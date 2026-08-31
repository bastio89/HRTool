const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { logAudit } = require('./audit');
const { tmpDir, extractText } = require('../utils/documentText');

const router = express.Router();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function toTextValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object') {
          const name = item.name || item.value || item.label || '';
          const level = item.level ? ` (${item.level})` : '';
          return `${String(name).trim()}${level}`.trim();
        }
        return String(item).trim();
      })
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value === 'object') {
    return Object.values(value).map((item) => String(item).trim()).filter(Boolean).join(', ') || null;
  }
  return String(value).trim() || null;
}

function toCsv(value, field = 'name') {
  if (!Array.isArray(value)) return toTextValue(value);
  return value
    .map((item) => {
      if (item === null || item === undefined) return '';
      if (typeof item === 'string') return item.trim();
      if (typeof item === 'object') {
        const main = item[field] || item.name || item.value || item.label || '';
        const level = item.level ? ` (${item.level})` : '';
        return `${String(main).trim()}${level}`.trim();
      }
      return String(item).trim();
    })
    .filter(Boolean)
    .join(', ') || null;
}

function normalizeHistoryEntries(value, kind) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (kind === 'work') return Boolean(item.employer || item.position);
    return Boolean(item.institution || item.degree || item.field_of_study);
  });
}

function normalizeWorkHistory(profile) {
  const entries = normalizeHistoryEntries(profile.work_history, 'work');
  const hasCurrentRole = entries.some((item) => {
    const employer = String(item.employer || '').trim().toLowerCase();
    const position = String(item.position || '').trim().toLowerCase();
    return employer === String(profile.current_employer || '').trim().toLowerCase()
      && position === String(profile.current_position || '').trim().toLowerCase();
  });

  if (!hasCurrentRole && (profile.current_employer || profile.current_position)) {
    entries.unshift({
      employer: profile.current_employer || null,
      position: profile.current_position || null,
      from_date: null,
      to_date: null,
      is_current: true,
      description: profile.experience || null,
      location: profile.location || null,
    });
  }

  return entries;
}

function extractWorkHistoryFromText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => {
    const lowered = line.toLowerCase();
    return (
      lowered.includes('beruflicher werdegang')
      || lowered.includes('berufserfahrung')
      || lowered.includes('praktische industrie')
      || lowered.includes('professional experience')
      || lowered.includes('work experience')
    );
  });

  if (startIndex === -1) {
    return [];
  }

  const entries = [];
  let currentEntry = null;

  const looksLikeRoleLine = (value) => /\b(engineer|developer|specialist|architect|manager|consultant|lead|administrator|designer|scientist|analyst|director|head|chief|developer|engineer|it specialist)\b/i.test(value);

  const flushCurrentEntry = () => {
    if (currentEntry && (currentEntry.employer || currentEntry.position || currentEntry.description)) {
      entries.push(currentEntry);
    }
    currentEntry = null;
  };

  for (const line of lines.slice(startIndex + 1)) {
    const lowered = line.toLowerCase();
    if (
      lowered.startsWith('4.')
      || lowered.startsWith('5.')
      || lowered.startsWith('6.')
      || lowered.includes('kompetenzmatrix')
      || lowered.includes('sprachkompetenzen')
      || lowered.includes('projektportfolio')
      || lowered.includes('referenzen')
    ) {
      break;
    }

    if (line.length > 220) {
      if (currentEntry) {
        currentEntry.description = currentEntry.description ? `${currentEntry.description}\n${line}` : line;
      }
      continue;
    }

    const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2 && looksLikeRoleLine(parts[0]) && /[A-Za-zÄÖÜäöüß]/.test(parts[1])) {
      flushCurrentEntry();
      currentEntry = {
        position: parts[0],
        employer: parts[1],
        from_date: null,
        to_date: null,
        is_current: entries.length === 0,
        description: parts.length > 2 ? parts.slice(2).join(', ') : null,
        location: parts.length > 2 ? parts[parts.length - 1] : null,
      };
      continue;
    }

    if (currentEntry) {
      currentEntry.description = currentEntry.description ? `${currentEntry.description}\n${line}` : line;
    }
  }

  flushCurrentEntry();
  return entries.filter((entry) => entry.employer || entry.position);
}

function summarizeWorkHistory(workHistory, fallbackExperienceYears) {
  if (typeof fallbackExperienceYears === 'number' && Number.isFinite(fallbackExperienceYears)) {
    const yearsLabel = fallbackExperienceYears === 1 ? '1 Jahr' : `${fallbackExperienceYears} Jahre`;
    if (!workHistory || !workHistory.length) {
      return yearsLabel;
    }
  }

  const entries = normalizeHistoryEntries(workHistory, 'work');
  if (!entries.length) {
    return typeof fallbackExperienceYears === 'number' && Number.isFinite(fallbackExperienceYears)
      ? `${fallbackExperienceYears} Jahre`
      : null;
  }

  const lines = entries.slice(0, 5).map((item) => {
    const parts = [item.position || item.employer || ''];
    const context = [item.employer, item.from_date, item.to_date].filter(Boolean).join(', ');
    if (context) {
      parts.push(context);
    }
    return parts.filter(Boolean).join(' - ');
  }).filter(Boolean);

  if (!lines.length) {
    return typeof fallbackExperienceYears === 'number' && Number.isFinite(fallbackExperienceYears)
      ? `${fallbackExperienceYears} Jahre`
      : null;
  }

  return lines.join('\n');
}

function summarizeEducation(profile) {
  if (profile.education) return profile.education;
  if (Array.isArray(profile.educations) && profile.educations.length > 0) {
    return toCsv(profile.educations, 'field_of_study');
  }
  return null;
}

function buildCandidateRow(profile) {
  const workHistorySummary = summarizeWorkHistory(normalizeWorkHistory(profile), profile.experience_years);
  return {
    name: profile.name,
    email: profile.email || null,
    phone: profile.phone || null,
    location: profile.location || null,
    experience: profile.experience || workHistorySummary || (profile.experience_years !== null && profile.experience_years !== undefined ? `${profile.experience_years}` : null),
    skills: toCsv(profile.skills),
    education: summarizeEducation(profile),
    desired_salary: profile.desired_salary || (profile.salary_expectation !== null && profile.salary_expectation !== undefined ? `${profile.salary_expectation}` : null),
    availability: profile.availability || null,
    languages: toCsv(profile.languages),
    certificates: profile.certificates || null,
    drivers_license: profile.drivers_license || null,
    mobility: profile.mobility || null,
    notes: profile.notes || null,
    status: 'Aktiv',
    tags: profile.tags || null,
    source: 'CV-Import',
    linkedin_url: profile.linkedin_url || null,
    xing_url: profile.xing_url || null,
    github_url: profile.github_url || null,
    portfolio_url: profile.portfolio_url || null,
    salary_min: null,
    salary_max: null,
    salary_currency: 'EUR',
    salary_interval: 'yearly',
    notice_period: profile.notice_period || null,
    available_from: profile.availability || null,
    gdpr_consent_date: null,
    gdpr_consent_type: null,
    gdpr_consent_expires: null,
    nationality: profile.nationality || null,
    work_permit: null,
    work_permit_until: null,
    referrer_name: null,
    referrer_email: null,
    current_employer: profile.current_employer || null,
    current_position: profile.current_position || null,
    gender: profile.gender || null,
  };
}

function persistCandidate(profile, req) {
  const row = buildCandidateRow(profile);
  const insert = db.prepare(`
    INSERT INTO candidates (name, email, phone, location, experience, skills,
      education, desired_salary, availability, languages, certificates,
      drivers_license, mobility, notes, status, tags, source,
      linkedin_url, xing_url, github_url, portfolio_url,
      salary_min, salary_max, salary_currency, salary_interval,
      notice_period, available_from,
      gdpr_consent_date, gdpr_consent_type, gdpr_consent_expires,
      nationality, work_permit, work_permit_until,
      referrer_name, referrer_email,
      current_employer, current_position, gender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    row.name, row.email, row.phone, row.location,
    row.experience, row.skills, row.education,
    row.desired_salary, row.availability, row.languages,
    row.certificates, row.drivers_license, row.mobility,
    row.notes, row.status, row.tags, row.source,
    row.linkedin_url, row.xing_url, row.github_url, row.portfolio_url,
    row.salary_min, row.salary_max, row.salary_currency, row.salary_interval,
    row.notice_period, row.available_from,
    row.gdpr_consent_date, row.gdpr_consent_type, row.gdpr_consent_expires,
    row.nationality, row.work_permit, row.work_permit_until,
    row.referrer_name, row.referrer_email,
    row.current_employer, row.current_position, row.gender,
  );

  const candidateId = result.lastInsertRowid;
  const workHistory = normalizeWorkHistory(profile);
  const educationHistory = normalizeHistoryEntries(profile.education_history, 'education');

  const workInsert = db.prepare(`
    INSERT INTO candidate_work_history (candidate_id, employer, position, from_date, to_date, is_current, description, location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const educationInsert = db.prepare(`
    INSERT INTO candidate_education (candidate_id, institution, degree, field_of_study, from_date, to_date, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const item of workHistory) {
      workInsert.run(
        candidateId,
        item.employer || null,
        item.position || null,
        item.from_date || null,
        item.to_date || null,
        item.is_current ? 1 : 0,
        item.description || null,
        item.location || null,
      );
    }
    for (const item of educationHistory) {
      educationInsert.run(
        candidateId,
        item.institution || null,
        item.degree || null,
        item.field_of_study || null,
        item.from_date || null,
        item.to_date || null,
        item.description || null,
      );
    }
  });
  tx();

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
  const candidateWorkHistory = db.prepare('SELECT * FROM candidate_work_history WHERE candidate_id = ? ORDER BY is_current DESC, from_date DESC').all(candidateId);
  const candidateEducationHistory = db.prepare('SELECT * FROM candidate_education WHERE candidate_id = ? ORDER BY from_date DESC').all(candidateId);
  logAudit(req, 'erstellt', 'Candidate', candidate.id, candidate.name);

  return {
    ...candidate,
    work_history: candidateWorkHistory,
    education_history: candidateEducationHistory,
  };
}

async function ingestIntoGraphRag(rawText, persist) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error('GraphRAG ist nicht konfiguriert');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/ingest/candidate?persist=${persist ? '1' : '0'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: rawText }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.detail || payload.error || 'Unbekannter Fehler';
      if (String(detail).toLowerCase().includes('parsing failed')) {
        throw new Error(`GraphRAG-Parsing fehlgeschlagen: ${detail}`);
      }
      if (String(detail).toLowerCase().includes('embedding creation failed')) {
        throw new Error(`GraphRAG-Embedding fehlgeschlagen: ${detail}`);
      }
      if (String(detail).toLowerCase().includes('persistence failed')) {
        throw new Error(`GraphRAG-Speicherung fehlgeschlagen: ${detail}`);
      }
      throw new Error(`GraphRAG HTTP ${response.status}: ${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
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
- Antworte direkt und prägnant. Überspringe langes Nachdenken (Reasoning) und halte die Denkphase so kurz wie möglich. Komm direkt zum Punkt.

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
 *     summary: CV parsen und optional zentral speichern
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
 *       502: { description: GraphRAG nicht erreichbar }
 */
router.post('/parse', upload.array('file', 10), async (req, res) => {
  const tempFiles = [];
  const persist = parseBoolean(req.query.persist, false);

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

    sendProgress('graphrag_connect', 'CV wird an GraphRAG übergeben...', 40);
    const graphRag = await ingestIntoGraphRag(combinedText.trim(), persist);

    sendProgress('graphrag_done', 'GraphRAG-Analyse abgeschlossen', 75);

    const profile = graphRag.profile || {};
    if (!Array.isArray(profile.work_history) || profile.work_history.length === 0) {
      const recoveredWorkHistory = extractWorkHistoryFromText(combinedText);
      if (recoveredWorkHistory.length > 0) {
        profile.work_history = recoveredWorkHistory;
        if (!profile.current_employer && recoveredWorkHistory[0]?.employer) {
          profile.current_employer = recoveredWorkHistory[0].employer;
        }
        if (!profile.current_position && recoveredWorkHistory[0]?.position) {
          profile.current_position = recoveredWorkHistory[0].position;
        }
        if (!profile.experience) {
          profile.experience = recoveredWorkHistory
            .slice(0, 3)
            .map((entry) => [entry.position, entry.employer].filter(Boolean).join(', '))
            .filter(Boolean)
            .join('\n');
        }
      }
    }
    let localCandidate = null;
    let storedInSqlite = false;
    let storedInNeo4j = Boolean(graphRag.persisted);
    if (persist) {
      sendProgress('sqlite_save', 'Speichere Kandidat in SQLite...', 85);
      try {
        localCandidate = persistCandidate(profile, req);
        storedInSqlite = Boolean(localCandidate);
      } catch (persistErr) {
        return sendError(503, {
          error: 'SQLite-Speicherung fehlgeschlagen',
          details: persistErr.message,
        });
      }
    }

    sendProgress('complete', persist ? 'Kandidat erfolgreich gespeichert' : 'Felder erfolgreich extrahiert', 100);

    sendResult({
      success: true,
      filenames,
      filename: filenames[0],
      candidate: localCandidate || profile,
      profile,
      localCandidate,
      graphRag,
      storage: {
        sqlite: storedInSqlite,
        neo4j: storedInNeo4j,
      },
      textLength: combinedText.length,
      persisted: persist,
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
