const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

const CATEGORIES = ['gesamt', 'fachlich', 'persönlich', 'kulturfit'];

/**
 * @swagger
 * /ratings/candidate/{candidateId}:
 *   get:
 *     summary: Bewertungen eines Bewerbers
 *     tags: [Ratings]
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Bewertungsliste mit Durchschnitt }
 */
router.get('/candidate/:candidateId', (req, res) => {
  try {
    const ratings = db.prepare(`
      SELECT * FROM candidate_ratings 
      WHERE candidate_id = ? 
      ORDER BY created_at DESC
    `).all(req.params.candidateId);

    // Calculate averages per category
    const averages = {};
    const groups = {};
    for (const r of ratings) {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r.rating);
    }
    for (const [cat, vals] of Object.entries(groups)) {
      averages[cat] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }

    // Overall average
    const allRatings = ratings.map(r => r.rating);
    const overallAvg = allRatings.length > 0
      ? Math.round((allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 10) / 10
      : null;

    res.json({ data: ratings, averages, overall: overallAvg, count: ratings.length });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Bewertungen' });
  }
});

/**
 * @swagger
 * /ratings/candidate/{candidateId}/average:
 *   get:
 *     summary: Durchschnittsbewertung eines Bewerbers
 *     tags: [Ratings]
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Durchschnitt und Anzahl }
 */
router.get('/candidate/:candidateId/average', (req, res) => {
  try {
    const result = db.prepare(`
      SELECT AVG(rating) as avg_rating, COUNT(*) as count
      FROM candidate_ratings WHERE candidate_id = ?
    `).get(req.params.candidateId);

    res.json({
      average: result.avg_rating ? Math.round(result.avg_rating * 10) / 10 : null,
      count: result.count
    });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Bewertung' });
  }
});

/**
 * @swagger
 * /ratings/candidates/averages:
 *   post:
 *     summary: Durchschnittsbewertungen für mehrere Bewerber (Batch)
 *     tags: [Ratings]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               candidateIds: { type: array, items: { type: integer } }
 *     responses:
 *       200: { description: Map von candidate_id zu Durchschnitt }
 */
router.post('/candidates/averages', (req, res) => {
  try {
    const { candidateIds } = req.body;
    if (!candidateIds?.length) return res.json({ data: {} });

    const placeholders = candidateIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT candidate_id, AVG(rating) as avg_rating, COUNT(*) as count
      FROM candidate_ratings 
      WHERE candidate_id IN (${placeholders})
      GROUP BY candidate_id
    `).all(...candidateIds);

    const result = {};
    for (const row of rows) {
      result[row.candidate_id] = {
        average: Math.round(row.avg_rating * 10) / 10,
        count: row.count
      };
    }
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Bewertungen' });
  }
});

/**
 * @swagger
 * /ratings/candidate/{candidateId}:
 *   post:
 *     summary: Bewertung abgeben
 *     tags: [Ratings]
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
 *               category: { type: string, enum: [gesamt, fachlich, persönlich, kulturfit] }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *     responses:
 *       201: { description: Bewertung erstellt }
 */
router.post('/candidate/:candidateId', (req, res) => {
  try {
    const { category = 'gesamt', rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Bewertung muss zwischen 1 und 5 liegen' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Ungültige Kategorie. Erlaubt: ${CATEGORIES.join(', ')}` });
    }

    const result = db.prepare(`
      INSERT INTO candidate_ratings (candidate_id, category, rating, comment, created_by) 
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.candidateId, category, rating, comment?.trim() || null, req.user?.display_name || 'System');

    const entry = db.prepare('SELECT * FROM candidate_ratings WHERE id = ?').get(result.lastInsertRowid);

    logAudit(req, 'bewertung', 'candidate', req.params.candidateId, null, {
      category, rating, comment: comment?.trim()
    });

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Erstellen der Bewertung' });
  }
});

/**
 * @swagger
 * /ratings/{id}:
 *   delete:
 *     summary: Bewertung löschen
 *     tags: [Ratings]
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
    db.prepare('DELETE FROM candidate_ratings WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen der Bewertung' });
  }
});

module.exports = router;
