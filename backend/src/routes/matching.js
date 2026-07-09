const express = require('express');
const db = require('../database');
const { logAiCall } = require('../aiLogger');
const { logAudit } = require('./audit');
const { matchingRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');
const { sanitizeObject } = require('../middleware/promptSanitizer');
const apiKeyAuth = require('../middleware/apiKey');
const { getAiConfig, stripReasoningTags } = require('../aiConfig');

const router = express.Router();

const MATCHING_CANDIDATE_FIELDS = `
  id, name, email, location, experience, skills, education,
  desired_salary, availability, languages, certificates, mobility
`;

const MATCHING_JOB_FIELDS = `
  id, title, description, requirements, location, type, status, url
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

function getJobs(jobIds) {
  if (jobIds && jobIds.length > 0) {
    const ids = jobIds.map(Number).filter(Boolean);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT ${MATCHING_JOB_FIELDS} FROM jobs WHERE id IN (${placeholders})`).all(...ids);
  }
  return db.prepare(`SELECT ${MATCHING_JOB_FIELDS} FROM jobs WHERE status IS NULL OR status != 'Archiviert' ORDER BY created_at DESC`).all();
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

function buildJobToCandidatesPrompt({ jobDescription, jobTitle, candidates, weights }) {
  const weightInstructions = buildWeightInstructions(weights);
  return `Du bist ein erfahrener HR-Analyst. Analysiere die folgenden Bewerber für die gegebene Stelle und bewerte jeden mit einem Score von 0-100.

Stellenbeschreibung:
${jobDescription}${weightInstructions}

Stellentitel: ${jobTitle || 'Unbenannte Stelle'}

Bewerber:
${candidates.map((c, idx) => `Kandidat ${idx + 1} (ID: ${c.id}):
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

async function assertAiReachable(baseUrl) {
  const pingCtrl = new AbortController();
  const pingTimeout = setTimeout(() => pingCtrl.abort(), 3000);
  try {
    await fetch(`${baseUrl}/`, { signal: pingCtrl.signal });
  } finally {
    clearTimeout(pingTimeout);
  }
}

async function generateJson({ baseUrl, model, prompt, timeoutMs = 180000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
    });

    const raw = await response.text();
    if (!response.ok) {
      const error = new Error(`Ollama HTTP ${response.status}`);
      error.status = response.status;
      error.raw = raw;
      throw error;
    }

    const data = JSON.parse(raw);
    return { raw, parsed: JSON.parse(stripReasoningTags(data.response)) };
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

    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL } = getAiConfig();
    try {
      await assertAiReachable(OLLAMA_URL);
    } catch {
      return res.status(503).json({ error: 'KI-Host nicht erreichbar. Bitte pruefen Sie die KI-Konfiguration.' });
    }

    const prompt = buildJobToCandidatesPrompt({
      jobDescription,
      jobTitle: normalizedJob.title,
      candidates: normalizedCandidates,
      weights,
    });
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 180000, 30000), 300000);
    const { parsed } = await generateJson({ baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, prompt, timeoutMs });
    const rows = normalizeJobResults({ parsed, job: normalizedJob, candidates: normalizedCandidates });

    const byInternalId = new Map(normalizedCandidates.map(candidate => [candidate.id, candidate]));
    const results = rows.map(row => {
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
    logAiCall({
      userId: null,
      feature: 'external-matching',
      model: OLLAMA_MODEL,
      prompt: `External matching (${normalizedCandidates.length} candidates)` ,
      response: JSON.stringify({ resultCount: results.length }),
      parsedResult: { resultCount: results.length, topScore: results[0]?.score ?? null },
      durationMs,
      success: true,
    });

    res.json({
      job: {
        externalJobId: normalizedJob.id,
        title: normalizedJob.title,
      },
      results,
      candidateCount: normalizedCandidates.length,
      model: OLLAMA_MODEL,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error('Error running external matching:', error);
    logAiCall({
      userId: null,
      feature: 'external-matching',
      model: getAiConfig().model,
      prompt: 'External matching failed',
      response: error.raw || null,
      parsedResult: null,
      durationMs,
      success: false,
      errorMessage: error.name === 'AbortError' ? 'Timeout' : error.message,
    });
    res.status(error.name === 'AbortError' ? 504 : 500).json({
      error: error.name === 'AbortError' ? 'KI-Timeout beim externen Matching' : 'Fehler beim externen Matching',
      details: error.message,
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
    const { jobDescription, jobTitle, candidateIds, weights, jobId } = req.body;

    if (!jobDescription || jobDescription.trim() === '') {
      return res.status(400).json({ error: 'Stellenbeschreibung ist erforderlich' });
    }

    const candidates = getCandidates(candidateIds);

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Keine Bewerber vorhanden' });
    }

    const startTime = Date.now();

    // Direct Ollama call (replaces n8n webhook)
    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL } = getAiConfig();

    const prompt = buildJobToCandidatesPrompt({ jobDescription, jobTitle, candidates, weights });

    // Check Ollama availability (3s timeout)
    try {
      await assertAiReachable(OLLAMA_URL);
    } catch {
      return res.status(503).json({ error: 'Ollama nicht erreichbar. Bitte stellen Sie sicher, dass Ollama läuft (http://localhost:11434).' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    let response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      logAiCall({ userId: req.user?.id, feature: 'matching', model: OLLAMA_MODEL, prompt, response: null, parsedResult: null, durationMs: duration, success: false, errorMessage: fetchErr.name === 'AbortError' ? 'Timeout >180s' : fetchErr.message });
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'Ollama Timeout – Matching dauerte zu lange (>180s). Versuche es mit weniger Bewerbern.' });
      }
      throw fetchErr;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      logAiCall({ userId: req.user?.id, feature: 'matching', model: OLLAMA_MODEL, prompt, response: errText, parsedResult: null, durationMs: Date.now() - startTime, success: false, errorMessage: `Ollama HTTP ${response.status}` });
      return res.status(502).json({ error: `Ollama-Fehler: Status ${response.status}`, details: errText });
    }

    const raw = await response.text();
    const matchingDuration = Date.now() - startTime;

    let matchingResults;
    try {
      const data = JSON.parse(raw);
      matchingResults = JSON.parse(stripReasoningTags(data.response));
    } catch (parseErr) {
      logAiCall({ userId: req.user?.id, feature: 'matching', model: OLLAMA_MODEL, prompt, response: raw, parsedResult: null, durationMs: matchingDuration, success: false, errorMessage: 'JSON-Parse: ' + parseErr.message });
      return res.status(502).json({ error: 'Ollama-Antwort konnte nicht verarbeitet werden', details: parseErr.message });
    }

    // De-Anonymisierung: echte Namen wieder einsetzen anhand der candidateId
    const candidateMap = new Map(candidates.map(c => [c.id, c.name]));
    if (matchingResults.results) {
      matchingResults.results = matchingResults.results.map(r => ({
        ...r,
        candidateName: candidateMap.get(r.candidateId) || r.candidateName
      }));
    }

    logAiCall({ userId: req.user?.id, feature: 'matching', model: OLLAMA_MODEL, prompt, response: raw, parsedResult: matchingResults, durationMs: matchingDuration, success: true });

    // Save results (mit echten Namen)
    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, job_id)
      VALUES (?, ?, ?, ?)
    `).run(jobDescription, jobTitle || 'Unbenannte Stelle', JSON.stringify(matchingResults), jobId || null);

    logAudit(req, 'ki-matching', 'Matching', saveResult.lastInsertRowid, jobTitle || 'Unbenannte Stelle', {
      candidateCount: candidates.length,
      topScore: matchingResults.results?.[0]?.score,
      durationMs: matchingDuration,
      model: OLLAMA_MODEL,
    });

    res.json({
      id: saveResult.lastInsertRowid,
      jobTitle: jobTitle || 'Unbenannte Stelle',
      results: matchingResults,
      candidateCount: candidates.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error running matching:', error);
    res.status(500).json({ 
      error: 'Fehler beim Matching',
      details: error.message
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
  const startTime = Date.now();
  const { mode = 'all_jobs_all_candidates', jobIds, candidateIds, weights } = req.body;

  try {
    const jobs = getJobs(jobIds);
    const candidates = getCandidates(candidateIds);

    if (jobs.length === 0) return res.status(400).json({ error: 'Keine Stellen vorhanden' });
    if (candidates.length === 0) return res.status(400).json({ error: 'Keine Bewerber vorhanden' });

    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL } = getAiConfig();
    try {
      await assertAiReachable(OLLAMA_URL);
    } catch {
      return res.status(503).json({ error: 'KI-Host nicht erreichbar. Bitte prüfen Sie die KI-Konfiguration unter Administration → KI-Modell.' });
    }

    const rows = [];
    const rawResponses = [];

    for (const job of jobs) {
      const jobDescription = buildJobDescription(job);
      const prompt = buildJobToCandidatesPrompt({ jobDescription, jobTitle: job.title, candidates, weights });
      const { raw, parsed } = await generateJson({ baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, prompt });
      rawResponses.push({ jobId: job.id, raw });
      rows.push(...normalizeJobResults({ parsed, job, candidates }));
    }

    const matrixResult = buildMatrixResult({ jobs, candidates, rows, mode, model: OLLAMA_MODEL });
    const durationMs = Date.now() - startTime;
    const resultTitle = mode === 'candidate_to_jobs'
      ? `Bewerber → alle Stellen (${candidates.length} × ${jobs.length})`
      : `N:N Matching (${jobs.length} Stellen × ${candidates.length} Bewerber)`;

    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, job_id)
      VALUES (?, ?, ?, ?)
    `).run(
      `Matrix-Matching: ${jobs.length} Stellen × ${candidates.length} Bewerber`,
      resultTitle,
      JSON.stringify(matrixResult),
      null
    );

    logAiCall({
      userId: req.user?.id,
      feature: 'matching-matrix',
      model: OLLAMA_MODEL,
      prompt: `Matrix matching (${jobs.length} jobs x ${candidates.length} candidates)`,
      response: JSON.stringify(rawResponses),
      parsedResult: matrixResult,
      durationMs,
      success: true,
    });

    logAudit(req, 'ki-matching-matrix', 'Matching', saveResult.lastInsertRowid, resultTitle, {
      jobCount: jobs.length,
      candidateCount: candidates.length,
      pairCount: rows.length,
      durationMs,
      model: OLLAMA_MODEL,
    });

    res.json({
      id: saveResult.lastInsertRowid,
      jobTitle: resultTitle,
      results: matrixResult,
      jobCount: jobs.length,
      candidateCount: candidates.length,
      pairCount: rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error('Error running matrix matching:', error);
    logAiCall({
      userId: req.user?.id,
      feature: 'matching-matrix',
      model: getAiConfig().model,
      prompt: `Matrix matching failed (${mode})`,
      response: error.raw || null,
      parsedResult: null,
      durationMs,
      success: false,
      errorMessage: error.name === 'AbortError' ? 'Timeout >180s' : error.message,
    });
    res.status(error.name === 'AbortError' ? 504 : 500).json({
      error: error.name === 'AbortError'
        ? 'KI-Timeout – Matrix-Matching dauerte zu lange. Versuche weniger Stellen oder Bewerber.'
        : 'Fehler beim Matrix-Matching',
      details: error.message,
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
