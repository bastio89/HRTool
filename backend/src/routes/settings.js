const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');
const { getAiConfig, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('../aiConfig');

const router = express.Router();

const isAdmin = (req) => req.user?.role === 'admin';

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
 * /settings/ai/config:
 *   get:
 *     summary: Aktuelle KI-Konfiguration (Host & Modell) laden
 *     tags: [Settings]
 *     responses:
 *       200: { description: Base-URL, Modell und Herkunft der Werte }
 */
router.get('/ai/config', (req, res) => {
  try {
    const config = getAiConfig();
    res.json({
      baseUrl: config.baseUrl,
      model: config.model,
      source: config.source,
      defaults: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL },
    });
  } catch (error) {
    console.error('Error fetching AI config:', error);
    res.status(500).json({ error: 'Fehler beim Laden der KI-Konfiguration' });
  }
});

/**
 * @swagger
 * /settings/ai/config:
 *   put:
 *     summary: KI-Konfiguration (Host & Modell) speichern (nur Admin)
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               baseUrl: { type: string }
 *               model: { type: string }
 *     responses:
 *       200: { description: Konfiguration gespeichert }
 */
router.put('/ai/config', (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Nur Administratoren dürfen die KI-Konfiguration ändern' });
    }

    const { baseUrl, model } = req.body;

    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      return res.status(400).json({ error: 'Host / Base-URL ist erforderlich' });
    }
    if (typeof model !== 'string' || !model.trim()) {
      return res.status(400).json({ error: 'Modell ist erforderlich' });
    }

    const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
    try {
      const parsed = new URL(trimmedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Host muss mit http:// oder https:// beginnen' });
      }
    } catch (_) {
      return res.status(400).json({ error: 'Ungültige Host-URL' });
    }

    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
    upsert.run('ai_base_url', trimmedUrl);
    upsert.run('ai_model', model.trim());

    logAudit(req, 'ki-konfiguration-geändert', 'Setting', null, 'ai_config', { baseUrl: trimmedUrl, model: model.trim() });

    res.json({ success: true, baseUrl: trimmedUrl, model: model.trim() });
  } catch (error) {
    console.error('Error saving AI config:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der KI-Konfiguration' });
  }
});

/**
 * @swagger
 * /settings/ai/models:
 *   get:
 *     summary: Verfügbare Modelle vom KI-Host laden (Ollama /api/tags)
 *     tags: [Settings]
 *     parameters:
 *       - in: query
 *         name: baseUrl
 *         schema: { type: string }
 *         description: Optionaler Host zum Testen, bevor er gespeichert wird
 *     responses:
 *       200: { description: Liste verfügbarer Modelle }
 */
router.get('/ai/models', async (req, res) => {
  try {
    const override = typeof req.query.baseUrl === 'string' && req.query.baseUrl.trim()
      ? req.query.baseUrl.trim().replace('host.docker.internal', 'localhost').replace(/\/+$/, '')
      : null;
    const baseUrl = override || getAiConfig().baseUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      return res.status(502).json({
        error: 'KI-Host nicht erreichbar',
        reachable: false,
        baseUrl,
        details: err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message,
        models: [],
      });
    }
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `KI-Host antwortete mit HTTP ${response.status}`, reachable: false, baseUrl, models: [] });
    }

    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data.models)
      ? data.models.map((m) => ({ name: m.name, size: m.size ?? null, modified_at: m.modified_at ?? null }))
      : [];

    res.json({ reachable: true, baseUrl, models });
  } catch (error) {
    console.error('Error listing AI models:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Modelle', models: [] });
  }
});

/**
 * @swagger
 * /settings/ai/test:
 *   post:
 *     summary: Verbindung zum KI-Host testen
 *     tags: [Settings]
 *     responses:
 *       200: { description: Erreichbarkeitsstatus }
 */
router.post('/ai/test', async (req, res) => {
  try {
    const override = typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim()
      ? req.body.baseUrl.trim().replace('host.docker.internal', 'localhost').replace(/\/+$/, '')
      : null;
    const baseUrl = override || getAiConfig().baseUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const started = Date.now();
    let response;
    try {
      response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      return res.json({ reachable: false, baseUrl, error: err.name === 'AbortError' ? 'Zeitüberschreitung (>5s)' : err.message });
    }
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));
    const modelCount = Array.isArray(data.models) ? data.models.length : 0;

    res.json({ reachable: response.ok, baseUrl, status: response.status, latencyMs: Date.now() - started, modelCount });
  } catch (error) {
    console.error('Error testing AI connection:', error);
    res.status(500).json({ error: 'Fehler beim Verbindungstest' });
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

    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(key, String(value));

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
