const express = require('express');
const db = require('../database');

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
    db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen der Stelle' });
  }
});

module.exports = router;
