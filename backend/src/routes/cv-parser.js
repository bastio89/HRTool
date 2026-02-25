const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Temp uploads directory
const tmpDir = path.join(__dirname, '..', '..', 'data', 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Multer config for temp file
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `cv-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Nur PDF und Word-Dateien erlaubt'), false);
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Extract text from file
async function extractText(filePath, mimetype) {
  if (mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  } else if (
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  throw new Error('Nicht unterstütztes Dateiformat');
}

// POST parse CV - extracts text and sends to n8n for AI processing
router.post('/parse', upload.single('file'), async (req, res) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    tempFilePath = path.join(tmpDir, req.file.filename);

    // 1. Extract text from PDF/Word
    console.log('📄 CV-Parser: Text wird extrahiert aus', req.file.originalname);
    const text = await extractText(tempFilePath, req.file.mimetype);

    if (!text || text.trim().length < 20) {
      return res.status(422).json({ error: 'Kein lesbarer Text in der Datei gefunden. Möglicherweise ist die Datei ein gescanntes Bild ohne OCR.' });
    }

    console.log(`📄 CV-Parser: ${text.length} Zeichen extrahiert, sende an n8n...`);

    // 2. Send to n8n webhook for AI extraction
    const webhookUrl = process.env.N8N_CV_WEBHOOK_URL || 'http://localhost:5678/webhook/cv-parse';

    const n8nResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cvText: text,
        filename: req.file.originalname,
      })
    });

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text();
      console.error('n8n CV-Parse webhook error:', n8nResponse.status, errText);
      return res.status(502).json({
        error: 'KI-Extraktion fehlgeschlagen',
        details: `n8n Status ${n8nResponse.status}`
      });
    }

    const extracted = await n8nResponse.json();
    console.log('✅ CV-Parser: KI-Extraktion erfolgreich');

    res.json({
      success: true,
      filename: req.file.originalname,
      candidate: extracted,
    });
  } catch (error) {
    console.error('CV parse error:', error);
    res.status(500).json({ error: 'Fehler beim Verarbeiten der Datei', details: error.message });
  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Datei zu groß (max. 10 MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
