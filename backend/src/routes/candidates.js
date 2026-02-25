const express = require('express');
const db = require('../database');

const router = express.Router();

// GET candidate stats (must be before /:id route)
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

// GET all candidates
router.get('/', (req, res) => {
  try {
    const { search, sort = 'created_at', order = 'desc' } = req.query;
    
    let query = 'SELECT * FROM candidates';
    const params = [];
    
    if (search) {
      query += ` WHERE name LIKE ? OR skills LIKE ? OR location LIKE ? OR experience LIKE ? OR education LIKE ?`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    const allowedSorts = ['name', 'location', 'created_at', 'updated_at', 'availability'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortCol} ${sortOrder}`;
    
    const candidates = db.prepare(query).all(...params);
    res.json({ data: candidates, total: candidates.length });
  } catch (error) {
    console.error('Error fetching candidates:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Bewerber' });
  }
});

// GET single candidate
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

// POST check for duplicates
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

// POST create candidate
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

// PUT update candidate
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

// DELETE candidate
router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Bewerber nicht gefunden' });
    }

    db.prepare('DELETE FROM candidates WHERE id = ?').run(req.params.id);
    res.json({ message: 'Bewerber erfolgreich gelöscht' });
  } catch (error) {
    console.error('Error deleting candidate:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Bewerbers' });
  }
});

module.exports = router;
