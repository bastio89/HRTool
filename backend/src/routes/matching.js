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
const { graphRagAuthHeaders } = require('../graphragAuth');
// Alle Paarungen eines Laufs landen zusaetzlich in matching_pair_results,
// damit sie als N:N-Export (Administration -> Datenexport) abrufbar sind.
// Das Speichern ist fehlertolerant: Ein Fehler dort laesst kein Matching
// scheitern, der Lauf wird dann beim naechsten Export aus der Historie
// nachgetragen.
const { recordMatchingPairsSafely } = require('../matchingPairs');
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

function toRequiredSkills(value) {
  return splitSkillValues(value).map((name) => ({ name, priority: 'Mandatory' }));
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

const MAX_STORED_MATCH_ROWS = 100;

function compactStoredMatchingResult(result, { direction, engine } = {}) {
  const matrix = Array.isArray(result?.matrix) ? result.matrix : [];
  const compactRow = (row) => ({
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
    type: result?.type,
    mode: result?.mode,
    model: result?.model,
    matchedAt: result?.matchedAt,
    embeddingModel: result?.embeddingModel,
    direction: direction ?? result?.direction,
    engine,
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

async function callGraphRagMatching(req, endpoint, payload) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...graphRagAuthHeaders(req) },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detailObject = data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail) ? data.detail : null;
    const message = detailObject?.error || (typeof data.detail === 'string' ? data.detail : null) || data.error || `GraphRAG HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = message;
    error.detailObject = detailObject;
    throw error;
  }

  return data;
}

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
    let graphRagResult;
    try {
      graphRagResult = await callGraphRagMatching(req, endpoint, { jobIds: jobs.map(job => job.uuid), cvIds: [candidate.uuid], engine });
    } catch (error) {
      throw explainGraphRagMiss(error, maps);
    }
    const remapped = remapByUuid(graphRagResult, maps);
    remapped.missing = describeMissing({ graphRagResult, ...maps, jobErrors, skippedJobs });
    return { direction, candidate, jobs: allJobs, graphRagResult: remapped };
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
  let graphRagResult;
  try {
    graphRagResult = await callGraphRagMatching(req, endpoint, { jobIds: [job.uuid], cvIds: candidates.map(c => c.uuid), engine });
  } catch (error) {
    throw explainGraphRagMiss(error, maps);
  }
  const remapped = remapByUuid(graphRagResult, maps);
  remapped.missing = describeMissing({ graphRagResult, ...maps, candidateErrors, skippedCandidates });
  return { direction, job, candidates: allCandidates, graphRagResult: remapped };
}

function sanitizeExternalPayload({ job, candidates }) {
  const sanitizedJob = sanitizeObject(job || {}, 'matching').sanitized;
  const sanitizedCandidates = candidates.map(candidate => sanitizeObject(candidate || {}, 'matching').sanitized);
  return { sanitizedJob, sanitizedCandidates };
}

function normalizeExternalCandidates(candidates) {
  return candidates.map((candidate, index) => ({
    id: index + 1,
    externalId: String(candidate.id || `candidate-${index + 1}`),
    name: candidate.name || `Kandidat ${index + 1}`,
    location: candidate.location,
    experience: candidate.experience,
    skills: candidate.skills,
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
 *       401: { description: API-Key fehlt oder ist ungueltig }
 *       503: { description: KI-Host nicht erreichbar oder externe API nicht konfiguriert }
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
      location: sanitizedJob.location,
      type: sanitizedJob.type,
    };

    const jobDescription = buildJobDescription(normalizedJob);
    if (!jobDescription || jobDescription === 'Unbenannte Stelle') {
      return res.status(400).json({ error: 'Stellentitel, Beschreibung oder Anforderungen sind erforderlich' });
    }

    const graphRagResult = await callGraphRagMatching(req, '/match/external/run', {
      job: normalizedJob,
      candidates: normalizedCandidates,
      weights,
      options,
    });

    const byInternalId = new Map(normalizedCandidates.map(candidate => [candidate.id, candidate]));
    const results = (graphRagResult.results || []).map((row) => {
      const candidate = byInternalId.get(Number(row.candidateId));
      return {
        externalCandidateId: candidate?.externalId || String(row.candidateId),
        candidateName: candidate?.name || row.candidateName,
        score: row.score,
        strengths: row.strengths || [],
        weaknesses: row.weaknesses || [],
        summary: row.summary || '',
      };
    });

    const durationMs = Date.now() - startTime;
    logAudit(req, 'external-matching', 'Matching', null, normalizedJob.title, {
      candidateCount: normalizedCandidates.length,
      topScore: results[0]?.score ?? null,
      durationMs,
    });

    res.json({
      job: {
        externalJobId: normalizedJob.id,
        title: normalizedJob.title,
      },
      results,
      candidateCount: normalizedCandidates.length,
      model: graphRagResult.model || null,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
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
 *     summary: KI-Matching starten
 *     tags: [Matching]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               jobDescription: { type: string, description: Stellenbeschreibung }
 *               jobTitle: { type: string }
 *               candidateIds: { type: array, items: { type: integer }, description: Optional - sonst alle Bewerber }
 *     responses:
 *       200: { description: Matching-Ergebnis mit Scores }
 *       400: { description: Keine Beschreibung oder keine Bewerber }
 *       502: { description: Externes Matching fehlgeschlagen }
 */
router.post('/run', matchingRateLimiter, promptGuard('matching'), async (req, res) => {
  try {
    const { jobDescription, jobTitle, candidateIds, candidateId, candidateNames, candidateName, weights, jobId } = req.body;

    const normalizedCandidateIds = Array.isArray(candidateIds)
      ? candidateIds
      : (candidateId != null ? [candidateId] : []);
    const normalizedCandidateNames = Array.isArray(candidateNames)
      ? candidateNames
      : (candidateName ? [candidateName] : []);

    const jobRecord = jobId
      ? (getJobs([jobId])[0] || null)
      : (jobTitle ? getJobByTitle(jobTitle) || null : null);

    const resolvedJob = jobRecord
      ? {
          ...jobRecord,
          description: buildJobDescription(jobRecord),
        }
      : {
          id: jobId || null,
          title: jobTitle || 'Unbenannte Stelle',
          description: (jobDescription || '').trim(),
          requirements: null,
          skills: null,
          location: null,
          type: null,
        };

    if (!resolvedJob.id && !resolvedJob.description) {
      return res.status(400).json({ error: 'jobId oder Stellenbeschreibung ist erforderlich' });
    }

    let candidates = getCandidates(normalizedCandidateIds);
    if (candidates.length === 0) {
      candidates = getCandidatesByNames(normalizedCandidateNames);
    }

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Keine Bewerber vorhanden' });
    }

    const { prompt, raw, matchingResults, model: OLLAMA_MODEL, durationMs: matchingDuration } = await runAiMatchingCore({
      resolvedJob,
      candidates,
      weights,
    });

    const storedJobId = Number.isFinite(Number(resolvedJob.id || jobId)) ? Number(resolvedJob.id || jobId) : null;
    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, results_summary, job_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(resolvedJob.description || buildJobDescription(resolvedJob), resolvedJob.title, JSON.stringify(matchingResults), JSON.stringify(buildMatchingSummary(matchingResults)), storedJobId);

    // Nur Stellen aus dem Tool gehoeren in die N:N-Uebersicht; ein Matching
    // gegen eine frei eingegebene Beschreibung hat keine Stelle.
    if (jobRecord) {
      recordMatchingPairsSafely(db, 'ai', matchingResults.results, {
        matchingResultId: saveResult.lastInsertRowid,
        jobId: jobRecord.id,
        candidateIds: candidates.map(candidate => candidate.id),
        model: OLLAMA_MODEL,
      });
    } else {
      recordMatchingPairsSafely(db, 'ai', [], { matchingResultId: saveResult.lastInsertRowid });
    }

    logAiCall({
      userId: req.user?.id,
      feature: 'matching',
      model: OLLAMA_MODEL,
      prompt,
      response: raw,
      parsedResult: matchingResults,
      durationMs: matchingDuration,
      success: true,
    });

    logAudit(req, 'ki-matching', 'Matching', saveResult.lastInsertRowid, resolvedJob.title, {
      candidateCount: candidates.length,
      jobId: storedJobId,
      topScore: matchingResults.results?.[0]?.score,
      durationMs: matchingDuration,
      model: OLLAMA_MODEL,
    });

    res.json({
      id: saveResult.lastInsertRowid,
      jobTitle: resolvedJob.title,
      results: matchingResults,
      candidateCount: candidates.length,
      jobId: storedJobId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
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

router.post('/run-selected', matchingRateLimiter, promptGuard('matching'), async (req, res) => {
  try {
    const { pairs, weights } = req.body;

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'Mindestens eine Paarung ist erforderlich' });
    }
    if (pairs.length > 20) {
      return res.status(400).json({ error: 'Maximal 20 Paarungen pro Anfrage erlaubt' });
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
    if (resolvedPairs.length === 0) {
      return res.json({ results: [], failures: localFailures, selectedCount: pairs.length, matchedCount: 0, failedCount: localFailures.length });
    }
    // Manuell angelegte Bewerber erhalten dabei ihren CV-Text (ohne ihn findet
    // GraphRAG sie fuer das KI-Matching nicht).
    await ensureGraphNodes(db, req, { candidateIds: resolvedPairs.map(pair => Number(pair.candidateId)) });

    const remoteResult = await callGraphRagMatching(req, '/match/ki_match_pairs', { pairs: resolvedPairs, weights });
    const graphRagResult = {
      ...remoteResult,
      failures: [...(remoteResult?.failures || []), ...localFailures],
      selectedCount: pairs.length,
      failedCount: (remoteResult?.failedCount ?? remoteResult?.failures?.length ?? 0) + localFailures.length,
    };

    recordMatchingPairsSafely(db, 'ai', graphRagResult?.results, { model: graphRagResult?.model || null });

    logAudit(req, 'ki-matching-batch', 'Matching', null, 'KI-Matching selektierte Paarungen', {
      selectedCount: pairs.length,
      matchedCount: graphRagResult?.matchedCount ?? graphRagResult?.results?.length ?? 0,
      failedCount: graphRagResult?.failedCount ?? graphRagResult?.failures?.length ?? 0,
    });

    res.json(graphRagResult);
  } catch (error) {
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
 *     summary: Matrix-Matching starten (alle Stellen gegen alle Bewerber oder Bewerber gegen alle Stellen)
 *     tags: [Matching]
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

    const graphRagResult = await callGraphRagMatching(req, engine === 'neo4j' ? '/match/external/matrix_neo4j' : '/match/external/matrix', {
      mode,
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        description: job.description,
        requirements: job.requirements,
        required_skills: toRequiredSkills(job.skills || job.requirements || job.description),
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
        has_skill: splitSkillValues(candidate.skills),
      })),
      weights,
    });

    const resultTitle = mode === 'candidate_to_jobs'
      ? `Bewerber → alle Stellen (${candidates.length} × ${jobs.length})`
      : `N:N Matching (${jobs.length} Stellen × ${candidates.length} Bewerber, ${engine === 'neo4j' ? 'Neo4j' : 'Python'})`;

    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, results_summary, job_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `Matrix-Matching: ${jobs.length} Stellen × ${candidates.length} Bewerber`,
      resultTitle,
      JSON.stringify(compactStoredMatchingResult(graphRagResult, { engine })),
      null,
      null
    );

    // Die Historie behaelt nur die besten Paarungen; fuer den N:N-Export
    // werden hier alle Paarungen des Laufs gespeichert.
    recordMatchingPairsSafely(db, 'vector', graphRagResult.matrix, {
      matchingResultId: saveResult.lastInsertRowid,
      jobIds: jobs.map(job => job.id),
      candidateIds: candidates.map(candidate => candidate.id),
      model: graphRagResult.model || null,
      engine,
    });

    logAudit(req, 'ki-matching-matrix', 'Matching', saveResult.lastInsertRowid, resultTitle, {
      jobCount: jobs.length,
      candidateCount: candidates.length,
      pairCount: graphRagResult.matrix?.length || 0,
    });

    res.json({
      id: saveResult.lastInsertRowid,
      jobTitle: resultTitle,
      results: graphRagResult,
      jobCount: jobs.length,
      candidateCount: candidates.length,
      pairCount: graphRagResult.matrix?.length || 0,
      engine,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
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
 *     summary: Vector-Matching gegen eine ausgewählte Stelle und Kandidaten
 *     tags: [Matching]
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

      const { candidate, jobs, graphRagResult } = await runVectorMatch(req, { direction, candidateId, candidateName, candidateIds, engine });
      const resultTitle = `Bewerber → alle Stellen: ${candidate?.name || 'Unbenannter Bewerber'}`;

      const matchingResult = { ...graphRagResult, direction };
      const saveResult = db.prepare(`
        INSERT INTO matching_results (job_description, job_title, results, results_summary, job_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        `Vector-Matching (${engine}) für ${candidate?.name || 'Unbenannter Bewerber'}`,
        resultTitle,
        JSON.stringify(compactStoredMatchingResult(graphRagResult, { direction, engine })),
        null,
        null,
      );

      recordMatchingPairsSafely(db, 'vector', graphRagResult.matrix, {
        matchingResultId: saveResult.lastInsertRowid,
        candidateId: candidate?.id ?? null,
        jobIds: jobs.map(job => job.id),
        model: graphRagResult.model || null,
        engine,
      });

      logAudit(req, 'ki-matching-vector', 'Matching', saveResult.lastInsertRowid, resultTitle, {
        engine,
        direction,
        candidateId: candidate?.id || null,
        jobCount: jobs.length,
        topScore: graphRagResult.matrix?.[0]?.score ?? null,
      });

      return res.json({
        id: saveResult.lastInsertRowid,
        jobTitle: resultTitle,
        results: matchingResult,
        candidateCount: 1,
        jobCount: jobs.length,
        engine,
        direction,
        timestamp: new Date().toISOString(),
      });
    }

    if (!jobId && !jobTitle) {
      return res.status(400).json({ error: 'jobId oder jobTitle ist erforderlich' });
    }
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ error: 'Mindestens ein Bewerber ist erforderlich' });
    }

    const { job, graphRagResult } = await runVectorMatch(req, { direction, jobId, jobTitle, candidateIds, engine });
    const resultTitle = `Stelle → Kandidaten: ${job.title || 'Unbenannte Stelle'}`;
    const storedJobId = Number.isFinite(Number(job.id)) ? Number(job.id) : null;

    const matchingResult = { ...graphRagResult, direction };
    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, results_summary, job_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `Vector-Matching (${engine}) für ${job.title || 'Unbenannte Stelle'}`,
      resultTitle,
      JSON.stringify(compactStoredMatchingResult(graphRagResult, { direction, engine })),
      null,
      storedJobId,
    );

    recordMatchingPairsSafely(db, 'vector', graphRagResult.matrix, {
      matchingResultId: saveResult.lastInsertRowid,
      jobId: storedJobId,
      model: graphRagResult.model || null,
      engine,
    });

    logAudit(req, 'ki-matching-vector', 'Matching', saveResult.lastInsertRowid, resultTitle, {
      engine,
      jobId: storedJobId,
      candidateCount: candidateIds.length,
      topScore: graphRagResult.matrix?.[0]?.score ?? null,
    });

    res.json({
      id: saveResult.lastInsertRowid,
      jobTitle: resultTitle,
      results: { ...graphRagResult, direction },
      candidateCount: candidateIds.length,
      engine,
      direction,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
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
 *     summary: 3D-Matching fuer ausgewaehlte Paarungen (Bewerber x Stelle)
 *     description: |
 *       Sucht Bewerber und Stellen per UUID in Neo4j, holt fehlende Eintraege
 *       vorher nach und liefert Teilergebnisse plus failures fuer Paarungen,
 *       die nicht gematcht werden konnten.
 *     tags: [Matching]
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

    const results = [];
    let model = null;
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
      const maps = { jobsByUuid: byUuid([job]), candidatesByUuid: byUuid(candidates) };
      try {
        const graphRagResult = await callGraphRagMatching(req, '/match/vectormatch', { jobIds: [job.uuid], cvIds: candidates.map(c => c.uuid), engine });
        model = graphRagResult.model || model;
        results.push(...remapByUuid(graphRagResult, maps).matrix);
        for (const uuid of graphRagResult.missingCandidateIds || []) {
          const candidate = maps.candidatesByUuid.get(String(uuid));
          if (candidate) failure(candidate, 'Kein Eintrag in Neo4j');
        }
      } catch (rawError) {
        const error = explainGraphRagMiss(rawError, maps);
        for (const candidate of candidates) failure(candidate, error.message);
      }
    }

    results.sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0));
    recordMatchingPairsSafely(db, 'vector', results, { model, engine });
    logAudit(req, 'ki-matching-vector', 'Matching', null, '3D-Matching selektierte Paarungen', {
      engine, selectedCount: pairs.length, matchedCount: results.length, failedCount: failures.length,
    });
    res.json({ mode: 'vector', engine, model, results, failures, selectedCount: pairs.length, matchedCount: results.length, failedCount: failures.length });
  } catch (error) {
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
