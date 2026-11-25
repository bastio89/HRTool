const express = require('express');
const db = require('../database');
const { logAiCall } = require('../aiLogger');
const { logAudit } = require('./audit');
const { matchingRateLimiter } = require('../middleware/rateLimiter');
const { buildMatchingSummary } = require('../utils/matchingSummary');
const { promptGuard } = require('../middleware/promptSanitizer');
const { sanitizeObject } = require('../middleware/promptSanitizer');
const apiKeyAuth = require('../middleware/apiKey');
const { getAiConfig, stripReasoningTags, resolveAiProvider, buildAiRequest, extractAiText, pingAiService } = require('../aiConfig');
const { graphRagRequest, RUN_ID } = require('../graphragRequest');
// Alle Paarungen eines Laufs landen zusaetzlich in matching_pair_results,
// damit sie als N:N-Export (Administration -> Datenexport) abrufbar sind.
// Produktive Schreibfehler werden gemeldet; GraphRAG bestaetigt eigene Writes.
const { recordMatchingPairsSafely, rememberMatchingRequest, saveMatchingHistory } = require('../matchingPairs');
// 3D-Matching ueber die UUID: vorher fehlende Neo4j-Eintraege nachholen.
const { ensureGraphNodes } = require('../graphNodes');

const router = express.Router();

const MATCHING_CANDIDATE_FIELDS = `
  id, name, email, location, experience, skills, education,
  desired_salary, availability, languages, certificates, mobility,
  notes, status, tags, source, current_employer, current_position,
  linkedin_url, xing_url, github_url, portfolio_url, drivers_license,
  salary_min, salary_max, salary_currency, salary_interval,
  notice_period, available_from, nationality, work_permit, work_permit_until,
  gender, parsing_method, uuid
`;

const MATCHING_JOB_FIELDS = `
  id, title, description, requirements, skills, location, type, status, url, uuid
`;

const WEIGHT_LABELS = {
  skills: 'Fachliche Qualifikation / Skills',
  experience: 'Berufserfahrung',
  education: 'Ausbildung / Hochschulabschluss',
  location: 'Wohnortnähe / Standort',
  languages: 'Sprachkenntnisse',
  salary: 'Gehaltsvorstellung',
  availability: 'Verfügbarkeit / Startdatum',
  certificates: 'Zertifikate / Weiterbildungen',
  cultural_fit: 'Kulturelle Passung / Soft Skills',
  mobility: 'Mobilität / Führerschein'
};

function getCandidates(candidateIds) {
  if (candidateIds && candidateIds.length > 0) {
    const ids = candidateIds.map(Number).filter(Boolean);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT ${MATCHING_CANDIDATE_FIELDS} FROM candidates WHERE id IN (${placeholders})`).all(...ids);
  }
  return db.prepare(`SELECT ${MATCHING_CANDIDATE_FIELDS} FROM candidates`).all();
}

function getCandidateByName(candidateName) {
  if (!candidateName) return null;
  return db.prepare(`SELECT ${MATCHING_CANDIDATE_FIELDS} FROM candidates WHERE lower(name) = lower(?) LIMIT 1`).get(candidateName);
}

function getCandidatesByNames(candidateNames) {
  const names = (candidateNames || []).map((name) => String(name || '').trim()).filter(Boolean);
  if (names.length === 0) return [];

  const seen = new Set();
  const candidates = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = getCandidateByName(name);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function hasCandidateTextsTable() {
  try {
    const row = db.prepare("SELECT to_regclass('public.candidate_texts') AS exists").get();
    return Boolean(row?.exists);
  } catch {
    return false;
  }
}

function getCandidateTextById(candidateId) {
  if (!candidateId || !hasCandidateTextsTable()) return null;
  return db.prepare(`
    SELECT candidate_name, original_text, anonymized_text, profile_json
    FROM candidate_texts
    WHERE candidate_id = CAST(? AS TEXT)
    LIMIT 1
  `).get(candidateId);
}

function buildCandidateFullText(candidate, candidateText) {
  const parts = [];
  if (candidateText?.candidate_name) parts.push(`CV-Name: ${candidateText.candidate_name}`);
  if (candidateText?.original_text) parts.push(`CV-Volltext:\n${candidateText.original_text}`);
  else if (candidateText?.anonymized_text) parts.push(`CV-Volltext:\n${candidateText.anonymized_text}`);
  if (candidateText?.profile_json) {
    let profile = candidateText.profile_json;
    if (typeof profile === 'string') {
      try { profile = JSON.parse(profile); } catch (_) { profile = null; }
    }
    // Das Geburtsdatum dient nur der Identifikation und gehoert nicht ins
    // Matching (Altersdiskriminierung).
    if (profile && typeof profile === 'object') {
      const { birth_date: _birthDate, ...matchingProfile } = profile;
      const profileJson = JSON.stringify(matchingProfile);
      if (profileJson !== '{}') parts.push(`CV-Struktur:\n${profileJson}`);
    }
  }
  return parts.join('\n\n').trim();
}

function getJobs(jobIds) {
  if (jobIds && jobIds.length > 0) {
    const ids = jobIds.map(Number).filter(Boolean);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT ${MATCHING_JOB_FIELDS} FROM jobs WHERE id IN (${placeholders})`).all(...ids);
  }
  return db.prepare(`SELECT ${MATCHING_JOB_FIELDS} FROM jobs WHERE status IS NULL OR status != 'Archiviert' ORDER BY created_at DESC`).all();
}

function getJobByTitle(jobTitle) {
  if (!jobTitle) return null;
  return db.prepare(`SELECT ${MATCHING_JOB_FIELDS} FROM jobs WHERE lower(title) = lower(?) LIMIT 1`).get(jobTitle);
}

function splitSkillValues(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitSkillValues(item))
      .filter(Boolean);
  }

  if (value == null) {
    return [];
  }

  if (typeof value === 'object') {
    const name = value.name || value.label || value.title || value.skill || value.value;
    return name ? [String(name).trim()] : [];
  }

  if (typeof value === 'string') {
    return value
      .split(/[,;\n|]+/)
      .map((item) => item.trim().replace(/^[\u2022\u25cf\u25e6\-–—*]+\s*/, '').trim())
      .filter(Boolean);
  }

  return [String(value).trim()].filter(Boolean);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

const MAX_STORED_MATCH_ROWS = 100;

function compactStoredMatchingResult(result, { direction, engine } = {}) {
  const matrix = Array.isArray(result?.matrix) ? result.matrix : [];
  const compactRow = (row) => ({
    method: row.method,
    qualified: row.qualified,
    model: row.model,
    matchedAt: row.matchedAt,
    cacheStatus: row.cacheStatus,
    evaluationId: row.evaluationId,
    jobId: row.jobId,
    candidateId: row.candidateId,
    sourceJobId: row.sourceJobId,
    sourceCandidateId: row.sourceCandidateId,
    jobTitle: row.jobTitle,
    candidateName: row.candidateName,
    score: row.score,
    vectorScore: row.vectorScore,
    hardSkillScore: row.hardSkillScore,
    softSkillScore: row.softSkillScore,
    summary: typeof row.summary === 'string' ? row.summary.slice(0, 240) : undefined,
  });
  const storedMatrix = [...matrix]
    .sort((left, right) => (Number(right?.score) || 0) - (Number(left?.score) || 0))
    .slice(0, MAX_STORED_MATCH_ROWS)
    .map(compactRow);
  const compactRankings = (groups, idKey, nameKey) => (Array.isArray(groups) ? groups : []).map((group) => ({
    [idKey]: group[idKey],
    [nameKey]: group[nameKey],
    results: [...(Array.isArray(group.results) ? group.results : [])]
      .sort((left, right) => (Number(right?.score) || 0) - (Number(left?.score) || 0))
      .slice(0, 5)
      .map(compactRow),
  }));

  return {
    method: result?.method,
    pairsPersisted: result?.pairsPersisted,
    type: result?.type,
    mode: result?.mode,
    model: result?.model,
    matchedAt: result?.matchedAt,
    runId: result?.runId,
    statusUrl: result?.statusUrl,
    embeddingModel: result?.embeddingModel,
    direction: direction ?? result?.direction,
    engine: engine ?? result?.engine,
    jobs: (Array.isArray(result?.jobs) ? result.jobs : []).map(({ id, title }) => ({ id, title })),
    candidates: (Array.isArray(result?.candidates) ? result.candidates : []).map(({ id, name }) => ({ id, name })),
    jobsRanked: compactRankings(result?.jobsRanked, 'jobId', 'jobTitle'),
    candidatesRanked: compactRankings(result?.candidatesRanked, 'candidateId', 'candidateName'),
    // Bewerber/Stellen, die nicht gematcht werden konnten (mit Grund).
    missing: Array.isArray(result?.missing) && result.missing.length ? result.missing.slice(0, 100) : undefined,
    totalPairCount: matrix.length,
    storedPairCount: storedMatrix.length,
    truncated: matrix.length > storedMatrix.length,
    matrix: storedMatrix,
  };
}

// Bewerber bzw. Stellen zu den angefragten IDs: PostgreSQL-ID, UUID oder eine
// aeltere Neo4j-ID. Liefert eine Map von jeder dieser IDs auf den Datensatz.
function resolveRecords(table, values) {
  const fields = table === 'candidates' ? MATCHING_CANDIDATE_FIELDS : MATCHING_JOB_FIELDS;
  const graphColumn = table === 'candidates' ? 'graph_candidate_id' : 'graph_job_id';
  const raw = [...new Set((values || []).map(value => String(value ?? '').trim()).filter(Boolean))];
  const numeric = raw.filter(value => /^\d+$/.test(value)).map(Number);
  const other = raw.filter(value => !/^\d+$/.test(value));
  const conditions = [];
  const params = [];
  if (numeric.length) {
    conditions.push(`id IN (${numeric.map(() => '?').join(',')})`);
    params.push(...numeric);
  }
  if (other.length) {
    const list = other.map(() => '?').join(',');
    conditions.push(`uuid::text IN (${list}) OR ${graphColumn} IN (${list})`);
    params.push(...other, ...other);
  }
  const map = new Map();
  if (!conditions.length) return map;
  const rows = db.prepare(`SELECT ${fields}, ${graphColumn} AS graph_id FROM ${table} WHERE ${conditions.join(' OR ')}`).all(...params);
  for (const row of rows) {
    for (const key of [row.id, row.uuid, row.graph_id]) {
      if (key !== null && key !== undefined && key !== '') map.set(String(key), row);
    }
  }
  return map;
}

const byUuid = (records) => new Map((records || []).filter(Boolean).map(record => [String(record.uuid), record]));

// GraphRAG antwortet mit den UUIDs; das Tool arbeitet mit den PostgreSQL-IDs.
function remapByUuid(graphRagResult, { jobsByUuid, candidatesByUuid }) {
  const mapRow = (row) => {
    const job = jobsByUuid.get(String(row.jobId));
    const candidate = candidatesByUuid.get(String(row.candidateId));
    return {
      ...row,
      sourceJobId: row.jobId,
      sourceCandidateId: row.candidateId,
      jobId: job?.id ?? row.jobId,
      jobTitle: job?.title ?? row.jobTitle,
      candidateId: candidate?.id ?? row.candidateId,
      candidateName: candidate?.name ?? row.candidateName,
    };
  };
  const mapGroups = (groups, idKey, nameKey, records, nameField) => (Array.isArray(groups) ? groups : []).map((group) => {
    const record = records.get(String(group[idKey]));
    return {
      ...group,
      [idKey]: record?.id ?? group[idKey],
      [nameKey]: record?.[nameField] ?? group[nameKey],
      results: Array.isArray(group.results) ? group.results.map(mapRow) : [],
    };
  });
  return {
    ...graphRagResult,
    matrix: (Array.isArray(graphRagResult?.matrix) ? graphRagResult.matrix : []).map(mapRow),
    jobsRanked: mapGroups(graphRagResult?.jobsRanked, 'jobId', 'jobTitle', jobsByUuid, 'title'),
    candidatesRanked: mapGroups(graphRagResult?.candidatesRanked, 'candidateId', 'candidateName', candidatesByUuid, 'name'),
  };
}

// Was im Ergebnis fehlt und warum: Abgleich gescheitert oder kein Eintrag in
// Neo4j. Wird mit dem Ergebnis angezeigt statt stillschweigend wegzufallen.
function describeMissing({ graphRagResult = {}, jobsByUuid, candidatesByUuid, jobErrors = new Map(), candidateErrors = new Map(), skippedJobs = [], skippedCandidates = [] }) {
  const missing = [];
  for (const job of skippedJobs) missing.push({ type: 'job', id: job.id, name: job.title, reason: jobErrors.get(Number(job.id)) });
  for (const candidate of skippedCandidates) missing.push({ type: 'candidate', id: candidate.id, name: candidate.name, reason: candidateErrors.get(Number(candidate.id)) });
  for (const uuid of graphRagResult.missingJobIds || []) {
    const job = jobsByUuid.get(String(uuid));
    missing.push({ type: 'job', id: job?.id ?? uuid, name: job?.title ?? null, reason: 'Kein Eintrag in Neo4j' });
  }
  for (const uuid of graphRagResult.missingCandidateIds || []) {
    const candidate = candidatesByUuid.get(String(uuid));
    missing.push({ type: 'candidate', id: candidate?.id ?? uuid, name: candidate?.name ?? null, reason: 'Kein Eintrag in Neo4j' });
  }
  return missing;
}

function userError(message, status = 422, details = null) {
  return Object.assign(new Error(message), { status, userMessage: true, details });
}

// Meldung aus einem GraphRAG-404 ("nichts davon ist in Neo4j") mit Namen.
function explainGraphRagMiss(error, { jobsByUuid, candidatesByUuid }) {
  if (error.status !== 404 || !error.detailObject) return error;
  const detail = error.detailObject;
  const names = [
    ...(detail.missingCandidateIds || []).map(id => candidatesByUuid.get(String(id))?.name || id),
    ...(detail.missingJobIds || []).map(id => jobsByUuid.get(String(id))?.title || id),
  ];
  return userError(`${detail.error || 'Kein Eintrag in Neo4j'}${names.length ? `: ${names.join(', ')}` : ''}`, 422, detail);
}

const runMetadata = data => data.runId
  ? { runId: data.runId, statusUrl: `/api/matching/runs/${data.runId}` } : {};

function matchingContext(kind, { jobs = [], candidates = [], ...fields }) {
  const unique = rows => [...new Map(rows.map(row => [String(row.id), row])).values()];
  const jobRows = unique(jobs).map(({ id, uuid, title }) => ({ id, uuid, title }));
  const candidateRows = unique(candidates).map(({ id, uuid, name }) => ({ id, uuid, name }));
  return {
    startedAt: Date.now(), ...fields, kind, jobs: jobRows, candidates: candidateRows,
    job_refs: jobRows.map(row => String(row.id)), candidate_refs: candidateRows.map(row => String(row.id)),
  };
}

function sendMatchingPending(res, error) {
  if (!error.matchingPending) return false;
  res.status(202).json(error.matchingPending);
  return true;
}

function tagMatchingResponse(data, method, rowsKey) {
  if (!Array.isArray(data?.[rowsKey])) throw userError('Unvollstaendige GraphRAG-Matchingantwort', 502);
  if (data.method && data.method !== method) throw userError('Unerwartete GraphRAG-Matchingmethode', 502);
  const tagRow = row => {
    if (row.method && row.method !== method) throw userError('Unerwartete GraphRAG-Paarmethode', 502);
    return { ...row, method };
  };
  return {
    ...data, method, ...runMetadata(data),
    [rowsKey]: data[rowsKey].map(tagRow),
    ...(Array.isArray(data.jobsRanked) ? { jobsRanked: data.jobsRanked.map(group => ({ ...group, results: group.results.map(tagRow) })) } : {}),
    ...(Array.isArray(data.candidatesRanked) ? { candidatesRanked: data.candidatesRanked.map(group => ({ ...group, results: group.results.map(tagRow) })) } : {}),
  };
}

async function callGraphRagMatching(req, endpoint, payload) {
  const { data, status } = await graphRagRequest(req, endpoint, payload);
  if (status === 202 || data.runId) {
    if (!RUN_ID.test(data.runId) || !req.matchingContext) {
      throw userError('Unvollstaendige GraphRAG-Laufantwort', 502);
    }
    rememberMatchingRequest(db, data.runId, req.user?.id, { ...req.matchingContext, actorId: req.user?.id });
  }
  if (status === 202) {
    if (data.status !== 'pending' || !Array.isArray(data.pendingPairs) || !Array.isArray(data.availableResults)) {
      throw userError('Ungueltige GraphRAG-Pending-Antwort', 502);
    }
    throw Object.assign(new Error('Matching laeuft im Hintergrund'), {
      matchingPending: { ...data, ...runMetadata(data) },
    });
  }
  if (data.runId && data.pairsPersisted !== true) {
    throw userError('GraphRAG hat die Paarpersistenz nicht bestaetigt', 502);
  }
  return tagMatchingResponse(data, endpoint === '/match/ki_match_pairs' ? 'ai' : 'vector',
    ['/match/ki_match_pairs', '/match/external/run', '/match/vectormatch-selected'].includes(endpoint) ? 'results' : 'matrix');
}

function finishMatching(req, remote, context, completedAt = null) {
  const { kind, jobs, candidates, engine, direction } = context;
  const maps = {
    jobsByUuid: new Map(jobs.flatMap(row => [[String(row.id), row], [String(row.uuid), row]])),
    candidatesByUuid: new Map(candidates.flatMap(row => [[String(row.id), row], [String(row.uuid), row]])),
  };
  let result = { ...remote, ...runMetadata(remote) };
  if (kind === 'vector') {
    result = { ...remapByUuid(result, maps), direction };
    result.missing = [...(context.missing || []), ...describeMissing({ graphRagResult: remote, ...maps })];
  } else if (['ai-run', 'ai-selected', 'vector-selected'].includes(kind)) {
    result.results = remapByUuid({ matrix: result.results }, maps).matrix;
    result.failures = [...(result.failures || []), ...(kind === 'vector-selected' ? [] : context.localFailures || [])];
    result.selectedCount = context.selectedCount;
    result.matchedCount = result.results.length;
    result.failedCount = result.failures.length;
  } else if (kind === 'external') {
    const external = new Map(context.externalCandidates.map(row => [String(row.id), row]));
    result.results = result.results.map(row => ({
      ...row, externalCandidateId: external.get(String(row.candidateId))?.externalId || String(row.candidateId),
      candidateName: external.get(String(row.candidateId))?.name || row.candidateName,
      strengths: row.strengths || [], weaknesses: row.weaknesses || [], summary: row.summary || '',
    }));
  }
  const hasHistory = ['ai-run', 'matrix', 'vector'].includes(kind);
  const history = hasHistory ? saveMatchingHistory(db, {
    runId: result.runId, description: context.description, title: context.title,
    result: kind === 'ai-run' ? result : compactStoredMatchingResult(result, { direction, engine }),
    summary: kind === 'ai-run' ? buildMatchingSummary(result) : null, jobId: context.jobId,
  }) : null;
  if (!history || history.created) {
    recordMatchingPairsSafely(db, result.method, result.matrix || result.results, {
      pairsPersisted: result.pairsPersisted === true, matchingResultId: history?.lastInsertRowid,
      jobIds: jobs.map(row => row.id), candidateIds: candidates.map(row => row.id),
      model: result.model, matchedAt: result.matchedAt, engine,
    });
    logAudit(req, kind === 'ai-selected' ? 'ki-matching-batch'
      : kind === 'ai-run' ? 'ki-matching' : kind === 'matrix' ? 'ki-matching-matrix'
        : kind === 'external' ? 'external-matching' : 'ki-matching-vector',
    'Matching', history?.lastInsertRowid ?? null, context.title || 'Matching selektierte Paarungen', {
      engine, direction, jobCount: jobs.length,
      candidateCount: kind === 'ai-run' ? context.selectedCount : candidates.length,
      selectedCount: context.selectedCount, matchedCount: result.matchedCount, failedCount: result.failedCount,
      jobId: context.jobId, candidateId: direction === 'candidate_to_jobs' ? candidates[0]?.id : undefined,
      pairCount: (result.matrix || result.results).length, topScore: (result.matrix || result.results)[0]?.score ?? null,
      model: result.model, durationMs: Date.now() - context.startedAt,
    });
    if (kind === 'ai-run') logAiCall({
      userId: context.actorId || req.user?.id, feature: 'matching', model: result.model,
      prompt: JSON.stringify(context.prompt), response: JSON.stringify(result), parsedResult: result,
      durationMs: Date.now() - context.startedAt, success: true,
    });
  }
  result.pairsPersisted = true;
  const metadata = runMetadata(result);
  const timestamp = completedAt || result.matchedAt || new Date(context.startedAt).toISOString();
  if (kind === 'external') return {
    ...metadata, job: context.externalJob, results: result.results,
    candidateCount: context.externalCandidates.length, model: result.model || null, method: result.method,
    pairsPersisted: true, matchedAt: result.matchedAt,
    durationMs: Math.max(0, Date.parse(completedAt || new Date().toISOString()) - context.startedAt), timestamp,
  };
  if (!hasHistory) return result;
  return {
    ...metadata, id: history.lastInsertRowid, jobTitle: context.title, results: result,
    candidateCount: kind === 'ai-run' ? context.selectedCount : candidates.length,
    ...(kind === 'matrix' || direction === 'candidate_to_jobs' ? { jobCount: jobs.length } : {}),
    ...(kind === 'matrix' ? { pairCount: result.matrix.length } : {}),
    ...(kind === 'ai-run' ? { jobId: context.jobId } : { engine }),
    ...(direction ? { direction } : {}), timestamp,
  };
}

/**
 * @swagger
 * /matching/runs/{runId}:
 *   get:
 *     summary: Eigenen dauerhaften Matching-Lauf und dessen Abschluss laden
 *     description: Eigentuemern und aktuell gespeicherten Administratoren vorbehalten. Abschluss-Polling behaelt die urspruengliche Erfolgsform unter resultPayload, ohne doppelte Historie oder Paarwrites. Kein erneuter Matching-POST notwendig.
 *     tags: [Matching]
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Laufstatus mit optionalem Abschluss
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MatchingRunStatus' }
 *       400: { description: Ungueltige Lauf-ID }
 *       401: { description: Gueltiger bestehender Benutzer erforderlich }
 *       404: { description: Lauf unbekannt, geloescht oder nicht zugreifbar }
 */
router.get('/runs/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    if (!RUN_ID.test(runId)) throw userError('Ungueltige Matching-Lauf-ID', 400);
    const { data } = await graphRagRequest(req, `/matching/runs/${runId}`);
    const row = db.prepare(`SELECT client_context FROM matching_runs
      WHERE id = ? AND (actor_user_id = ? OR EXISTS (
        SELECT 1 FROM users WHERE id = ? AND role = 'admin'
      )) AND error_code IS DISTINCT FROM 'source_deleted'`)
      .get(runId, req.user?.id, req.user?.id);
    if (!row) throw userError('Matching-Anfrage nicht gefunden', 404);
    const context = row.client_context;
    const response = { ...data, ...runMetadata({ runId }) };
    if (data.resultPayload && context) {
      if (data.resultPayload.runId !== runId || data.resultPayload.pairsPersisted !== true) {
        throw userError('Unvollstaendiges gespeichertes Matching-Ergebnis', 502);
      }
      const method = context.kind.startsWith('ai-') ? 'ai' : 'vector';
      response.resultPayload = finishMatching(req,
        tagMatchingResponse(data.resultPayload, method, ['vector', 'matrix'].includes(context.kind) ? 'matrix' : 'results'),
        context, data.updatedAt);
    }
    res.json(response);
  } catch (error) {
    console.error('Error reading matching run:', error);
    res.status(error.status || 500).json({ error: 'Matching-Lauf konnte nicht geladen werden', details: error.message });
  }
});

function buildJobDescription(job) {
  const parts = [];
  if (job.description) parts.push(job.description);
  if (job.requirements) parts.push(`Anforderungen:\n${job.requirements}`);
  if (job.location) parts.push(`Standort: ${job.location}`);
  if (job.type) parts.push(`Arbeitsmodell: ${job.type}`);
  return parts.join('\n\n').trim() || job.title || 'Unbenannte Stelle';
}

function buildWeightInstructions(weights) {
  if (!weights || typeof weights !== 'object') return '';

  const nonZero = Object.entries(weights).filter(([key, value]) => value !== 0 && WEIGHT_LABELS[key]);
  if (nonZero.length === 0) return '';

  const increased = nonZero.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const decreased = nonZero.filter(([, value]) => value < 0).sort((a, b) => a[1] - b[1]);

  let instructions = '\n\nWICHTIG – GEWICHTUNG DER BEWERTUNGSKRITERIEN:\n';
  instructions += 'Der Recruiter hat folgende Gewichtungsanpassungen vorgenommen (Skala -10 bis +10, 0=Standard):\n';

  if (increased.length > 0) {
    instructions += '\nSTÄRKER GEWICHTEN (höhere Priorität):\n';
    for (const [key, value] of increased) {
      const intensity = value >= 7 ? 'SEHR STARK' : value >= 4 ? 'STARK' : 'LEICHT';
      instructions += `- ${WEIGHT_LABELS[key]}: +${value} → ${intensity} höher gewichten\n`;
    }
  }
  if (decreased.length > 0) {
    instructions += '\nWENIGER GEWICHTEN (niedrigere Priorität):\n';
    for (const [key, value] of decreased) {
      const intensity = value <= -7 ? 'FAST IGNORIEREN' : value <= -4 ? 'DEUTLICH WENIGER' : 'ETWAS WENIGER';
      instructions += `- ${WEIGHT_LABELS[key]}: ${value} → ${intensity} gewichten\n`;
    }
  }
  instructions += '\nPasse deinen Score entsprechend dieser Gewichtung an. Kriterien mit hoher Gewichtung sollen überproportional in den Score einfließen.\n';
  return instructions;
}

function buildJobToCandidatesPrompt({ job, candidates, weights }) {
  const weightInstructions = buildWeightInstructions(weights);
  const jobProfile = job && typeof job === 'object' ? job : {};
  const jobTitle = jobProfile.title || 'Unbenannte Stelle';
  const jobDescription = buildJobDescription(jobProfile);
  const jobSkills = splitSkillValues(jobProfile.skills || jobProfile.requirements || jobDescription);
  const rawJobText = jobProfile.rawDescription || jobProfile.sourceDescription || '';

  return `Du bist ein erfahrener HR-Analyst. Analysiere das folgende Jobprofil und die Kandidatenprofile und bewerte jeden mit einem Score von 0-100.

WICHTIGE BEWERTUNGSREGELN:
- Nutze primär den Job-Volltext und den CV-Volltext.
- Beziehe Skills, Erfahrung, Ausbildung, Sprachen, Standort und Arbeitsmodell ein.
- Gib nicht nur Wortähnlichkeit wieder, sondern bewerte die tatsächliche Passung zur Stelle.
- Wenn der CV nur teilweise passt, setze einen mittleren Score. Wenn die Passung klar ist, setze einen hohen Score.
- Wenn wichtige Anforderungen fehlen, senke den Score deutlich.
- Antworte ausschließlich mit JSON und ohne zusätzliche Erklärungen.

Jobprofil:
- ID: ${jobProfile.id ?? 'k.A.'}
- Titel: ${jobTitle}
- Beschreibung: ${jobProfile.description || 'k.A.'}
- Anforderungen: ${jobProfile.requirements || 'k.A.'}
- Skills: ${jobSkills.length > 0 ? jobSkills.join(', ') : 'k.A.'}
- Standort: ${jobProfile.location || 'k.A.'}
- Arbeitsmodell: ${jobProfile.type || 'k.A.'}
${rawJobText ? `- Job-Volltext:\n${rawJobText}\n` : ''}
${weightInstructions}

Score-Raster als Orientierung:
- 0-20: klare Nicht-Passung
- 21-40: schwache Passung
- 41-60: teilweise passende Profile
- 61-80: gute Passung
- 81-100: sehr starke Passung

Stellentitel: ${jobTitle}

Kandidatenprofile:
${candidates.map((c, idx) => `Kandidat ${idx + 1} (ID: ${c.id}):
- Name: ${c.name || 'k.A.'}
- Skills: ${c.skills || 'k.A.'}
- Erfahrung: ${c.experience || 'k.A.'}
- Ausbildung: ${c.education || 'k.A.'}
- Sprachen: ${c.languages || 'k.A.'}
- Standort: ${c.location || 'k.A.'}
- Gehaltsvorstellung: ${c.desired_salary || 'k.A.'}
- Verfügbarkeit: ${c.availability || 'k.A.'}
- Zertifikate: ${c.certificates || 'k.A.'}
- Mobilität: ${c.mobility || 'k.A.'}`).join('\n\n')}

${candidates.map((c, idx) => {
  const sections = [];
  if (c.fullText) sections.push(`Zusätzlicher Kandidatenkontext ${idx + 1}:\n${c.fullText}`);
  return sections.join('\n\n');
}).filter(Boolean).join('\n\n')}

Antworte NUR mit einem validen JSON-Objekt in diesem Format (kein Text davor oder danach):
{
  "results": [
    {
      "candidateId": <id>,
      "candidateName": "Kandidat X",
      "score": <0-100>,
      "strengths": ["Stärke 1", "Stärke 2"],
      "weaknesses": ["Schwäche 1"],
      "summary": "Kurze Begründung"
    }
  ]
}`;
}

async function assertAiReachable(baseUrl, provider) {
  if (typeof pingAiService === 'function') {
    await pingAiService(baseUrl, provider, 3000);
    return;
  }
  const url = provider === 'openai' ? `${baseUrl}/v1/models` : `${baseUrl}/`;
  await fetch(url);
}

async function generateJson({ baseUrl, model, provider, prompt, timeoutMs = 180000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { url, body, headers } = buildAiRequest({ baseUrl, model, provider, prompt, format: 'json', options: { temperature: 0.2 } });
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    if (!response.ok) {
      const error = new Error(response.status === 429
        ? 'Das KI-Modell wurde vom Provider rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
        : `AI HTTP ${response.status}`);
      error.status = response.status;
      error.raw = raw;
      throw error;
    }

    const data = JSON.parse(raw);
    const { text } = extractAiText(data, provider);
    return { raw, parsed: JSON.parse(stripReasoningTags(text)) };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeJobResults({ parsed, job, candidates }) {
  const candidateMap = new Map(candidates.map(c => [c.id, c.name]));
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  return results.map((result) => ({
    ...result,
    jobId: job.id,
    jobTitle: job.title,
    candidateName: candidateMap.get(result.candidateId) || result.candidateName,
    score: Math.max(0, Math.min(100, Number(result.score) || 0)),
  })).sort((a, b) => b.score - a.score);
}

async function runAiMatchingCore({ resolvedJob, candidates, weights }) {
  const startTime = Date.now();
  const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: PROVIDER_CFG } = getAiConfig();
  const aiProvider = await resolveAiProvider(OLLAMA_URL, PROVIDER_CFG);

  try {
    await assertAiReachable(OLLAMA_URL, aiProvider);
  } catch {
    const error = new Error('KI-Host nicht erreichbar. Bitte stellen Sie sicher, dass der KI-Server läuft.');
    error.status = 503;
    throw error;
  }

  const enrichedCandidates = candidates.map((candidate) => {
    const candidateText = getCandidateTextById(candidate.id);
    return {
      ...candidate,
      fullText: buildCandidateFullText(candidate, candidateText),
    };
  });

  const prompt = buildJobToCandidatesPrompt({
    job: {
      ...resolvedJob,
      rawDescription: resolvedJob.rawDescription || resolvedJob.description || resolvedJob.jobDescription || '',
    },
    candidates: enrichedCandidates,
    weights,
  });

  const { raw, parsed } = await generateJson({
    baseUrl: OLLAMA_URL,
    model: OLLAMA_MODEL,
    provider: aiProvider,
    prompt,
    timeoutMs: 180000,
  });

  const matchingResults = {
    results: normalizeJobResults({ parsed, job: resolvedJob, candidates: enrichedCandidates }),
  };
  const candidateMap = new Map(enrichedCandidates.map((candidate) => [candidate.id, candidate.name]));
  if (matchingResults.results) {
    matchingResults.results = matchingResults.results.map((result) => ({
      ...result,
      candidateName: candidateMap.get(result.candidateId) || result.candidateName,
    }));
  }

  return {
    prompt,
    raw,
    matchingResults,
    model: OLLAMA_MODEL,
    durationMs: Date.now() - startTime,
  };
}

function buildMatrixResult({ jobs, candidates, rows, mode, model }) {
  const candidateMap = new Map(candidates.map(c => [c.id, c.name]));
  const jobsRanked = jobs.map(job => ({
    jobId: job.id,
    jobTitle: job.title,
    results: rows.filter(row => row.jobId === job.id).sort((a, b) => b.score - a.score),
  }));
  const candidatesRanked = candidates.map(candidate => ({
    candidateId: candidate.id,
    candidateName: candidateMap.get(candidate.id) || candidate.name,
    results: rows.filter(row => row.candidateId === candidate.id).sort((a, b) => b.score - a.score),
  }));

  return {
    type: 'matrix',
    mode,
    model,
    matchedAt: new Date().toISOString(),
    jobs: jobs.map(job => ({ id: job.id, title: job.title })),
    candidates: candidates.map(candidate => ({ id: candidate.id, name: candidate.name })),
    matrix: rows.sort((a, b) => b.score - a.score),
    jobsRanked,
    candidatesRanked,
  };
}

// 3D-Matching ueber GraphRAG. Bewerber und Stellen werden per UUID gesucht
// (nicht mehr ueber den Namen); fehlende Neo4j-Eintraege werden vorher
// nachgeholt, was dann noch fehlt, steht in result.missing.
async function runVectorMatch(req, { direction = 'job_to_candidates', jobId, jobTitle, candidateId, candidateName, candidateIds, engine = 'python' }) {
  const endpoint = '/match/vectormatch';

  if (direction === 'candidate_to_jobs') {
    const requestedId = candidateId ?? candidateIds?.[0] ?? null;
    const candidate = (requestedId !== null && resolveRecords('candidates', [requestedId]).get(String(requestedId)))
      || getCandidateByName(candidateName);
    if (!candidate) throw userError('Bewerber nicht gefunden', 404);
    const allJobs = getJobs();
    if (allJobs.length === 0) throw userError('Keine Stellen vorhanden', 404);

    const { candidateErrors, jobErrors } = await ensureGraphNodes(db, req, { candidateIds: [candidate.id], jobIds: allJobs.map(job => job.id) });
    if (candidateErrors.has(Number(candidate.id))) {
      throw userError(`${candidate.name} ist nicht in Neo4j und konnte nicht übertragen werden: ${candidateErrors.get(Number(candidate.id))}`);
    }
    const jobs = allJobs.filter(job => !jobErrors.has(Number(job.id)));
    const skippedJobs = allJobs.filter(job => jobErrors.has(Number(job.id)));
    if (jobs.length === 0) throw userError(`Keine Stelle konnte nach Neo4j übertragen werden: ${[...jobErrors.values()][0]}`);

    const maps = { jobsByUuid: byUuid(allJobs), candidatesByUuid: byUuid([candidate]) };
    req.matchingContext = matchingContext('vector', {
      jobs: allJobs, candidates: [candidate], direction, engine,
      title: `Bewerber → alle Stellen: ${candidate.name || 'Unbenannter Bewerber'}`,
      description: `Vector-Matching (${engine}) für ${candidate.name || 'Unbenannter Bewerber'}`,
      missing: describeMissing({ ...maps, jobErrors, skippedJobs }),
    });
    let graphRagResult;
    try {
      graphRagResult = await callGraphRagMatching(req, endpoint, { jobIds: jobs.map(job => job.uuid), cvIds: [candidate.uuid], engine });
    } catch (error) {
      throw explainGraphRagMiss(error, maps);
    }
    return { graphRagResult };
  }

  const job = (jobId !== undefined && jobId !== null && resolveRecords('jobs', [jobId]).get(String(jobId))) || getJobByTitle(jobTitle);
  if (!job) throw userError('Stelle nicht gefunden', 404);
  const candidateMap = resolveRecords('candidates', candidateIds);
  const allCandidates = [...new Map((candidateIds || [])
    .map(value => candidateMap.get(String(value)))
    .filter(Boolean)
    .map(candidate => [candidate.id, candidate])).values()];
  if (allCandidates.length === 0) throw userError('Keiner der ausgewählten Bewerber wurde gefunden', 404);

  const { candidateErrors, jobErrors } = await ensureGraphNodes(db, req, { candidateIds: allCandidates.map(c => c.id), jobIds: [job.id] });
  if (jobErrors.has(Number(job.id))) {
    throw userError(`Die Stelle „${job.title}“ ist nicht in Neo4j und konnte nicht übertragen werden: ${jobErrors.get(Number(job.id))}`);
  }
  const candidates = allCandidates.filter(candidate => !candidateErrors.has(Number(candidate.id)));
  const skippedCandidates = allCandidates.filter(candidate => candidateErrors.has(Number(candidate.id)));
  if (candidates.length === 0) {
    throw userError(`Keiner der Bewerber konnte nach Neo4j übertragen werden: ${skippedCandidates.map(c => c.name).join(', ')} (${[...candidateErrors.values()][0]})`);
  }

  const maps = { jobsByUuid: byUuid([job]), candidatesByUuid: byUuid(allCandidates) };
  req.matchingContext = matchingContext('vector', {
    jobs: [job], candidates: allCandidates, direction, engine, jobId: job.id,
    title: `Stelle → Kandidaten: ${job.title || 'Unbenannte Stelle'}`,
    description: `Vector-Matching (${engine}) für ${job.title || 'Unbenannte Stelle'}`,
    missing: describeMissing({ ...maps, candidateErrors, skippedCandidates }),
  });
  let graphRagResult;
  try {
    graphRagResult = await callGraphRagMatching(req, endpoint, { jobIds: [job.uuid], cvIds: candidates.map(c => c.uuid), engine });
  } catch (error) {
    throw explainGraphRagMiss(error, maps);
  }
  return { graphRagResult };
}

function sanitizeExternalPayload({ job, candidates }) {
  const sanitizedJob = sanitizeObject(job || {}, 'matching').sanitized;
  const sanitizedCandidates = candidates.map(candidate => sanitizeObject(candidate || {}, 'matching').sanitized);
  return { sanitizedJob, sanitizedCandidates };
}

function normalizeExternalCandidates(candidates) {
  return candidates.map((candidate, index) => ({
    id: candidate.id ?? null,
    externalId: String(candidate.id ?? ''),
    name: candidate.name || `Kandidat ${index + 1}`,
    location: candidate.location,
    experience: candidate.experience,
    skills: candidate.skills,
    has_skill: candidate.has_skill ?? candidate.skills,
    education: candidate.education,
    desired_salary: candidate.desired_salary,
    availability: candidate.availability,
    languages: candidate.languages,
    certificates: candidate.certificates,
    mobility: candidate.mobility,
  }));
}

/**
 * @swagger
 * /matching/external/run:
 *   post:
 *     summary: Externes Matching per OpenAPI REST starten
 *     deprecated: true
 *     description: Veralteter Endpunkt. Verwenden Sie stattdessen den GraphRAG-Endpoint /match/external/run direkt.
 *     tags: [Matching]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ExternalMatchingRequest'
 *     responses:
 *       200:
 *         description: Matching-Ergebnis mit Scores
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExternalMatchingResponse'
 *       400: { description: Ungueltige Eingabe }
 *       202: { $ref: '#/components/responses/MatchingPending' }
 *       402: { description: Credits fuer eine eigene Neuberechnung fehlen; Hits und Joins sind kostenlos }
 *       401: { description: API-Key fehlt oder ist ungueltig }
 *       422: { description: Gespeicherte IDs oder vorbereitete Job-Skills fehlen }
 *       503: { description: Skillbewertung oder Paarpersistenz fehlgeschlagen }
 */
router.post('/external/run', apiKeyAuth, matchingRateLimiter, async (req, res) => {
  const startTime = Date.now();
  try {
    const { job, candidates, weights, options = {} } = req.body;
    if (!job || typeof job !== 'object') return res.status(400).json({ error: 'job ist erforderlich' });
    if (!Array.isArray(candidates) || candidates.length === 0) return res.status(400).json({ error: 'Mindestens ein Kandidat ist erforderlich' });
    if (candidates.length > 50) return res.status(400).json({ error: 'Maximal 50 Kandidaten pro Anfrage erlaubt' });

    const { sanitizedJob, sanitizedCandidates } = sanitizeExternalPayload({ job, candidates });
    const normalizedCandidates = normalizeExternalCandidates(sanitizedCandidates);
    const normalizedJob = {
      id: sanitizedJob.id || null,
      title: sanitizedJob.title || 'Unbenannte Stelle',
      description: sanitizedJob.description,
      requirements: sanitizedJob.requirements,
      required_skills: sanitizedJob.required_skills ?? sanitizedJob.skills,
      location: sanitizedJob.location,
      type: sanitizedJob.type,
    };

    const jobDescription = buildJobDescription(normalizedJob);
    if (!jobDescription || jobDescription === 'Unbenannte Stelle') {
      return res.status(400).json({ error: 'Stellentitel, Beschreibung oder Anforderungen sind erforderlich' });
    }

    req.matchingContext = matchingContext('external', {
      jobs: [...resolveRecords('jobs', [normalizedJob.id]).values()],
      candidates: [...resolveRecords('candidates', normalizedCandidates.map(row => row.id)).values()],
      externalJob: { externalJobId: normalizedJob.id, title: normalizedJob.title },
      externalCandidates: normalizedCandidates.map(({ id, externalId, name }) => ({ id, externalId, name })),
      title: normalizedJob.title, startedAt: startTime,
    });
    const graphRagResult = await callGraphRagMatching(req, '/match/external/run', {
      job: normalizedJob,
      candidates: normalizedCandidates,
      weights,
      options,
    });
    res.json(finishMatching(req, graphRagResult, req.matchingContext));
  } catch (error) {
    if (sendMatchingPending(res, error)) return;
    console.error('Error running external matching:', error);
    res.status(error.status || (error.name === 'AbortError' ? 504 : 500)).json({
      error: error.name === 'AbortError' ? 'KI-Timeout beim externen Matching' : 'Fehler beim externen Matching',
      details: error.details || error.message,
    });
  }
});

/**
 * @swagger
 * /matching/run:
 *   post:
 *     summary: Unabhaengiges AI-Matching fuer explizite gespeicherte Paare
 *     tags: [Matching]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             required: [jobId, candidateIds]
 *             properties:
 *               jobId: { oneOf: [{ type: integer }, { type: string }], description: Gespeicherte ID oder UUID der Stelle }
 *               candidateIds: { type: array, minItems: 1, maxItems: 20, items: { oneOf: [{ type: integer }, { type: string }] }, description: Explizite gespeicherte Profil-IDs oder UUIDs }
 *     responses:
 *       200: { description: Matching-Ergebnis mit Scores }
 *       202: { $ref: '#/components/responses/MatchingPending' }
 *       402: { description: Credits fuer eine eigene AI-Neuberechnung fehlen }
 *       400: { description: Keine explizite gespeicherte Paarauswahl }
 *       502: { description: Externes Matching fehlgeschlagen }
 */
router.post('/run', matchingRateLimiter, promptGuard('matching'), async (req, res) => {
  try {
    const { candidateIds, candidateId, weights, jobId } = req.body;
    const normalizedCandidateIds = Array.isArray(candidateIds)
      ? candidateIds
      : (candidateId != null ? [candidateId] : []);
    if (jobId == null || !String(jobId).trim() || normalizedCandidateIds.length === 0) {
      return res.status(400).json({ error: 'Gespeicherte jobId und explizite candidateIds sind erforderlich' });
    }
    const jobRecord = resolveRecords('jobs', [jobId]).get(String(jobId).trim());
    if (!jobRecord) return res.status(404).json({ error: 'Gespeicherte Stelle nicht gefunden' });
    req.matchingContext = matchingContext('ai-run', {
      jobs: [jobRecord], jobId: jobRecord.id, title: jobRecord.title, description: buildJobDescription(jobRecord),
      prompt: { jobId: jobRecord.id, candidateIds: normalizedCandidateIds, weights },
    });
    const matchingResults = await runSelectedAiPairs(req, {
      pairs: normalizedCandidateIds.map(id => ({ jobId: jobRecord.id, candidateId: id })),
      weights,
    });
    res.json(finishMatching(req, matchingResults, req.matchingContext));
  } catch (error) {
    if (sendMatchingPending(res, error)) return;
    console.error('Error running matching:', error);
    const statusCode = error.status || (error.name === 'AbortError' ? 504 : 500);
    res.status(statusCode).json({ 
      error: statusCode === 429
        ? 'Das KI-Modell ist aktuell rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
        : statusCode === 503
          ? 'KI-Host nicht erreichbar. Bitte stellen Sie sicher, dass der KI-Server läuft.'
          : 'Fehler beim Matching',
      details: error.message
    });
  }
});

async function runSelectedAiPairs(req, { pairs, weights }) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
      throw userError('Mindestens eine Paarung ist erforderlich', 400);
    }
    if (pairs.length > 20) {
      throw userError('Maximal 20 Paarungen pro Anfrage erlaubt', 400);
    }

    // IDs serverseitig aufloesen (PostgreSQL-ID oder UUID) und eindeutig an
    // GraphRAG geben; der CV-Text liegt unter der PostgreSQL-ID.
    const jobMap = resolveRecords('jobs', pairs.flatMap(pair => [pair.jobId, pair.sourceJobId]));
    const candidateMap = resolveRecords('candidates', pairs.flatMap(pair => [pair.candidateId, pair.sourceCandidateId]));
    const localFailures = [];
    const resolvedPairs = [];
    for (const pair of pairs) {
      const job = jobMap.get(String(pair.jobId)) || jobMap.get(String(pair.sourceJobId));
      const candidate = candidateMap.get(String(pair.candidateId)) || candidateMap.get(String(pair.sourceCandidateId));
      if (!job || !candidate) {
        localFailures.push({ jobId: pair.jobId ?? null, jobTitle: pair.jobTitle || null, candidateId: pair.candidateId ?? null, candidateName: pair.candidateName || null, error: !job ? 'Stelle nicht gefunden' : 'Bewerber nicht gefunden' });
      } else {
        resolvedPairs.push({ jobId: String(job.id), jobTitle: job.title, candidateId: String(candidate.id), candidateName: candidate.name });
      }
    }
    req.matchingContext = matchingContext(req.matchingContext?.kind || 'ai-selected', {
      ...req.matchingContext, jobs: [...jobMap.values()], candidates: [...candidateMap.values()],
      localFailures, selectedCount: pairs.length,
    });
    if (resolvedPairs.length === 0) {
      return { method: 'ai', results: [], failures: [], selectedCount: pairs.length, matchedCount: 0, failedCount: 0 };
    }
    // Manuell angelegte Bewerber erhalten dabei ihren CV-Text (ohne ihn findet
    // GraphRAG sie fuer das KI-Matching nicht).
    await ensureGraphNodes(db, req, { candidateIds: resolvedPairs.map(pair => Number(pair.candidateId)) });

    return callGraphRagMatching(req, '/match/ki_match_pairs', { pairs: resolvedPairs, weights });
}

/**
 * @swagger
 * /matching/run-selected:
 *   post:
 *     summary: AI-Gesamtbewertung fuer 1 bis 20 explizite gespeicherte Paare
 *     description: Delegiert an GraphRAG. method=ai; score 0 bis 100; qualified=null. Keine Skill-Gates oder Hybridformel. Einzelne Paarfehler stehen in failures.
 *     tags: [Matching]
 *     responses:
 *       200: { description: Methodentreue Ergebnisse mit Cache- und Paarzeitmetadaten }
 *       202: { $ref: '#/components/responses/MatchingPending' }
 */
router.post('/run-selected', matchingRateLimiter, promptGuard('matching'), async (req, res) => {
  try {
    const graphRagResult = await runSelectedAiPairs(req, req.body);
    res.json(finishMatching(req, graphRagResult, req.matchingContext));
  } catch (error) {
    if (sendMatchingPending(res, error)) return;
    console.error('Error running selected matching batch:', error);
    res.status(error.status || 500).json({
      error: error.name === 'AbortError'
        ? 'KI-Timeout beim Batch-Matching'
        : 'Fehler beim Batch-Matching',
      details: error.details || error.message,
    });
  }
});

/**
 * @swagger
 * /matching/run-matrix:
 *   post:
 *     summary: Zentrale Skill-Abdeckung als Matrix (method=vector, Score 0 bis 100)
 *     tags: [Matching]
 *     responses:
 *       200: { description: Matrix mit Historien-ID und Cache-Metadaten }
 *       202: { $ref: '#/components/responses/MatchingPending' }
 */
router.post('/run-matrix', matchingRateLimiter, promptGuard('matching'), async (req, res) => {
  const { mode = 'all_jobs_all_candidates', jobIds, candidateIds, weights, engine = 'python' } = req.body;

  try {
    const jobs = getJobs(jobIds);
    const candidates = getCandidates(candidateIds);

    if (jobs.length === 0) return res.status(400).json({ error: 'Keine Stellen vorhanden' });
    if (candidates.length === 0) return res.status(400).json({ error: 'Keine Bewerber vorhanden' });

    if (!['python', 'neo4j'].includes(engine)) {
      return res.status(400).json({ error: 'Ungültige Vector-Matching-Engine' });
    }

    req.matchingContext = matchingContext('matrix', {
      jobs, candidates, engine, mode,
      title: mode === 'candidate_to_jobs'
        ? `Bewerber → alle Stellen (${candidates.length} × ${jobs.length})`
        : `N:N Matching (${jobs.length} Stellen × ${candidates.length} Bewerber, ${engine === 'neo4j' ? 'Neo4j' : 'Python'})`,
      description: `Matrix-Matching: ${jobs.length} Stellen × ${candidates.length} Bewerber`,
    });
    const graphRagResult = await callGraphRagMatching(req, engine === 'neo4j' ? '/match/external/matrix_neo4j' : '/match/external/matrix', {
      mode,
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        description: job.description,
        requirements: job.requirements,
        required_skills: job.skills,
        location: job.location,
        type: job.type,
      })),
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        location: candidate.location,
        experience: candidate.experience,
        skills: candidate.skills,
        education: candidate.education,
        desired_salary: candidate.desired_salary,
        availability: candidate.availability,
        languages: candidate.languages,
        certificates: candidate.certificates,
        mobility: candidate.mobility,
        has_skill: candidate.skills,
      })),
      weights,
    });

    res.json(finishMatching(req, graphRagResult, req.matchingContext));
  } catch (error) {
    if (sendMatchingPending(res, error)) return;
    console.error('Error running matrix matching:', error);
    res.status(error.status || 500).json({
      error: error.name === 'AbortError'
        ? 'KI-Timeout – Matrix-Matching dauerte zu lange. Versuche weniger Stellen oder Bewerber.'
        : error.status === 429
          ? 'Das KI-Modell ist aktuell rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
          : 'Fehler beim Matrix-Matching',
      details: error.details || error.message,
    });
  }
});

/**
 * @swagger
 * /matching/vectormatch:
 *   post:
 *     summary: Zentrale Skill-Abdeckung in beiden Richtungen (method=vector)
 *     tags: [Matching]
 *     responses:
 *       200: { description: Skill-Ergebnisse mit Historien-ID und Cache-Metadaten }
 *       202: { $ref: '#/components/responses/MatchingPending' }
 */
router.post('/vectormatch', matchingRateLimiter, promptGuard('matching'), async (req, res) => {
  try {
    const { direction = 'job_to_candidates', jobId, jobTitle, candidateId, candidateName, candidateIds, engine = 'python' } = req.body;

    if (!['job_to_candidates', 'candidate_to_jobs'].includes(direction)) {
      return res.status(400).json({ error: 'Ungültige Vector-Matching-Richtung' });
    }
    if (!['python', 'neo4j'].includes(engine)) {
      return res.status(400).json({ error: 'Ungültige Vector-Matching-Engine' });
    }

    if (direction === 'candidate_to_jobs') {
      if (!candidateId && !candidateName && (!Array.isArray(candidateIds) || candidateIds.length === 0)) {
        return res.status(400).json({ error: 'candidateId oder candidateName ist erforderlich' });
      }

      const { graphRagResult } = await runVectorMatch(req, { direction, candidateId, candidateName, candidateIds, engine });
      return res.json(finishMatching(req, graphRagResult, req.matchingContext));
    }

    if (!jobId && !jobTitle) {
      return res.status(400).json({ error: 'jobId oder jobTitle ist erforderlich' });
    }
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ error: 'Mindestens ein Bewerber ist erforderlich' });
    }

    const { graphRagResult } = await runVectorMatch(req, { direction, jobId, jobTitle, candidateIds, engine });
    res.json(finishMatching(req, graphRagResult, req.matchingContext));
  } catch (error) {
    if (sendMatchingPending(res, error)) return;
    console.error('Error running vector matching:', error);
    res.status(error.status || 500).json({
      error: error.userMessage
        ? error.message
        : error.name === 'AbortError'
          ? 'KI-Timeout – Vector-Matching dauerte zu lange.'
          : error.status === 429
            ? 'Das KI-Modell ist aktuell rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
            : `Fehler beim Vector-Matching: ${error.details || error.message}`,
      details: error.details || error.message,
    });
  }
});

/**
 * @swagger
 * /matching/vectormatch-selected:
 *   post:
 *     summary: Skill-Abdeckung fuer ausgewaehlte Paarungen (kein AI-Matching)
 *     description: |
 *       Sucht Bewerber und Stellen per UUID in Neo4j, holt fehlende Eintraege
 *       vorher nach und liefert Teilergebnisse plus failures fuer Paarungen,
 *       die nicht gematcht werden konnten.
 *       Mehrere Stellen bilden einen dauerhaften Sammelauftrag ohne eigene
 *       Gebuehr. Je Stellen-Teillauf mit eigener Neuberechnung bleibt der
 *       bisherige Tarif von 0,10 Credits erhalten; Hits und Joins kosten nichts.
 *     tags: [Matching]
 *     responses:
 *       200: { description: Vollstaendige Auswahl mit Ergebnissen und expliziten Paarfehlern }
 *       202: { $ref: '#/components/responses/MatchingPending' }
 */
router.post('/vectormatch-selected', matchingRateLimiter, async (req, res) => {
  try {
    const { pairs, engine = 'python' } = req.body || {};
    if (!Array.isArray(pairs) || pairs.length === 0) return res.status(400).json({ error: 'Mindestens eine Paarung ist erforderlich' });
    if (pairs.length > 200) return res.status(400).json({ error: 'Maximal 200 Paarungen pro Anfrage erlaubt' });
    if (!['python', 'neo4j'].includes(engine)) return res.status(400).json({ error: 'Ungültige Vector-Matching-Engine' });

    const jobMap = resolveRecords('jobs', pairs.flatMap(pair => [pair.jobId, pair.sourceJobId]));
    const candidateMap = resolveRecords('candidates', pairs.flatMap(pair => [pair.candidateId, pair.sourceCandidateId]));
    const failures = [];
    const groups = new Map();
    for (const pair of pairs) {
      const job = jobMap.get(String(pair.jobId)) || jobMap.get(String(pair.sourceJobId));
      const candidate = candidateMap.get(String(pair.candidateId)) || candidateMap.get(String(pair.sourceCandidateId));
      if (!job || !candidate) {
        failures.push({ jobId: pair.jobId ?? null, jobTitle: pair.jobTitle || null, candidateId: pair.candidateId ?? null, candidateName: pair.candidateName || null, error: !job ? 'Stelle nicht gefunden' : 'Bewerber nicht gefunden' });
        continue;
      }
      if (!groups.has(job.id)) groups.set(job.id, { job, candidates: new Map() });
      groups.get(job.id).candidates.set(candidate.id, candidate);
    }

    const allCandidates = [...new Map([...groups.values()].flatMap(group => [...group.candidates.values()]).map(c => [c.id, c])).values()];
    const { candidateErrors, jobErrors } = await ensureGraphNodes(db, req, {
      candidateIds: allCandidates.map(candidate => candidate.id),
      jobIds: [...groups.keys()],
    });

    const selectedPairs = [];
    for (const { job, candidates: candidateGroup } of groups.values()) {
      const failure = (candidate, error) => failures.push({ jobId: job.id, jobTitle: job.title, candidateId: candidate.id, candidateName: candidate.name, error });
      if (jobErrors.has(Number(job.id))) {
        for (const candidate of candidateGroup.values()) failure(candidate, `Stelle nicht in Neo4j: ${jobErrors.get(Number(job.id))}`);
        continue;
      }
      const candidates = [];
      for (const candidate of candidateGroup.values()) {
        if (candidateErrors.has(Number(candidate.id))) failure(candidate, `Bewerber nicht in Neo4j: ${candidateErrors.get(Number(candidate.id))}`);
        else candidates.push(candidate);
      }
      if (candidates.length === 0) continue;
      selectedPairs.push(...candidates.map(candidate => ({ jobId: job.id, candidateId: candidate.id })));
    }
    req.matchingContext = matchingContext('vector-selected', {
      jobs: [...jobMap.values()], candidates: [...candidateMap.values()], engine, selectedCount: pairs.length,
    });
    const graphRagResult = selectedPairs.length ? await callGraphRagMatching(req, '/match/vectormatch-selected', {
      pairs: selectedPairs, engine, localFailures: failures, selectedCount: pairs.length,
    }) : { method: 'vector', mode: 'vector', engine, model: null, results: [], failures };
    res.json(finishMatching(req, graphRagResult, req.matchingContext));
  } catch (error) {
    if (sendMatchingPending(res, error)) return;
    console.error('Error running selected vector matching:', error);
    res.status(error.status || 500).json({ error: error.userMessage ? error.message : 'Fehler beim 3D-Matching', details: error.details || error.message });
  }
});

/**
 * @swagger
 * /matching/history:
 *   get:
 *     summary: Matching-Historie (letzte 50)
 *     tags: [Matching]
 *     responses:
 *       200: { description: Liste vergangener Matchings }
 */
function serializeMatchingHistoryRow(row) {
  let summary = row.results_summary ? JSON.parse(row.results_summary) : null;
  if (!summary && row.legacy_results) {
    summary = buildMatchingSummary(JSON.parse(row.legacy_results));
    db.prepare('UPDATE matching_results SET results_summary = ? WHERE id = ?')
      .run(JSON.stringify(summary), row.id);
  }
  return {
    id: row.id,
    job_title: row.job_title,
    created_at: row.created_at,
    human_reviewed: row.human_reviewed,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    review_notes: row.review_notes,
    summary: summary || buildMatchingSummary(),
  };
}

function hydrateMatrixCandidateNames(results) {
  if (results?.type !== 'matrix' || !Array.isArray(results.matrix)) return results;

  const candidateIds = [...new Set(results.matrix
    .map((row) => Number(row.candidateId))
    .filter(Number.isInteger))];
  const candidates = candidateIds.length > 0
    ? db.prepare(`SELECT id, name FROM candidates WHERE id IN (${candidateIds.map(() => '?').join(',')})`).all(...candidateIds)
    : [];
  const candidateNames = new Map(candidates.map((candidate) => [String(candidate.id), candidate.name]));
  const matrix = results.matrix.map((row) => ({
    ...row,
    candidateName: candidateNames.get(String(row.candidateId)) || row.candidateName,
  }));
  const buildRankings = (idKey, nameKey) => {
    const groups = new Map();
    matrix.forEach((row) => {
      const id = row[idKey];
      if (id == null) return;
      const key = String(id);
      if (!groups.has(key)) groups.set(key, { [idKey]: id, [nameKey]: row[nameKey], results: [] });
      groups.get(key).results.push(row);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      results: group.results.sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0)).slice(0, 5),
    }));
  };

  return {
    ...results,
    matrix,
    jobsRanked: results.jobsRanked?.length ? results.jobsRanked : buildRankings('jobId', 'jobTitle'),
    candidatesRanked: results.candidatesRanked?.length ? results.candidatesRanked : buildRankings('candidateId', 'candidateName'),
  };
}

router.get('/history', (req, res) => {
  try {
    const results = db.prepare(
      `SELECT id, job_title, created_at, results_summary,
        CASE WHEN results_summary IS NULL THEN results ELSE NULL END AS legacy_results,
        human_reviewed, reviewed_by, reviewed_at, review_notes
       FROM matching_results ORDER BY created_at DESC LIMIT 50`
    ).all();

    res.json({ data: results.map(serializeMatchingHistoryRow) });
  } catch (error) {
    console.error('Error fetching matching history:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Historie' });
  }
});

/**
 * @swagger
 * /matching/history/{id}:
 *   get:
 *     summary: Einzelnes Matching-Ergebnis
 *     tags: [Matching]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Matching-Ergebnis }
 *       404: { description: Nicht gefunden }
 */
router.get('/history/:id', (req, res) => {
  try {
    const result = db.prepare('SELECT * FROM matching_results WHERE id = ?').get(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
    }
    res.json({ 
      ...result, 
      results: hydrateMatrixCandidateNames(JSON.parse(result.results)),
      human_reviewed: !!result.human_reviewed,
      reviewed_by: result.reviewed_by,
      reviewed_at: result.reviewed_at,
      review_notes: result.review_notes,
    });
  } catch (error) {
    console.error('Error fetching matching result:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Ergebnisses' });
  }
});

/**
 * @swagger
 * /matching/history/{id}:
 *   delete:
 *     summary: Matching-Ergebnis löschen
 *     tags: [Matching]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Erfolgreich gelöscht }
 */
router.delete('/history/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM matching_results WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
    }
    db.prepare('DELETE FROM matching_results WHERE id = ?').run(req.params.id);
    logAudit(req, 'gelöscht', 'Matching', existing.id, existing.job_title);
    res.json({ message: 'Ergebnis gelöscht' });
  } catch (error) {
    console.error('Error deleting result:', error);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

/**
 * @swagger
 * /matching/history/{id}/review:
 *   put:
 *     summary: Matching-Ergebnis als menschlich überprüft markieren (EU AI Act Art. 14)
 *     tags: [Matching]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               notes: { type: string, description: Optionale Anmerkungen zur Überprüfung }
 *     responses:
 *       200: { description: Als überprüft markiert }
 */
router.put('/history/:id/review', (req, res) => {
  try {
    const { notes } = req.body;
    const result = db.prepare('SELECT * FROM matching_results WHERE id = ?').get(req.params.id);
    if (!result) return res.status(404).json({ error: 'Ergebnis nicht gefunden' });

    db.prepare(`
      UPDATE matching_results 
      SET human_reviewed = 1, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `).run(req.user?.display_name || req.user?.username || 'Unbekannt', notes || null, req.params.id);

    logAudit(req, 'ki-review', 'Matching', req.params.id, result.job_title, {
      notes,
      action: 'Human review completed (AI Act Art. 14)'
    });

    res.json({
      success: true,
      human_reviewed: true,
      reviewed_by: req.user?.display_name || req.user?.username,
      reviewed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error marking as reviewed:', error);
    res.status(500).json({ error: 'Fehler beim Markieren als überprüft' });
  }
});

module.exports = router;
