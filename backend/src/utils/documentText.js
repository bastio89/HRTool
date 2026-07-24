const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// System OCR tool paths (homebrew on macOS)
const TESSERACT_BIN = '/opt/homebrew/opt/tesseract/bin/tesseract';
const PDFTOPPM_BIN = '/opt/homebrew/opt/poppler/bin/pdftoppm';

const tmpDir = path.join(__dirname, '..', '..', 'data', 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

function hasOcrTools() {
  return fs.existsSync(TESSERACT_BIN) && fs.existsSync(PDFTOPPM_BIN);
}

async function ocrPdf(filePath) {
  if (!hasOcrTools()) {
    console.warn('⚠️ OCR-Tools (tesseract/poppler) nicht gefunden. Scanned PDFs können nicht verarbeitet werden.');
    return '';
  }

  const ocrTmpDir = path.join(tmpDir, `ocr-${Date.now()}`);
  fs.mkdirSync(ocrTmpDir, { recursive: true });

  try {
    const imgPrefix = path.join(ocrTmpDir, 'page');
    execSync(`"${PDFTOPPM_BIN}" -png -r 300 "${filePath}" "${imgPrefix}"`, {
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pageFiles = fs.readdirSync(ocrTmpDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.png'))
      .sort();

    if (pageFiles.length === 0) return '';

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

    return fullText.trim();
  } finally {
    try { fs.rmSync(ocrTmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function ocrImage(filePath) {
  if (!fs.existsSync(TESSERACT_BIN)) return '';
  try {
    const text = execSync(
      `"${TESSERACT_BIN}" "${filePath}" stdout -l deu+eng --psm 1 2>/dev/null`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    return text.trim();
  } catch {
    return '';
  }
}

async function extractText(filePath, mimetype) {
  if (mimetype.startsWith('image/')) {
    return ocrImage(filePath);
  }

  if (mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);

    let text = '';
    try {
      const data = await pdfParse(buffer);
      text = (data.text || '').trim();
    } catch (pdfErr) {
      console.warn('PDF parse Warnung:', pdfErr.message);
    }

    if (!text || text.length < 20) {
      const ocrText = await ocrPdf(filePath);
      if (ocrText && ocrText.length >= 20) return ocrText;
      return text || ocrText || '';
    }

    return text;
  }

  if (
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (mimetype === 'text/plain' || mimetype === 'text/markdown') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  throw new Error('Nicht unterstütztes Dateiformat');
}

module.exports = {
  tmpDir,
  extractText,
};