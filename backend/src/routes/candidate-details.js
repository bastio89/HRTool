const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `photo_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`)
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Nur Bilddateien erlaubt'));
}});

// ============================================
// WORK HISTORY (#1)
// ============================================

// GET /candidate-details/:candidateId/work-history
router.get('/:candidateId/work-history', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM candidate_work_history WHERE candidate_id = ? ORDER BY is_current DESC, from_date DESC').all(req.params.candidateId);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /candidate-details/:candidateId/work-history
router.post('/:candidateId/work-history', (req, res) => {
  try {
    const { employer, position, from_date, to_date, is_current, description, location } = req.body;
    if (!employer || !position) return res.status(400).json({ error: 'Arbeitgeber und Position sind erforderlich' });
    const result = db.prepare(`INSERT INTO candidate_work_history (candidate_id, employer, position, from_date, to_date, is_current, description, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      req.params.candidateId, employer, position, from_date || null, to_date || null, is_current ? 1 : 0, description || null, location || null
    );
    const entry = db.prepare('SELECT * FROM candidate_work_history WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /candidate-details/work-history/:id
router.put('/work-history/:id', (req, res) => {
  try {
    const { employer, position, from_date, to_date, is_current, description, location } = req.body;
    db.prepare(`UPDATE candidate_work_history SET employer=?, position=?, from_date=?, to_date=?, is_current=?, description=?, location=? WHERE id=?`).run(
      employer, position, from_date || null, to_date || null, is_current ? 1 : 0, description || null, location || null, req.params.id
    );
    const entry = db.prepare('SELECT * FROM candidate_work_history WHERE id = ?').get(req.params.id);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /candidate-details/work-history/:id
router.delete('/work-history/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM candidate_work_history WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert work history (for CV parser) — replaces all existing entries
router.post('/:candidateId/work-history/bulk', (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries muss ein Array sein' });
    const del = db.prepare('DELETE FROM candidate_work_history WHERE candidate_id = ?');
    const insert = db.prepare(`INSERT INTO candidate_work_history (candidate_id, employer, position, from_date, to_date, is_current, description, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const replaceAll = db.transaction((items) => {
      del.run(req.params.candidateId);
      for (const e of items) {
        insert.run(req.params.candidateId, e.employer, e.position, e.from_date || null, e.to_date || null, e.is_current ? 1 : 0, e.description || null, e.location || null);
      }
    });
    replaceAll(entries);
    const rows = db.prepare('SELECT * FROM candidate_work_history WHERE candidate_id = ? ORDER BY is_current DESC, from_date DESC').all(req.params.candidateId);
    res.status(201).json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// EDUCATION (#2)
// ============================================

// GET /candidate-details/:candidateId/education
router.get('/:candidateId/education', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM candidate_education WHERE candidate_id = ? ORDER BY from_date DESC').all(req.params.candidateId);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /candidate-details/:candidateId/education
router.post('/:candidateId/education', (req, res) => {
  try {
    const { institution, degree, field_of_study, from_date, to_date, description } = req.body;
    if (!institution) return res.status(400).json({ error: 'Institution ist erforderlich' });
    const result = db.prepare(`INSERT INTO candidate_education (candidate_id, institution, degree, field_of_study, from_date, to_date, description) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      req.params.candidateId, institution, degree || null, field_of_study || null, from_date || null, to_date || null, description || null
    );
    const entry = db.prepare('SELECT * FROM candidate_education WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /candidate-details/education/:id
router.put('/education/:id', (req, res) => {
  try {
    const { institution, degree, field_of_study, from_date, to_date, description } = req.body;
    db.prepare(`UPDATE candidate_education SET institution=?, degree=?, field_of_study=?, from_date=?, to_date=?, description=? WHERE id=?`).run(
      institution, degree || null, field_of_study || null, from_date || null, to_date || null, description || null, req.params.id
    );
    const entry = db.prepare('SELECT * FROM candidate_education WHERE id = ?').get(req.params.id);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /candidate-details/education/:id
router.delete('/education/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM candidate_education WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert education (for CV parser) — replaces all existing entries
router.post('/:candidateId/education/bulk', (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries muss ein Array sein' });
    const del = db.prepare('DELETE FROM candidate_education WHERE candidate_id = ?');
    const insert = db.prepare(`INSERT INTO candidate_education (candidate_id, institution, degree, field_of_study, from_date, to_date, description) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const replaceAll = db.transaction((items) => {
      del.run(req.params.candidateId);
      for (const e of items) {
        insert.run(req.params.candidateId, e.institution, e.degree || null, e.field_of_study || null, e.from_date || null, e.to_date || null, e.description || null);
      }
    });
    replaceAll(entries);
    const rows = db.prepare('SELECT * FROM candidate_education WHERE candidate_id = ? ORDER BY from_date DESC').all(req.params.candidateId);
    res.status(201).json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PHOTO (#8)
// ============================================

// POST /candidate-details/:id/photo
router.post('/:id/photo', photoUpload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Foto hochgeladen' });
    // Delete old photo if exists
    const candidate = db.prepare('SELECT photo_filename FROM candidates WHERE id = ?').get(req.params.id);
    if (candidate?.photo_filename) {
      const oldPath = path.join(uploadsDir, candidate.photo_filename);
      try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
    }
    db.prepare('UPDATE candidates SET photo_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.file.filename, req.params.id);
    res.json({ success: true, filename: req.file.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /candidate-details/:id/photo
router.delete('/:id/photo', (req, res) => {
  try {
    const candidate = db.prepare('SELECT photo_filename FROM candidates WHERE id = ?').get(req.params.id);
    if (candidate?.photo_filename) {
      const filePath = path.join(uploadsDir, candidate.photo_filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    }
    db.prepare('UPDATE candidates SET photo_filename = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /candidate-details/:id/photo (serve photo)
router.get('/:id/photo', (req, res) => {
  try {
    const candidate = db.prepare('SELECT photo_filename FROM candidates WHERE id = ?').get(req.params.id);
    if (!candidate?.photo_filename) return res.status(404).json({ error: 'Kein Foto vorhanden' });
    const filePath = path.join(uploadsDir, candidate.photo_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CUSTOM FIELDS (#12)
// ============================================

// GET definitions
router.get('/custom-fields/definitions', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM custom_field_definitions ORDER BY sort_order, id').all();
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST definition
router.post('/custom-fields/definitions', (req, res) => {
  try {
    const { name, field_type, options, is_required, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
    const result = db.prepare(`INSERT INTO custom_field_definitions (name, field_type, options, is_required, sort_order) VALUES (?, ?, ?, ?, ?)`).run(
      name, field_type || 'text', options ? JSON.stringify(options) : null, is_required ? 1 : 0, sort_order || 0
    );
    const field = db.prepare('SELECT * FROM custom_field_definitions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(field);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT definition
router.put('/custom-fields/definitions/:id', (req, res) => {
  try {
    const { name, field_type, options, is_required, sort_order } = req.body;
    db.prepare(`UPDATE custom_field_definitions SET name=?, field_type=?, options=?, is_required=?, sort_order=? WHERE id=?`).run(
      name, field_type || 'text', options ? JSON.stringify(options) : null, is_required ? 1 : 0, sort_order || 0, req.params.id
    );
    const field = db.prepare('SELECT * FROM custom_field_definitions WHERE id = ?').get(req.params.id);
    res.json(field);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE definition
router.delete('/custom-fields/definitions/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM candidate_custom_values WHERE field_id = ?').run(req.params.id);
    db.prepare('DELETE FROM custom_field_definitions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET values for a candidate
router.get('/:candidateId/custom-fields', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT d.id as field_id, d.name, d.field_type, d.options, d.is_required, d.sort_order, v.value
      FROM custom_field_definitions d
      LEFT JOIN candidate_custom_values v ON v.field_id = d.id AND v.candidate_id = ?
      ORDER BY d.sort_order, d.id
    `).all(req.params.candidateId);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT values for a candidate (bulk upsert)
router.put('/:candidateId/custom-fields', (req, res) => {
  try {
    const { values } = req.body; // [{ field_id, value }]
    if (!Array.isArray(values)) return res.status(400).json({ error: 'values muss ein Array sein' });
    const upsert = db.prepare(`INSERT INTO candidate_custom_values (candidate_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(candidate_id, field_id) DO UPDATE SET value = excluded.value`);
    const upsertMany = db.transaction((items) => {
      for (const v of items) {
        upsert.run(req.params.candidateId, v.field_id, v.value || null);
      }
    });
    upsertMany(values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CANDIDATE MERGE (#10)
// ============================================

router.post('/merge', (req, res) => {
  try {
    const { keepId, mergeId } = req.body;
    if (!keepId || !mergeId) return res.status(400).json({ error: 'keepId und mergeId sind erforderlich' });
    
    const keep = db.prepare('SELECT * FROM candidates WHERE id = ?').get(keepId);
    const merge = db.prepare('SELECT * FROM candidates WHERE id = ?').get(mergeId);
    if (!keep || !merge) return res.status(404).json({ error: 'Kandidat nicht gefunden' });

    const mergeTx = db.transaction(() => {
      // Fill empty fields in keep with merge data
      const textFields = ['email', 'phone', 'location', 'experience', 'skills', 'education',
        'desired_salary', 'availability', 'languages', 'certificates', 'drivers_license',
        'mobility', 'notes', 'source', 'linkedin_url', 'xing_url', 'github_url', 'portfolio_url',
        'nationality', 'work_permit', 'work_permit_until', 'notice_period', 'available_from',
        'current_employer', 'current_position', 'referrer_name', 'referrer_email'];
      
      const updates = [];
      const params = [];
      for (const f of textFields) {
        if (!keep[f] && merge[f]) {
          updates.push(`${f} = ?`);
          params.push(merge[f]);
        }
      }
      // Merge tags
      const keepTags = keep.tags ? keep.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const mergeTags = merge.tags ? merge.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const allTags = [...new Set([...keepTags, ...mergeTags])];
      updates.push('tags = ?');
      params.push(allTags.join(', '));
      
      if (updates.length > 0) {
        params.push(keepId);
        db.prepare(`UPDATE candidates SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params);
      }

      // Move related data to keep candidate
      db.prepare('UPDATE activities SET candidate_id = ? WHERE candidate_id = ?').run(keepId, mergeId);
      db.prepare('UPDATE candidate_files SET candidate_id = ? WHERE candidate_id = ?').run(keepId, mergeId);
      db.prepare('UPDATE candidate_ratings SET candidate_id = ? WHERE candidate_id = ?').run(keepId, mergeId);
      db.prepare('UPDATE candidate_work_history SET candidate_id = ? WHERE candidate_id = ?').run(keepId, mergeId);
      db.prepare('UPDATE candidate_education SET candidate_id = ? WHERE candidate_id = ?').run(keepId, mergeId);
      db.prepare('UPDATE candidate_custom_values SET candidate_id = ? WHERE candidate_id = ? AND field_id NOT IN (SELECT field_id FROM candidate_custom_values WHERE candidate_id = ?)').run(keepId, mergeId, keepId);
      db.prepare('UPDATE comments SET entity_id = ? WHERE entity_type = ? AND entity_id = ?').run(keepId, 'candidate', mergeId);
      
      // Handle pipeline entries (skip duplicates for same job)
      const existingJobs = db.prepare('SELECT job_id FROM pipeline_entries WHERE candidate_id = ?').all(keepId).map(r => r.job_id);
      const mergeEntries = db.prepare('SELECT * FROM pipeline_entries WHERE candidate_id = ?').all(mergeId);
      for (const entry of mergeEntries) {
        if (!existingJobs.includes(entry.job_id)) {
          db.prepare('UPDATE pipeline_entries SET candidate_id = ? WHERE id = ?').run(keepId, entry.id);
        }
      }

      // Delete merged candidate
      db.prepare('DELETE FROM candidates WHERE id = ?').run(mergeId);
    });

    mergeTx();
    const result = db.prepare('SELECT * FROM candidates WHERE id = ?').get(keepId);
    logAudit(req, 'zusammengeführt', 'Candidate', keepId, `${keep.name} + ${merge.name}`);
    res.json(result);
  } catch (err) {
    console.error('Merge error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
