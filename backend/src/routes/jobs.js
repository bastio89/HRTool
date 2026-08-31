const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const db = require('../database');
const { logAudit } = require('./audit');
const { logAiCall } = require('../aiLogger');
const { generatorRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');
const { getAiConfig, stripReasoningTags, resolveAiProvider, buildAiRequest, extractAiText, pingAiService } = require('../aiConfig');
const { tmpDir, extractText } = require('../utils/documentText');

const router = express.Router();

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

function buildGraphRagJobProfile(job) {
  return {
    title: String(job.title || '').trim(),
    location: job.location || null,
    employment_type: job.type || null,
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

function persistLocalJob(job) {
  const result = db.prepare(`
    INSERT INTO jobs (title, about_us, description, requirements, skills, benefits, location, type, status, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.title,
    job.about_us || null,
    job.description || null,
    job.requirements || null,
    job.skills || null,
    job.benefits || null,
    job.location || null,
    job.type || 'Vollzeit',
    job.status || 'Offen',
    job.url || null,
  );

  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
}

async function ingestIntoGraphRag(rawText, persist = true) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim();
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/ingest/job?persist=${persist ? '1' : '0'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: rawText }),
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
    const { status, page, limit } = req.query;
    
    let whereClause = '';
    const params = [];
    if (status) {
      whereClause = ' WHERE j.status = ?';
      params.push(status);
    }
    
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
 */
router.post('/', (req, res) => {
  try {
    const { title, description, requirements, skills, location, type, status, url, about_us, benefits } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titel ist erforderlich' });

    const job = persistLocalJob({ title, about_us, description, requirements, skills, benefits, location, type, status, url });
    logAudit(req, 'erstellt', 'Job', job.id, job.title);

    ingestIntoGraphRag(buildGraphRagJobText(job), true).catch((graphRagErr) => {
      console.warn('GraphRAG job ingestion failed:', graphRagErr.message);
      return { error: graphRagErr.message };
    }).then((graphRag) => {
      res.status(201).json({ ...job, graphRag });
    });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Erstellen der Stelle' });
  }
});

/**
 * @swagger
 * /jobs/parse-description:
 *   post:
 *     summary: Stellenbeschreibung aus Datei extrahieren
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

  try {
    const text = await extractText(req.file.path, req.file.mimetype);
    const trimmedText = String(text || '').trim();

    if (!trimmedText) {
      return res.status(400).json({ error: 'Aus der Datei konnte kein Text extrahiert werden' });
    }

    const graphRag = await ingestIntoGraphRag(trimmedText, persist);
    const profile = graphRag?.profile || {};
    const extractedSkills = serializeJobSkills(profile.required_skills);
    const parsedJob = persist
      ? persistLocalJob({
        title: profile.title || path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[-_]+/g, ' ').trim() || req.file.originalname,
        about_us: profile.about_us || '',
        description: profile.description || '',
        requirements: profile.requirements || '',
        skills: extractedSkills,
        benefits: profile.benefits || '',
        location: profile.location || null,
        type: profile.employment_type || 'Vollzeit',
        status: 'Offen',
        url: null,
      })
      : null;

    const importSteps = {
      aiParsed: {
        ok: Boolean(graphRag?.profile),
      },
      graphRagSaved: {
        ok: Boolean(graphRag && !graphRag.error),
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
      title: parsedJob?.title || profile.title || '',
      about_us: parsedJob?.about_us || profile.about_us || '',
      description: parsedJob?.description || profile.description || '',
      requirements: parsedJob?.requirements || profile.requirements || '',
      skills: parsedJob?.skills || extractedSkills || '',
      benefits: parsedJob?.benefits || profile.benefits || '',
      importSteps,
      graphRag,
    });
  } catch (err) {
    console.error('Job description upload error:', err);
    const message = String(err?.message || '');
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
    const { title, description, requirements, skills, location, type, status, url, about_us, benefits } = req.body;
    db.prepare(`
      UPDATE jobs SET title=?, about_us=?, description=?, requirements=?, skills=?, benefits=?, location=?, type=?, status=?, url=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(title, about_us || null, description || null, requirements || null, skills || null, benefits || null,
      location || null, type || 'Vollzeit', status || 'Offen', url || null, req.params.id);
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    logAudit(req, 'aktualisiert', 'Job', job.id, job.title);
    res.json(job);
  } catch (err) {
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
router.delete('/:id', (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Stelle nicht gefunden' });
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('Archiviert', req.params.id);
    logAudit(req, 'archiviert', 'Job', req.params.id, job?.title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Archivieren der Stelle' });
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
