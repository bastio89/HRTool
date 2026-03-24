const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');
const { logAiCall } = require('../aiLogger');
const { generatorRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');

const router = express.Router();

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
    const { title, description, requirements, location, type, status, url } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titel ist erforderlich' });

    const result = db.prepare(`
      INSERT INTO jobs (title, description, requirements, location, type, status, url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      title, description || null, requirements || null,
      location || null, type || 'Vollzeit', status || 'Offen', url || null
    );
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
    logAudit(req, 'erstellt', 'Job', job.id, job.title);
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Erstellen der Stelle' });
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
    const { title, description, requirements, location, type, status, url } = req.body;
    db.prepare(`
      UPDATE jobs SET title=?, description=?, requirements=?, location=?, type=?, status=?, url=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(title, description || null, requirements || null, location || null,
      type || 'Vollzeit', status || 'Offen', url || null, req.params.id);
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

    const OLLAMA_URL = process.env.OLLAMA_BASE_URL?.replace('host.docker.internal', 'localhost') || 'http://localhost:11434';
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

    const prompt = `Du bist ein HR-Experte. Erstelle eine Stellenausschreibung auf Deutsch.

Jobtitel: ${title || 'Nicht angegeben'}
${type ? `Anstellungsart: ${type}` : ''}
${location ? `Standort: ${location}` : ''}
${keywords ? `Stichpunkte: ${keywords}` : ''}

Antworte NUR mit diesem exakten JSON-Format (ohne Markdown, ohne Erklärung):
{"description": "HIER die Stellenbeschreibung als Fließtext (3-4 Absätze)", "requirements": "HIER die Anforderungen, jeweils mit • am Anfang, getrennt durch Zeilenumbruch"}

Die Keys MÜSSEN "description" und "requirements" heißen (englisch). Beide Werte sind Strings.`;

    // First check if Ollama is reachable at all (quick 5s check)
    try {
      const pingController = new AbortController();
      setTimeout(() => pingController.abort(), 5000);
      await fetch(`${OLLAMA_URL}/`, { signal: pingController.signal });
    } catch (pingErr) {
      console.error('Ollama not reachable:', pingErr.message);
      return res.status(502).json({ error: 'Ollama ist nicht erreichbar. Bitte sicherstellen, dass Ollama läuft.' });
    }

    // Send generation request with 180s timeout (large models need time to load)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    const startTime = Date.now();
    let response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          options: { temperature: 0.7, num_predict: 2048 }
        }),
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
        errorMessage: `Ollama Status ${response.status}: ${errText}`,
      });
      return res.status(502).json({ error: 'Ollama-Fehler: ' + (errText || 'Unbekannter Fehler') });
    }

    const data = await response.json();
    const responseText = data.response || '';
    const generationDuration = Date.now() - startTime;

    // Parse JSON from response (handle markdown wrapping, German keys, nested structures)
    let parsed = { description: '', requirements: '' };
    try {
      // Strip markdown code blocks if present
      let cleanText = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      
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
      inputTokens: data.prompt_eval_count ?? null,
      outputTokens: data.eval_count ?? null,
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
