const express = require('express');
const db = require('../database');

const router = express.Router();

const STAGES = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt'];

/**
 * @swagger
 * /pipeline/job/{jobId}:
 *   get:
 *     summary: Pipeline-Board einer Stelle
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Board mit Stages und Kandidaten }
 */
router.get('/job/:jobId', (req, res) => {
  try {
    const entries = db.prepare(`
      SELECT pe.id, pe.job_id, pe.candidate_id, pe.stage, pe.notes, pe.created_at, pe.updated_at,
        c.name as candidate_name, c.location, c.skills, c.availability, c.status, c.tags, c.email
      FROM pipeline_entries pe
      JOIN candidates c ON c.id = pe.candidate_id
      WHERE pe.job_id = ?
      ORDER BY pe.updated_at DESC
    `).all(req.params.jobId);

    // Group by stage
    const board = {};
    for (const stage of STAGES) {
      board[stage] = entries.filter(e => e.stage === stage);
    }

    res.json({ stages: STAGES, board, total: entries.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Pipeline' });
  }
});

/**
 * @swagger
 * /pipeline/job/{jobId}/add:
 *   post:
 *     summary: Bewerber zur Pipeline hinzufügen
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               candidate_id: { type: integer }
 *               stage: { type: string }
 *     responses:
 *       201: { description: Pipeline-Eintrag erstellt }
 */
router.post('/job/:jobId/add', (req, res) => {
  try {
    const { candidate_id, stage = 'Beworben', notes } = req.body;
    if (!candidate_id) return res.status(400).json({ error: 'Bewerber-ID erforderlich' });

    const result = db.prepare(`
      INSERT OR REPLACE INTO pipeline_entries (job_id, candidate_id, stage, notes, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(req.params.jobId, candidate_id, stage, notes || null);

    // Auto-log activity
    const candidate = db.prepare('SELECT name FROM candidates WHERE id = ?').get(candidate_id);
    const job = db.prepare('SELECT title FROM jobs WHERE id = ?').get(req.params.jobId);
    if (candidate && job) {
      db.prepare(`INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)`)
        .run(candidate_id, 'Pipeline', `Zur Stelle "${job.title}" hinzugefügt (${stage})`);
    }

    const entry = db.prepare(`
      SELECT pe.*, c.name as candidate_name FROM pipeline_entries pe
      JOIN candidates c ON c.id = pe.candidate_id
      WHERE pe.id = ?
    `).get(result.lastInsertRowid || db.prepare('SELECT id FROM pipeline_entries WHERE job_id=? AND candidate_id=?').get(req.params.jobId, candidate_id).id);

    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Hinzufügen zur Pipeline' });
  }
});

/**
 * @swagger
 * /pipeline/{entryId}/stage:
 *   put:
 *     summary: Stage aktualisieren
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               stage: { type: string }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Stage aktualisiert }
 */
router.put('/:entryId/stage', (req, res) => {
  try {
    const { stage, notes } = req.body;
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Ungültige Stage' });

    const entry = db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(req.params.entryId);
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    const oldStage = entry.stage;

    db.prepare(`
      UPDATE pipeline_entries SET stage=?, notes=COALESCE(?, notes), updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(stage, notes || null, req.params.entryId);

    // Save note to pipeline_notes history
    if (notes && notes.trim()) {
      db.prepare(`INSERT INTO pipeline_notes (pipeline_entry_id, content, old_stage, new_stage) VALUES (?, ?, ?, ?)`)
        .run(req.params.entryId, notes.trim(), oldStage, stage);
    }

    // Auto note for stage change without explicit note
    if (oldStage !== stage && (!notes || !notes.trim())) {
      db.prepare(`INSERT INTO pipeline_notes (pipeline_entry_id, content, old_stage, new_stage, author) VALUES (?, ?, ?, ?, ?)`)
        .run(req.params.entryId, `Stage gewechselt: "${oldStage}" → "${stage}"`, oldStage, stage, 'System');
    }

    // Log stage change as activity
    if (entry.stage !== stage) {
      const job = db.prepare('SELECT title FROM jobs WHERE id = ?').get(entry.job_id);
      db.prepare(`INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)`)
        .run(entry.candidate_id, 'Pipeline', `Stage gewechselt: "${entry.stage}" → "${stage}"${job ? ` (${job.title})` : ''}${notes ? ` — ${notes}` : ''}`);
    }

    res.json(db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(req.params.entryId));
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Stage' });
  }
});

/**
 * @swagger
 * /pipeline/{entryId}/notes:
 *   get:
 *     summary: Notizen eines Pipeline-Eintrags
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Liste der Notizen }
 */
router.get('/:entryId/notes', (req, res) => {
  try {
    const notes = db.prepare(
      'SELECT * FROM pipeline_notes WHERE pipeline_entry_id = ? ORDER BY created_at DESC'
    ).all(req.params.entryId);
    res.json({ data: notes });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Notizen' });
  }
});

/**
 * @swagger
 * /pipeline/{entryId}/notes:
 *   post:
 *     summary: Notiz hinzufügen
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               content: { type: string }
 *     responses:
 *       201: { description: Notiz erstellt }
 */
router.post('/:entryId/notes', (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Notiz darf nicht leer sein' });

    const entry = db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(req.params.entryId);
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    const result = db.prepare(
      'INSERT INTO pipeline_notes (pipeline_entry_id, content, old_stage, new_stage) VALUES (?, ?, ?, ?)'
    ).run(req.params.entryId, content.trim(), entry.stage, entry.stage);

    const note = db.prepare('SELECT * FROM pipeline_notes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Speichern der Notiz' });
  }
});

/**
 * @swagger
 * /pipeline/active-jobs:
 *   get:
 *     summary: Aktive Pipelines (Jobs mit Kandidaten)
 *     tags: [Pipeline]
 *     responses:
 *       200: { description: Liste aktiver Pipeline-Jobs }
 */
router.get('/active-jobs', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT j.id, j.title, j.location, j.type, j.status,
        pe.stage, COUNT(*) as count
      FROM pipeline_entries pe
      JOIN jobs j ON j.id = pe.job_id
      GROUP BY pe.job_id, pe.stage
      ORDER BY j.title, pe.stage
    `).all();

    // Group by job
    const jobMap = new Map();
    for (const row of rows) {
      if (!jobMap.has(row.id)) {
        jobMap.set(row.id, {
          id: row.id,
          title: row.title,
          location: row.location,
          type: row.type,
          status: row.status,
          stages: {},
          total: 0
        });
      }
      const job = jobMap.get(row.id);
      job.stages[row.stage] = row.count;
      job.total += row.count;
    }

    res.json({ data: Array.from(jobMap.values()) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der aktiven Pipelines' });
  }
});

/**
 * @swagger
 * /pipeline/{entryId}:
 *   delete:
 *     summary: Pipeline-Eintrag entfernen
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Entfernt }
 */
router.delete('/:entryId', (req, res) => {
  try {
    db.prepare('DELETE FROM pipeline_entries WHERE id = ?').run(req.params.entryId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Entfernen aus der Pipeline' });
  }
});

module.exports = router;
