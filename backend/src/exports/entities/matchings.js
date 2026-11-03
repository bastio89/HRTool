// Export-Entitaeten "KI-Matching" und "3D-Matching": N:N-Abzug aller
// gespeicherten Matching-Ergebnisse, eine Zeile je Paarung Bewerber x Stelle.
// Grundlage ist matching_pair_results (letztes Ergebnis je Paarung, siehe
// src/matchingPairs.js). Mit score_above landen nur Paarungen im Export,
// deren Matchingwert groesser als der angegebene Prozentwert ist.

const { ExportValidationError } = require('../errors');
const { backfillMatchingPairs, ensureMatchingPairSchema } = require('../../matchingPairs');

const JOB_STATUSES = ['Offen', 'Besetzt', 'Pausiert', 'Archiviert'];
const CANDIDATE_STATUSES = ['Aktiv', 'Passiv', 'In Prozess', 'Blacklist'];

const toArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map(item => String(item).trim())
    .filter(Boolean);
};

const placeholders = (values) => values.map(() => '?').join(',');

function parseList(text) {
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

const field = (key, label, group, value, type = 'string') => ({ key, label, group, type, value });

const CANDIDATE_FIELDS = [
  field('candidate_id', 'Bewerber-ID', 'Bewerber', row => row.candidate_id, 'number'),
  field('candidate_uuid', 'Bewerber-UUID (GraphRAG/Neo4j)', 'Bewerber', row => row.candidate_uuid ?? null),
  field('candidate_name', 'Name', 'Bewerber', row => row.candidate_name ?? null),
  field('candidate_email', 'E-Mail', 'Bewerber', row => row.candidate_email ?? null),
  field('candidate_location', 'Wohnort', 'Bewerber', row => row.candidate_location ?? null),
  field('candidate_status', 'Status', 'Bewerber', row => row.candidate_status ?? null),
];

const JOB_FIELDS = [
  field('job_id', 'Stellen-ID', 'Stelle', row => row.job_id, 'number'),
  field('job_uuid', 'Stellen-UUID (GraphRAG/Neo4j)', 'Stelle', row => row.job_uuid ?? null),
  field('job_title', 'Stellentitel', 'Stelle', row => row.job_title ?? null),
  field('job_company', 'Unternehmen', 'Stelle', row => row.job_company ?? null),
  field('job_location', 'Standort', 'Stelle', row => row.job_location ?? null),
  field('job_status', 'Status', 'Stelle', row => row.job_status ?? null),
];

const RESULT_FIELDS = [
  field('score', 'Matchingwert (%)', 'Matching', row => row.score, 'number'),
  field('summary', 'Zusammenfassung', 'Matching', row => row.summary ?? null),
  field('strengths', 'Stärken', 'Matching', row => parseList(row.strengths), 'list'),
  field('weaknesses', 'Schwächen', 'Matching', row => parseList(row.weaknesses), 'list'),
  field('model', 'Modell', 'Matching', row => row.model ?? null),
  field('matched_at', 'Gematcht am', 'Matching', row => row.matched_at ?? null, 'datetime'),
  field('matching_result_id', 'Matching-Lauf (Historien-ID)', 'Matching', row => row.matching_result_id ?? null, 'number'),
];

const VECTOR_FIELDS = [
  field('hard_skill_score', 'HardSkill-Score (%)', 'Matching', row => row.hard_skill_score ?? null, 'number'),
  field('soft_skill_score', 'SoftSkill-Score (%)', 'Matching', row => row.soft_skill_score ?? null, 'number'),
  field('engine', 'Engine (python / neo4j)', 'Matching', row => row.engine ?? null),
];

const FILTERS = [
  { key: 'score_above', type: 'number', min: 0, max: 100, unit: '%', primary: true, label: 'Nur Matchingwert größer als (%)' },
  { key: 'job_ids', type: 'list', label: 'Nur diese Stellen-IDs' },
  { key: 'candidate_ids', type: 'list', label: 'Nur diese Bewerber-IDs' },
  { key: 'job_status', type: 'list', options: JOB_STATUSES, label: 'Status der Stelle (einer davon)' },
  { key: 'candidate_status', type: 'list', options: CANDIDATE_STATUSES, label: 'Status des Bewerbers (einer davon)' },
  { key: 'updated_since', type: 'datetime', label: 'Gematcht seit (für inkrementelle Abzüge)' },
];

function parseThreshold(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(',', '.').replace('%', '').trim());
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new ExportValidationError('Der Matchingwert muss eine Zahl zwischen 0 und 100 sein');
  }
  return number;
}

function buildWhere(method, filters = {}) {
  const conditions = ['mp.method = ?'];
  const params = [method];

  const threshold = parseThreshold(filters.score_above);
  if (threshold !== null) {
    conditions.push('mp.score > ?');
    params.push(threshold);
  }

  for (const [key, column] of [['job_ids', 'mp.job_id'], ['candidate_ids', 'mp.candidate_id']]) {
    const requested = toArray(filters[key]);
    if (!requested.length) continue;
    // Eine Auswahl ohne gueltige ID darf nicht zu "alle" werden.
    const ids = requested.map(Number).filter(Number.isInteger);
    conditions.push(ids.length ? `${column} IN (${placeholders(ids)})` : '1 = 0');
    params.push(...ids);
  }

  const jobStatuses = toArray(filters.job_status);
  if (jobStatuses.length) {
    conditions.push(`COALESCE(j.status, 'Offen') IN (${placeholders(jobStatuses)})`);
    params.push(...jobStatuses);
  }
  const candidateStatuses = toArray(filters.candidate_status);
  if (candidateStatuses.length) {
    conditions.push(`COALESCE(c.status, 'Aktiv') IN (${placeholders(candidateStatuses)})`);
    params.push(...candidateStatuses);
  }

  if (filters.updated_since && !Number.isNaN(Date.parse(filters.updated_since))) {
    conditions.push('mp.matched_at >= ?');
    params.push(filters.updated_since);
  }

  return { where: ` WHERE ${conditions.join(' AND ')}`, params };
}

const FROM = `
  FROM matching_pair_results mp
  JOIN candidates c ON c.id = mp.candidate_id
  JOIN jobs j ON j.id = mp.job_id
`;

// Vor jedem Abzug werden Laeufe aus der Historie nachgetragen, die noch
// nicht in matching_pair_results stehen (z. B. Laeufe vor diesem Update).
function prepare(db) {
  ensureMatchingPairSchema(db);
  backfillMatchingPairs(db);
}

function createMatchingEntity({ key, label, description, method, extraFields, defaultFields }) {
  const fields = [...CANDIDATE_FIELDS, ...JOB_FIELDS, ...RESULT_FIELDS, ...extraFields];
  return {
    key,
    label,
    description,
    method,
    auditEntity: 'Matching',
    defaultFormat: 'csv',
    filters: FILTERS,
    defaultFields,

    fields() {
      return fields;
    },

    count(db, filters) {
      prepare(db);
      const { where, params } = buildWhere(method, filters);
      return Number(db.prepare(`SELECT COUNT(*) AS count ${FROM}${where}`).get(...params)?.count) || 0;
    },

    load(db, filters, { limit, offset } = {}) {
      prepare(db);
      const { where, params } = buildWhere(method, filters);
      let sql = `
        SELECT mp.*,
          c.name AS candidate_name, c.graph_candidate_id AS candidate_uuid,
          c.email AS candidate_email, c.location AS candidate_location,
          COALESCE(c.status, 'Aktiv') AS candidate_status,
          j.title AS job_title, j.graph_job_id AS job_uuid, j.company AS job_company,
          j.location AS job_location, COALESCE(j.status, 'Offen') AS job_status
        ${FROM}${where}
        ORDER BY mp.score DESC, mp.candidate_id ASC, mp.job_id ASC
      `;
      if (limit > 0) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, Math.max(0, offset || 0));
      }
      return db.prepare(sql).all(...params);
    },

    loadRelated() {
      return {};
    },
  };
}

const aiMatchingEntity = createMatchingEntity({
  key: 'matching_ai',
  label: 'KI-Matching (Bewerber × Stellen)',
  description: 'Letztes KI-Matching-Ergebnis je Paarung aus Bewerber und Stelle.',
  method: 'ai',
  extraFields: [],
  defaultFields: ['candidate_id', 'candidate_name', 'job_id', 'job_title', 'score', 'summary', 'matched_at'],
});

const vectorMatchingEntity = createMatchingEntity({
  key: 'matching_vector',
  label: '3D-Matching (Bewerber × Stellen)',
  description: 'Letztes 3D-Matching-Ergebnis (Skill-Vektoren) je Paarung aus Bewerber und Stelle.',
  method: 'vector',
  extraFields: VECTOR_FIELDS,
  defaultFields: ['candidate_id', 'candidate_name', 'job_id', 'job_title', 'score', 'hard_skill_score', 'soft_skill_score', 'matched_at'],
});

module.exports = { aiMatchingEntity, vectorMatchingEntity, FILTERS };
