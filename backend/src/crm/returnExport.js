// Rueckgabe-CSV an das CRM: je CRM-Kandidat und Stelle eine Zeile mit dem
// letzten Matching-Ergebnis (KI oder 3D, getrennte Dateien). Das CRM
// uebernimmt eine Datei nur ganz oder gar nicht; deshalb kommt hier nur
// hinein, was die CRM-Pruefung besteht. Alles andere wird mit Grund
// ausgewiesen. Format: README, Abschnitt "CRM-Schnittstelle".

const { toCsv } = require('./csv');
const { CRM_SOURCE } = require('./candidateImport');
const { backfillMatchingPairs, ensureMatchingPairSchema } = require('../matchingPairs');
const { extractJobSalary } = require('./salary');

const METHODS = { ai: 'KI-Matching', vector: '3D-Matching' };
const HEADER = ['UUID', 'Vorname', 'Nachname', 'Firma', 'Stelle', 'URL', 'Matching', 'Bewerbungsdatum', 'Startdatum', 'Ort', 'Lohnvorstellung', 'Anforderungen', 'Status'];
const LIMITS = {
  rows: 5000,
  // 5 MiB je Datei laut CRM; etwas Reserve fuer Kodierungsunterschiede.
  bytes: 5 * 1024 * 1024 - 4096,
  text: 20000,
};

class CrmExportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CrmExportError';
    this.status = status;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à', ndash: '–', mdash: '—', bull: '•', hellip: '…' };

// Stellentexte koennen HTML enthalten (z. B. aus jobs.ch). Das CRM lehnt
// < und > ab: Tags werden zu Text, verbleibende Zeichen ersetzt.
function plainText(value) {
  let text = String(value ?? '');
  if (/<[a-z!/][^>]*>/i.test(text)) {
    text = text
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '\n• ')
      .replace(/<\s*\/\s*(p|div|ul|ol|h[1-6]|tr|table|section)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '');
  }
  text = text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : match;
      }
      return ENTITIES[code] ?? match;
    })
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function limitText(text, max = LIMITS.text) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Absolute http(s)-URL ohne Zugangsdaten, unveraendert wie gespeichert.
function urlProblem(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return 'Stelle ohne URL';
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return 'URL der Stelle ist ungültig';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'URL der Stelle ist keine http(s)-Adresse';
  if (parsed.username || parsed.password) return 'URL der Stelle enthält Zugangsdaten';
  if (/[<>]/.test(url)) return 'URL der Stelle enthält < oder >';
  return null;
}

function formatScore(score) {
  const value = Math.max(0, Math.min(100, Number(score)));
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function parseThreshold(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(',', '.').replace('%', '').trim());
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new CrmExportError('Der Matchingwert muss eine Zahl zwischen 0 und 100 sein');
  }
  return number;
}

function loadPairs(db, method, threshold) {
  ensureMatchingPairSchema(db);
  backfillMatchingPairs(db);
  const params = [method, CRM_SOURCE];
  let where = 'mp.method = ? AND c.source = ?';
  if (threshold !== null) {
    where += ' AND mp.score > ?';
    params.push(threshold);
  }
  return db.prepare(`
    SELECT mp.score, mp.candidate_id, mp.job_id,
      c.uuid::text AS candidate_uuid, c.name AS candidate_name, c.crm_first_name, c.crm_last_name,
      j.title, j.company, j.url, j.location, j.salary, j.requirements, j.description, j.benefits, j.about_us, j.raw_text
    FROM matching_pair_results mp
    JOIN candidates c ON c.id = mp.candidate_id
    JOIN jobs j ON j.id = mp.job_id
    WHERE ${where}
    ORDER BY c.uuid, mp.score DESC, j.id
  `).all(...params);
}

// Zeilen der Rueckgabe und ausgeschlossene Paarungen mit Grund.
function buildReturnRows(db, { method, scoreAbove } = {}) {
  if (!METHODS[method]) throw new CrmExportError('Methode muss "ai" (KI-Matching) oder "vector" (3D-Matching) sein');
  const threshold = parseThreshold(scoreAbove);
  const rows = [];
  const excluded = [];
  const seen = new Set();

  for (const pair of loadPairs(db, method, threshold)) {
    const company = plainText(pair.company);
    const title = plainText(pair.title);
    const reasons = [];
    if (!company) reasons.push('Stelle ohne Firma');
    if (!title) reasons.push('Stelle ohne Titel');
    const urlIssue = urlProblem(pair.url);
    if (urlIssue) reasons.push(urlIssue);
    const url = String(pair.url ?? '').trim();
    const key = `${pair.candidate_uuid}|${url}`;
    if (!reasons.length && seen.has(key)) reasons.push('Gleiche URL bei einer zweiten Stelle');
    if (reasons.length) {
      excluded.push({ candidateId: pair.candidate_id, candidateName: pair.candidate_name, jobId: pair.job_id, jobTitle: pair.title, score: pair.score, reasons });
      continue;
    }
    seen.add(key);
    const requirements = plainText(pair.requirements) || plainText(pair.description);
    const salary = plainText(pair.salary) || extractJobSalary([pair.raw_text, pair.description, pair.requirements, pair.benefits, pair.about_us]) || '';
    rows.push([
      pair.candidate_uuid.toLowerCase(),
      limitText(plainText(pair.crm_first_name)),
      limitText(plainText(pair.crm_last_name)),
      limitText(company),
      limitText(title),
      url,
      formatScore(pair.score),
      '',
      '',
      limitText(plainText(pair.location)),
      limitText(salary),
      limitText(requirements),
      '',
    ]);
  }
  return { method, threshold, rows, excluded };
}

// Teilt die Zeilen so auf, dass jede Datei hoechstens 5000 Datenzeilen und
// knapp 5 MiB hat. Eine Person bleibt moeglichst in einer Datei.
function splitIntoParts(rows) {
  const headerBytes = Buffer.byteLength(toCsv([HEADER]), 'utf8');
  const parts = [];
  let current = [];
  let bytes = headerBytes;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(toCsv([row], { bom: false }), 'utf8');
    if (current.length && (current.length >= LIMITS.rows || bytes + rowBytes > LIMITS.bytes)) {
      parts.push(current);
      current = [];
      bytes = headerBytes;
    }
    current.push(row);
    bytes += rowBytes;
  }
  if (current.length) parts.push(current);
  return parts;
}

function previewReturn(db, options) {
  const { method, threshold, rows, excluded } = buildReturnRows(db, options);
  const parts = splitIntoParts(rows);
  const reasonCounts = {};
  for (const entry of excluded) for (const reason of entry.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  return {
    method,
    methodLabel: METHODS[method],
    threshold,
    rowCount: rows.length,
    candidateCount: new Set(rows.map(row => row[0])).size,
    parts: parts.map((part, index) => ({ part: index + 1, rows: part.length })),
    excludedCount: excluded.length,
    excludedReasons: reasonCounts,
    excluded: excluded.slice(0, 200),
    sample: rows.slice(0, 5).map(row => Object.fromEntries(HEADER.map((column, index) => [column, row[index]]))),
  };
}

function renderReturnCsv(db, { part = 1, ...options } = {}) {
  const { method, rows } = buildReturnRows(db, options);
  if (!rows.length) throw new CrmExportError('Keine Zeilen für die Rückgabe: es gibt kein passendes Matching von CRM-Kandidaten', 404);
  const parts = splitIntoParts(rows);
  const index = Number(part) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= parts.length) throw new CrmExportError(`Teil ${part} gibt es nicht (1 bis ${parts.length})`, 404);
  const suffix = parts.length > 1 ? `-teil-${index + 1}-von-${parts.length}` : '';
  return {
    filename: `hr-matching-rueckgabe-${method === 'ai' ? 'ki' : '3d'}${suffix}.csv`,
    content: toCsv([HEADER, ...parts[index]]),
    rows: parts[index].length,
  };
}

module.exports = { CrmExportError, HEADER, LIMITS, METHODS, buildReturnRows, plainText, previewReturn, renderReturnCsv, splitIntoParts, urlProblem };
