// Administration -> CRM-Austausch: Kandidaten aus dem CRM-ZIP importieren und
// die Rueckgabe-CSV mit den Matching-Ergebnissen erzeugen. Nur fuer Admins.
// Ablauf und Format: README, Abschnitt "CRM-Schnittstelle".
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const db = require('../database');
const { logAudit } = require('./audit');
const { sendIdentityError } = require('../identity');
const {
  CrmImportError,
  createImportSession,
  deleteImportSession,
  importCandidate,
  importsDir,
} = require('../crm/candidateImport');
const { CrmExportError, previewReturn, renderReturnCsv } = require('../crm/returnExport');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Administratoren dürfen den CRM-Austausch nutzen' });
  }
  next();
});

const incomingDir = path.join(importsDir, 'incoming');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(incomingDir, { recursive: true });
      cb(null, incomingDir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.zip`),
  }),
  fileFilter: (req, file, cb) => {
    const isZip = /\.zip$/i.test(file.originalname) || /zip/i.test(file.mimetype);
    cb(isZip ? null : new CrmImportError('Bitte das ZIP aus dem CRM hochladen (hr-matching-kandidaten.zip)'), isZip);
  },
  // 256 MiB CV-Inhalt laut CRM plus kandidaten.csv und ZIP-Verwaltungsdaten.
  limits: { fileSize: 300 * 1024 * 1024, files: 1 },
});

function sendError(res, error, fallback) {
  if (error instanceof CrmImportError || error instanceof CrmExportError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (sendIdentityError(res, error)) return undefined;
  console.error(fallback, error);
  return res.status(500).json({ error: fallback, details: error.message });
}

/**
 * @swagger
 * /crm/import:
 *   post:
 *     summary: CRM-ZIP hochladen und pruefen (noch kein Import)
 *     tags: [CRM]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200: { description: "Pruefliste je Kandidat (token, rows, summary)" }
 */
router.post('/import', (req, res) => {
  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError.code === 'LIMIT_FILE_SIZE' ? 'Das ZIP ist zu groß (max. 300 MB)' : uploadError.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Kein ZIP hochgeladen' });
    try {
      const session = await createImportSession(req.file.path, req.file.originalname, req.user);
      logAudit(req, 'geprüft', 'CRM-Import', null, session.originalName, JSON.stringify(session.summary));
      res.json(session);
    } catch (error) {
      fs.rmSync(req.file.path, { force: true });
      sendError(res, error, 'CRM-ZIP konnte nicht geprüft werden');
    }
  });
});

/**
 * @swagger
 * /crm/import/{token}/candidates/{uuid}:
 *   post:
 *     summary: Einen Kandidaten aus dem gepruefte CRM-ZIP importieren
 *     tags: [CRM]
 *     responses:
 *       200: { description: "status created | linked | updated | unchanged" }
 */
router.post('/import/:token/candidates/:uuid', async (req, res) => {
  try {
    res.json(await importCandidate(req.params.token, req.params.uuid, req));
  } catch (error) {
    sendError(res, error, 'Kandidat konnte nicht importiert werden');
  }
});

router.delete('/import/:token', (req, res) => {
  try {
    deleteImportSession(req.params.token);
    res.json({ deleted: true });
  } catch (error) {
    sendError(res, error, 'Import konnte nicht entfernt werden');
  }
});

/**
 * @swagger
 * /crm/return/preview:
 *   get:
 *     summary: Vorschau der Rueckgabe-CSV (Zeilen, Teile, ausgeschlossene Paarungen)
 *     tags: [CRM]
 *     parameters:
 *       - { in: query, name: method, required: true, schema: { type: string, enum: [ai, vector] } }
 *       - { in: query, name: score_above, schema: { type: number } }
 */
router.get('/return/preview', (req, res) => {
  try {
    res.json(previewReturn(db, { method: req.query.method, scoreAbove: req.query.score_above }));
  } catch (error) {
    sendError(res, error, 'Vorschau der Rückgabe fehlgeschlagen');
  }
});

/**
 * @swagger
 * /crm/return/download:
 *   get:
 *     summary: Rueckgabe-CSV fuer das CRM (Semikolon, UTF-8 mit BOM)
 *     tags: [CRM]
 *     parameters:
 *       - { in: query, name: method, required: true, schema: { type: string, enum: [ai, vector] } }
 *       - { in: query, name: score_above, schema: { type: number } }
 *       - { in: query, name: part, schema: { type: integer, default: 1 } }
 */
router.get('/return/download', (req, res) => {
  try {
    const file = renderReturnCsv(db, { method: req.query.method, scoreAbove: req.query.score_above, part: req.query.part || 1 });
    logAudit(req, 'exportiert', 'CRM-Rückgabe', null, file.filename, `${file.rows} Zeilen`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.content);
  } catch (error) {
    sendError(res, error, 'Rückgabe-CSV konnte nicht erzeugt werden');
  }
});

module.exports = router;
