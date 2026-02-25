const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { logAiCall } = require('../aiLogger');

const router = express.Router();

// System OCR tool paths (homebrew on macOS)
const TESSERACT_BIN = '/opt/homebrew/opt/tesseract/bin/tesseract';
const PDFTOPPM_BIN = '/opt/homebrew/opt/poppler/bin/pdftoppm';

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

// Check if OCR tools are available
function hasOcrTools() {
  return fs.existsSync(TESSERACT_BIN) && fs.existsSync(PDFTOPPM_BIN);
}

// OCR fallback for scanned PDFs: convert PDF pages to images, then run tesseract
async function ocrPdf(filePath) {
  if (!hasOcrTools()) {
    console.warn('⚠️ OCR-Tools (tesseract/poppler) nicht gefunden. Scanned PDFs können nicht verarbeitet werden.');
    return '';
  }

  const ocrTmpDir = path.join(tmpDir, `ocr-${Date.now()}`);
  fs.mkdirSync(ocrTmpDir, { recursive: true });

  try {
    // Convert PDF pages to PNG images (300 DPI for good OCR quality)
    const imgPrefix = path.join(ocrTmpDir, 'page');
    console.log('🔍 OCR: Konvertiere PDF-Seiten zu Bildern...');
    execSync(`"${PDFTOPPM_BIN}" -png -r 300 "${filePath}" "${imgPrefix}"`, {
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Find all generated page images
    const pageFiles = fs.readdirSync(ocrTmpDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.png'))
      .sort();

    if (pageFiles.length === 0) {
      console.warn('⚠️ OCR: Keine Seitenbilder erzeugt');
      return '';
    }

    console.log(`🔍 OCR: ${pageFiles.length} Seite(n) gefunden, starte Texterkennung (deu+eng)...`);

    // Run tesseract on each page image and collect text
    let fullText = '';
    for (const pageFile of pageFiles) {
      const imgPath = path.join(ocrTmpDir, pageFile);
      try {
        const pageText = execSync(
          `"${TESSERACT_BIN}" "${imgPath}" stdout -l deu+eng --psm 1 2>/dev/null`,
          { timeout: 30000, encoding: 'utf-8' }
        );
        fullText += pageText + '\n';
      } catch (tessErr) {
        console.warn(`⚠️ OCR: Fehler bei Seite ${pageFile}:`, tessErr.message);
      }
    }

    console.log(`🔍 OCR: ${fullText.trim().length} Zeichen via OCR extrahiert`);
    return fullText.trim();
  } finally {
    // Cleanup OCR temp directory
    try {
      fs.rmSync(ocrTmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// Extract text from file (with OCR fallback for scanned PDFs)
async function extractText(filePath, mimetype) {
  if (mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);

    // First try: direct text extraction
    let text = '';
    try {
      const data = await pdfParse(buffer);
      text = (data.text || '').trim();
    } catch (pdfErr) {
      console.warn('PDF parse Warnung:', pdfErr.message);
      // Don't throw — try OCR fallback instead
    }

    // If no usable text found, try OCR fallback
    if (!text || text.length < 20) {
      console.log('📄 Kein eingebetteter Text gefunden — versuche OCR...');
      const ocrText = await ocrPdf(filePath);
      if (ocrText && ocrText.length >= 20) {
        return ocrText;
      }
      // If OCR also failed, return whatever we have (or empty)
      return text || ocrText || '';
    }

    return text;
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

/**
 * @swagger
 * /cv-parser/parse:
 *   post:
 *     summary: CV parsen (PDF/Word → KI-Extraktion)
 *     tags: [CV Parser]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             properties:
 *               file: { type: string, format: binary, description: PDF oder Word-Datei }
 *     responses:
 *       200: { description: Extrahierte Bewerberdaten (Name, E-Mail, Skills etc.) }
 *       400: { description: Keine Datei oder ungültiges Format }
 */
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

    // 2. Send to n8n webhook for AI extraction (with 90s timeout)
    const webhookUrl = process.env.N8N_CV_WEBHOOK_URL || 'http://localhost:5678/webhook/cv-parse';
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 90000);

    const cvPrompt = JSON.stringify({ cvText: text, filename: req.file.originalname });
    const startTime = Date.now();

    let n8nResponse;
    try {
      n8nResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: cvPrompt
      });
    } catch (fetchErr) {
      clearTimeout(fetchTimeout);
      const duration = Date.now() - startTime;
      logAiCall({
        userId: req.user?.id,
        feature: 'cv-parser',
        model: process.env.OLLAMA_MODEL || 'llama3.2',
        prompt: cvPrompt,
        response: null,
        parsedResult: null,
        durationMs: duration,
        success: false,
        errorMessage: fetchErr.name === 'AbortError' ? 'Timeout >90s' : fetchErr.message,
      });
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'n8n Timeout – CV-Analyse dauerte zu lange (>90s)' });
      }
      throw fetchErr;
    }
    clearTimeout(fetchTimeout);

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text();
      console.error('n8n CV-Parse webhook error:', n8nResponse.status, errText);
      logAiCall({
        userId: req.user?.id,
        feature: 'cv-parser',
        model: process.env.OLLAMA_MODEL || 'llama3.2',
        prompt: cvPrompt,
        response: errText,
        parsedResult: null,
        durationMs: Date.now() - startTime,
        success: false,
        errorMessage: `n8n Status ${n8nResponse.status}`,
      });
      return res.status(502).json({
        error: 'KI-Extraktion fehlgeschlagen',
        details: `n8n Status ${n8nResponse.status}`
      });
    }

    const extracted = await n8nResponse.json();
    const cvDuration = Date.now() - startTime;
    console.log('✅ CV-Parser: KI-Extraktion erfolgreich');

    // AI Act Art. 12: Log the AI call
    logAiCall({
      userId: req.user?.id,
      feature: 'cv-parser',
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      prompt: cvPrompt,
      response: JSON.stringify(extracted),
      parsedResult: extracted,
      durationMs: cvDuration,
      success: true,
    });

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
