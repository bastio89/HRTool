const express = require('express');
const db = require('../database');

const router = express.Router();

const STAGES = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt'];

// GET full pipeline for a job
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

// POST add candidate to pipeline
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

// PUT update stage
router.put('/:entryId/stage', (req, res) => {
  try {
    const { stage, notes } = req.body;
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Ungültige Stage' });

    const entry = db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(req.params.entryId);
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    db.prepare(`
      UPDATE pipeline_entries SET stage=?, notes=COALESCE(?, notes), updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(stage, notes || null, req.params.entryId);

    // Log stage change as activity
    if (entry.stage !== stage) {
      const job = db.prepare('SELECT title FROM jobs WHERE id = ?').get(entry.job_id);
      db.prepare(`INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)`)
        .run(entry.candidate_id, 'Pipeline', `Stage gewechselt: "${entry.stage}" → "${stage}"${job ? ` (${job.title})` : ''}`);
    }

    res.json(db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(req.params.entryId));
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Stage' });
  }
});

// DELETE remove from pipeline
router.delete('/:entryId', (req, res) => {
  try {
    db.prepare('DELETE FROM pipeline_entries WHERE id = ?').run(req.params.entryId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Entfernen aus der Pipeline' });
  }
});

module.exports = router;
