const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

/**
 * @swagger
 * /interviews:
 *   get:
 *     summary: Alle Interviews (optional gefiltert)
 *     tags: [Interviews]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200: { description: Liste aller Interviews }
 */
router.get('/', (req, res) => {
  try {
    const { from, to, status } = req.query;

    let where = [];
    let params = [];

    if (from) {
      where.push('i.interview_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('i.interview_date <= ?');
      params.push(to);
    }
    if (status) {
      where.push('i.status = ?');
      params.push(status);
    }

    const whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';

    const interviews = db.prepare(`
      SELECT i.*, c.name as candidate_name, c.email as candidate_email,
             j.title as job_title, j.location as job_location
      FROM interviews i
      LEFT JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN jobs j ON i.job_id = j.id
      ${whereClause}
      ORDER BY i.interview_date ASC, i.interview_time ASC
    `).all(...params);

    res.json({ data: interviews });
  } catch (error) {
    console.error('Error fetching interviews:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Interviews' });
  }
});

/**
 * @swagger
 * /interviews/upcoming:
 *   get:
 *     summary: Kommende Interviews (nächste 14 Tage)
 *     tags: [Interviews]
 *     responses:
 *       200: { description: Kommende Interviews }
 */
router.get('/upcoming', (req, res) => {
  try {
    const interviews = db.prepare(`
      SELECT i.*, c.name as candidate_name, c.email as candidate_email,
             j.title as job_title, j.location as job_location
      FROM interviews i
      LEFT JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN jobs j ON i.job_id = j.id
      WHERE i.interview_date >= date('now')
        AND i.interview_date <= date('now', '+14 days')
        AND i.status != 'abgesagt'
      ORDER BY i.interview_date ASC, i.interview_time ASC
    `).all();

    res.json({ data: interviews });
  } catch (error) {
    console.error('Error fetching upcoming interviews:', error);
    res.status(500).json({ error: 'Fehler beim Laden der kommenden Interviews' });
  }
});

/**
 * @swagger
 * /interviews/pipeline/{entryId}:
 *   get:
 *     summary: Interviews für einen Pipeline-Eintrag
 *     tags: [Interviews]
 */
router.get('/pipeline/:entryId', (req, res) => {
  try {
    const interviews = db.prepare(`
      SELECT i.*, c.name as candidate_name, j.title as job_title
      FROM interviews i
      LEFT JOIN candidates c ON i.candidate_id = c.id
      LEFT JOIN jobs j ON i.job_id = j.id
      WHERE i.pipeline_entry_id = ?
      ORDER BY i.interview_date ASC, i.interview_time ASC
    `).all(req.params.entryId);

    res.json({ data: interviews });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Interviews' });
  }
});

/**
 * @swagger
 * /interviews:
 *   post:
 *     summary: Neues Interview anlegen
 *     tags: [Interviews]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               pipeline_entry_id: { type: integer, required: true }
 *               candidate_id: { type: integer, required: true }
 *               job_id: { type: integer, required: true }
 *               interview_date: { type: string, format: date, required: true }
 *               interview_time: { type: string }
 *               duration_minutes: { type: integer }
 *               interview_type: { type: string, enum: ['vor Ort', 'Video', 'Telefon'] }
 *               location: { type: string }
 *               meeting_link: { type: string }
 *               participants: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Interview erstellt }
 */
router.post('/', (req, res) => {
  try {
    const {
      pipeline_entry_id, candidate_id, job_id,
      interview_date, interview_time, duration_minutes,
      interview_type, location, meeting_link, participants, notes
    } = req.body;

    if (!pipeline_entry_id || !candidate_id || !job_id || !interview_date) {
      return res.status(400).json({ error: 'Pipeline-Eintrag, Bewerber, Stelle und Datum erforderlich' });
    }

    const result = db.prepare(`
      INSERT INTO interviews (pipeline_entry_id, candidate_id, job_id,
        interview_date, interview_time, duration_minutes,
        interview_type, location, meeting_link, participants, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pipeline_entry_id, candidate_id, job_id,
      interview_date, interview_time || null, duration_minutes || 60,
      interview_type || 'vor Ort', location || null, meeting_link || null,
      participants || null, notes || null
    );

    const candidate = db.prepare('SELECT name FROM candidates WHERE id = ?').get(candidate_id);
    const job = db.prepare('SELECT title FROM jobs WHERE id = ?').get(job_id);

    logAudit(req, 'interview-erstellt', 'Interview', result.lastInsertRowid, 
      `${candidate?.name} – ${job?.title}`, {
      interview_date, interview_time, interview_type: interview_type || 'vor Ort'
    });

    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Interview erstellt'
    });
  } catch (error) {
    console.error('Error creating interview:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Interviews' });
  }
});

/**
 * @swagger
 * /interviews/{id}:
 *   put:
 *     summary: Interview aktualisieren
 *     tags: [Interviews]
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const {
      interview_date, interview_time, duration_minutes,
      interview_type, location, meeting_link, participants, notes, status
    } = req.body;

    const existing = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Interview nicht gefunden' });
    }

    db.prepare(`
      UPDATE interviews SET
        interview_date = COALESCE(?, interview_date),
        interview_time = COALESCE(?, interview_time),
        duration_minutes = COALESCE(?, duration_minutes),
        interview_type = COALESCE(?, interview_type),
        location = ?,
        meeting_link = ?,
        participants = ?,
        notes = ?,
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      interview_date || null, interview_time || null, duration_minutes || null,
      interview_type || null, location ?? existing.location, meeting_link ?? existing.meeting_link,
      participants ?? existing.participants, notes ?? existing.notes,
      status || null, id
    );

    logAudit(req, 'interview-aktualisiert', 'Interview', id, null, { status });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating interview:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Interviews' });
  }
});

/**
 * @swagger
 * /interviews/{id}:
 *   delete:
 *     summary: Interview löschen
 *     tags: [Interviews]
 */
router.delete('/:id', (req, res) => {
  try {
    const interview = db.prepare('SELECT * FROM interviews WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM interviews WHERE id = ?').run(req.params.id);
    logAudit(req, 'interview-gelöscht', 'Interview', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Löschen des Interviews' });
  }
});

module.exports = router;
