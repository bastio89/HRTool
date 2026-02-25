const express = require('express');
const db = require('../database');

const router = express.Router();

// Helper: Log an audit entry (called from other routes)
function logAudit(req, action, entityType, entityId, entityLabel, details) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, entity_label, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id || null,
      req.user?.display_name || req.user?.username || 'System',
      action,
      entityType,
      entityId || null,
      entityLabel || null,
      typeof details === 'object' ? JSON.stringify(details) : (details || null)
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

/**
 * @swagger
 * /audit:
 *   get:
 *     summary: Audit-Log (Admin, paginiert)
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: entity_type
 *         schema: { type: string }
 *         description: Filter nach Entity-Typ (Candidate, Job, Pipeline, User, Matching, System)
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *         description: Filter nach Aktion (erstellt, aktualisiert, gelöscht, etc.)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Suche in Benutzername, Entity-Label oder Details
 *     responses:
 *       200: { description: Paginiertes Audit-Log }
 *       403: { description: Keine Berechtigung }
 */
router.get('/', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins können das Audit-Log einsehen' });
  }

  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    if (req.query.entity_type) {
      where.push('entity_type = ?');
      params.push(req.query.entity_type);
    }
    if (req.query.action) {
      where.push('action LIKE ?');
      params.push(`%${req.query.action}%`);
    }
    if (req.query.search) {
      where.push('(username LIKE ? OR entity_label LIKE ? OR details LIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s, s);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${whereClause}`).get(...params).count;
    const entries = db.prepare(`
      SELECT * FROM audit_log ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data: entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    console.error('Audit log fetch error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Audit-Logs' });
  }
});

/**
 * @swagger
 * /audit/stats:
 *   get:
 *     summary: Audit-Log Statistiken
 *     tags: [Audit]
 *     responses:
 *       200: { description: Aktivitäten der letzten 7 Tage }
 */
router.get('/stats', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins' });
  }

  try {
    const today = db.prepare(
      "SELECT COUNT(*) as count FROM audit_log WHERE created_at >= datetime('now', 'start of day')"
    ).get().count;

    const thisWeek = db.prepare(
      "SELECT COUNT(*) as count FROM audit_log WHERE created_at >= datetime('now', '-7 days')"
    ).get().count;

    const byType = db.prepare(`
      SELECT entity_type, COUNT(*) as count FROM audit_log
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY entity_type ORDER BY count DESC
    `).all();

    const byUser = db.prepare(`
      SELECT username, COUNT(*) as count FROM audit_log
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY username ORDER BY count DESC LIMIT 10
    `).all();

    res.json({ today, thisWeek, byType, byUser });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

module.exports = router;
module.exports.logAudit = logAudit;
