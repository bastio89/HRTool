const express = require('express');
const db = require('../database');

const router = express.Router();

// GET all jobs
router.get('/', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT j.*, 
        (SELECT COUNT(*) FROM pipeline_entries WHERE job_id = j.id) as candidate_count
      FROM jobs j
    `;
    const params = [];
    if (status) {
      query += ' WHERE j.status = ?';
      params.push(status);
    }
    query += ' ORDER BY j.created_at DESC';
    const jobs = db.prepare(query).all(...params);
    res.json({ data: jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Stellen' });
  }
});

// GET single job
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

// POST create job
router.post('/', (req, res) => {
  try {
    const { title, description, requirements, location, type, status } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titel ist erforderlich' });

    const result = db.prepare(`
      INSERT INTO jobs (title, description, requirements, location, type, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      title, description || null, requirements || null,
      location || null, type || 'Vollzeit', status || 'Offen'
    );
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Erstellen der Stelle' });
  }
});

// PUT update job
router.put('/:id', (req, res) => {
  try {
    const { title, description, requirements, location, type, status } = req.body;
    db.prepare(`
      UPDATE jobs SET title=?, description=?, requirements=?, location=?, type=?, status=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(title, description || null, requirements || null, location || null,
      type || 'Vollzeit', status || 'Offen', req.params.id);
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Stelle' });
  }
});

// DELETE job
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen der Stelle' });
  }
});

module.exports = router;
