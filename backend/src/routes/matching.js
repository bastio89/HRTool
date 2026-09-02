const express = require('express');
const db = require('../database');
const { logAiCall } = require('../aiLogger');
const { logAudit } = require('./audit');
const { matchingRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');
const { sanitizeObject } = require('../middleware/promptSanitizer');
const apiKeyAuth = require('../middleware/apiKey');
const { getAiConfig, stripReasoningTags, resolveAiProvider, buildAiRequest, extractAiText, pingAiService } = require('../aiConfig');

const router = express.Router();

const MATCHING_CANDIDATE_FIELDS = `
  id, name, email, location, experience, skills, education,
  desired_salary, availability, languages, certificates, mobility
`;

const MATCHING_JOB_FIELDS = `
  id, title, description, requirements, skills, location, type, status, url
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

async function callGraphRagMatching(endpoint, payload) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || data.error || `GraphRAG HTTP ${response.status}`);
    error.status = response.status;
    error.details = data.detail || data.error || null;
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

  return `Du bist ein erfahrener HR-Analyst. Analysiere das folgende Jobprofil und die Kandidatenprofile und bewerte jeden mit einem Score von 0-100.

Jobprofil:
- ID: ${jobProfile.id ?? 'k.A.'}
- Titel: ${jobTitle}
- Beschreibung: ${jobProfile.description || 'k.A.'}
- Anforderungen: ${jobProfile.requirements || 'k.A.'}
- Skills: ${jobSkills.length > 0 ? jobSkills.join(', ') : 'k.A.'}
- Standort: ${jobProfile.location || 'k.A.'}
- Arbeitsmodell: ${jobProfile.type || 'k.A.'}
${weightInstructions}

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

async function runVectorMatch({ direction = 'job_to_candidates', jobId, jobTitle, candidateId, candidateName, candidateIds, engine = 'python' }) {
  const endpoint = engine === 'neo4j' ? '/match/vectormatch_neo4j' : '/match/vectormatch';

  if (direction === 'candidate_to_jobs') {
    const candidateRecord = getCandidates(candidateId ? [candidateId] : candidateIds)?.[0]
      || getCandidateByName(candidateName)
      || {
        id: candidateId || candidateIds?.[0] || null,
        name: candidateName || `Bewerber ${candidateId || ''}`.trim(),
      };
    const jobs = getJobs();
    if (jobs.length === 0) {
      throw Object.assign(new Error('Keine Stellen vorhanden'), { status: 404 });
    }

    const graphRagResult = await callGraphRagMatching(endpoint, {
      jobIds: jobs.map((job) => job.id),
      jobTitles: jobs.map((job) => job.title).filter(Boolean),
      cvIds: [candidateRecord.id],
      candidateNames: [candidateRecord.name].filter(Boolean),
    });

    return {
      direction,
      candidate: candidateRecord,
      jobs,
      graphRagResult,
    };
  }

  const jobRecord = getJobs([jobId])[0]
    || getJobByTitle(jobTitle)
    || {
      id: jobId || null,
      title: jobTitle || `Stelle ${jobId || ''}`.trim(),
    };
  const candidateRecords = getCandidates(candidateIds);
  const storedJobId = jobRecord?.id ?? (Number.isFinite(Number(jobId)) ? Number(jobId) : null);
  const matchedJob = jobRecord || { id: storedJobId, title: `Stelle ${jobId}` };

  const graphRagResult = await callGraphRagMatching(endpoint, {
    jobIds: [storedJobId ?? jobId],
    jobTitles: [matchedJob.title || `Stelle ${jobId}`],
    cvIds: candidateIds,
    candidateNames: candidateRecords.map((candidate) => candidate.name).filter(Boolean),
  });

  return {
    direction,
    job: matchedJob,
    candidates: candidateRecords,
    graphRagResult,
  };
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
 *     description: Matching-only Schnittstelle fuer Kunden, die HRTool ohne UI und ohne lokale Kandidaten-/Stellenspeicherung nutzen moechten.
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

    const graphRagResult = await callGraphRagMatching('/match/external/run', {
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
 *       502: { description: n8n Workflow fehlgeschlagen }
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

    const startTime = Date.now();
    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: PROVIDER_CFG } = getAiConfig();
    const aiProvider = await resolveAiProvider(OLLAMA_URL, PROVIDER_CFG);

    try {
      await assertAiReachable(OLLAMA_URL, aiProvider);
    } catch {
      return res.status(503).json({ error: 'KI-Host nicht erreichbar. Bitte stellen Sie sicher, dass der KI-Server läuft.' });
    }

    const prompt = buildJobToCandidatesPrompt({
      job: resolvedJob,
      candidates,
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
      results: normalizeJobResults({ parsed, job: resolvedJob, candidates }),
    };
    const matchingDuration = Date.now() - startTime;
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate.name]));
    if (matchingResults.results) {
      matchingResults.results = matchingResults.results.map((result) => ({
        ...result,
        candidateName: candidateMap.get(result.candidateId) || result.candidateName,
      }));
    }

    const storedJobId = Number.isFinite(Number(resolvedJob.id || jobId)) ? Number(resolvedJob.id || jobId) : null;
    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, job_id)
      VALUES (?, ?, ?, ?)
    `).run(resolvedJob.description || buildJobDescription(resolvedJob), resolvedJob.title, JSON.stringify(matchingResults), storedJobId);

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
    res.status(500).json({ 
      error: error.status === 429
        ? 'Das KI-Modell ist aktuell rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
        : error.status || error.details ? 'Fehler beim Matching' : 'Fehler beim Matching',
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

    const results = [];
    const failures = [];
    const jobsByKey = new Map();

    for (const pair of pairs) {
      const jobRecord = pair?.jobId ? getJobs([pair.jobId])[0] : (pair?.jobTitle ? getJobByTitle(pair.jobTitle) : null);
      const candidateRecord = pair?.candidateId
        ? getCandidates([pair.candidateId])[0]
        : (pair?.candidateName ? getCandidateByName(pair.candidateName) : null);

      const normalizedJob = {
        id: jobRecord?.id || pair?.jobId || null,
        title: jobRecord?.title || pair?.jobTitle || 'Unbenannte Stelle',
        description: pair?.jobDescription || jobRecord?.description,
        skills: jobRecord?.skills,
        requirements: jobRecord?.requirements,
        location: jobRecord?.location,
        type: jobRecord?.type,
      };
      const jobDescription = buildJobDescription(normalizedJob);
      const jobKey = String(normalizedJob.id || normalizedJob.title || 'job');
      if (!jobsByKey.has(jobKey)) {
        jobsByKey.set(jobKey, {
          job: normalizedJob,
          jobDescription,
          candidates: [],
          pairs: [],
        });
      }

      const normalizedCandidate = {
        id: candidateRecord?.id || pair?.candidateId || null,
        name: candidateRecord?.name || pair?.candidateName || 'Unbekannter Bewerber',
        location: candidateRecord?.location,
        experience: candidateRecord?.experience,
        skills: candidateRecord?.skills,
        education: candidateRecord?.education,
        desired_salary: candidateRecord?.desired_salary,
        availability: candidateRecord?.availability,
        languages: candidateRecord?.languages,
        certificates: candidateRecord?.certificates,
        mobility: candidateRecord?.mobility,
        has_skill: splitSkillValues(candidateRecord?.skills),
      };

      jobsByKey.get(jobKey).candidates.push(normalizedCandidate);
      jobsByKey.get(jobKey).pairs.push({
        jobId: normalizedJob.id,
        jobTitle: normalizedJob.title,
        jobDescription,
        candidateId: normalizedCandidate.id,
        candidateName: normalizedCandidate.name,
      });
    }

    for (const { job, jobDescription, candidates: jobCandidates, pairs: jobPairs } of jobsByKey.values()) {
      if (!jobDescription || jobDescription === 'Unbenannte Stelle') {
        for (const pair of jobPairs) {
          failures.push({
            ...pair,
            error: 'Stellentitel, Beschreibung oder Anforderungen sind erforderlich',
          });
        }
        continue;
      }

      try {
        const graphRagResult = await callGraphRagMatching('/match/external/run', {
          job: {
            id: job.id,
            title: job.title,
            description: jobDescription,
            requirements: job.requirements,
            required_skills: toRequiredSkills(job.skills || job.requirements || job.description || jobDescription),
            location: job.location,
            type: job.type,
          },
          candidates: jobCandidates,
          weights,
        });

        const resultByCandidateId = new Map((graphRagResult.results || []).map((item) => [String(item.candidateId), item]));
        const saveResult = db.prepare(`
          INSERT INTO matching_results (job_description, job_title, results, job_id)
          VALUES (?, ?, ?, ?)
        `).run(
          jobDescription,
          job.title,
          JSON.stringify(graphRagResult),
          Number.isFinite(Number(job.id)) ? Number(job.id) : null,
        );

        for (const pair of jobPairs) {
          const row = resultByCandidateId.get(String(pair.candidateId)) || {};
          results.push({
            id: saveResult.lastInsertRowid,
            jobId: pair.jobId,
            jobTitle: pair.jobTitle,
            candidateId: pair.candidateId,
            candidateName: pair.candidateName,
            score: row.score ?? 0,
            strengths: row.strengths || [],
            weaknesses: row.weaknesses || [],
            summary: row.summary || '',
            model: graphRagResult.model || null,
          });
        }
      } catch (error) {
        for (const pair of jobPairs) {
          failures.push({
            ...pair,
            error: error.name === 'AbortError'
              ? 'KI-Timeout beim Matching'
              : error.status === 429
                ? 'Das KI-Modell ist aktuell rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
                : error.message || 'Fehler beim Matching',
          });
        }
      }
    }

    logAudit(req, 'ki-matching-batch', 'Matching', null, 'KI-Matching selektierte Paarungen', {
      selectedCount: pairs.length,
      matchedCount: results.length,
      failedCount: failures.length,
    });

    res.json({
      results,
      failures,
      selectedCount: pairs.length,
      matchedCount: results.length,
      failedCount: failures.length,
      timestamp: new Date().toISOString(),
    });
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

    const graphRagResult = await callGraphRagMatching(engine === 'neo4j' ? '/match/external/matrix_neo4j' : '/match/external/matrix', {
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
      INSERT INTO matching_results (job_description, job_title, results, job_id)
      VALUES (?, ?, ?, ?)
    `).run(
      `Matrix-Matching: ${jobs.length} Stellen × ${candidates.length} Bewerber`,
      resultTitle,
      JSON.stringify(graphRagResult),
      null
    );

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

      const { candidate, jobs, graphRagResult } = await runVectorMatch({ direction, candidateId, candidateName, candidateIds, engine });
      const resultTitle = `Bewerber → alle Stellen: ${candidate?.name || 'Unbenannter Bewerber'}`;

      const saveResult = db.prepare(`
        INSERT INTO matching_results (job_description, job_title, results, job_id)
        VALUES (?, ?, ?, ?)
      `).run(
        `Vector-Matching (${engine}) für ${candidate?.name || 'Unbenannter Bewerber'}`,
        resultTitle,
        JSON.stringify({ ...graphRagResult, direction }),
        null,
      );

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
        results: { ...graphRagResult, direction },
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

    const { job, graphRagResult } = await runVectorMatch({ direction, jobId, jobTitle, candidateIds, engine });
    const resultTitle = `Stelle → Kandidaten: ${job.title || 'Unbenannte Stelle'}`;
    const storedJobId = Number.isFinite(Number(job.id)) ? Number(job.id) : null;

    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, job_id)
      VALUES (?, ?, ?, ?)
    `).run(
      `Vector-Matching (${engine}) für ${job.title || 'Unbenannte Stelle'}`,
      resultTitle,
      JSON.stringify({ ...graphRagResult, direction }),
      storedJobId,
    );

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
      error: error.name === 'AbortError'
        ? 'KI-Timeout – Vector-Matching dauerte zu lange.'
        : error.status === 429
          ? 'Das KI-Modell ist aktuell rate-limited. Bitte kurz warten oder ein anderes Modell wählen.'
          : 'Fehler beim Vector-Matching',
      details: error.details || error.message,
    });
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
router.get('/history', (req, res) => {
  try {
    const results = db.prepare(
      'SELECT id, job_title, created_at, results, human_reviewed, reviewed_by, reviewed_at, review_notes FROM matching_results ORDER BY created_at DESC LIMIT 50'
    ).all();
    
    const parsed = results.map(r => ({
      ...r,
      results: JSON.parse(r.results),
    }));
    
    res.json({ data: parsed });
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
      results: JSON.parse(result.results),
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
