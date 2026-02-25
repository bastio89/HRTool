const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

/**
 * @swagger
 * /settings:
 *   get:
 *     summary: Alle Einstellungen laden
 *     tags: [Settings]
 *     responses:
 *       200: { description: Key-Value Einstellungen }
 */
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
  }
});

/**
 * @swagger
 * /settings/{key}:
 *   put:
 *     summary: Einstellung aktualisieren
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               value: { type: string }
 *     responses:
 *       200: { description: Einstellung aktualisiert }
 */
router.put('/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Wert erforderlich' });
    }

    // Validate specific settings
    if (key === 'dsgvo_retention_months') {
      const months = parseInt(value);
      if (isNaN(months) || months < 1 || months > 24) {
        return res.status(400).json({ error: 'Aufbewahrungsfrist muss zwischen 1 und 24 Monaten liegen' });
      }
    }

    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))').run(key, String(value));

    logAudit(req, 'einstellung-geändert', 'Setting', null, key, { value });

    res.json({ success: true, key, value: String(value) });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Einstellung' });
  }
});

/**
 * @swagger
 * /settings/dsgvo/expired:
 *   get:
 *     summary: Bewerber mit abgelaufener DSGVO-Aufbewahrungsfrist
 *     tags: [Settings]
 *     responses:
 *       200: { description: Liste abgelaufener Bewerber mit Statistiken }
 */
router.get('/dsgvo/expired', (req, res) => {
  try {
    const retentionSetting = db.prepare("SELECT value FROM settings WHERE key = 'dsgvo_retention_months'").get();
    const months = parseInt(retentionSetting?.value) || 6;

    const expired = db.prepare(`
      SELECT id, name, email, location, status, created_at, updated_at,
        ROUND(julianday('now') - julianday(COALESCE(updated_at, created_at))) as days_since_update
      FROM candidates
      WHERE datetime(COALESCE(updated_at, created_at), '+' || ? || ' months') < datetime('now')
      ORDER BY updated_at ASC, created_at ASC
    `).all(months);

    const total = db.prepare('SELECT COUNT(*) as count FROM candidates').get().count;

    res.json({
      expired,
      expiredCount: expired.length,
      totalCandidates: total,
      retentionMonths: months,
      cutoffDate: new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Error fetching expired candidates:', error);
    res.status(500).json({ error: 'Fehler beim Laden der abgelaufenen Bewerber' });
  }
});

/**
 * @swagger
 * /settings/dsgvo/delete-expired:
 *   delete:
 *     summary: Alle abgelaufenen Bewerber DSGVO-konform löschen
 *     tags: [Settings]
 *     responses:
 *       200: { description: Anzahl gelöschter Bewerber }
 */
router.delete('/dsgvo/delete-expired', (req, res) => {
  try {
    const retentionSetting = db.prepare("SELECT value FROM settings WHERE key = 'dsgvo_retention_months'").get();
    const months = parseInt(retentionSetting?.value) || 6;

    const expired = db.prepare(`
      SELECT id, name FROM candidates
      WHERE datetime(COALESCE(updated_at, created_at), '+' || ? || ' months') < datetime('now')
    `).all(months);

    if (expired.length === 0) {
      return res.json({ deleted: 0, message: 'Keine abgelaufenen Bewerber vorhanden' });
    }

    const deleteTransaction = db.transaction(() => {
      const ids = expired.map(c => c.id);

      for (const id of ids) {
        // Delete related data
        db.prepare('DELETE FROM activities WHERE candidate_id = ?').run(id);
        db.prepare('DELETE FROM pipeline_entries WHERE candidate_id = ?').run(id);
        db.prepare('DELETE FROM candidate_files WHERE candidate_id = ?').run(id);
        db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
      }

      return ids.length;
    });

    const deletedCount = deleteTransaction();

    logAudit(req, 'dsgvo-löschung', 'Candidate', null, null, {
      deletedCount,
      retentionMonths: months,
      deletedNames: expired.slice(0, 10).map(c => c.name)
    });

    res.json({
      deleted: deletedCount,
      retentionMonths: months,
      message: `${deletedCount} Bewerber DSGVO-konform gelöscht`
    });
  } catch (error) {
    console.error('Error deleting expired candidates:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der abgelaufenen Bewerber' });
  }
});

module.exports = router;
