const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');
const apiKeyAuth = require('../middleware/apiKey');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  ExportValidationError,
  describeEntities,
  listFormats,
  normalizeSpec,
  runExport,
} = require('../exports');

const router = express.Router();

// Export-Profile: gespeicherte Spezifikationen, z. B. "Personaldaten fuer
// Lohnbuchhaltung". Ein Profil legt Felder, Zielfeldnamen, Format und Filter
// fest und kann optional fuer den Abruf durch ein Fremdsystem freigegeben
// werden.
db.exec(`
  CREATE TABLE IF NOT EXISTS export_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    entity TEXT NOT NULL DEFAULT 'candidates',
    format TEXT NOT NULL DEFAULT 'json',
    format_options TEXT NOT NULL DEFAULT '{}',
    fields TEXT NOT NULL DEFAULT '[]',
    filters TEXT NOT NULL DEFAULT '{}',
    external_enabled INTEGER DEFAULT 0,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Der Datenexport liegt in der Administration und ist damit Admins vorbehalten.
const RUN_ROLES = ['admin'];
const MANAGE_ROLES = ['admin'];

const externalRateLimiter = createRateLimiter({
  maxRequests: 30,
  windowMs: 60000,
  keyPrefix: 'export-external',
  keyFn: () => 'api-key',
});

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Keine Berechtigung fuer Datenexporte' });
    }
    next();
  };
}

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (_) {
    return fallback;
  }
}

function serializeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    entity: row.entity,
    format: row.format,
    format_options: parseJson(row.format_options, {}),
    fields: parseJson(row.fields, []),
    filters: parseJson(row.filters, {}),
    external_enabled: Boolean(row.external_enabled),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function loadProfile(id) {
  return serializeProfile(db.prepare('SELECT * FROM export_profiles WHERE id = ?').get(Number(id)));
}

function handleError(res, error, fallback) {
  if (error instanceof ExportValidationError) return res.status(400).json({ error: error.message });
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

// Laufzeit-Filter (z. B. ausgewaehlte Bewerber) ergaenzen die Filter des
// Profils, ersetzen sie aber nur dort, wo sie denselben Schluessel setzen.
function mergeFilters(base = {}, override = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  return merged;
}

function sendExport(res, result) {
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('X-Export-Count', String(result.count));
  res.setHeader('X-Total-Count', String(result.total));
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Count, X-Total-Count');
  res.send(result.body);
}

// Jeder Abzug personenbezogener Daten wird protokolliert (DSGVO Art. 30).
function auditExport(req, result, { profile, channel }) {
  logAudit(req, 'export', 'Export', profile?.id || null, profile?.name || `Ad-hoc-Export ${result.spec.entity}`, {
    channel,
    entity: result.spec.entity,
    format: result.spec.format,
    fields: result.spec.fields.map(field => field.key),
    filters: result.spec.filters,
    count: result.count,
    total: result.total,
  });
}

function profileInput(body = {}, existing = {}) {
  const name = String(body.name ?? existing.name ?? '').trim();
  if (!name) throw new ExportValidationError('Name ist erforderlich');
  const spec = normalizeSpec(db, {
    entity: body.entity ?? existing.entity,
    format: body.format ?? existing.format,
    format_options: body.format_options ?? existing.format_options,
    fields: body.fields ?? existing.fields,
    filters: body.filters ?? existing.filters,
  });
  return {
    name,
    description: String(body.description ?? existing.description ?? '').trim(),
    external_enabled: (body.external_enabled ?? existing.external_enabled) ? 1 : 0,
    spec,
  };
}

/**
 * @swagger
 * /exports/schema:
 *   get:
 *     summary: Exportierbare Entitaeten, Felder, Filter und Formate
 *     tags: [Exports]
 *     responses:
 *       200: { description: Beschreibung der Export-Schnittstelle }
 */
router.get('/schema', requireRole(RUN_ROLES), (req, res) => {
  try {
    res.json({ entities: describeEntities(db), formats: listFormats() });
  } catch (error) {
    handleError(res, error, 'Fehler beim Laden des Export-Schemas');
  }
});

/**
 * @swagger
 * /exports/profiles:
 *   get:
 *     summary: Gespeicherte Export-Profile
 *     tags: [Exports]
 *     responses:
 *       200: { description: Liste der Profile }
 */
router.get('/profiles', requireRole(RUN_ROLES), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM export_profiles ORDER BY name ASC').all();
    res.json(rows.map(serializeProfile));
  } catch (error) {
    handleError(res, error, 'Fehler beim Laden der Export-Profile');
  }
});

router.get('/profiles/:id', requireRole(RUN_ROLES), (req, res) => {
  const profile = loadProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Export-Profil nicht gefunden' });
  res.json(profile);
});

/**
 * @swagger
 * /exports/profiles:
 *   post:
 *     summary: Export-Profil anlegen (Admin)
 *     tags: [Exports]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               entity: { type: string, example: candidates }
 *               format: { type: string, enum: [json, ndjson, csv, xml] }
 *               format_options: { type: object }
 *               fields:
 *                 type: array
 *                 items:
 *                   properties:
 *                     key: { type: string, example: email }
 *                     as: { type: string, example: contact.email }
 *               filters: { type: object }
 *               external_enabled: { type: boolean }
 *     responses:
 *       201: { description: Angelegtes Profil }
 *       400: { description: Ungueltige Spezifikation }
 */
router.post('/profiles', requireRole(MANAGE_ROLES), (req, res) => {
  try {
    const input = profileInput(req.body);
    const result = db.prepare(`
      INSERT INTO export_profiles (name, description, entity, format, format_options, fields, filters, external_enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name,
      input.description,
      input.spec.entity,
      input.spec.format,
      JSON.stringify(input.spec.format_options),
      JSON.stringify(input.spec.fields),
      JSON.stringify(input.spec.filters),
      input.external_enabled,
      req.user?.display_name || req.user?.username || null,
    );
    const profile = loadProfile(result.lastInsertRowid);
    logAudit(req, 'erstellt', 'ExportProfile', profile.id, profile.name, {
      fields: profile.fields.map(field => field.key),
      external_enabled: profile.external_enabled,
    });
    res.status(201).json(profile);
  } catch (error) {
    handleError(res, error, 'Fehler beim Anlegen des Export-Profils');
  }
});

router.put('/profiles/:id', requireRole(MANAGE_ROLES), (req, res) => {
  try {
    const existing = loadProfile(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Export-Profil nicht gefunden' });
    const input = profileInput(req.body, existing);
    db.prepare(`
      UPDATE export_profiles
      SET name = ?, description = ?, entity = ?, format = ?, format_options = ?, fields = ?, filters = ?,
          external_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      input.name,
      input.description,
      input.spec.entity,
      input.spec.format,
      JSON.stringify(input.spec.format_options),
      JSON.stringify(input.spec.fields),
      JSON.stringify(input.spec.filters),
      input.external_enabled,
      existing.id,
    );
    const profile = loadProfile(existing.id);
    logAudit(req, 'aktualisiert', 'ExportProfile', profile.id, profile.name, {
      fields: profile.fields.map(field => field.key),
      external_enabled: profile.external_enabled,
    });
    res.json(profile);
  } catch (error) {
    handleError(res, error, 'Fehler beim Speichern des Export-Profils');
  }
});

router.delete('/profiles/:id', requireRole(MANAGE_ROLES), (req, res) => {
  try {
    const existing = loadProfile(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Export-Profil nicht gefunden' });
    db.prepare('DELETE FROM export_profiles WHERE id = ?').run(existing.id);
    logAudit(req, 'gelöscht', 'ExportProfile', existing.id, existing.name);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'Fehler beim Loeschen des Export-Profils');
  }
});

/**
 * @swagger
 * /exports/preview:
 *   post:
 *     summary: Vorschau der ersten Datensaetze einer Export-Spezifikation
 *     tags: [Exports]
 *     responses:
 *       200: { description: "{ total, records }" }
 */
router.post('/preview', requireRole(RUN_ROLES), (req, res) => {
  try {
    const result = runExport(db, { ...req.body, format: 'json', format_options: { envelope: false } }, { limit: 5 });
    res.json({ total: result.total, records: JSON.parse(result.body) });
  } catch (error) {
    handleError(res, error, 'Fehler bei der Export-Vorschau');
  }
});

/**
 * @swagger
 * /exports/run:
 *   post:
 *     summary: Ad-hoc-Export nach Spezifikation (Datei-Download)
 *     tags: [Exports]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               entity: { type: string, example: candidates }
 *               format: { type: string, enum: [json, ndjson, csv, xml] }
 *               format_options: { type: object }
 *               fields: { type: array, items: { type: object } }
 *               filters: { type: object }
 *     responses:
 *       200: { description: Exportdatei }
 *       400: { description: Ungueltige Spezifikation }
 */
router.post('/run', requireRole(RUN_ROLES), (req, res) => {
  try {
    const result = runExport(db, req.body, { limit: req.body?.limit, offset: req.body?.offset });
    auditExport(req, result, { channel: 'ui' });
    sendExport(res, result);
  } catch (error) {
    handleError(res, error, 'Export fehlgeschlagen');
  }
});

/**
 * @swagger
 * /exports/profiles/{id}/run:
 *   post:
 *     summary: Export-Profil ausfuehren (Datei-Download)
 *     description: Optional koennen im Body zusaetzliche Filter (z. B. ids) uebergeben werden.
 *     tags: [Exports]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Exportdatei }
 */
router.post('/profiles/:id/run', requireRole(RUN_ROLES), (req, res) => {
  try {
    const profile = loadProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Export-Profil nicht gefunden' });
    const result = runExport(db, {
      ...profile,
      filters: mergeFilters(profile.filters, req.body?.filters),
    }, { limit: req.body?.limit, offset: req.body?.offset, filename: profile.name });
    auditExport(req, result, { profile, channel: 'ui' });
    sendExport(res, result);
  } catch (error) {
    handleError(res, error, 'Export fehlgeschlagen');
  }
});

/**
 * @swagger
 * /exports/external/profiles:
 *   get:
 *     summary: Fuer Fremdsysteme freigegebene Export-Profile (API-Key)
 *     tags: [Exports]
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200: { description: Liste der freigegebenen Profile }
 *       401: { description: Ungueltiger API-Key }
 */
router.get('/external/profiles', apiKeyAuth, externalRateLimiter, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM export_profiles WHERE external_enabled = 1 ORDER BY name ASC').all();
    res.json(rows.map(serializeProfile).map(({ id, name, description, entity, format, fields, updated_at }) => ({
      id, name, description, entity, format, fields: fields.map(field => field.as), updated_at,
    })));
  } catch (error) {
    handleError(res, error, 'Fehler beim Laden der Export-Profile');
  }
});

/**
 * @swagger
 * /exports/external/profiles/{id}:
 *   get:
 *     summary: Datenabzug eines freigegebenen Export-Profils abrufen (API-Key)
 *     description: |
 *       Fuer die Anbindung von Fremdsystemen. Seitenweise ueber limit/offset;
 *       mit updated_since lassen sich nur seit dem letzten Abruf geaenderte
 *       Datensaetze holen. Header X-Total-Count enthaelt die Gesamtanzahl.
 *     tags: [Exports]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: offset
 *         schema: { type: integer }
 *       - in: query
 *         name: updated_since
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Exportdatei im Format des Profils }
 *       401: { description: Ungueltiger API-Key }
 *       404: { description: Profil nicht gefunden oder nicht freigegeben }
 */
router.get('/external/profiles/:id', apiKeyAuth, externalRateLimiter, (req, res) => {
  try {
    const profile = loadProfile(req.params.id);
    if (!profile || !profile.external_enabled) {
      return res.status(404).json({ error: 'Export-Profil nicht gefunden oder nicht freigegeben' });
    }
    const result = runExport(db, {
      ...profile,
      filters: mergeFilters(profile.filters, { updated_since: req.query.updated_since }),
    }, { limit: req.query.limit, offset: req.query.offset, filename: profile.name });
    auditExport(req, result, { profile, channel: 'external-api' });
    sendExport(res, result);
  } catch (error) {
    handleError(res, error, 'Export fehlgeschlagen');
  }
});

module.exports = router;
