const { sourceUrlFromText } = require('../jobSourceUrl');
const { Blob } = require('node:buffer');
const express = require('express');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const db = require('../database');
const { logAudit } = require('./audit');
const { logAiCall } = require('../aiLogger');
const { generatorRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');
const { getAiConfig, stripReasoningTags, resolveAiProvider, buildAiRequest, extractAiText, pingAiService } = require('../aiConfig');
const { tmpDir, extractText } = require('../utils/documentText');
const { graphRagAuthHeaders } = require('../graphragAuth');
const { DuplicateError, assertNoJobDuplicate, findJobDuplicateAsync, sendIdentityError, translateUniqueViolation, translateJobUniqueViolationAsync } = require('../identity');
const { enqueueMatchingImport } = require('../matchingImports');
const { deleteJobFromGraphRag } = require('../utils/graphRagJob');
const { forwardJobsChPluginRequest } = require('./plugins');

const router = express.Router();
const repoRoot = path.resolve(__dirname, '..', '..');
const jobsChExportScript = path.join(repoRoot, 'graphrag', 'batch_tools', 'import_jobs_from_pdfs_obsolete.py');

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `job-${uniqueSuffix}${ext}`);
  },
});

const uploadFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
  ];

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Nur PDF-, Word-, TXT- und Markdown-Dateien erlaubt'), false);
  }
};

const descriptionUpload = multer({
  storage: uploadStorage,
  fileFilter: uploadFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

function splitJobTextSections(text) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  if (!normalized) {
    return { about_us: '', description: '', requirements: '', benefits: '' };
  }

  const lines = normalized.split('\n').map(line => line.trim());

  // Section heading patterns
  const headings = {
    about_us:     /^(über uns|about us|wir sind|unternehmen|wer wir sind|das unternehmen|unsere firma|company|who we are)\b/i,
    description:  /^(stellenbeschreibung|aufgaben|tätigkeiten|deine aufgaben|ihre aufgaben|deine aufgabe|job description|responsibilities|your responsibilities|was du machst|what you.ll do|aufgabenbeschreibung|das erwartet dich)\b/i,
    requirements: /^(anforderungen|profil|qualifikationen|voraussetzungen|must[- ]haves|requirements|qualifications|your profile|dein profil|ihr profil|gesuchtes profil|skills|was du mitbringst|what you bring|das bringst du mit)\b/i,
    benefits:     /^(was wir bieten|benefits|vorteile|wir bieten|wir bieten dir|das bieten wir|das bieten wir dir|unser angebot|perks|what we offer|our offer|deine vorteile)\b/i,
  };

  let currentSection = 'description';
  const buckets = { about_us: [], description: [], requirements: [], benefits: [] };

  for (const line of lines) {
    if (!line) {
      buckets[currentSection].push('');
      continue;
    }

    let matched = false;
    for (const [section, pattern] of Object.entries(headings)) {
      if (pattern.test(line)) {
        currentSection = section;
        matched = true;
        break;
      }
    }

    if (!matched) {
      buckets[currentSection].push(line);
    }
  }

  const clean = (arr) => arr.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const result = {
    about_us:     clean(buckets.about_us),
    description:  clean(buckets.description),
    requirements: clean(buckets.requirements),
    benefits:     clean(buckets.benefits),
  };

  // Fallback: if nothing was split into separate sections, put everything in description
  if (!result.about_us && !result.requirements && !result.benefits) {
    result.description = normalized;
  }

  return result;
}

function buildGraphRagJobText(job) {
  const sections = [
    `Jobtitel: ${job.title || ''}`,
    job.company ? `\nArbeitgeber: ${job.company}` : '',
    job.about_us ? `\nÜber uns:\n${job.about_us}` : '',
    job.description ? `\nBeschreibung:\n${job.description}` : '',
    job.requirements ? `\nAnforderungen:\n${job.requirements}` : '',
    job.skills ? `\nSkills:\n${job.skills}` : '',
    job.benefits ? `\nBenefits:\n${job.benefits}` : '',
    job.location ? `\nStandort: ${job.location}` : '',
    job.type ? `\nAnstellungsart: ${job.type}` : '',
    job.status ? `\nStatus: ${job.status}` : '',
    job.url ? `\nURL: ${job.url}` : '',
  ];
  return sections.filter(Boolean).join('\n').trim();
}

function buildGraphRagJobProfile(job, profile = {}) {
  const structuredSkills = new Map((Array.isArray(profile.required_skills) ? profile.required_skills : [])
    .filter(skill => skill && typeof skill === 'object')
    .map(skill => [String(skill.name || '').trim().toLowerCase(), skill]));
  return {
    ...profile,
    title: String(job.title || '').trim(),
    company: job.company || null,
    recruiter_company: job.recruiter_company || null,
    employer_company: job.employer_company || null,
    location: job.location || null,
    employment_type: job.type || null,
    about_us: job.about_us || null,
    description: job.description || null,
    requirements: job.requirements || null,
    benefits: job.benefits || null,
    required_skills: String(job.skills || '').split(',').map(name => name.trim()).filter(Boolean).map(name => ({
      category: 'HardSkill', priority: 'Mandatory',
      ...structuredSkills.get(name.toLowerCase()), name,
    })),
  };
}

function serializeJobSkills(skills) {
  if (Array.isArray(skills)) {
    return skills
      .map((skill) => {
        if (typeof skill === 'string') return skill.trim();
        if (skill && typeof skill === 'object') return String(skill.name || skill.label || '').trim();
        return '';
      })
      .filter(Boolean)
      .join(', ');
  }

  if (typeof skills === 'string') {
    return skills.trim();
  }

  return '';
}

function fastParserJobProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const title = String(profile.job_title || '').trim();
  const company = String(profile.company_name || '').trim();
  return title || company ? { title, company } : null;
}

function fastParserJobSkills(profile) {
  const categories = {
    soft_skills: 'SoftSkill',
    it_skills: 'HardSkill',
    method_skills: 'HardSkill',
    tool_skills: 'HardSkill',
    language_skills: 'HardSkill',
  };
  const skills = [];
  const seen = new Set();
  for (const [field, category] of Object.entries(categories)) {
    const values = profile?.required_skills?.[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const name = typeof value === 'string' ? value.trim() : '';
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      skills.push({ name, category, priority: 'Mandatory' });
    }
  }
  return skills;
}

function isCredibleJobTitle(value, company) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (title.length < 3 || title.length > 120 || title.split(' ').length > 12 || !/\p{L}/u.test(title)) return false;
  if (/^(unknown job|unknown|job|job description|stellenanzeige|stellenbeschreibung|stellenangebot|unbekannte stelle|stelle)$/i.test(title)) return false;
  if (company && title.toLocaleLowerCase() === String(company).trim().toLocaleLowerCase()) return false;
  return !/\b(?:mit sitz in|ist ein(?:e|en)?|sind ein(?:e)?|wir sind|wir suchen|suchen wir|bietet|with headquarters in|located in|headquartered in|we are|we're looking for|is a|are a)\b/i.test(title);
}

function explicitJobTitleFromText(text, company) {
  const patterns = [
    /\b(?:suchen\s+wir|wir\s+suchen)\b[\s\S]{0,180}?\bals\s+([^\n.!?;]{3,120})/iu,
    /\b(?:we(?:'re| are)\s+looking\s+for|looking\s+for)\s+(?:an?\s+)?([^\n.!?;]{3,120})/iu,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    const title = match?.[1]?.replace(/\s+/g, ' ').trim();
    if (isCredibleJobTitle(title, company)) return title;
  }
  return '';
}

function validateImportedJob(profile, rawText) {
  const issues = [];
  if (!isCredibleJobTitle(profile.title, profile.company)) {
    issues.push('Kein plausibler Stellentitel erkannt.');
  }
  if (!String(rawText || '').trim() || ![profile.description, profile.requirements, profile.about_us]
    .some(value => String(value || '').trim())) {
    issues.push('Kein verwertbarer Beschreibungstext erkannt.');
  }
  if (!serializeJobSkills(profile.required_skills)) {
    issues.push('Keine erforderlichen Skills erkannt; das Skill-Matching kann nicht gestartet werden.');
  }
  return issues;
}

async function parseJobPdfWithFastParser(req, file) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  const form = new FormData();
  const pdf = await fs.promises.readFile(file.path);
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), file.originalname);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/parse/job`, {
        method: 'POST',
        headers: graphRagAuthHeaders(req),
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      error.statusCode = 503;
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Fast-PDF-Parser HTTP ${response.status}: ${payload.detail || 'Unbekannter Fehler'}`);
      error.statusCode = response.status === 503 ? 503 : response.status === 413 ? 413 : 502;
      throw error;
    }
    if (!payload.profile || typeof payload.profile !== 'object' || typeof payload.raw_text !== 'string') {
      const error = new Error('Fast-PDF-Parser lieferte kein vollständiges Profil und keinen Rohtext.');
      error.statusCode = 502;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function persistLocalJob(job, { req, profile = {}, rawText, refreshExisting = false } = {}) {
  const value = (key, profileKey = key) => job[key] !== undefined ? job[key] : profile[profileKey];
  const identity = {
    title: value('title'), company: value('company'), location: value('location'), url: job.url,
  };
  try {
    return await db.transactionAsync(async (tx) => {
      const hit = await findJobDuplicateAsync(tx, identity);
      if (hit && !refreshExisting) throw new DuplicateError('job', hit.reason, hit.existing);
      const existing = hit ? await tx.prepare('SELECT * FROM jobs WHERE id = ? FOR UPDATE').get(hit.existing.id) : null;
      if (hit && !existing) throw new Error('Die vorhandene Stelle wurde waehrend des Imports geloescht');
      const values = {
        company: value('company') || null,
        title: identity.title,
        about_us: value('about_us') || null,
        description: value('description') || null,
        requirements: value('requirements') || null,
        skills: serializeJobSkills(value('skills', 'required_skills')) || null,
        benefits: value('benefits') || null,
        location: value('location') || null,
        type: value('type', 'employment_type') || 'Vollzeit',
        url: job.url || existing?.url || null,
        source: job.source || null,
        salary: job.salary !== undefined ? String(job.salary || '').trim() || null : existing?.salary || null,
        recruiter_company: value('recruiter_company') || null,
        employer_company: value('employer_company') || null,
      };
      values.raw_text = String(rawText ?? buildGraphRagJobText(values)).trim();
      const matchingProfile = buildGraphRagJobProfile(values, profile);
      values.parsed_profile_json = JSON.stringify(matchingProfile);
      const changed = !existing || Object.entries(values).filter(([key]) => key !== 'source').some(([key, next]) => key === 'parsed_profile_json'
        ? !isDeepStrictEqual(existing[key] ? JSON.parse(existing[key]) : null, matchingProfile)
        : existing[key] !== next);
      if (!changed) return {
        ...existing, duplicate: true, changed: false, matchingRunId: null,
        matchingStatus: 'not_required', preparationStatus: 'not_requested',
      };
      let id = existing?.id;
      if (existing) {
        await tx.prepare(`UPDATE jobs SET ${Object.keys(values).map(key => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(...Object.values(values), id);
      } else {
        const inserted = { graph_job_id: job.graph_job_id || null, ...values, status: job.status || 'Offen' };
        id = (await tx.prepare(`INSERT INTO jobs (${Object.keys(inserted).join(', ')}) VALUES (${Object.keys(inserted).map(() => '?').join(', ')})`)
          .run(...Object.values(inserted))).lastInsertRowid;
      }
      const matching = await enqueueMatchingImport(tx, {
        entityType: 'job', entityId: id, req, source: profile && Object.keys(profile).length ? 'Job-Profil-Import' : 'Job-Import',
        eventKey: existing ? `job:${id}:${randomUUID()}` : undefined,
      });
      return {
        ...await tx.prepare('SELECT * FROM jobs WHERE id = ?').get(id),
        ...matching, duplicate: Boolean(existing), changed: true,
      };
    });
  } catch (error) {
    if (error?.code === '23505') {
      throw await db.transactionAsync(tx => translateJobUniqueViolationAsync(tx, error, identity));
    }
    throw error;
  }
}

// jobId: UUID der Stelle aus PostgreSQL. GraphRAG legt den Neo4j-Knoten
// dann unter genau dieser ID an, damit beide Datenbanken dieselbe ID kennen.
async function ingestIntoGraphRag(
  req, rawText, persist = true, profile = null, jobId = null, parseRawTextWithProfile = false,
) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  if (!baseUrl) return null;

  const persistValue = persist === true ? '1' : persist === false ? '0' : String(persist);
  const jobIdParam = jobId ? `&job_id=${encodeURIComponent(jobId)}` : '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/ingest/job?persist=${encodeURIComponent(persistValue)}${jobIdParam}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...graphRagAuthHeaders(req) },
      body: JSON.stringify(profile
        ? (parseRawTextWithProfile ? { raw_text: rawText, profile } : { profile })
        : { raw_text: rawText }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`GraphRAG HTTP ${response.status}: ${payload.detail || payload.error || 'Unbekannter Fehler'}`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeJobsChLinks(body) {
  if (Array.isArray(body?.links)) {
    return body.links
      .map((link) => (typeof link === 'string' ? link.trim() : ''))
      .filter(Boolean)
  }

  if (typeof body?.linksText === 'string') {
    return body.linksText
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean)
  }

  return []
}

/**
 * @swagger
 * /jobs:
 *   get:
 *     summary: Alle Stellen (paginiert)
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Offen, Besetzt, Pausiert, Archiviert] }
 *       - in: query
 *         name: search
 *         description: Stichworte werden über Titel, Firma, Skills, Standort und Beschreibungstexte gesucht.
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Paginierte Stellenliste }
 */
router.get('/', (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    
    const conditions = [];
    const params = [];
    if (status) {
      conditions.push('j.status = ?');
      params.push(status);
    }
    const searchableFields = [
      'j.title', 'j.company', 'j.skills', 'j.location', 'j.description',
      'j.requirements', 'j.about_us', 'j.benefits', 'j.type', 'j.status', 'j.url', 'j.source',
    ];
    const searchTerms = String(search || '').trim().split(/[\s,]+/).filter(Boolean);
    for (const term of searchTerms) {
      const termFields = [...searchableFields, 'CAST(j.id AS TEXT)'];
      conditions.push(`(${termFields.map((field) => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`);
      params.push(...termFields.map(() => `%${term.toLowerCase()}%`));
    }
    // Fachbereich sieht nur die ihm zugewiesenen Stellen.
    if (req.user?.role === 'fachbereich') {
      conditions.push('j.id IN (SELECT job_id FROM user_job_access WHERE user_id = ?)');
      params.push(req.user.id);
    }
    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    
    // Total count
    const total = db.prepare(`SELECT COUNT(*) as count FROM jobs j${whereClause}`).get(...params).count;
    
    let query = `
      SELECT j.*, 
        (SELECT COUNT(*) FROM pipeline_entries WHERE job_id = j.id) as candidate_count
      FROM jobs j${whereClause}
      ORDER BY j.created_at DESC
    `;
    
    const queryParams = [...params];
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (pageNum > 0 && limitNum > 0) {
      query += ' LIMIT ? OFFSET ?';
      queryParams.push(limitNum, (pageNum - 1) * limitNum);
    }
    
    const jobs = db.prepare(query).all(...queryParams);
    res.json({
      data: jobs,
      total,
      page: pageNum > 0 ? pageNum : 1,
      limit: limitNum > 0 ? limitNum : total,
      totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 1,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Stellen' });
  }
});

/**
 * @swagger
 * /jobs/{id}:
 *   get:
 *     summary: Einzelne Stelle laden
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Stellen-Objekt }
 */
router.get('/:id', (req, res) => {
  try {
    const job = db.prepare(`
      SELECT j.*, 
        (SELECT COUNT(*) FROM pipeline_entries WHERE job_id = j.id) as candidate_count
      FROM jobs j WHERE j.id = ?
    `).get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Stelle nicht gefunden' });
    // Fremde Stellen erscheinen für Fachbereich wie nicht vorhandene (404), damit
    // sich ihre Existenz nicht abfragen lässt.
    if (req.user?.role === 'fachbereich') {
      const access = db.prepare('SELECT 1 FROM user_job_access WHERE user_id = ? AND job_id = ?').get(req.user.id, job.id);
      if (!access) return res.status(404).json({ error: 'Stelle nicht gefunden' });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Stelle' });
  }
});

/**
 * @swagger
 * /jobs:
 *   post:
 *     summary: Stelle anlegen
 *     tags: [Jobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Job' }
 *     responses:
 *       201: { description: Erstellte Stelle }
 *       200: { description: Aktualisierter oder unveraenderter Profil-Reimport. Neue Datenversionen enthalten matchingRunId und matchingStatus; unveraenderte Importe melden not_required. }
 *       409: { description: Bereits vorhandene Stelle beim manuellen Anlegen ohne Importprofil }
 */
router.post('/', async (req, res) => {
  try {
    const { title, company, description, requirements, skills, location, type, status, about_us, benefits, source, graphRagProfile } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titel ist erforderlich' });
    if (graphRagProfile !== undefined && (!graphRagProfile || typeof graphRagProfile !== 'object' || Array.isArray(graphRagProfile))) {
      return res.status(400).json({ error: 'graphRagProfile muss ein Job-Profil sein' });
    }
    // Ohne URL: Link aus "Quelle: ..." im Text (z. B. jobs.ch-PDF), damit die
    // Stelle eindeutig ist und in die CRM-Rueckgabe kann.
    const url = String(req.body.url || '').trim()
      || sourceUrlFromText(description, requirements, about_us, benefits, graphRagProfile?.description, req.body.raw_text);

    const job = await persistLocalJob({
      title, company, about_us, description, requirements, skills, benefits, location, type, status, url, source,
      salary: req.body.salary,
    }, {
      req, profile: graphRagProfile || {}, rawText: req.body.raw_text ?? graphRagProfile?.description,
      refreshExisting: Boolean(graphRagProfile),
    });
    let graphRag = null;
    if (job.changed) {
      logAudit(req, job.duplicate ? 'aktualisiert' : 'erstellt', 'Job', job.id, job.title);
      try {
        graphRag = await ingestIntoGraphRag(
          req, buildGraphRagJobText(job), 'neo4j', graphRagProfile ? JSON.parse(job.parsed_profile_json) : null, job.uuid,
        );
        if (graphRag?.id) db.prepare('UPDATE jobs SET graph_job_id = ? WHERE id = ?').run(graphRag.id, job.id);
      } catch (graphRagErr) {
        console.warn('GraphRAG job ingestion failed:', graphRagErr.message);
        graphRag = { error: graphRagErr.message, preparationStatus: 'required', preparationError: 'graph_preparation_failed' };
      }
    }
    res.status(job.duplicate ? 200 : 201).json({
      ...job,
      ...db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id),
      preparationStatus: graphRag?.preparationStatus || job.preparationStatus,
      preparationError: graphRag?.preparationError,
      preparedRevision: graphRag?.preparedRevision,
      graphRag,
    });
  } catch (err) {
    if (sendIdentityError(res, err)) return;
    console.error('Job creation error:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen der Stelle' });
  }
});

/**
 * @swagger
 * /jobs/parse-description:
 *   post:
 *     summary: Stellenbeschreibung aus Datei extrahieren (veraltet)
 *     deprecated: true
 *     description: Veralteter Endpunkt. Zur Extraktion und optionalen lokalen Persistenz wird jetzt POST /api/v1/parse/job im Fast CV and Job Parser verwendet. Der neue Parser akzeptiert PDF-Dateien.
 *     tags: [Jobs]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             properties:
 *               file: { type: string, format: binary, description: PDF, Word, TXT oder Markdown-Datei }
 *     responses:
 *       200: { description: Extrahierter Text inkl. aufgeteilter Beschreibung und Anforderungen }
 *       400: { description: Keine Datei oder ungültiges Format }
 */
router.post('/parse-description', descriptionUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Datei ist erforderlich' });
  }

  const persist = String(req.query.persist || '').toLowerCase() === '1' || String(req.query.persist || '').toLowerCase() === 'true';
  const extractOnly = String(req.query.extractOnly || '').toLowerCase() === '1' || String(req.query.extractOnly || '').toLowerCase() === 'true';

  try {
    const text = await extractText(req.file.path, req.file.mimetype);
    let trimmedText = String(text || '').trim();

    if (!trimmedText) {
      return res.status(400).json({ error: 'Aus der Datei konnte kein Text extrahiert werden' });
    }

    if (extractOnly) {
      const sections = splitJobTextSections(trimmedText);
      return res.json({
        success: true,
        filename: req.file.originalname,
        id: null,
        job: null,
        text: trimmedText,
        title: path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[-_]+/g, ' ').trim() || req.file.originalname,
        about_us: sections.about_us,
        description: sections.description,
        requirements: sections.requirements,
        skills: '',
        benefits: sections.benefits,
        importSteps: {
          aiParsed: { ok: false },
          graphRagSaved: { ok: false },
          dbSaved: { ok: false },
        },
        graphRag: null,
      });
    }

  // GraphRAG laesst hier ein Sprachmodell auf den Stellentext los. Der Aufruf
  // gehoert deshalb ins KI-Protokoll (Art. 12 EU AI Act), genauso wie der
  // Generator weiter unten.
  const isPdf = req.file.mimetype === 'application/pdf' || path.extname(req.file.originalname).toLowerCase() === '.pdf';
  const fastParse = isPdf ? await parseJobPdfWithFastParser(req, req.file) : null;
  const fastText = String(fastParse?.raw_text || '').trim();
  if (fastText.length > trimmedText.length) trimmedText = fastText;
  const fastProfile = fastParserJobProfile(fastParse?.profile);
  const fastSkills = fastParserJobSkills(fastParse?.profile);
  const aiStartedAt = Date.now();
  // Erst nur auslesen; gespeichert wird nach der Dublettenpruefung, der
  // Neo4j-Knoten entsteht danach mit der UUID der Stelle.
  let graphRag = await ingestIntoGraphRag(req, trimmedText, false);
  const modelProfile = graphRag?.profile || {};
  const company = modelProfile.company || modelProfile.company_name || fastProfile?.company || '';
  const filenameTitle = path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[-_]+/g, ' ').trim();
  const resolvedTitle = [explicitJobTitleFromText(trimmedText, company), modelProfile.title, fastProfile?.title, filenameTitle]
    .find(title => isCredibleJobTitle(title, company)) || '';
  const modelSkills = Array.isArray(modelProfile.required_skills) ? modelProfile.required_skills : [];
  const requiredSkills = serializeJobSkills(modelSkills) ? modelSkills : fastSkills;
  const sections = splitJobTextSections(trimmedText);
  const profile = {
    ...modelProfile,
    title: resolvedTitle,
    company: company || null,
    location: modelProfile.location || null,
    about_us: modelProfile.about_us || sections.about_us || '',
    description: modelProfile.description || sections.description || trimmedText,
    requirements: modelProfile.requirements || sections.requirements || '',
    benefits: modelProfile.benefits || sections.benefits || '',
    required_skills: requiredSkills,
  };
  const extractedSkills = serializeJobSkills(requiredSkills);
  const qualityIssues = validateImportedJob(profile, trimmedText);

  logAiCall({
    userId: req.user?.id,
    feature: 'job-import',
    model: getAiConfig().model,
    prompt: trimmedText,
    response: graphRag,
    parsedResult: profile,
    skills: extractedSkills,
    durationMs: Date.now() - aiStartedAt,
    success: qualityIssues.length === 0,
    errorMessage: qualityIssues.length ? qualityIssues.join(' ') : null,
  });

  if (persist && qualityIssues.length) {
    return res.status(422).json({
      error: 'Import-Qualitätsprüfung fehlgeschlagen',
      detail: qualityIssues.join(' '),
      importSteps: {
        aiParsed: { ok: false },
        graphRagSaved: { ok: false },
        dbSaved: { ok: false },
      },
    });
  }

  const parsedJob = persist
    ? await persistLocalJob({
      graph_job_id: null,
      title: resolvedTitle,
      company,
      source: 'Job-LLM-Import',
      about_us: profile.about_us,
      description: profile.description,
      requirements: profile.requirements,
      skills: extractedSkills,
      benefits: profile.benefits,
      location: profile.location,
      type: profile.employment_type || 'Vollzeit',
      status: 'Offen',
      url: sourceUrlFromText(trimmedText),
    }, { req, profile, rawText: trimmedText, refreshExisting: true })
    : null;

    if (parsedJob?.changed) {
      try {
        const stored = await ingestIntoGraphRag(req, null, 'neo4j', JSON.parse(parsedJob.parsed_profile_json), parsedJob.uuid);
        graphRag = { ...graphRag, ...stored, profile: JSON.parse(parsedJob.parsed_profile_json) };
        if (stored?.id) db.prepare('UPDATE jobs SET graph_job_id = ? WHERE id = ?').run(stored.id, parsedJob.id);
      } catch (graphRagErr) {
        console.warn('GraphRAG job ingestion failed:', graphRagErr.message);
        graphRag = { ...graphRag, error: graphRagErr.message, preparationStatus: 'required', preparationError: 'graph_preparation_failed' };
      }
    }

    const importSteps = {
      aiParsed: {
        ok: qualityIssues.length === 0,
      },
      graphRagSaved: {
        ok: Boolean(parsedJob?.changed && graphRag?.preparationStatus === 'ready' && !graphRag.error),
      },
      dbSaved: {
        ok: Boolean(parsedJob),
      },
    };

    res.json({
      success: true,
      filename: req.file.originalname,
      id: parsedJob?.id || graphRag?.id || null,
      job: parsedJob,
      text: trimmedText,
      title: parsedJob?.title || resolvedTitle,
      company: parsedJob?.company || profile.company || '',
      about_us: parsedJob?.about_us || profile.about_us,
      description: parsedJob?.description || profile.description,
      requirements: parsedJob?.requirements || profile.requirements,
      skills: parsedJob?.skills || extractedSkills || '',
      benefits: parsedJob?.benefits || profile.benefits,
      importSteps,
      graphRag,
      matchingRunId: parsedJob?.matchingRunId || null,
      matchingStatus: parsedJob?.matchingStatus || 'not_requested',
      matchingStatusUrl: parsedJob?.matchingStatusUrl,
      preparationStatus: graphRag?.preparationStatus || parsedJob?.preparationStatus || 'not_requested',
      preparationError: graphRag?.preparationError,
      preparedRevision: graphRag?.preparedRevision,
    });
  } catch (err) {
    if (err instanceof DuplicateError) return res.status(409).json(err.toJSON());
    console.error('Job description upload error:', err);
    if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode <= 599) {
      return res.status(err.statusCode).json({ error: 'Job-Import fehlgeschlagen', detail: err.message });
    }
    const message = String(err?.message || '');

    // Auch der fehlgeschlagene Versuch ist aufzeichnungspflichtig.
    logAiCall({
      userId: req.user?.id,
      feature: 'job-import',
      model: getAiConfig().model,
      prompt: null,
      response: null,
      parsedResult: null,
      success: false,
      errorMessage: message || 'Unbekannter Fehler',
    });

    if (message.includes('GraphRAG HTTP 502: Job parsing failed:')) {
      return res.status(502).json({
        error: 'GraphRAG-Parsing fehlgeschlagen',
        detail: message.replace(/^GraphRAG HTTP 502: Job parsing failed:\s*/, ''),
      });
    }
    if (message.includes('GraphRAG HTTP 502: Job embedding creation failed:')) {
      return res.status(502).json({
        error: 'GraphRAG-Embedding fehlgeschlagen',
        detail: message.replace(/^GraphRAG HTTP 502: Job embedding creation failed:\s*/, ''),
      });
    }
    if (message.includes('GraphRAG HTTP 503: Job persistence failed:')) {
      return res.status(503).json({
        error: 'GraphRAG-Speicherung fehlgeschlagen',
        detail: message.replace(/^GraphRAG HTTP 503: Job persistence failed:\s*/, ''),
      });
    }

    res.status(500).json({
      error: 'Fehler beim Verarbeiten der Stellenbeschreibung',
      detail: message || 'Unbekannter Fehler',
    });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

router.post('/export-pdf', (req, res) => {
  return forwardJobsChPluginRequest(req, res, '/plugins/jobs_ch/export-pdf')
});

/**
 * @swagger
 * /jobs/{id}:
 *   put:
 *     summary: Stelle aktualisieren
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Aktualisierte Stelle }
 */
router.put('/:id', (req, res) => {
  try {
    const { title, company, description, requirements, skills, location, type, status, url, about_us, benefits } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titel ist erforderlich' });
    assertNoJobDuplicate(db, { title, company, location, url, excludeId: Number(req.params.id) });
    db.prepare(`
      UPDATE jobs SET title=?, company=?, about_us=?, description=?, requirements=?, skills=?, benefits=?, location=?, type=?, status=?, url=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(title, company || null, about_us || null, description || null, requirements || null, skills || null, benefits || null,
      location || null, type || 'Vollzeit', status || 'Offen', url || null, req.params.id);
    if (Object.prototype.hasOwnProperty.call(req.body, 'salary')) {
      db.prepare('UPDATE jobs SET salary = ? WHERE id = ?').run(String(req.body.salary || '').trim() || null, req.params.id);
    }
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    logAudit(req, 'aktualisiert', 'Job', job.id, job.title);
    res.json(job);
  } catch (rawErr) {
    const err = translateUniqueViolation(db, rawErr, 'job', { ...req.body, excludeId: Number(req.params.id) });
    if (sendIdentityError(res, err)) return;
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Stelle' });
  }
});

/**
 * @swagger
 * /jobs/{id}:
 *   delete:
 *     summary: Stelle löschen
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Erfolgreich gelöscht }
 */
router.delete('/:id', async (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Stelle nicht gefunden' });

    const graphRag = await deleteJobFromGraphRag(req, job);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    logAudit(req, 'gelöscht', 'Job', req.params.id, job?.title);

    res.json({
      success: true,
      graphRag,
    });
  } catch (err) {
    console.error('Job delete error:', err);
    const message = String(err?.message || '');
    if (message.includes('GraphRAG HTTP 502: Job deletion failed:')) {
      return res.status(502).json({
        error: 'GraphRAG-Löschung fehlgeschlagen',
        detail: message.replace(/^GraphRAG HTTP 502: Job deletion failed:\s*/, ''),
      });
    }
    res.status(500).json({ error: 'Fehler beim Löschen der Stelle', detail: message || 'Unbekannter Fehler' });
  }
});

/**
 * @swagger
 * /jobs/generate-description:
 *   post:
 *     summary: KI-gestützte Stellenbeschreibung generieren (Ollama)
 *     tags: [Jobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               title: { type: string, description: 'Jobtitel' }
 *               keywords: { type: string, description: 'Stichpunkte/Keywords für die Stelle' }
 *               type: { type: string, description: 'Anstellungsart' }
 *               location: { type: string, description: 'Standort' }
 *     responses:
 *       200: { description: Generierte Stellenbeschreibung und Anforderungen }
 */
router.post('/generate-description', generatorRateLimiter, promptGuard('job-generator'), async (req, res) => {
  try {
    const { title, keywords, type, location } = req.body;

    if (!title && !keywords) {
      return res.status(400).json({ error: 'Jobtitel oder Stichpunkte erforderlich' });
    }

    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, apiKey: AI_API_KEY } = getAiConfig();

    const prompt = `Du bist ein HR-Experte. Erstelle eine Stellenausschreibung auf Deutsch.

Jobtitel: ${title || 'Nicht angegeben'}
${type ? `Anstellungsart: ${type}` : ''}
${location ? `Standort: ${location}` : ''}
${keywords ? `Stichpunkte: ${keywords}` : ''}

Antworte direkt und prägnant. Überspringe langes Nachdenken (Reasoning) und halte die Denkphase so kurz wie möglich. Komm direkt zum Punkt.

Antworte NUR mit diesem exakten JSON-Format (ohne Markdown, ohne Erklärung):
{"description": "HIER die Stellenbeschreibung als Fließtext (3-4 Absätze)", "requirements": "HIER die Anforderungen, jeweils mit • am Anfang, getrennt durch Zeilenumbruch"}

Die Keys MÜSSEN "description" und "requirements" heißen (englisch). Beide Werte sind Strings.`;

    // First check if the configured AI service is reachable.
    try {
      const { provider: cfgProvider } = getAiConfig();
      const aiProvider = await resolveAiProvider(OLLAMA_URL, cfgProvider);
      await pingAiService(OLLAMA_URL, aiProvider, 5000, AI_API_KEY);
    } catch (pingErr) {
      console.error('AI service not reachable:', pingErr.message);
      return res.status(502).json({ error: 'KI-Host ist nicht erreichbar. Bitte Konfiguration und API-Key prüfen.' });
    }

    let aiProvider = 'ollama';
    try {
      const { provider: cfgProvider } = getAiConfig();
      aiProvider = await resolveAiProvider(OLLAMA_URL, cfgProvider);
    } catch (_) {}

    const { url: aiUrl, body: aiBody, headers: aiHeaders } = buildAiRequest({
      baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: aiProvider, prompt,
      apiKey: AI_API_KEY, options: { think: false, num_predict: 2048 },
    });

    // Send generation request with 180s timeout (large models need time to load)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    const startTime = Date.now();
    let response;
    try {
      response = await fetch(aiUrl, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify(aiBody),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logAiCall({
        userId: req.user?.id,
        feature: 'job-generator',
        model: OLLAMA_MODEL,
        prompt,
        response: null,
        parsedResult: null,
        durationMs: duration,
        success: false,
        errorMessage: fetchErr.name === 'AbortError' ? 'Timeout >180s' : fetchErr.message,
      });
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'Ollama-Timeout: Die Generierung hat zu lange gedauert (> 3 Min). Versuche es erneut — das Modell wird beim ersten Aufruf geladen.' });
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Ollama error:', errText);
      logAiCall({
        userId: req.user?.id,
        feature: 'job-generator',
        model: OLLAMA_MODEL,
        prompt,
        response: errText,
        parsedResult: null,
        durationMs: Date.now() - startTime,
        success: false,
        errorMessage: `KI-Dienst Status ${response.status}: ${errText}`,
      });
      return res.status(502).json({ error: 'Ollama-Fehler: ' + (errText || 'Unbekannter Fehler') });
    }

    const data = await response.json();
    const { text: responseText, promptTokens: inputTokens, evalTokens: outputTokens } = extractAiText(data, aiProvider);
    const generationDuration = Date.now() - startTime;

    // Parse JSON from response (handle markdown wrapping, German keys, nested structures)
    let parsed = { description: '', requirements: '' };
    try {
      // Strip markdown code blocks if present
      let cleanText = stripReasoningTags(responseText);
      
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        
        // Handle both English and German keys
        const desc = raw.description || raw.Beschreibung || raw.beschreibung || '';
        let req = raw.requirements || raw.Anforderungen || raw.anforderungen || '';
        
        // If description is itself a nested JSON string, parse it
        if (typeof desc === 'string' && desc.trim().startsWith('{')) {
          try {
            const inner = JSON.parse(desc);
            parsed.description = inner.description || inner.Beschreibung || desc;
            parsed.requirements = inner.requirements || inner.Anforderungen || req;
          } catch { parsed.description = desc; }
        } else {
          parsed.description = typeof desc === 'string' ? desc : JSON.stringify(desc);
        }
        
        // Handle requirements as array or object
        if (Array.isArray(req)) {
          parsed.requirements = req.map(r => typeof r === 'string' ? `• ${r}` : `• ${JSON.stringify(r)}`).join('\n');
        } else if (typeof req === 'object' && req !== null) {
          // Flatten nested requirement object
          const items = [];
          for (const [key, val] of Object.entries(req)) {
            if (Array.isArray(val)) val.forEach(v => items.push(`• ${v}`));
            else items.push(`• ${key}: ${val}`);
          }
          parsed.requirements = items.join('\n');
        } else {
          parsed.requirements = req || '';
        }
      } else {
        throw new Error('Kein JSON in Antwort');
      }
    } catch (parseErr) {
      console.warn('JSON parse fallback:', parseErr.message);
      // Fallback: split raw text
      const parts = responseText.split(/anforderungen|requirements/i);
      parsed.description = (parts[0] || responseText).replace(/[{}"\[\]]/g, '').trim();
      parsed.requirements = (parts[1] || '').replace(/[{}"\[\]:]/g, '').trim();
    }

    // Clean up the final output
    const cleanText = (text) => {
      if (!text) return '';
      return text
        .replace(/^(description|requirements|beschreibung|anforderungen)\s*:\s*/i, '') // strip key prefixes
        .replace(/\\n/g, '\n')  // convert literal \n to real newlines
        .replace(/,\s*$/, '')   // trailing comma
        .trim();
    };

    logAudit(req, 'ki-generierung', 'Job', null, title, {
      model: OLLAMA_MODEL,
      keywords: keywords?.slice(0, 200)
    });

    const finalDescription = cleanText(parsed.description);
    const finalRequirements = cleanText(parsed.requirements);

    // AI Act Art. 12: Log the AI call
    logAiCall({
      userId: req.user?.id,
      feature: 'job-generator',
      model: OLLAMA_MODEL,
      prompt,
      response: responseText,
      parsedResult: { description: finalDescription, requirements: finalRequirements },
      durationMs: generationDuration,
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      success: true,
    });

    res.json({
      description: finalDescription,
      requirements: finalRequirements,
      model: OLLAMA_MODEL
    });
  } catch (error) {
    console.error('Error generating job description:', error);
    res.status(500).json({ error: 'Fehler bei der KI-Generierung. Ist Ollama gestartet?' });
  }
});

module.exports = router;
