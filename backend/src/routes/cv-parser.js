const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { logAiCall } = require('../aiLogger');
const { getAiConfig, stripReasoningTags, resolveAiProvider, buildAiRequest, extractAiText, pingAiService } = require('../aiConfig');

const router = express.Router();

// System OCR tool paths (homebrew on macOS)
const TESSERACT_BIN = '/opt/homebrew/opt/tesseract/bin/tesseract';
const PDFTOPPM_BIN = '/opt/homebrew/opt/poppler/bin/pdftoppm';

// Temp uploads directory
const tmpDir = path.join(__dirname, '..', '..', 'data', 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Multer config for temp file — accept multiple files
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
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Nur PDF, Word und Bilddateien erlaubt'), false);
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

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
    const imgPrefix = path.join(ocrTmpDir, 'page');
    console.log('🔍 OCR: Konvertiere PDF-Seiten zu Bildern...');
    execSync(`"${PDFTOPPM_BIN}" -png -r 300 "${filePath}" "${imgPrefix}"`, {
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pageFiles = fs.readdirSync(ocrTmpDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.png'))
      .sort();

    if (pageFiles.length === 0) {
      console.warn('⚠️ OCR: Keine Seitenbilder erzeugt');
      return '';
    }

    console.log(`🔍 OCR: ${pageFiles.length} Seite(n) gefunden, starte Texterkennung (deu+eng)...`);

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
    try { fs.rmSync(ocrTmpDir, { recursive: true, force: true }); } catch {}
  }
}

// OCR for images (certificates etc.)
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

// Extract text from file (with OCR fallback for scanned PDFs)
async function extractText(filePath, mimetype) {
  // Images → OCR directly
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

    // If no usable text, try OCR
    if (!text || text.length < 20) {
      console.log('📄 Kein eingebetteter Text gefunden — versuche OCR...');
      const ocrText = await ocrPdf(filePath);
      if (ocrText && ocrText.length >= 20) return ocrText;
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

// ─── Build the extraction prompt for Ollama ───
function buildExtractionPrompt(text, filenames) {
  // Truncate to ~12000 chars to stay within context window for smaller models
  const truncated = text.length > 12000 ? text.substring(0, 12000) + '\n[... Text gekürzt ...]' : text;

  return `Du bist ein HR-Experte und Lebenslauf-Parser. Analysiere den folgenden Text aus Bewerbungsunterlagen (${filenames.join(', ')}) und extrahiere ALLE verfügbaren Informationen.

WICHTIG:
- Extrahiere NUR Informationen, die tatsächlich im Text stehen. Erfinde NICHTS.
- Für den Beruflichen Werdegang (work_history): Erstelle für JEDEN genannten Arbeitgeber/Zeitraum einen EIGENEN Eintrag. Sortiere sie absteigend (neueste Tätigkeit zuerst).
- Für den Bildungsweg (education_history): Erstelle für JEDE genannte Ausbildung/Studium einen eigenen Eintrag. Sortiere absteigend (neueste zuerst).
- Datumsformate: Nutze "YYYY-MM" Format (z.B. "2020-01"). Falls nur das Jahr bekannt ist, nutze "YYYY-01".
- Wenn eine Tätigkeit aktuell ist (z.B. "seit 2022", "bis heute"), setze is_current auf true und to_date auf "".

Antworte NUR mit einem validen JSON-Objekt (KEIN Markdown, KEINE Erklärung):

{
  "name": "Vollständiger Name",
  "email": "E-Mail-Adresse",
  "phone": "Telefonnummer",
  "location": "Wohnort/Stadt",
  "nationality": "Nationalität",
  "current_employer": "Aktueller Arbeitgeber",
  "current_position": "Aktuelle Position/Jobtitel",
  "experience": "Zusammenfassung der Berufserfahrung als Fließtext (2-3 Sätze)",
  "skills": "Kommagetrennte Liste aller genannten Skills und Kompetenzen",
  "education": "Höchster Abschluss + Institution als Zusammenfassung",
  "languages": "Sprachen mit Niveau, z.B. Deutsch (Muttersprache), Englisch (B2)",
  "certificates": "Kommagetrennte Zertifikate und Weiterbildungen",
  "drivers_license": "Führerscheinklasse(n) oder leer",
  "mobility": "Reisebereitschaft/Mobilität oder leer",
  "desired_salary": "Gehaltsvorstellung falls genannt oder leer",
  "salary_min": null,
  "salary_max": null,
  "availability": "Verfügbarkeit/Startdatum oder leer",
  "notice_period": "Kündigungsfrist falls genannt oder leer",
  "linkedin_url": "LinkedIn-URL oder leer",
  "xing_url": "Xing-URL oder leer",
  "github_url": "GitHub-URL oder leer",
  "portfolio_url": "Portfolio/Website-URL oder leer",
  "tags": "Passende Tags kommagetrennt, z.B. Senior, Remote, Freelancer",
  "notes": "Sonstige relevante Infos die in kein anderes Feld passen",
  "gender": "Geschlecht des Bewerbers: 'Frau', 'Herr' oder 'Divers'. Versuche aus Kontexthinweisen (Vorname, Anrede, Pronomen) abzuleiten. Wenn unklar, leer lassen.",
  "work_history": [
    {
      "employer": "Arbeitgeber-Name",
      "position": "Jobtitel/Position",
      "from_date": "YYYY-MM",
      "to_date": "YYYY-MM oder leer wenn aktuell",
      "is_current": false,
      "description": "Kurze Beschreibung der Aufgaben/Tätigkeiten",
      "location": "Arbeitsort falls bekannt"
    }
  ],
  "education_history": [
    {
      "institution": "Name der Hochschule/Schule",
      "degree": "Abschluss (z.B. Bachelor, Master, Dipl.)",
      "field_of_study": "Fachrichtung/Studiengang",
      "from_date": "YYYY-MM",
      "to_date": "YYYY-MM",
      "description": "Schwerpunkte oder Abschlussarbeit falls genannt"
    }
  ]
}

TEXT AUS DEN BEWERBUNGSUNTERLAGEN:
${truncated}`;
}

/**
 * @swagger
 * /cv-parser/parse:
 *   post:
 *     summary: CV parsen (PDF/Word/Bilder → direkte Ollama KI-Extraktion)
 *     tags: [CV Parser]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             properties:
 *               file: { type: string, format: binary, description: PDF, Word oder Bilddatei (auch mehrere) }
 *     responses:
 *       200: { description: Extrahierte Bewerberdaten mit strukturiertem Werdegang }
 *       400: { description: Keine Datei oder ungültiges Format }
 *       502: { description: Ollama nicht erreichbar }
 */
router.post('/parse', upload.array('file', 10), async (req, res) => {
  const tempFiles = [];

  // SSE progress helper
  const useSSE = req.headers.accept === 'text/event-stream';
  if (useSSE) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
  }
  const sendProgress = (step, detail, progress) => {
    if (useSSE) {
      res.write(`data: ${JSON.stringify({ type: 'progress', step, detail, progress })}\n\n`);
    }
  };
  const sendResult = (data) => {
    if (useSSE) {
      res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`);
      res.end();
    } else {
      res.json(data);
    }
  };
  const sendError = (status, data) => {
    if (useSSE) {
      res.write(`data: ${JSON.stringify({ type: 'error', ...data })}\n\n`);
      res.end();
    } else {
      res.status(status).json(data);
    }
  };

  try {
    // Support both single file ('file') and multi-file upload
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return sendError(400, { error: 'Keine Datei hochgeladen' });
    }

    sendProgress('upload', `${files.length} Datei(en) empfangen`, 5);

    // 1. Extract text from all uploaded files
    let combinedText = '';
    const filenames = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(tmpDir, file.filename);
      tempFiles.push(filePath);
      filenames.push(file.originalname);

      const fileLabel = files.length > 1 ? `(${i + 1}/${files.length}) ` : '';
      sendProgress('extract', `${fileLabel}Text wird aus ${file.originalname} extrahiert (${(file.size / 1024).toFixed(0)} KB)`, 10 + Math.round((i / files.length) * 20));

      console.log(`📄 CV-Parser: Text wird extrahiert aus ${file.originalname} (${(file.size / 1024).toFixed(0)} KB)...`);
      try {
        const text = await extractText(filePath, file.mimetype);
        if (text && text.trim().length > 5) {
          combinedText += `\n\n=== Datei: ${file.originalname} ===\n${text}`;
        }
      } catch (extractErr) {
        console.warn(`⚠️ Konnte ${file.originalname} nicht lesen:`, extractErr.message);
        sendProgress('extract', `⚠️ ${file.originalname} konnte nicht gelesen werden`, 10 + Math.round(((i + 1) / files.length) * 20));
      }
    }

    if (!combinedText || combinedText.trim().length < 20) {
      return sendError(422, {
        error: 'Kein lesbarer Text in den Dateien gefunden. Möglicherweise handelt es sich um gescannte Bilder ohne OCR-Unterstützung.',
      });
    }

    sendProgress('extract_done', `${combinedText.length} Zeichen aus ${files.length} Datei(en) extrahiert`, 35);

    console.log(`📄 CV-Parser: ${combinedText.length} Zeichen aus ${files.length} Datei(en) extrahiert, sende an Ollama...`);

    // 2. Call Ollama directly for AI extraction
    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: PROVIDER_CFG } = getAiConfig();

    const prompt = buildExtractionPrompt(combinedText.trim(), filenames);

    const aiProvider = await resolveAiProvider(OLLAMA_URL, PROVIDER_CFG);
    const { url: aiUrl, body: aiBody } = buildAiRequest({
      baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: aiProvider,
      prompt, format: 'json', options: { temperature: 0.1, num_predict: 8192 },
    });

    // Quick reachability check
    sendProgress('ollama_connect', `Verbindung zu KI-Host (${OLLAMA_MODEL})...`, 40);
    try {
      await pingAiService(OLLAMA_URL, aiProvider, 5000);
    } catch (pingErr) {
      console.error('AI host not reachable:', pingErr.message);
      return sendError(502, { error: 'KI-Host ist nicht erreichbar. Bitte sicherstellen, dass der KI-Server läuft.' });
    }

    sendProgress('ollama_analyze', `KI analysiert ${combinedText.length} Zeichen Text mit ${OLLAMA_MODEL}...`, 50);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min for large docs
    const startTime = Date.now();

    // Send periodic progress updates during AI processing
    let ollamaProgress = 50;
    const progressInterval = setInterval(() => {
      ollamaProgress = Math.min(ollamaProgress + 2, 88);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      sendProgress('ollama_analyze', `KI analysiert... (${elapsed}s)`, ollamaProgress);
    }, 3000);

    let response;
    try {
      response = await fetch(aiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearInterval(progressInterval);
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logAiCall({
        userId: req.user?.id,
        feature: 'cv-parser',
        model: OLLAMA_MODEL,
        prompt: prompt.substring(0, 500) + '...',
        response: null,
        parsedResult: null,
        durationMs: duration,
        success: false,
        errorMessage: fetchErr.name === 'AbortError' ? 'Timeout >180s' : fetchErr.message,
      });
      if (fetchErr.name === 'AbortError') {
        return sendError(504, { error: 'Ollama-Timeout: CV-Analyse dauerte zu lange (> 3 Min). Versuche es erneut — das Modell wird beim ersten Aufruf geladen.' });
      }
      throw fetchErr;
    }
    clearInterval(progressInterval);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Ollama CV-Parse error:', response.status, errText);
      logAiCall({
        userId: req.user?.id,
        feature: 'cv-parser',
        model: OLLAMA_MODEL,
        prompt: prompt.substring(0, 500) + '...',
        response: errText,
        parsedResult: null,
        durationMs: Date.now() - startTime,
        success: false,
        errorMessage: `Ollama Status ${response.status}: ${errText}`,
      });
      return sendError(502, { error: 'Ollama-Fehler bei CV-Analyse', details: errText });
    }

    sendProgress('ollama_done', 'KI-Analyse abgeschlossen, Ergebnis wird verarbeitet...', 90);

    const data = await response.json();
    const { text: responseText } = extractAiText(data, aiProvider);
    const cvDuration = Date.now() - startTime;

    console.log(`✅ CV-Parser: Ollama-Antwort erhalten (${cvDuration}ms, ${responseText.length} Zeichen)`);

    // 3. Parse JSON from Ollama response
    let extracted = {};
    try {
      let cleanText = stripReasoningTags(responseText);
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Kein JSON in Antwort gefunden');
      }
    } catch (parseErr) {
      console.warn('⚠️ CV-Parser: JSON-Parsing fehlgeschlagen, versuche Fallback...', parseErr.message);
      // Try to extract at least basic fields via regex
      const nameMatch = responseText.match(/"name"\s*:\s*"([^"]+)"/);
      const emailMatch = responseText.match(/"email"\s*:\s*"([^"]+)"/);
      const phoneMatch = responseText.match(/"phone"\s*:\s*"([^"]+)"/);
      const skillsMatch = responseText.match(/"skills"\s*:\s*"([^"]+)"/);
      if (nameMatch) extracted.name = nameMatch[1];
      if (emailMatch) extracted.email = emailMatch[1];
      if (phoneMatch) extracted.phone = phoneMatch[1];
      if (skillsMatch) extracted.skills = skillsMatch[1];
    }

    // 4. Post-process: ensure work_history and education_history are sorted (newest first)
    if (Array.isArray(extracted.work_history)) {
      extracted.work_history = extracted.work_history
        .filter(w => w.employer || w.position)
        .sort((a, b) => {
          const dateA = a.from_date || '';
          const dateB = b.from_date || '';
          return dateB.localeCompare(dateA); // newest first
        });
    }
    if (Array.isArray(extracted.education_history)) {
      extracted.education_history = extracted.education_history
        .filter(e => e.institution || e.degree)
        .sort((a, b) => {
          const dateA = a.from_date || '';
          const dateB = b.from_date || '';
          return dateB.localeCompare(dateA);
        });
    }

    // Clean null/undefined string values
    for (const key of Object.keys(extracted)) {
      if (extracted[key] === null || extracted[key] === undefined || extracted[key] === 'null' || extracted[key] === 'leer') {
        extracted[key] = '';
      }
    }

    // AI Act Art. 12: Log the AI call
    logAiCall({
      userId: req.user?.id,
      feature: 'cv-parser',
      model: OLLAMA_MODEL,
      prompt: prompt.substring(0, 500) + '...',
      response: responseText.substring(0, 2000),
      parsedResult: extracted,
      durationMs: cvDuration,
      success: true,
    });

    sendProgress('complete', 'Felder erfolgreich extrahiert', 100);

    sendResult({
      success: true,
      filenames,
      filename: filenames[0], // backward compat
      candidate: extracted,
      textLength: combinedText.length,
      durationMs: cvDuration,
    });
  } catch (error) {
    console.error('CV parse error:', error);
    sendError(500, { error: 'Fehler beim Verarbeiten der Datei', details: error.message });
  } finally {
    // Clean up all temp files
    for (const fp of tempFiles) {
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch {}
      }
    }
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Datei zu groß (max. 20 MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
