// CRM-Import: Das CRM (Axessence) liefert hr-matching-kandidaten.zip mit
// kandidaten.csv und den CVs unter cvs/. Ablauf:
//   1. createImportSession: ZIP ablegen und pruefen (CSV lesen, UUIDs, Labels,
//      CV-Pfade). Ergebnis ist eine Pruefliste je Kandidat.
//   2. importCandidate: je Kandidat CV lesen, von GraphRAG auswerten lassen
//      und den Bewerber mit der CRM-UUID anlegen oder aktualisieren. Der
//      Browser ruft das Kandidat fuer Kandidat auf (Fortschritt, keine
//      stundenlange Anfrage).
// Die CRM-UUID wird zur UUID des Bewerbers: dieselbe ID in CRM, PostgreSQL
// und Neo4j. Details: README, Abschnitt "CRM-Schnittstelle".

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const { parseCsv, unprotectCell } = require('./csv');
const { ZipArchiveError, listEntries, readEntry } = require('./zipArchive');
const { extractText } = require('../utils/documentText');
const cvParser = require('../routes/cv-parser');
const { DuplicateError } = require('../identity');
const { syncGraphCandidatesInBackground } = require('../utils/graphRagCandidate');
const { uploadsDir } = require('../utils/candidateFiles');
const { logAudit } = require('../routes/audit');

const CRM_SOURCE = 'CRM';
const MiB = 1024 * 1024;
const LIMITS = {
  candidates: 10000,
  csvBytes: 32 * MiB,
  cvBytes: 256 * MiB,
  sessionAgeMs: 24 * 60 * 60 * 1000,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CV_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
};
const CSV_COLUMNS = ['UUID', 'Vorname', 'Nachname', 'Labels', 'CV_Dokument'];
const importsDir = path.join(__dirname, '..', '..', 'data', 'crm-imports');

class CrmImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CrmImportError';
    this.status = status;
  }
}

function sessionDir(token) {
  if (!UUID_RE.test(String(token || ''))) throw new CrmImportError('Unbekannter Import', 404);
  const dir = path.join(importsDir, token);
  if (!fs.existsSync(path.join(dir, 'inspection.json'))) {
    throw new CrmImportError('Import nicht gefunden oder abgelaufen – bitte das ZIP erneut hochladen', 404);
  }
  return dir;
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Hochgeladene Archive werden nach einem Tag entfernt.
function cleanupOldSessions(now = Date.now()) {
  if (!fs.existsSync(importsDir)) return;
  const expired = target => now - fs.statSync(target).mtimeMs > LIMITS.sessionAgeMs;
  for (const name of fs.readdirSync(importsDir)) {
    const target = path.join(importsDir, name);
    try {
      // incoming/ enthaelt laufende Uploads; dort nur liegengebliebene Dateien.
      if (name === 'incoming') {
        for (const file of fs.readdirSync(target)) if (expired(path.join(target, file))) fs.rmSync(path.join(target, file), { force: true });
      } else if (expired(target)) {
        removeDir(target);
      }
    } catch (_) { /* gleichzeitig entfernt */ }
  }
}

// Labels kommen als JSON-Array in der CSV-Zelle, z. B. ["Deutsch", "Projektleiter"].
function parseLabels(raw) {
  if (!raw) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch (_) {
    throw new CrmImportError('Labels sind kein gültiges JSON-Array');
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new CrmImportError('Labels sind kein JSON-Array von Texten');
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

// Tags werden im Tool kommagetrennt gespeichert; Labels kommen zu den
// vorhandenen Tags hinzu (nichts geht verloren).
function mergeTags(existing, labels) {
  const tags = String(existing || '').split(',').map(tag => tag.trim()).filter(Boolean);
  const known = new Set(tags.map(tag => tag.toLowerCase()));
  for (const label of labels.map(item => item.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (!known.has(label.toLowerCase())) {
      tags.push(label);
      known.add(label.toLowerCase());
    }
  }
  return tags.length ? tags.join(', ') : null;
}

function validCvPath(raw) {
  const cvPath = String(raw || '').replace(/\\/g, '/').trim();
  if (!cvPath) return { error: 'Kein CV angegeben' };
  if (cvPath.startsWith('/') || /^[a-zA-Z]:/.test(cvPath) || cvPath.split('/').includes('..')) {
    return { error: 'Ungültiger CV-Pfad (nur Pfade innerhalb des Archivs)' };
  }
  const ext = path.posix.extname(cvPath).toLowerCase();
  if (!CV_TYPES[ext]) return { error: `CV-Format ${ext || '(ohne Endung)'} wird nicht unterstützt (PDF, DOCX, DOC)` };
  return { cvPath, ext };
}

function findCandidatesByUuid(uuids) {
  const found = new Map();
  for (let i = 0; i < uuids.length; i += 500) {
    const chunk = uuids.slice(i, i + 500);
    const rows = db.prepare(`SELECT id, uuid::text AS uuid, name FROM candidates WHERE uuid IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
    for (const row of rows) found.set(row.uuid, row);
  }
  return found;
}

// Prueft das Archiv und liefert je CSV-Zeile, was der Import tun wird.
async function inspectArchive(zipPath) {
  const entries = await listEntries(zipPath);
  if (!entries.has('kandidaten.csv')) throw new CrmImportError('kandidaten.csv fehlt im Archiv');
  const csv = await readEntry(zipPath, 'kandidaten.csv', LIMITS.csvBytes);
  let table;
  try {
    table = parseCsv(csv.toString('utf8'));
  } catch (error) {
    throw new CrmImportError(`kandidaten.csv: ${error.message}`);
  }
  if (!table.length) throw new CrmImportError('kandidaten.csv ist leer');

  const header = table[0].map(cell => unprotectCell(cell).trim().toLowerCase());
  const columns = Object.fromEntries(CSV_COLUMNS.map(column => [column, header.indexOf(column.toLowerCase())]));
  const missing = CSV_COLUMNS.filter(column => columns[column] < 0);
  if (missing.length) throw new CrmImportError(`Spalte(n) fehlen in kandidaten.csv: ${missing.join(', ')}`);

  const dataRows = table.slice(1);
  if (dataRows.length > LIMITS.candidates) {
    throw new CrmImportError(`Zu viele Kandidaten (${dataRows.length}); erlaubt sind ${LIMITS.candidates} je Export`);
  }

  const seen = new Map();
  const rows = dataRows.map((cells, index) => {
    const cell = column => unprotectCell(cells[columns[column]] ?? '').trim();
    const row = {
      line: index + 2,
      uuid: cell('UUID').toLowerCase(),
      firstName: cell('Vorname'),
      lastName: cell('Nachname'),
      labels: [],
      cvPath: cell('CV_Dokument'),
      cvSize: null,
      action: null,
      existingId: null,
      existingName: null,
      error: null,
    };
    const fail = (message) => Object.assign(row, { error: message });
    if (!UUID_RE.test(row.uuid)) return fail('UUID fehlt oder ist ungültig');
    if (seen.has(row.uuid)) return fail(`UUID kommt mehrfach vor (auch in Zeile ${seen.get(row.uuid)})`);
    seen.set(row.uuid, row.line);
    try {
      row.labels = parseLabels(cell('Labels'));
    } catch (error) {
      return fail(error.message);
    }
    const cv = validCvPath(row.cvPath);
    if (cv.error) return fail(cv.error);
    row.cvPath = cv.cvPath;
    const entry = entries.get(cv.cvPath);
    if (!entry) return fail(`CV-Datei ${cv.cvPath} fehlt im Archiv`);
    if (entry.size > LIMITS.cvBytes) return fail('CV-Datei ist größer als 256 MiB');
    row.cvSize = entry.size;
    return row;
  });

  const existing = findCandidatesByUuid(rows.filter(row => !row.error).map(row => row.uuid));
  for (const row of rows) {
    if (row.error) continue;
    const candidate = existing.get(row.uuid);
    row.action = candidate ? 'update' : 'new';
    row.existingId = candidate?.id ?? null;
    row.existingName = candidate?.name ?? null;
  }
  return {
    rows,
    summary: {
      total: rows.length,
      new: rows.filter(row => row.action === 'new').length,
      update: rows.filter(row => row.action === 'update').length,
      errors: rows.filter(row => row.error).length,
    },
  };
}

function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

// Legt das hochgeladene ZIP ab und prueft es.
async function createImportSession(uploadedPath, originalName, user) {
  cleanupOldSessions();
  const token = crypto.randomUUID();
  const dir = path.join(importsDir, token);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, 'archive.zip');
  try {
    moveFile(uploadedPath, zipPath);
    const inspection = await inspectArchive(zipPath);
    const session = { token, originalName: originalName || null, createdAt: new Date().toISOString(), userId: user?.id ?? null, ...inspection };
    fs.writeFileSync(path.join(dir, 'inspection.json'), JSON.stringify(session));
    return session;
  } catch (error) {
    removeDir(dir);
    if (error instanceof ZipArchiveError) throw new CrmImportError(error.message);
    throw error;
  }
}

function loadSession(token) {
  const dir = sessionDir(token);
  return { dir, session: JSON.parse(fs.readFileSync(path.join(dir, 'inspection.json'), 'utf8')) };
}

function deleteImportSession(token) {
  removeDir(sessionDir(token));
}

const normalizeText = text => String(text || '').replace(/\s+/g, ' ').trim();

// Das Original-CV landet beim Bewerber unter "Dateien"; ein frueher aus dem
// CRM uebernommenes CV desselben Bewerbers wird ersetzt.
function storeCvFile(candidateId, uuid, name, buffer, ext) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const previous = db.prepare('SELECT id, filename FROM candidate_files WHERE candidate_id = ? AND filename LIKE ?').all(candidateId, `crm-${uuid}-%`);
  const filename = `crm-${uuid}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  db.prepare('INSERT INTO candidate_files (candidate_id, filename, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?)')
    .run(candidateId, filename, `CV ${name}${ext}`, CV_TYPES[ext], buffer.length);
  for (const file of previous) {
    db.prepare('DELETE FROM candidate_files WHERE id = ?').run(file.id);
    try { fs.unlinkSync(path.join(uploadsDir, file.filename)); } catch (_) { /* schon weg */ }
  }
}

// Stammdaten aus dem CRM: UUID, Name, Labels und die Namensteile fuer die
// Rueckgabe. Ein leerer Name aus dem CRM aendert den Namen nicht.
function applyCrmFields(candidate, row, name) {
  db.prepare(`
    UPDATE candidates SET uuid = CAST(? AS UUID), name = ?, tags = ?, source = ?,
      crm_first_name = ?, crm_last_name = ?, crm_imported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.uuid, name, mergeTags(candidate.tags, row.labels), CRM_SOURCE, row.firstName || null, row.lastName || null, candidate.id);
}

// Bei geaendertem CV: neu ausgelesene Angaben uebernehmen. Leere Werte
// ueberschreiben nichts, damit im Tool Ergaenztes erhalten bleibt.
const CV_FIELDS = ['email', 'phone', 'location', 'experience', 'skills', 'education', 'languages', 'certificates',
  'drivers_license', 'mobility', 'linkedin_url', 'xing_url', 'github_url', 'portfolio_url', 'notice_period',
  'nationality', 'current_employer', 'current_position'];

function refreshFromProfile(candidateId, profile, text, name) {
  const row = cvParser.buildCandidateRow(profile);
  db.prepare(`UPDATE candidates SET ${CV_FIELDS.map(field => `${field} = COALESCE(NULLIF(?, ''), ${field})`).join(', ')} WHERE id = ?`)
    .run(...CV_FIELDS.map(field => (row[field] === undefined || row[field] === null ? null : String(row[field]))), candidateId);
  cvParser.writeCandidateHistory(candidateId, profile, { replace: true });
  cvParser.writeCandidateText(candidateId, name, text, profile, CRM_SOURCE);
}

async function readCvText(dir, row) {
  const ext = path.posix.extname(row.cvPath).toLowerCase();
  const buffer = await readEntry(path.join(dir, 'archive.zip'), row.cvPath, LIMITS.cvBytes);
  if (!buffer) throw new CrmImportError(`CV-Datei ${row.cvPath} fehlt im Archiv`, 422);
  const tempFile = path.join(dir, `cv-${row.uuid}${ext}`);
  fs.writeFileSync(tempFile, buffer);
  try {
    const text = String(await extractText(tempFile, CV_TYPES[ext]) || '').trim();
    if (text.length < 20) throw new CrmImportError('Im CV wurde kein lesbarer Text gefunden', 422);
    return { text, buffer, ext };
  } catch (error) {
    if (error instanceof CrmImportError) throw error;
    throw new CrmImportError(`CV konnte nicht gelesen werden: ${error.message}`, 422);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

function crmName(row) {
  return [row.firstName, row.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// Neuer Bewerber. Gibt es dieselbe Person (Name + Geburtsdatum) schon im
// Tool ohne CRM-Bezug, wird sie mit der CRM-UUID verknuepft statt doppelt
// angelegt. Fuehrt das CRM sie dagegen unter einer anderen UUID, sind es
// laut CRM zwei Personen: dann ohne Geburtsdatum anlegen.
function createCandidate(row, profile, text, req) {
  try {
    return { status: 'created', candidate: cvParser.persistCandidate(profile, req, text, { syncGraph: false, textSource: CRM_SOURCE }) };
  } catch (error) {
    if (!(error instanceof DuplicateError)) throw error;
    const other = db.prepare('SELECT * FROM candidates WHERE id = ?').get(error.existing?.id);
    if (other && other.source !== CRM_SOURCE) {
      if (!db.prepare('SELECT 1 AS found FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').get(other.id)) {
        cvParser.writeCandidateText(other.id, profile.name, text, profile, CRM_SOURCE);
      }
      return { status: 'linked', candidate: other };
    }
    return {
      status: 'created',
      warning: `Gleicher Name und Geburtsdatum wie Bewerber #${error.existing?.id} (andere CRM-UUID). Das CRM führt beide als verschiedene Personen; das Geburtsdatum wurde nicht übernommen.`,
      candidate: cvParser.persistCandidate({ ...profile, birth_date: null }, req, text, { syncGraph: false, textSource: CRM_SOURCE }),
    };
  }
}

// Importiert einen Kandidaten der Pruefliste.
async function importCandidate(token, uuid, req) {
  const { dir, session } = loadSession(token);
  const row = session.rows.find(item => item.uuid === String(uuid || '').toLowerCase());
  if (!row) throw new CrmImportError('Diese UUID gehört nicht zu diesem Import', 404);
  if (row.error) throw new CrmImportError(row.error, 422);

  const { text, buffer, ext } = await readCvText(dir, row);
  const existing = db.prepare('SELECT * FROM candidates WHERE uuid = ?').get(row.uuid);

  let status;
  let warning = null;
  let candidate;
  if (existing) {
    const stored = db.prepare('SELECT original_text FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').get(existing.id);
    const name = crmName(row) || existing.name;
    const cvChanged = !stored || normalizeText(stored.original_text) !== normalizeText(text);
    if (cvChanged) {
      const { profile } = await cvParser.parseCvProfile(text, row.cvPath, req);
      refreshFromProfile(existing.id, profile, text, name);
      storeCvFile(existing.id, row.uuid, name, buffer, ext);
    }
    applyCrmFields(existing, row, name);
    status = cvChanged ? 'updated' : 'unchanged';
    candidate = existing;
    logAudit(req, 'aktualisiert', 'Candidate', existing.id, name, `CRM-Import (${status === 'updated' ? 'neues CV' : 'Stammdaten'})`);
  } else {
    const { profile } = await cvParser.parseCvProfile(text, row.cvPath, req);
    if (crmName(row)) profile.name = crmName(row);
    if (!String(profile.name || '').trim()) {
      throw new CrmImportError('Kein Name: weder im CRM noch im CV angegeben', 422);
    }
    ({ status, warning = null, candidate } = createCandidate(row, profile, text, req));
    try {
      applyCrmFields(candidate, row, crmName(row) || candidate.name);
    } catch (error) {
      if (status === 'created') db.prepare('DELETE FROM candidates WHERE id = ?').run(candidate.id);
      throw error;
    }
    storeCvFile(candidate.id, row.uuid, crmName(row) || candidate.name, buffer, ext);
    if (status === 'linked') logAudit(req, 'aktualisiert', 'Candidate', candidate.id, candidate.name, `Mit CRM-UUID ${row.uuid} verknüpft`);
  }

  // Erst jetzt traegt der Bewerber die CRM-UUID, die auch der Neo4j-Knoten erhaelt.
  syncGraphCandidatesInBackground([candidate.id], req);
  const saved = db.prepare('SELECT id, uuid::text AS uuid, name, tags FROM candidates WHERE id = ?').get(candidate.id);
  return { uuid: row.uuid, status, warning, candidate: saved };
}

module.exports = {
  CRM_SOURCE,
  CrmImportError,
  LIMITS,
  cleanupOldSessions,
  createImportSession,
  deleteImportSession,
  importCandidate,
  importsDir,
  inspectArchive,
  mergeTags,
  parseLabels,
};
