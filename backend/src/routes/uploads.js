const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// File filter: PDF, Word, Images
const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/jpg',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Nur PDF, Word und Bilder (JPG, PNG) erlaubt'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

/**
 * @swagger
 * /uploads/candidate/{candidateId}:
 *   post:
 *     summary: Datei hochladen
 *     tags: [Uploads]
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201: { description: Datei hochgeladen }
 */
router.post('/candidate/:candidateId', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const candidate = db.prepare('SELECT id FROM candidates WHERE id = ?').get(req.params.candidateId);
    if (!candidate) {
      // Clean up uploaded file
      fs.unlinkSync(path.join(uploadsDir, req.file.filename));
      return res.status(404).json({ error: 'Bewerber nicht gefunden' });
    }

    const result = db.prepare(
      'INSERT INTO candidate_files (candidate_id, filename, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.candidateId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);

    const fileRecord = db.prepare('SELECT * FROM candidate_files WHERE id = ?').get(result.lastInsertRowid);

    // Log activity
    db.prepare('INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)')
      .run(req.params.candidateId, 'Upload', `Datei hochgeladen: ${req.file.originalname}`);

    res.status(201).json(fileRecord);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Fehler beim Hochladen' });
  }
});

/**
 * @swagger
 * /uploads/candidate/{candidateId}:
 *   get:
 *     summary: Dateien eines Bewerbers
 *     tags: [Uploads]
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Dateiliste }
 */
router.get('/candidate/:candidateId', (req, res) => {
  try {
    const files = db.prepare(
      'SELECT * FROM candidate_files WHERE candidate_id = ? ORDER BY created_at DESC'
    ).all(req.params.candidateId);
    res.json({ data: files });
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Dateien' });
  }
});

/**
 * @swagger
 * /uploads/download/{fileId}:
 *   get:
 *     summary: Datei herunterladen
 *     tags: [Uploads]
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Datei-Download }
 */
router.get('/download/:fileId', (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM candidate_files WHERE id = ?').get(req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Datei nicht gefunden' });

    const filePath = path.join(uploadsDir, file.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht auf Festplatte gefunden' });

    res.download(filePath, file.original_name);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Fehler beim Herunterladen' });
  }
});

/**
 * @swagger
 * /uploads/{fileId}:
 *   delete:
 *     summary: Datei löschen
 *     tags: [Uploads]
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Gelöscht }
 */
router.delete('/:fileId', (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM candidate_files WHERE id = ?').get(req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Datei nicht gefunden' });

    // Delete from disk
    const filePath = path.join(uploadsDir, file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Delete from DB
    db.prepare('DELETE FROM candidate_files WHERE id = ?').run(req.params.fileId);

    res.json({ message: 'Datei gelöscht' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Datei' });
  }
});

// Error handling for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Datei ist zu groß (max. 10 MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
