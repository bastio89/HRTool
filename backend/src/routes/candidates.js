const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { logAudit } = require('./audit');

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
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    const total = db.prepare('SELECT COUNT(*) as count FROM candidates').get();
    const recentWeek = db.prepare(
      `SELECT COUNT(*) as count FROM candidates WHERE created_at >= datetime('now', '-${days} days')`
    ).get();
    const prevWeek = db.prepare(
      `SELECT COUNT(*) as count FROM candidates WHERE created_at >= datetime('now', '-${days * 2} days') AND created_at < datetime('now', '-${days} days')`
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
      `SELECT COUNT(*) as count FROM matching_results WHERE created_at >= datetime('now', '-${days} days')`
    ).get();
    const matchingsPrevWeek = db.prepare(
      `SELECT COUNT(*) as count FROM matching_results WHERE created_at >= datetime('now', '-${days * 2} days') AND created_at < datetime('now', '-${days} days')`
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
      periodDays: days,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

/**
 * @swagger
 * /candidates/stats/time-to-hire:
 *   get:
 *     summary: Time-to-Hire Metriken (Durchschnitt pro Stage, Bottleneck-Erkennung)
 *     tags: [Candidates]
 *     responses:
 *       200:
 *         description: Time-to-Hire Statistiken
 */
router.get('/stats/time-to-hire', (req, res) => {
  try {
    // 1) Overall Time-to-Hire: Days from pipeline entry to Hired
    const hiredEntries = db.prepare(`
      SELECT pe.id, pe.created_at as entered_at, pe.updated_at as hired_at,
        CAST(julianday(pe.updated_at) - julianday(pe.created_at) AS REAL) as days_to_hire,
        c.name as candidate_name, j.title as job_title
      FROM pipeline_entries pe
      JOIN candidates c ON c.id = pe.candidate_id
      JOIN jobs j ON j.id = pe.job_id
      WHERE pe.stage = 'Hired'
      ORDER BY pe.updated_at DESC
    `).all();

    const totalHired = hiredEntries.length;
    const avgDaysToHire = totalHired > 0
      ? Math.round(hiredEntries.reduce((sum, e) => sum + e.days_to_hire, 0) / totalHired * 10) / 10
      : null;
    const minDays = totalHired > 0 ? Math.round(Math.min(...hiredEntries.map(e => e.days_to_hire)) * 10) / 10 : null;
    const maxDays = totalHired > 0 ? Math.round(Math.max(...hiredEntries.map(e => e.days_to_hire)) * 10) / 10 : null;
    const medianDays = totalHired > 0 ? (() => {
      const sorted = hiredEntries.map(e => e.days_to_hire).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return Math.round((sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
    })() : null;

    // 2) Average time per stage transition (from pipeline_notes)
    const stageTransitions = db.prepare(`
      SELECT pn.old_stage, pn.new_stage,
        pe.id as entry_id, pe.created_at as entry_created,
        pn.created_at as transition_at
      FROM pipeline_notes pn
      JOIN pipeline_entries pe ON pe.id = pn.pipeline_entry_id
      WHERE pn.old_stage IS NOT NULL AND pn.new_stage IS NOT NULL
        AND pn.old_stage != pn.new_stage
      ORDER BY pe.id, pn.created_at
    `).all();

    // Group transitions by entry to compute stage durations
    const entryMap = new Map();
    for (const t of stageTransitions) {
      if (!entryMap.has(t.entry_id)) entryMap.set(t.entry_id, []);
      entryMap.get(t.entry_id).push(t);
    }

    const stageDurations = {};
    const stages = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot'];
    for (const stage of stages) stageDurations[stage] = [];

    for (const [entryId, transitions] of entryMap) {
      // For each transition, compute time spent in old_stage
      for (let i = 0; i < transitions.length; i++) {
        const t = transitions[i];
        // Previous timestamp: either previous transition or entry creation
        const prevTime = i === 0 ? t.entry_created : transitions[i - 1].transition_at;
        const days = (new Date(t.transition_at) - new Date(prevTime)) / (1000 * 60 * 60 * 24);
        if (days >= 0 && stages.includes(t.old_stage)) {
          stageDurations[t.old_stage].push(days);
        }
      }
    }

    const stageMetrics = stages.map(stage => {
      const durations = stageDurations[stage];
      const count = durations.length;
      const avg = count > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / count * 10) / 10 : null;
      return { stage, avgDays: avg, count };
    });

    // 3) Bottleneck: stage with highest average days
    const bottleneck = stageMetrics
      .filter(s => s.avgDays !== null)
      .sort((a, b) => b.avgDays - a.avgDays)[0] || null;

    // 4) Time-to-Hire per job (top 10)
    const jobGroups = {};
    for (const e of hiredEntries) {
      if (!jobGroups[e.job_title]) jobGroups[e.job_title] = [];
      jobGroups[e.job_title].push(e.days_to_hire);
    }
    const perJob = Object.entries(jobGroups).map(([title, days]) => ({
      jobTitle: title,
      hired: days.length,
      avgDays: Math.round(days.reduce((s, d) => s + d, 0) / days.length * 10) / 10,
    })).sort((a, b) => b.hired - a.hired).slice(0, 10);

    // 5) Trend: Avg time-to-hire for last 3 months
    const monthlyTrend = [];
    for (let i = 2; i >= 0; i--) {
      const monthEntries = hiredEntries.filter(e => {
        const d = new Date(e.hired_at);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        return d >= monthStart && d <= monthEnd;
      });
      const avg = monthEntries.length > 0
        ? Math.round(monthEntries.reduce((s, e) => s + e.days_to_hire, 0) / monthEntries.length * 10) / 10
        : null;
      const now = new Date();
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyTrend.push({
        month: monthDate.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }),
        avgDays: avg,
        hired: monthEntries.length,
      });
    }

    // 6) Currently in pipeline (not yet hired/rejected)
    const inPipeline = db.prepare(`
      SELECT COUNT(*) as count,
        ROUND(AVG(julianday('now') - julianday(pe.created_at)), 1) as avg_days_waiting
      FROM pipeline_entries pe
      WHERE pe.stage NOT IN ('Hired', 'Abgesagt')
    `).get();

    res.json({
      overview: {
        totalHired,
        avgDaysToHire,
        medianDays,
        minDays,
        maxDays,
      },
      stageMetrics,
      bottleneck: bottleneck ? { stage: bottleneck.stage, avgDays: bottleneck.avgDays } : null,
      perJob,
      monthlyTrend,
      inPipeline: {
        count: inPipeline.count,
        avgDaysWaiting: inPipeline.avg_days_waiting,
      },
    });
  } catch (error) {
    console.error('Error fetching time-to-hire stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Time-to-Hire Statistiken' });
  }
});

/**
 * @swagger
 * /candidates/stats/tags:
 *   get:
 *     summary: Alle verwendeten Tags mit Häufigkeit
 *     tags: [Candidates]
 *     responses:
 *       200: { description: Liste aller Tags }
 */
router.get('/stats/tags', (req, res) => {
  try {
    const rows = db.prepare("SELECT tags FROM candidates WHERE tags IS NOT NULL AND tags != ''").all();
    const tagCounts = {};
    for (const row of rows) {
      const tags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const sorted = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    res.json({ tags: sorted });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Tags' });
  }
});

/**
 * @swagger
 * /candidates/stats/sources:
 *   get:
 *     summary: Quellen-Analyse (Bewerber pro Quelle, Hired-Rate)
 *     tags: [Candidates]
 *     responses:
 *       200:
 *         description: Quellen-Statistiken
 */
router.get('/stats/sources', (req, res) => {
  try {
    // Bewerber pro Quelle
    const sourceCounts = db.prepare(`
      SELECT COALESCE(source, 'Unbekannt') as source, COUNT(*) as count
      FROM candidates
      GROUP BY COALESCE(source, 'Unbekannt')
      ORDER BY count DESC
    `).all();

    const total = sourceCounts.reduce((sum, s) => sum + s.count, 0);

    // Hired-Rate pro Quelle (Kandidaten die in Pipeline auf "Hired" stehen)
    const hiredBySource = db.prepare(`
      SELECT COALESCE(c.source, 'Unbekannt') as source, COUNT(DISTINCT c.id) as hired
      FROM candidates c
      JOIN pipeline_entries pe ON pe.candidate_id = c.id
      WHERE pe.stage = 'Hired'
      GROUP BY COALESCE(c.source, 'Unbekannt')
    `).all();
    const hiredMap = new Map(hiredBySource.map(h => [h.source, h.hired]));

    // In-Prozess pro Quelle
    const inProcessBySource = db.prepare(`
      SELECT COALESCE(c.source, 'Unbekannt') as source, COUNT(DISTINCT c.id) as in_process
      FROM candidates c
      JOIN pipeline_entries pe ON pe.candidate_id = c.id
      WHERE pe.stage NOT IN ('Hired', 'Abgesagt')
      GROUP BY COALESCE(c.source, 'Unbekannt')
    `).all();
    const processMap = new Map(inProcessBySource.map(p => [p.source, p.in_process]));

    const sources = sourceCounts.map(s => ({
      source: s.source,
      count: s.count,
      percentage: total > 0 ? Math.round((s.count / total) * 100) : 0,
      hired: hiredMap.get(s.source) || 0,
      hiredRate: s.count > 0 ? Math.round(((hiredMap.get(s.source) || 0) / s.count) * 100) : 0,
      inProcess: processMap.get(s.source) || 0,
    }));

    res.json({ sources, total });
  } catch (error) {
    console.error('Error fetching source stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Quellen-Statistiken' });
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
    
    // Full-text search (including tags)
    if (search) {
      conditions.push('(name LIKE ? OR skills LIKE ? OR location LIKE ? OR experience LIKE ? OR education LIKE ? OR tags LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Tags AND-logic: each tag must be present
    if (req.query.tags) {
      const tagList = req.query.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tagList) {
        conditions.push('tags LIKE ?');
        params.push(`%${tag}%`);
      }
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
 * /candidates/{id}/history:
 *   get:
 *     summary: Pipeline-Historie eines Bewerbers (alle Jobs/Stages)
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Pipeline-Verlauf mit Jobs und Stage-Changes }
 */
router.get('/:id/history', (req, res) => {
  try {
    // Get all pipeline entries for this candidate with job info
    const entries = db.prepare(`
      SELECT pe.id, pe.job_id, pe.stage, pe.notes, pe.created_at, pe.updated_at,
             j.title as job_title, j.status as job_status, j.location as job_location
      FROM pipeline_entries pe
      JOIN jobs j ON j.id = pe.job_id
      WHERE pe.candidate_id = ?
      ORDER BY pe.updated_at DESC
    `).all(req.params.id);

    // Get stage change notes for all entries
    const entryIds = entries.map(e => e.id);
    let stageChanges = [];
    if (entryIds.length > 0) {
      const placeholders = entryIds.map(() => '?').join(',');
      stageChanges = db.prepare(`
        SELECT pn.*, pe.job_id
        FROM pipeline_notes pn
        JOIN pipeline_entries pe ON pe.id = pn.pipeline_entry_id
        WHERE pn.pipeline_entry_id IN (${placeholders})
        AND pn.old_stage IS NOT NULL
        ORDER BY pn.created_at DESC
      `).all(...entryIds);
    }

    // Get interviews for this candidate
    const interviews = db.prepare(`
      SELECT i.*, j.title as job_title
      FROM interviews i
      JOIN jobs j ON j.id = i.job_id
      WHERE i.candidate_id = ?
      ORDER BY i.interview_date DESC
    `).all(req.params.id);

    res.json({ entries, stageChanges, interviews });
  } catch (err) {
    console.error('Error fetching candidate history:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Historie' });
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
    logAudit(req, 'erstellt', 'Candidate', candidate.id, candidate.name);
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
    logAudit(req, 'aktualisiert', 'Candidate', candidate.id, candidate.name);
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

    logAudit(req, 'gelöscht', 'Candidate', existing.id, existing.name);
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
    logAudit(req, 'batch-gelöscht', 'Candidate', null, null, { ids, count: result.changes });
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
    logAudit(req, 'batch-status', 'Candidate', null, null, { ids, status, count: result.changes });
    res.json({ updated: result.changes });
  } catch (error) {
    console.error('Error batch status update:', error);
    res.status(500).json({ error: 'Fehler bei Massen-Statusänderung' });
  }
});

/**
 * @swagger
 * /candidates/import:
 *   post:
 *     summary: Bewerber aus CSV importieren
 *     tags: [Candidates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               rows: { type: array, description: 'Array of candidate objects with mapped fields' }
 *               skipDuplicates: { type: boolean, default: true }
 *     responses:
 *       200: { description: Import-Ergebnis mit Statistiken }
 */
router.post('/import', (req, res) => {
  try {
    const { rows, skipDuplicates = true } = req.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Keine Daten zum Importieren' });
    }

    const VALID_FIELDS = [
      'name', 'email', 'phone', 'location', 'experience', 'skills',
      'education', 'desired_salary', 'availability', 'languages',
      'certificates', 'drivers_license', 'mobility', 'notes', 'status', 'tags', 'source'
    ];

    let imported = 0;
    let skipped = 0;
    let errors = [];
    const duplicates = [];

    const insertStmt = db.prepare(`
      INSERT INTO candidates (name, email, phone, location, experience, skills,
        education, desired_salary, availability, languages, certificates,
        drivers_license, mobility, notes, status, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const checkDupByEmail = db.prepare("SELECT id, name FROM candidates WHERE email = ? AND email IS NOT NULL AND email != ''");
    const checkDupByName = db.prepare('SELECT id, name FROM candidates WHERE LOWER(name) = LOWER(?)');

    const importMany = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 1;

        // Validate name
        if (!row.name || String(row.name).trim() === '') {
          errors.push({ row: rowNum, reason: 'Name fehlt' });
          continue;
        }

        // Check duplicates
        if (skipDuplicates) {
          let dup = null;
          if (row.email && String(row.email).trim()) {
            dup = checkDupByEmail.get(String(row.email).trim());
          }
          if (!dup && row.name) {
            dup = checkDupByName.get(String(row.name).trim());
          }
          if (dup) {
            duplicates.push({ row: rowNum, name: row.name, existingName: dup.name });
            skipped++;
            continue;
          }
        }

        try {
          insertStmt.run(
            String(row.name).trim(),
            row.email || null, row.phone || null, row.location || null,
            row.experience || null, row.skills || null, row.education || null,
            row.desired_salary || null, row.availability || null, row.languages || null,
            row.certificates || null, row.drivers_license || null, row.mobility || null,
            row.notes || null, row.status || 'Aktiv', row.tags || null, row.source || null
          );
          imported++;
        } catch (err) {
          errors.push({ row: rowNum, reason: err.message });
        }
      }
    });

    importMany();

    logAudit(req, 'csv-import', 'Candidate', null, null, {
      total: rows.length, imported, skipped, errors: errors.length
    });

    res.json({
      total: rows.length,
      imported,
      skipped,
      errors: errors.length,
      errorDetails: errors.slice(0, 20),
      duplicates: duplicates.slice(0, 20)
    });
  } catch (error) {
    console.error('Error importing candidates:', error);
    res.status(500).json({ error: 'Fehler beim CSV-Import' });
  }
});

module.exports = router;
