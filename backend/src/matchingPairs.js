// Matching-Ergebnisse je Paarung (Bewerber x Stelle) fuer den N:N-Export.
//
// matching_results haelt pro Lauf nur eine gekuerzte Zusammenfassung (die
// besten 100 Paarungen), damit die Historie klein bleibt. Ein Export "alle
// Bewerber x alle Stellen" braucht aber jede Paarung. Diese Tabelle speichert
// deshalb je Methode ('ai' = KI-Matching, 'vector' = 3D-Matching) und
// Paarung genau das letzte Ergebnis. Sie waechst damit hoechstens auf
// (#Bewerber x #Stellen) Zeilen je Methode, egal wie oft gematcht wird.
//
// Bewerber- und Stellen-IDs sind immer die Primaerschluessel aus PostgreSQL
// (candidates.id, jobs.id). Neo4j-Knoten tragen die UUID aus PostgreSQL
// (Spalte uuid); aeltere Knoten sind ueber jobs.graph_job_id bzw.
// candidates.graph_candidate_id(s) verknuepft.
// Zeilen aus GraphRAG werden deshalb hier auf die PostgreSQL-IDs
// zurueckgefuehrt (ID, dann UUID, dann optional eindeutiger Name/Titel);
// nicht zuordenbare Zeilen werden verworfen statt geraten.

const METHODS = ['ai', 'vector'];
const CHUNK_SIZE = 500;
const MAX_TEXT = 1000;
const MAX_LIST_ITEMS = 8;

const readyDatabases = new WeakSet();

function ensureMatchingPairSchema(db) {
  if (readyDatabases.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS matching_pair_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      hard_skill_score REAL,
      soft_skill_score REAL,
      summary TEXT,
      strengths TEXT,
      weaknesses TEXT,
      model TEXT,
      engine TEXT,
      matching_result_id INTEGER REFERENCES matching_results(id) ON DELETE CASCADE,
      matched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (method, candidate_id, job_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_matching_pairs_method_score ON matching_pair_results (method, score DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_matching_pairs_job ON matching_pair_results (job_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_matching_pairs_run ON matching_pair_results (matching_result_id)');
  // Merkt sich, welche Laeufe der Historie schon uebernommen wurden.
  db.exec('ALTER TABLE matching_results ADD COLUMN IF NOT EXISTS pairs_recorded INTEGER DEFAULT 0');
  readyDatabases.add(db);
}

// Scores kommen als 0-100 (Ganzzahl) oder als Anteil 0-1 (Kommazahl).
function toPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = !Number.isInteger(number) && number > 0 && number < 1 ? number * 100 : number;
  return Math.round(Math.max(0, Math.min(100, percent)) * 100) / 100;
}

// Hard-/SoftSkill-Scores liefert GraphRAG immer als Anteil 0-1.
function fractionToPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = number <= 1 ? number * 100 : number;
  return Math.round(Math.max(0, Math.min(100, percent)) * 100) / 100;
}

function shortText(value, max = MAX_TEXT) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function listJson(value) {
  if (!Array.isArray(value)) return null;
  const items = value
    .map(item => shortText(typeof item === 'string' ? item : JSON.stringify(item), 300))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
  return items.length ? JSON.stringify(items) : null;
}

const isNumericId = (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0)
  || (typeof value === 'string' && /^\d+$/.test(value.trim()));
const normalizeKey = (value) => String(value || '').trim().toLowerCase();

function chunks(list, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function selectIn(db, sql, values) {
  const rows = [];
  for (const part of chunks(values, 1000)) {
    rows.push(...db.prepare(sql.replace('(?)', `(${part.map(() => '?').join(',')})`)).all(...part));
  }
  return rows;
}

// Namen/Titel werden nur verwendet, wenn sie eindeutig sind.
function uniqueBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeKey(row[key]);
    if (!name) continue;
    map.set(name, map.has(name) ? null : Number(row.id));
  }
  return map;
}

// Neo4j-UUIDs von Bewerbern: graph_candidate_id ist die zuletzt
// verknuepfte, graph_candidate_ids alle (Dubletten in Neo4j). Eine UUID, die
// zu mehreren Bewerbern gehoert, gilt als nicht eindeutig.
function candidatesByGraphId(db, uuids) {
  if (!uuids.length) return new Map();
  let rows = [];
  try {
    for (const part of chunks(uuids, 1000)) {
      const list = part.map(() => '?').join(',');
      rows.push(...db.prepare(`
        SELECT id, uuid::text AS uuid, graph_candidate_id, graph_candidate_ids FROM candidates
        WHERE uuid::text IN (${list}) OR graph_candidate_id IN (${list}) OR graph_candidate_ids && ARRAY[${list}]::TEXT[]
      `).all(...part, ...part, ...part));
    }
  } catch (_) {
    rows = []; // Spalten fehlen in sehr alten Datenbanken
  }
  const wanted = new Set(uuids);
  const map = new Map();
  for (const row of rows) {
    const ids = new Set([row.uuid, row.graph_candidate_id, ...(Array.isArray(row.graph_candidate_ids) ? row.graph_candidate_ids : [])]);
    for (const uuid of ids) {
      if (!uuid || !wanted.has(uuid)) continue;
      const id = Number(row.id);
      map.set(uuid, map.has(uuid) && map.get(uuid) !== id ? null : id);
    }
  }
  return map;
}

// Neo4j-IDs von Stellen: uuid (kanonisch) oder - bei Altdaten - graph_job_id.
// Eine ID, die zu mehreren Stellen passt, gilt als nicht eindeutig.
function jobsByGraphId(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const wanted = new Set(ids);
  for (const part of chunks(ids, 1000)) {
    const list = part.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, uuid::text AS uuid, graph_job_id FROM jobs WHERE uuid::text IN (${list}) OR graph_job_id IN (${list})`)
      .all(...part, ...part);
    for (const row of rows) {
      for (const key of new Set([row.uuid, row.graph_job_id])) {
        if (!key || !wanted.has(key)) continue;
        const id = Number(row.id);
        map.set(key, map.has(key) && map.get(key) !== id ? null : id);
      }
    }
  }
  return map;
}

// Loest die IDs aller Zeilen eines Laufs gesammelt auf (wenige Abfragen statt
// einer pro Zeile).
function createIdResolver(db, rows, options) {
  const { candidateId, jobId, fallbackJobId, allowNameLookup = false } = options;
  const candidateIds = new Set();
  const candidateUuids = new Set();
  const jobIds = new Set();
  const jobUuids = new Set();
  const names = new Set();
  const titles = new Set();

  for (const row of rows) {
    for (const value of [row?.candidateId, row?.sourceCandidateId, candidateId]) {
      if (isNumericId(value)) candidateIds.add(Number(value));
      else if (value !== null && value !== undefined && String(value).trim()) candidateUuids.add(String(value).trim());
    }
    for (const value of [row?.jobId, row?.sourceJobId, jobId, fallbackJobId]) {
      if (isNumericId(value)) jobIds.add(Number(value));
      else if (value !== null && value !== undefined && String(value).trim()) jobUuids.add(String(value).trim());
    }
    if (allowNameLookup && row?.candidateName) names.add(normalizeKey(row.candidateName));
    if (allowNameLookup && row?.jobTitle) titles.add(normalizeKey(row.jobTitle));
  }

  const knownCandidates = new Set(candidateIds.size
    ? selectIn(db, 'SELECT id FROM candidates WHERE id IN (?)', [...candidateIds]).map(row => Number(row.id))
    : []);
  const candidateByUuid = candidatesByGraphId(db, [...candidateUuids]);
  const knownJobs = new Set(jobIds.size
    ? selectIn(db, 'SELECT id FROM jobs WHERE id IN (?)', [...jobIds]).map(row => Number(row.id))
    : []);
  const jobByUuid = jobsByGraphId(db, [...jobUuids]);
  const candidateByName = names.size
    ? uniqueBy(selectIn(db, 'SELECT id, name FROM candidates WHERE LOWER(name) IN (?)', [...names]), 'name')
    : new Map();
  const jobByTitle = titles.size
    ? uniqueBy(selectIn(db, 'SELECT id, title FROM jobs WHERE LOWER(title) IN (?)', [...titles]), 'title')
    : new Map();

  const resolveCandidateValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (isNumericId(value)) return knownCandidates.has(Number(value)) ? Number(value) : null;
    return candidateByUuid.get(String(value).trim()) ?? null;
  };
  const resolveJobValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (isNumericId(value)) return knownJobs.has(Number(value)) ? Number(value) : null;
    return jobByUuid.get(String(value).trim()) ?? null;
  };

  return {
    candidate(row) {
      if (candidateId !== undefined && candidateId !== null) return resolveCandidateValue(candidateId);
      return resolveCandidateValue(row?.candidateId)
        ?? resolveCandidateValue(row?.sourceCandidateId)
        ?? (allowNameLookup ? candidateByName.get(normalizeKey(row?.candidateName)) ?? null : null);
    },
    job(row) {
      if (jobId !== undefined && jobId !== null) return resolveJobValue(jobId);
      return resolveJobValue(row?.jobId)
        ?? resolveJobValue(row?.sourceJobId)
        ?? (allowNameLookup ? jobByTitle.get(normalizeKey(row?.jobTitle)) ?? null : null)
        ?? resolveJobValue(fallbackJobId);
    },
  };
}

const toIdSet = (values) => (Array.isArray(values) && values.length
  ? new Set(values.filter(isNumericId).map(Number))
  : null);

/**
 * Speichert die Paarungen eines Matching-Laufs. Pro Methode und Paarung
 * bleibt nur das juengste Ergebnis erhalten; aeltere Ergebnisse (z. B. beim
 * Nachtragen der Historie) ueberschreiben neuere nicht.
 *
 * options:
 *   candidateId / jobId   - alle Zeilen gehoeren zu diesem Bewerber / dieser Stelle
 *   fallbackJobId         - Stelle, falls eine Zeile keine eigene traegt
 *   candidateIds / jobIds - nur diese Bewerber / Stellen waren Teil des Laufs
 *   allowNameLookup       - Zuordnung ueber eindeutigen Namen/Titel erlauben
 *   matchingResultId, model, engine, matchedAt
 */
function recordMatchingPairs(db, method, rows, options = {}) {
  if (!METHODS.includes(method)) throw new Error(`Unbekannte Matching-Methode "${method}"`);
  ensureMatchingPairSchema(db);
  const list = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const { matchingResultId = null, model = null, engine = null } = options;
  const matchedAt = new Date(options.matchedAt || Date.now());
  const matchedAtIso = Number.isNaN(matchedAt.getTime()) ? new Date().toISOString() : matchedAt.toISOString();

  let stored = 0;
  let skipped = 0;
  if (list.length) {
    const resolver = createIdResolver(db, list, options);
    const allowedCandidates = toIdSet(options.candidateIds);
    const allowedJobs = toIdSet(options.jobIds);
    const byPair = new Map();

    for (const row of list) {
      const candidate = resolver.candidate(row);
      const job = resolver.job(row);
      const score = toPercent(row.score);
      if (!candidate || !job || score === null
        || (allowedCandidates && !allowedCandidates.has(candidate))
        || (allowedJobs && !allowedJobs.has(job))) {
        skipped += 1;
        continue;
      }
      byPair.set(`${candidate}:${job}`, [
        method,
        candidate,
        job,
        score,
        fractionToPercent(row.hardSkillScore),
        fractionToPercent(row.softSkillScore),
        shortText(row.summary),
        listJson(row.strengths),
        listJson(row.weaknesses),
        shortText(row.model || model, 200),
        method === 'vector' ? shortText(engine, 50) : null,
        matchingResultId,
        matchedAtIso,
      ]);
    }

    for (const part of chunks([...byPair.values()])) {
      const result = db.prepare(`
        INSERT INTO matching_pair_results (
          method, candidate_id, job_id, score, hard_skill_score, soft_skill_score,
          summary, strengths, weaknesses, model, engine, matching_result_id, matched_at
        ) VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
        ON CONFLICT (method, candidate_id, job_id) DO UPDATE SET
          score = EXCLUDED.score,
          hard_skill_score = EXCLUDED.hard_skill_score,
          soft_skill_score = EXCLUDED.soft_skill_score,
          summary = EXCLUDED.summary,
          strengths = EXCLUDED.strengths,
          weaknesses = EXCLUDED.weaknesses,
          model = EXCLUDED.model,
          engine = EXCLUDED.engine,
          matching_result_id = EXCLUDED.matching_result_id,
          matched_at = EXCLUDED.matched_at
        WHERE matching_pair_results.matched_at <= EXCLUDED.matched_at
      `).run(...part.flat());
      stored += result.changes;
    }
  }

  if (matchingResultId) {
    db.prepare('UPDATE matching_results SET pairs_recorded = 1 WHERE id = ?').run(matchingResultId);
  }
  return { stored, skipped };
}

// Ein fehlgeschlagenes Speichern darf das Matching selbst nicht scheitern
// lassen; der Lauf wird dann spaeter aus der Historie nachgetragen.
function recordMatchingPairsSafely(db, method, rows, options) {
  try {
    return recordMatchingPairs(db, method, rows, options);
  } catch (error) {
    console.warn(`Matching-Paarungen (${method}) konnten nicht gespeichert werden:`, error.message);
    return { stored: 0, skipped: Array.isArray(rows) ? rows.length : 0, error: error.message };
  }
}

const VECTOR_TYPES = new Set(['vectormatch', 'vectormatch_neo4j']);

// Ordnet einen gespeicherten Lauf der Historie einer Methode zu.
function classifyStoredRun(row, parsed) {
  const model = String(parsed?.model || '');
  const rows = Array.isArray(parsed?.matrix)
    ? parsed.matrix
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.results?.results) ? parsed.results.results : [];

  let method = 'ai';
  if (model.startsWith('graph-rag') || parsed?.engine || parsed?.embeddingModel || parsed?.direction
    || VECTOR_TYPES.has(parsed?.type) || parsed?.mode === 'vectormatch') {
    method = 'vector';
  } else if (!(parsed?.type === 'matrix' && model) && /^(Vector|Matrix)-Matching/i.test(String(row.job_description || ''))) {
    method = 'vector';
  }

  const engine = method === 'vector' ? (parsed?.engine || (model.includes('neo4j') ? 'neo4j' : 'python')) : null;
  return { method, rows, model: model || null, engine };
}

/**
 * Uebernimmt Laeufe aus matching_results, die noch nicht in
 * matching_pair_results stehen (Laeufe vor Einfuehrung der Tabelle oder
 * Laeufe, deren direktes Speichern fehlgeschlagen ist). Laeuft pro Zeile,
 * damit grosse Altlaeufe nicht alle gleichzeitig im Speicher liegen.
 */
function backfillMatchingPairs(db) {
  ensureMatchingPairSchema(db);
  const pending = db.prepare(
    'SELECT id FROM matching_results WHERE COALESCE(pairs_recorded, 0) = 0 ORDER BY created_at ASC, id ASC'
  ).all();
  let runs = 0;
  let stored = 0;
  for (const { id } of pending) {
    const row = db.prepare('SELECT id, job_id, job_description, results, created_at FROM matching_results WHERE id = ?').get(id);
    if (!row) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(row.results);
    } catch (_) {
      parsed = null;
    }
    const run = classifyStoredRun(row, parsed);
    const direction = parsed?.direction;
    const result = recordMatchingPairsSafely(db, run.method, run.rows, {
      matchingResultId: row.id,
      model: run.model,
      engine: run.engine,
      matchedAt: row.created_at,
      // KI-Laeufe ohne gespeicherte Stelle (freie Stellenbeschreibung) haben
      // keine Stelle im Tool und werden nicht zugeordnet.
      fallbackJobId: run.method === 'ai' || direction === 'job_to_candidates' ? row.job_id : null,
      allowNameLookup: run.method === 'vector',
    });
    if (result.error) {
      // Nicht endlos neu versuchen; der Lauf bleibt in der Historie sichtbar.
      db.prepare('UPDATE matching_results SET pairs_recorded = 1 WHERE id = ?').run(row.id);
    }
    runs += 1;
    stored += result.stored;
  }
  return { runs, stored };
}

module.exports = {
  METHODS,
  backfillMatchingPairs,
  classifyStoredRun,
  ensureMatchingPairSchema,
  recordMatchingPairs,
  recordMatchingPairsSafely,
  toPercent,
};
