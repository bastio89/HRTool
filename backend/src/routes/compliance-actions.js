const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

// ═══════════════════════════════════════
// Compliance Actions — CRUD
// ═══════════════════════════════════════

/**
 * @swagger
 * /compliance-actions:
 *   get:
 *     summary: Alle Compliance-Aktionen laden
 *     tags: [Compliance]
 *     parameters:
 *       - in: query
 *         name: ref_type
 *         schema: { type: string, enum: [compliance, risk] }
 *       - in: query
 *         name: ref_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, in_progress, done] }
 *     responses:
 *       200: { description: Liste der Aktionen }
 */
router.get('/', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    let where = [];
    let params = [];

    if (req.query.ref_type) {
      where.push('ref_type = ?');
      params.push(req.query.ref_type);
    }
    if (req.query.ref_id) {
      where.push('ref_id = ?');
      params.push(req.query.ref_id);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const actions = db.prepare(`SELECT * FROM compliance_actions ${whereClause} ORDER BY 
      CASE status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 END,
      CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
      created_at DESC
    `).all(...params);

    res.json({ data: actions });
  } catch (error) {
    console.error('Error fetching compliance actions:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Aktionen' });
  }
});

/**
 * @swagger
 * /compliance-actions:
 *   post:
 *     summary: Neue Compliance-Aktion erstellen
 *     tags: [Compliance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               ref_type: { type: string }
 *               ref_id: { type: string }
 *               title: { type: string }
 *               description: { type: string }
 *               priority: { type: string }
 *               assigned_to: { type: string }
 *               due_date: { type: string }
 *     responses:
 *       201: { description: Aktion erstellt }
 */
router.post('/', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const { ref_type, ref_id, title, description, priority, assigned_to, due_date } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Titel ist erforderlich' });
    }

    const result = db.prepare(`
      INSERT INTO compliance_actions (ref_type, ref_id, title, description, priority, assigned_to, due_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ref_type || 'general',
      ref_id || null,
      title.trim(),
      description || null,
      priority || 'medium',
      assigned_to || null,
      due_date || null,
      req.user?.display_name || req.user?.username || 'System'
    );

    logAudit(req, 'compliance-action-created', 'ComplianceAction', result.lastInsertRowid, title.trim(), {
      ref_type, ref_id, priority
    });

    const action = db.prepare('SELECT * FROM compliance_actions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(action);
  } catch (error) {
    console.error('Error creating compliance action:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Aktion' });
  }
});

/**
 * @swagger
 * /compliance-actions/{id}:
 *   put:
 *     summary: Compliance-Aktion aktualisieren
 *     tags: [Compliance]
 */
router.put('/:id', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const existing = db.prepare('SELECT * FROM compliance_actions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Aktion nicht gefunden' });

    const { title, description, status, priority, assigned_to, due_date, notes } = req.body;

    const newStatus = status || existing.status;
    const completedAt = newStatus === 'done' && existing.status !== 'done' ? new Date().toISOString() : existing.completed_at;
    const completedBy = newStatus === 'done' && existing.status !== 'done' 
      ? (req.user?.display_name || req.user?.username || 'System') 
      : existing.completed_by;

    db.prepare(`
      UPDATE compliance_actions 
      SET title = ?, description = ?, status = ?, priority = ?, assigned_to = ?, due_date = ?, notes = ?,
          completed_at = ?, completed_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      (title || existing.title).trim(),
      description !== undefined ? description : existing.description,
      newStatus,
      priority || existing.priority,
      assigned_to !== undefined ? assigned_to : existing.assigned_to,
      due_date !== undefined ? due_date : existing.due_date,
      notes !== undefined ? notes : existing.notes,
      completedAt,
      completedBy,
      req.params.id
    );

    logAudit(req, 'compliance-action-updated', 'ComplianceAction', req.params.id, existing.title, {
      oldStatus: existing.status, newStatus, priority
    });

    const updated = db.prepare('SELECT * FROM compliance_actions WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating compliance action:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Aktion' });
  }
});

/**
 * @swagger
 * /compliance-actions/{id}:
 *   delete:
 *     summary: Compliance-Aktion löschen
 *     tags: [Compliance]
 */
router.delete('/:id', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const existing = db.prepare('SELECT * FROM compliance_actions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Aktion nicht gefunden' });

    db.prepare('DELETE FROM compliance_actions WHERE id = ?').run(req.params.id);

    logAudit(req, 'compliance-action-deleted', 'ComplianceAction', req.params.id, existing.title);

    res.json({ message: 'Aktion gelöscht' });
  } catch (error) {
    console.error('Error deleting compliance action:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Aktion' });
  }
});

// ═══════════════════════════════════════
// Risk Overrides — manuelle Statusüberschreibungen
// ═══════════════════════════════════════

/**
 * @swagger
 * /compliance-actions/risk-overrides:
 *   get:
 *     summary: Alle manuellen Risiko-Überschreibungen laden
 *     tags: [Compliance]
 */
router.get('/risk-overrides', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }
    const overrides = db.prepare('SELECT * FROM risk_overrides').all();
    res.json({ data: overrides });
  } catch (error) {
    console.error('Error fetching risk overrides:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Überschreibungen' });
  }
});

/**
 * @swagger
 * /compliance-actions/risk-overrides/{riskId}:
 *   put:
 *     summary: Risiko-Status manuell überschreiben
 *     tags: [Compliance]
 */
router.put('/risk-overrides/:riskId', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const { manual_status, notes } = req.body;
    const validStatuses = ['active', 'partially-mitigated', 'mitigated', null];
    if (manual_status && !validStatuses.includes(manual_status)) {
      return res.status(400).json({ error: 'Ungültiger Status' });
    }

    const existing = db.prepare('SELECT * FROM risk_overrides WHERE risk_id = ?').get(req.params.riskId);
    
    if (manual_status === null || manual_status === '') {
      // Remove override — revert to auto
      if (existing) {
        db.prepare('DELETE FROM risk_overrides WHERE risk_id = ?').run(req.params.riskId);
      }
      logAudit(req, 'risk-override-removed', 'RiskOverride', null, req.params.riskId, { notes });
      return res.json({ message: 'Überschreibung entfernt — automatischer Status wiederhergestellt' });
    }

    if (existing) {
      db.prepare('UPDATE risk_overrides SET manual_status = ?, notes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE risk_id = ?')
        .run(manual_status, notes || null, req.user?.display_name || req.user?.username || 'System', req.params.riskId);
    } else {
      db.prepare('INSERT INTO risk_overrides (risk_id, manual_status, notes, updated_by) VALUES (?, ?, ?, ?)')
        .run(req.params.riskId, manual_status, notes || null, req.user?.display_name || req.user?.username || 'System');
    }

    logAudit(req, 'risk-override-set', 'RiskOverride', null, req.params.riskId, {
      manual_status, notes
    });

    const updated = db.prepare('SELECT * FROM risk_overrides WHERE risk_id = ?').get(req.params.riskId);
    res.json(updated);
  } catch (error) {
    console.error('Error setting risk override:', error);
    res.status(500).json({ error: 'Fehler beim Setzen der Überschreibung' });
  }
});

// ═══════════════════════════════════════
// Summary — Übersicht über offene Aktionen
// ═══════════════════════════════════════

router.get('/summary', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const total = db.prepare('SELECT COUNT(*) as c FROM compliance_actions').get().c;
    const open = db.prepare("SELECT COUNT(*) as c FROM compliance_actions WHERE status = 'open'").get().c;
    const inProgress = db.prepare("SELECT COUNT(*) as c FROM compliance_actions WHERE status = 'in_progress'").get().c;
    const done = db.prepare("SELECT COUNT(*) as c FROM compliance_actions WHERE status = 'done'").get().c;
    const overdue = db.prepare("SELECT COUNT(*) as c FROM compliance_actions WHERE status != 'done' AND due_date < date('now')").get().c;
    const critical = db.prepare("SELECT COUNT(*) as c FROM compliance_actions WHERE status != 'done' AND priority = 'critical'").get().c;

    res.json({ total, open, inProgress, done, overdue, critical });
  } catch (error) {
    console.error('Error fetching compliance summary:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Zusammenfassung' });
  }
});

module.exports = router;
