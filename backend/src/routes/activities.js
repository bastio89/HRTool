const express = require('express');
const db = require('../database');

const router = express.Router();

const ACTIVITY_TYPES = ['Notiz', 'Anruf', 'E-Mail', 'Interview', 'Angebot', 'Absage', 'Pipeline'];

// GET activities for a candidate
router.get('/candidate/:candidateId', (req, res) => {
  try {
    const activities = db.prepare(`
      SELECT * FROM activities 
      WHERE candidate_id = ? 
      ORDER BY created_at DESC
    `).all(req.params.candidateId);
    res.json({ data: activities });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Aktivitäten' });
  }
});

// POST create activity
router.post('/candidate/:candidateId', (req, res) => {
  try {
    const { type, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Inhalt ist erforderlich' });
    if (!ACTIVITY_TYPES.includes(type)) return res.status(400).json({ error: 'Ungültiger Typ' });

    const result = db.prepare(`
      INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)
    `).run(req.params.candidateId, type, content.trim());

    const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(activity);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Erstellen der Aktivität' });
  }
});

// DELETE activity
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen der Aktivität' });
  }
});

module.exports = router;
