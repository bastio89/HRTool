// Eindeutige Identitaet von Bewerbern und Stellen.
//
// Fachliche Regeln (vom Fachbereich festgelegt):
//   - Eine Person gibt es genau einmal: gleicher Name UND gleiches
//     Geburtsdatum = dieselbe Person. Das Geburtsdatum ist beim Anlegen
//     Pflicht. Ein Treffer blockiert das Anlegen.
//   - Eine Stelle gibt es genau einmal: gleiche URL ODER gleicher Titel bei
//     gleicher Firma und gleichem Ort = dieselbe Stelle.
//
// Jeder Bewerber und jede Stelle traegt ausserdem eine UUID (Spalte uuid),
// die PostgreSQL vergibt und eindeutig haelt. GraphRAG/Neo4j verwendet fuer
// seine Knoten genau diese UUID, damit beide Datenbanken dieselbe ID kennen.
//
// Die Pruefung hier wird von allen Anlegewegen des Backends genutzt; die
// Eindeutigkeitsindizes in PostgreSQL sind die letzte Sicherung, auch gegen
// gleichzeitige Anfragen und gegen Anlegewege ausserhalb des Backends.

// Gleiche Normalisierung in SQL und JS: Leerraum zusammenfassen, trimmen,
// Kleinschreibung. Die Ausdruecke sind IMMUTABLE und taugen fuer Indizes.
const textKey = (column) => `lower(regexp_replace(btrim(COALESCE(${column}, '')), '\\s+', ' ', 'g'))`;
// Protokoll, "www." und abschliessende Schraegstriche spielen fuer die
// Identitaet einer Stellen-URL keine Rolle.
const urlKey = (column) => `regexp_replace(lower(btrim(${column})), '^https?://(www\\.)?|/+$', '', 'g')`;

const IDENTITY_INDEXES = [
  {
    key: 'candidates_uuid',
    label: 'Bewerber: UUID',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_uuid ON candidates (uuid)',
  },
  {
    key: 'jobs_uuid',
    label: 'Stellen: UUID',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_uuid ON jobs (uuid)',
  },
  {
    key: 'candidates_identity',
    label: 'Bewerber: Name + Geburtsdatum',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_identity ON candidates ((${textKey('name')}), birth_date) WHERE birth_date IS NOT NULL`,
  },
  {
    key: 'jobs_url',
    label: 'Stellen: URL',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_url ON jobs ((${urlKey('url')})) WHERE url IS NOT NULL AND btrim(url) <> ''`,
  },
  {
    key: 'jobs_identity',
    label: 'Stellen: Titel + Firma + Ort',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_identity ON jobs ((${textKey('title')}), (${textKey('company')}), (${textKey('location')}))`,
  },
];

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

class IdentityValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'IdentityValidationError';
    this.status = 400;
    this.field = field;
  }
}

class DuplicateError extends Error {
  constructor(entity, reason, existing) {
    super(entity === 'candidate'
      ? `Diese Person ist bereits im Tool angelegt: ${existing?.name || 'Bewerber'} (ID ${existing?.id})`
      : `Diese Stelle ist bereits im Tool angelegt: ${existing?.title || 'Stelle'} (ID ${existing?.id})`);
    this.name = 'DuplicateError';
    this.status = 409;
    this.code = entity === 'candidate' ? 'DUPLICATE_CANDIDATE' : 'DUPLICATE_JOB';
    this.entity = entity;
    this.reason = reason;
    this.existing = existing;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      reason: this.reason,
      existing: this.existing,
    };
  }
}

// Akzeptiert JJJJ-MM-TT, TT.MM.JJJJ (auch einstellig) und TT/MM/JJJJ.
// Liefert JJJJ-MM-TT oder null; ungueltige Angaben werfen einen Fehler.
function normalizeBirthDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
    if (!match) throw new IdentityValidationError(`Ungültiges Geburtsdatum "${text}" (erwartet TT.MM.JJJJ oder JJJJ-MM-TT)`, 'birth_date');
    [, day, month, year] = match;
  }
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new IdentityValidationError(`Ungültiges Geburtsdatum "${text}"`, 'birth_date');
  }
  const today = new Date();
  if (y < 1900 || date.getTime() > today.getTime()) {
    throw new IdentityValidationError(`Unplausibles Geburtsdatum "${text}"`, 'birth_date');
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Pflichtangaben fuer das Anlegen eines Bewerbers.
function requireCandidateIdentity(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new IdentityValidationError('Name ist erforderlich', 'name');
  const birthDate = normalizeBirthDate(input.birth_date);
  if (!birthDate) {
    throw new IdentityValidationError('Geburtsdatum ist erforderlich – Name und Geburtsdatum machen eine Person im Tool eindeutig', 'birth_date');
  }
  return { name, birth_date: birthDate };
}

function findCandidateDuplicate(db, { name, birth_date: birthDate, excludeId = null }) {
  if (!name || !birthDate) return null;
  const params = [String(name), birthDate];
  let sql = `
    SELECT id, uuid, name, birth_date, email FROM candidates
    WHERE ${textKey('name')} = ${textKey('CAST(? AS TEXT)')} AND birth_date = CAST(? AS DATE)
  `;
  if (excludeId !== null && excludeId !== undefined) {
    sql += ' AND id <> ?';
    params.push(Number(excludeId));
  }
  const row = db.prepare(`${sql} ORDER BY id LIMIT 1`).get(...params);
  return row || null;
}

function assertNoCandidateDuplicate(db, input) {
  const existing = findCandidateDuplicate(db, input);
  if (existing) throw new DuplicateError('candidate', 'name_birth_date', existing);
}

function findJobDuplicate(db, { url, title, company, location, excludeId = null }) {
  const exclude = excludeId !== null && excludeId !== undefined;
  const excludeSql = exclude ? ' AND id <> ?' : '';
  const excludeParams = exclude ? [Number(excludeId)] : [];
  if (url && String(url).trim()) {
    const row = db.prepare(`
      SELECT id, uuid, title, company, location, url FROM jobs
      WHERE url IS NOT NULL AND btrim(url) <> '' AND ${urlKey('url')} = ${urlKey('CAST(? AS TEXT)')}${excludeSql}
      ORDER BY id LIMIT 1
    `).get(String(url), ...excludeParams);
    if (row) return { reason: 'url', existing: row };
  }
  if (title && String(title).trim()) {
    const row = db.prepare(`
      SELECT id, uuid, title, company, location, url FROM jobs
      WHERE ${textKey('title')} = ${textKey('CAST(? AS TEXT)')}
        AND ${textKey('company')} = ${textKey('CAST(? AS TEXT)')}
        AND ${textKey('location')} = ${textKey('CAST(? AS TEXT)')}${excludeSql}
      ORDER BY id LIMIT 1
    `).get(String(title), company ?? null, location ?? null, ...excludeParams);
    if (row) return { reason: 'title_company_location', existing: row };
  }
  return null;
}

function assertNoJobDuplicate(db, input) {
  const hit = findJobDuplicate(db, input);
  if (hit) throw new DuplicateError('job', hit.reason, hit.existing);
}

// Verletzt ein INSERT/UPDATE trotz Vorpruefung einen Eindeutigkeitsindex
// (z. B. zwei gleichzeitige Anfragen), wird daraus dieselbe Meldung.
function translateUniqueViolation(db, error, entity, input) {
  if (error?.code !== '23505') return error;
  const constraint = String(error.constraint || error.message || '');
  if (entity === 'candidate' && constraint.includes('uq_candidates_identity')) {
    return new DuplicateError('candidate', 'name_birth_date', findCandidateDuplicate(db, input) || {});
  }
  if (entity === 'job' && (constraint.includes('uq_jobs_url') || constraint.includes('uq_jobs_identity'))) {
    const hit = findJobDuplicate(db, input);
    return new DuplicateError('job', hit?.reason || (constraint.includes('uq_jobs_url') ? 'url' : 'title_company_location'), hit?.existing || {});
  }
  return error;
}

// Antwortet einheitlich auf Identitaetsfehler; liefert false, wenn der Fehler
// nicht dazugehoert und der Aufrufer ihn selbst behandeln muss.
function sendIdentityError(res, error) {
  if (error instanceof DuplicateError) {
    res.status(409).json(error.toJSON());
    return true;
  }
  if (error instanceof IdentityValidationError) {
    res.status(400).json({ error: error.message, field: error.field });
    return true;
  }
  return false;
}

function enableIdentityIndexes(db) {
  const status = {};
  for (const index of IDENTITY_INDEXES) {
    try {
      db.exec(index.sql);
      status[index.key] = { label: index.label, active: true };
    } catch (error) {
      // Typisch: Es gibt noch Dubletten im Bestand. Sie werden in der
      // Dubletten-Uebersicht bereinigt; danach wird der Index angelegt.
      status[index.key] = { label: index.label, active: false, error: error.message };
    }
  }
  return status;
}

function identityIndexStatus(db) {
  const names = {
    candidates_uuid: 'uq_candidates_uuid',
    jobs_uuid: 'uq_jobs_uuid',
    candidates_identity: 'uq_candidates_identity',
    jobs_url: 'uq_jobs_url',
    jobs_identity: 'uq_jobs_identity',
  };
  const existing = new Set(db.prepare(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE 'uq\\_%'"
  ).all().map(row => row.indexname));
  return IDENTITY_INDEXES.map(index => ({ key: index.key, label: index.label, active: existing.has(names[index.key]) }));
}

// UUID-Spalten anlegen und befuellen. Wo GraphRAG bereits eine eindeutige
// UUID vergeben hat, wird sie uebernommen, damit Postgres und Neo4j dieselbe
// ID tragen.
function ensureUuidColumn(db, table, graphColumn) {
  db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS uuid UUID`);
  // CASE statt WHERE-Bedingung: nur gueltige UUIDs werden gecastet.
  db.exec(`
    WITH graph AS (
      SELECT id, CASE WHEN ${graphColumn} ~ '${UUID_PATTERN}' THEN ${graphColumn}::uuid END AS graph_uuid
      FROM ${table}
    ), single AS (
      SELECT graph_uuid FROM graph WHERE graph_uuid IS NOT NULL GROUP BY graph_uuid HAVING COUNT(*) = 1
    )
    UPDATE ${table} t SET uuid = g.graph_uuid
    FROM graph g JOIN single s ON s.graph_uuid = g.graph_uuid
    WHERE t.id = g.id AND t.uuid IS NULL
      AND NOT EXISTS (SELECT 1 FROM ${table} o WHERE o.uuid = g.graph_uuid)
  `);
  db.exec(`UPDATE ${table} SET uuid = gen_random_uuid() WHERE uuid IS NULL`);
  db.exec(`ALTER TABLE ${table} ALTER COLUMN uuid SET DEFAULT gen_random_uuid()`);
  db.exec(`ALTER TABLE ${table} ALTER COLUMN uuid SET NOT NULL`);
}

function ensureIdentitySchema(db) {
  db.exec('ALTER TABLE candidates ADD COLUMN IF NOT EXISTS birth_date DATE');
  ensureUuidColumn(db, 'candidates', 'graph_candidate_id');
  ensureUuidColumn(db, 'jobs', 'graph_job_id');
  const status = enableIdentityIndexes(db);
  for (const [key, entry] of Object.entries(status)) {
    if (!entry.active) {
      console.warn(`⚠️  Eindeutigkeitsregel "${entry.label}" (${key}) ist noch nicht aktiv: ${entry.error}. Bitte Dubletten unter Administration → Dubletten bereinigen.`);
    }
  }
  return status;
}

module.exports = {
  DuplicateError,
  IdentityValidationError,
  assertNoCandidateDuplicate,
  assertNoJobDuplicate,
  enableIdentityIndexes,
  ensureIdentitySchema,
  findCandidateDuplicate,
  findJobDuplicate,
  identityIndexStatus,
  normalizeBirthDate,
  requireCandidateIdentity,
  sendIdentityError,
  textKey,
  translateUniqueViolation,
  urlKey,
};
