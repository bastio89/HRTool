const express = require('express');
const db = require('../database');

const router = express.Router();

const ACTIVITY_TYPES = ['Notiz', 'Anruf', 'E-Mail', 'Interview', 'Angebot', 'Absage', 'Pipeline'];

/**
 * @swagger
 * /activities/candidate/{candidateId}:
 *   get:
 *     summary: Aktivitäten eines Bewerbers
 *     tags: [Activities]
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Aktivitätenliste }
 */
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

/**
 * @swagger
 * /activities/candidate/{candidateId}:
 *   post:
 *     summary: Aktivität anlegen
 *     tags: [Activities]
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               type: { type: string, enum: [Notiz, Anruf, 'E-Mail', Interview, Angebot, Absage] }
 *               content: { type: string }
 *     responses:
 *       201: { description: Aktivität erstellt }
 */
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

/**
 * @swagger
 * /activities/{id}:
 *   delete:
 *     summary: Aktivität löschen
 *     tags: [Activities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Gelöscht }
 */
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen der Aktivität' });
  }
});

module.exports = router;
