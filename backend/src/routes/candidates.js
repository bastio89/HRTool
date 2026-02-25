const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../database');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');

// Helper: Delete physical files for candidate IDs
function cleanupCandidateFiles(candidateIds) {
  const ids = Array.isArray(candidateIds) ? candidateIds : [candidateIds];
  const placeholders = ids.map(() => '?').join(',');
  const files = db.prepare(`SELECT filename FROM candidate_files WHERE candidate_id IN (${placeholders})`).all(...ids);
  for (const file of files) {
    const filePath = path.join(uploadsDir, file.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete file ${filePath}:`, err.message);
    }
  }
}

/**
 * @swagger
 * /candidates/stats/overview:
 *   get:
 *     summary: Dashboard-Statistiken
 *     tags: [Candidates]
 *     responses:
 *       200:
 *         description: Statistische Übersicht
 */
router.get('/stats/overview', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM candidates').get();
    const recentWeek = db.prepare(
      "SELECT COUNT(*) as count FROM candidates WHERE created_at >= datetime('now', '-7 days')"
    ).get();
    const prevWeek = db.prepare(
      "SELECT COUNT(*) as count FROM candidates WHERE created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')"
    ).get();
    const thisMonth = db.prepare(
      "SELECT COUNT(*) as count FROM candidates WHERE created_at >= datetime('now', 'start of month')"
    ).get();
    const lastMonth = db.prepare(
      "SELECT COUNT(*) as count FROM candidates WHERE created_at >= datetime('now', 'start of month', '-1 month') AND created_at < datetime('now', 'start of month')"
    ).get();
    const locations = db.prepare(
      'SELECT location, COUNT(*) as count FROM candidates WHERE location IS NOT NULL GROUP BY location ORDER BY count DESC LIMIT 5'
    ).all();

    // Matching stats
    const matchingsThisWeek = db.prepare(
      "SELECT COUNT(*) as count FROM matching_results WHERE created_at >= datetime('now', '-7 days')"
    ).get();
    const matchingsPrevWeek = db.prepare(
      "SELECT COUNT(*) as count FROM matching_results WHERE created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')"
    ).get();
    const matchingsTotal = db.prepare('SELECT COUNT(*) as count FROM matching_results').get();

    // Jobs stats
    const openJobs = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'Offen'").get();
    const closedThisMonth = db.prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE status = 'Besetzt' AND updated_at >= datetime('now', 'start of month')"
    ).get();

    res.json({
      totalCandidates: total.count,
      newThisWeek: recentWeek.count,
      newPrevWeek: prevWeek.count,
      newThisMonth: thisMonth.count,
      newLastMonth: lastMonth.count,
      topLocations: locations,
      matchingsTotal: matchingsTotal.count,
      matchingsThisWeek: matchingsThisWeek.count,
      matchingsPrevWeek: matchingsPrevWeek.count,
      openJobs: openJobs.count,
      closedThisMonth: closedThisMonth.count,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

/**
 * @swagger
 * /candidates:
 *   get:
 *     summary: Alle Bewerber (paginiert)
 *     tags: [Candidates]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Volltextsuche (Name, Skills, Standort, Erfahrung, Bildung)
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *         description: Seitennummer
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1 }
 *         description: Einträge pro Seite
 *       - in: query
 *         name: skills
 *         schema: { type: string }
 *         description: Komma-getrennte Skills (UND-Logik, alle müssen vorhanden sein)
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Komma-getrennte Status-Filter
 *       - in: query
 *         name: location
 *         schema: { type: string }
 *         description: Standort-Filter (Teiltext)
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [name, location, created_at, updated_at, availability] }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Paginierte Bewerberliste
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - properties:
 *                     data:
 *                       items: { $ref: '#/components/schemas/Candidate' }
 */
router.get('/', (req, res) => {
  try {
    const { search, skills, status, location, sort = 'created_at', order = 'desc', page, limit } = req.query;
    
    const conditions = [];
    const params = [];
    
    // Full-text search
    if (search) {
      conditions.push('(name LIKE ? OR skills LIKE ? OR location LIKE ? OR experience LIKE ? OR education LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Skills AND-logic: each skill must be present
    if (skills) {
      const skillList = skills.split(',').map(s => s.trim()).filter(Boolean);
      for (const skill of skillList) {
        conditions.push('skills LIKE ?');
        params.push(`%${skill}%`);
      }
    }
    
    // Status filter (comma-separated, OR-logic within)
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        const placeholders = statuses.map(() => '?').join(',');
        conditions.push(`(COALESCE(status, 'Aktiv') IN (${placeholders}))`);
        params.push(...statuses);
      }
    }
    
    // Location filter
    if (location) {
      conditions.push('location LIKE ?');
      params.push(`%${location}%`);
    }
    
    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    
    // Total count for pagination
    const total = db.prepare(`SELECT COUNT(*) as count FROM candidates${whereClause}`).get(...params).count;
    
    const allowedSorts = ['name', 'location', 'created_at', 'updated_at', 'availability'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    
    let query = `SELECT * FROM candidates${whereClause} ORDER BY ${sortCol} ${sortOrder}`;
    
    // Pagination (optional - if page/limit not provided, return all)
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (pageNum > 0 && limitNum > 0) {
      const offset = (pageNum - 1) * limitNum;
      query += ` LIMIT ? OFFSET ?`;
      params.push(limitNum, offset);
    }
    
    const candidates = db.prepare(query).all(...params);
    res.json({
      data: candidates,
      total,
      page: pageNum > 0 ? pageNum : 1,
      limit: limitNum > 0 ? limitNum : total,
      totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 1,
    });
  } catch (error) {
    console.error('Error fetching candidates:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Bewerber' });
  }
});

/**
 * @swagger
 * /candidates/{id}:
 *   get:
 *     summary: Einzelnen Bewerber laden
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Bewerber-Objekt, content: { application/json: { schema: { $ref: '#/components/schemas/Candidate' } } } }
 *       404: { description: Nicht gefunden }
 */
router.get('/:id', (req, res) => {
  try {
    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: 'Bewerber nicht gefunden' });
    }
    res.json(candidate);
  } catch (error) {
    console.error('Error fetching candidate:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Bewerbers' });
  }
});

/**
 * @swagger
 * /candidates/check-duplicate:
 *   post:
 *     summary: Duplikat-Prüfung (Name/E-Mail)
 *     tags: [Candidates]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               excludeId: { type: integer }
 *     responses:
 *       200: { description: Liste gefundener Duplikate }
 */
router.post('/check-duplicate', (req, res) => {
  try {
    const { name, email, excludeId } = req.body;
    const duplicates = [];

    if (name && name.trim()) {
      const byName = db.prepare(
        'SELECT id, name, email, location FROM candidates WHERE LOWER(name) = LOWER(?)' + (excludeId ? ' AND id != ?' : '')
      ).all(...(excludeId ? [name.trim(), excludeId] : [name.trim()]));
      duplicates.push(...byName.map(d => ({ ...d, matchType: 'name' })));
    }

    if (email && email.trim()) {
      const byEmail = db.prepare(
        'SELECT id, name, email, location FROM candidates WHERE LOWER(email) = LOWER(?)' + (excludeId ? ' AND id != ?' : '')
      ).all(...(excludeId ? [email.trim(), excludeId] : [email.trim()]));
      const existingIds = new Set(duplicates.map(d => d.id));
      duplicates.push(...byEmail.filter(d => !existingIds.has(d.id)).map(d => ({ ...d, matchType: 'email' })));
    }

    res.json({ duplicates });
  } catch (error) {
    console.error('Error checking duplicates:', error);
    res.status(500).json({ error: 'Fehler bei der Duplikatprüfung' });
  }
});

/**
 * @swagger
 * /candidates:
 *   post:
 *     summary: Bewerber anlegen
 *     tags: [Candidates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Candidate' }
 *     responses:
 *       201: { description: Erstellter Bewerber }
 *       400: { description: Validierungsfehler }
 */
router.post('/', (req, res) => {
  try {
    const {
      name, email, phone, location, experience, skills,
      education, desired_salary, availability, languages,
      certificates, drivers_license, mobility, notes, status, tags, source
    } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    const result = db.prepare(`
      INSERT INTO candidates (name, email, phone, location, experience, skills,
        education, desired_salary, availability, languages, certificates,
        drivers_license, mobility, notes, status, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, email || null, phone || null, location || null,
      experience || null, skills || null, education || null,
      desired_salary || null, availability || null, languages || null,
      certificates || null, drivers_license || null, mobility || null,
      notes || null, status || 'Aktiv', tags || null, source || null
    );

    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(candidate);
  } catch (error) {
    console.error('Error creating candidate:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Bewerbers' });
  }
});

/**
 * @swagger
 * /candidates/{id}:
 *   put:
 *     summary: Bewerber aktualisieren
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Candidate' }
 *     responses:
 *       200: { description: Aktualisierter Bewerber }
 *       404: { description: Nicht gefunden }
 */
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Bewerber nicht gefunden' });
    }

    const {
      name, email, phone, location, experience, skills,
      education, desired_salary, availability, languages,
      certificates, drivers_license, mobility, notes, status, tags, source
    } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    db.prepare(`
      UPDATE candidates SET
        name = ?, email = ?, phone = ?, location = ?, experience = ?,
        skills = ?, education = ?, desired_salary = ?, availability = ?,
        languages = ?, certificates = ?, drivers_license = ?, mobility = ?,
        notes = ?, status = ?, tags = ?, source = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name, email || null, phone || null, location || null,
      experience || null, skills || null, education || null,
      desired_salary || null, availability || null, languages || null,
      certificates || null, drivers_license || null, mobility || null,
      notes || null, status || 'Aktiv', tags || null, source || null, req.params.id
    );

    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    res.json(candidate);
  } catch (error) {
    console.error('Error updating candidate:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Bewerbers' });
  }
});

/**
 * @swagger
 * /candidates/{id}:
 *   delete:
 *     summary: Bewerber löschen
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Erfolgreich gelöscht }
 *       404: { description: Nicht gefunden }
 */
router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Bewerber nicht gefunden' });
    }

    // Clean up physical files before DB deletion (CASCADE deletes candidate_files rows)
    cleanupCandidateFiles(parseInt(req.params.id));

    db.prepare('DELETE FROM candidates WHERE id = ?').run(req.params.id);
    res.json({ message: 'Bewerber erfolgreich gelöscht' });
  } catch (error) {
    console.error('Error deleting candidate:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Bewerbers' });
  }
});

/**
 * @swagger
 * /candidates/batch/delete:
 *   post:
 *     summary: Mehrere Bewerber löschen
 *     tags: [Candidates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200: { description: Anzahl gelöschter Bewerber }
 */
router.post('/batch/delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Keine IDs angegeben' });
    }

    // Clean up physical files before DB deletion
    cleanupCandidateFiles(ids);

    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`DELETE FROM candidates WHERE id IN (${placeholders})`).run(...ids);
    res.json({ deleted: result.changes });
  } catch (error) {
    console.error('Error batch deleting:', error);
    res.status(500).json({ error: 'Fehler beim Massen-Löschen' });
  }
});

/**
 * @swagger
 * /candidates/batch/status:
 *   post:
 *     summary: Status mehrerer Bewerber ändern
 *     tags: [Candidates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *               status:
 *                 type: string
 *                 enum: [Aktiv, Passiv, In Prozess, Blacklist]
 *     responses:
 *       200: { description: Anzahl aktualisierter Bewerber }
 */
router.post('/batch/status', (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Keine IDs angegeben' });
    }
    const validStatuses = ['Aktiv', 'Passiv', 'In Prozess', 'Blacklist'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Ungültiger Status' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`UPDATE candidates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(status, ...ids);
    res.json({ updated: result.changes });
  } catch (error) {
    console.error('Error batch status update:', error);
    res.status(500).json({ error: 'Fehler bei Massen-Statusänderung' });
  }
});

module.exports = router;
