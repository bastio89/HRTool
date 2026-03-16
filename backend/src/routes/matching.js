const express = require('express');
const db = require('../database');
const { logAiCall } = require('../aiLogger');
const { logAudit } = require('./audit');

const router = express.Router();

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
router.post('/run', async (req, res) => {
  try {
    const { jobDescription, jobTitle, candidateIds } = req.body;

    if (!jobDescription || jobDescription.trim() === '') {
      return res.status(400).json({ error: 'Stellenbeschreibung ist erforderlich' });
    }

    // Get candidates - either specific ones or all
    let candidates;
    if (candidateIds && candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => '?').join(',');
      candidates = db.prepare(`SELECT * FROM candidates WHERE id IN (${placeholders})`).all(...candidateIds);
    } else {
      candidates = db.prepare('SELECT * FROM candidates').all();
    }

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Keine Bewerber vorhanden' });
    }

    // Call n8n webhook for matching (with 120s timeout for LLM processing)
    const webhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/hr-matching';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    
    const matchingPrompt = JSON.stringify({
      jobDescription,
      jobTitle: jobTitle || 'Unbenannte Stelle',
      candidates: candidates.map((c, idx) => ({
        id: c.id,
        name: `Kandidat ${idx + 1}`,
        experience: c.experience,
        skills: c.skills,
        education: c.education,
        languages: c.languages,
        certificates: c.certificates,
        location: c.location,
        desired_salary: c.desired_salary,
        availability: c.availability,
        drivers_license: c.drivers_license,
        mobility: c.mobility
      }))
    });

    const startTime = Date.now();
    let response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: matchingPrompt
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      logAiCall({
        userId: req.user?.id,
        feature: 'matching',
        model: process.env.OLLAMA_MODEL || 'llama3.2',
        prompt: matchingPrompt,
        response: null,
        parsedResult: null,
        durationMs: duration,
        success: false,
        errorMessage: fetchErr.name === 'AbortError' ? 'Timeout >120s' : fetchErr.message,
      });
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'n8n Timeout – Matching dauerte zu lange (>120s)' });
      }
      throw fetchErr;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('n8n webhook error:', response.status, errText);
      logAiCall({
        userId: req.user?.id,
        feature: 'matching',
        model: process.env.OLLAMA_MODEL || 'llama3.2',
        prompt: matchingPrompt,
        response: errText,
        parsedResult: null,
        durationMs: Date.now() - startTime,
        success: false,
        errorMessage: `n8n Status ${response.status}: ${errText}`,
      });
      return res.status(502).json({ 
        error: 'n8n Workflow fehlgeschlagen',
        details: `Status ${response.status}: ${errText}`
      });
    }

    const matchingResults = await response.json();
    const matchingDuration = Date.now() - startTime;

    // AI Act Art. 12: Log the AI call
    logAiCall({
      userId: req.user?.id,
      feature: 'matching',
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      prompt: matchingPrompt,
      response: JSON.stringify(matchingResults),
      parsedResult: matchingResults,
      durationMs: matchingDuration,
      success: true,
    });

    // De-Anonymisierung: echte Namen wieder einsetzen anhand der candidateId
    const candidateMap = new Map(candidates.map(c => [c.id, c.name]));
    if (matchingResults.results) {
      matchingResults.results = matchingResults.results.map(r => ({
        ...r,
        candidateName: candidateMap.get(r.candidateId) || r.candidateName
      }));
    }

    // Save results (mit echten Namen)
    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results)
      VALUES (?, ?, ?)
    `).run(jobDescription, jobTitle || 'Unbenannte Stelle', JSON.stringify(matchingResults));

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
