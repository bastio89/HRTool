// Export-Entitaet "Bewerber": welche Felder exportierbar sind, wie sie
// gelesen werden und nach welchen Kriterien sich der Datenabzug eingrenzen
// laesst. Verwandte Daten (Werdegang, Ausbildung, Pipeline, Zusatzfelder)
// werden nur geladen, wenn ein ausgewaehltes Feld sie braucht.

const splitList = (value) => String(value || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

const column = (key, label, group, extra = {}) => ({
  key, label, group, type: 'string', value: row => row[key] ?? null, ...extra,
});

const BASE_FIELDS = [
  column('id', 'Interne ID', 'Stammdaten', { type: 'number' }),
  column('gender', 'Anrede / Geschlecht', 'Stammdaten'),
  column('name', 'Name (vollständig)', 'Stammdaten'),
  { key: 'first_name', label: 'Vorname (abgeleitet)', group: 'Stammdaten', type: 'string', value: row => splitName(row.name).first || null },
  { key: 'last_name', label: 'Nachname (abgeleitet)', group: 'Stammdaten', type: 'string', value: row => splitName(row.name).last || null },
  column('email', 'E-Mail', 'Stammdaten'),
  column('phone', 'Telefon', 'Stammdaten'),
  column('location', 'Wohnort / Adresse', 'Stammdaten'),
  column('nationality', 'Nationalität', 'Stammdaten'),

  column('current_position', 'Aktuelle Position', 'Beruf'),
  column('current_employer', 'Aktueller Arbeitgeber', 'Beruf'),
  column('experience', 'Berufserfahrung (Freitext)', 'Beruf'),
  column('skills', 'Skills (Text)', 'Beruf'),
  { key: 'skills_list', label: 'Skills (Liste)', group: 'Beruf', type: 'list', value: row => splitList(row.skills) },
  column('education', 'Ausbildung (Freitext)', 'Beruf'),
  column('languages', 'Sprachen', 'Beruf'),
  column('certificates', 'Zertifikate', 'Beruf'),

  column('desired_salary', 'Gehaltswunsch (Freitext)', 'Konditionen'),
  column('salary_min', 'Gehalt min.', 'Konditionen', { type: 'number' }),
  column('salary_max', 'Gehalt max.', 'Konditionen', { type: 'number' }),
  column('salary_currency', 'Währung', 'Konditionen'),
  column('salary_interval', 'Gehaltsintervall', 'Konditionen'),
  column('availability', 'Verfügbarkeit', 'Konditionen'),
  column('available_from', 'Verfügbar ab', 'Konditionen'),
  column('notice_period', 'Kündigungsfrist', 'Konditionen'),
  column('work_permit', 'Arbeitserlaubnis', 'Konditionen'),
  column('work_permit_until', 'Arbeitserlaubnis bis', 'Konditionen'),
  column('drivers_license', 'Führerschein', 'Konditionen'),
  column('mobility', 'Mobilität', 'Konditionen'),

  column('linkedin_url', 'LinkedIn', 'Online-Profile'),
  column('xing_url', 'Xing', 'Online-Profile'),
  column('github_url', 'GitHub', 'Online-Profile'),
  column('portfolio_url', 'Portfolio', 'Online-Profile'),

  column('status', 'Status', 'Recruiting'),
  column('source', 'Quelle', 'Recruiting'),
  column('tags', 'Tags (Text)', 'Recruiting'),
  { key: 'tags_list', label: 'Tags (Liste)', group: 'Recruiting', type: 'list', value: row => splitList(row.tags) },
  column('referrer_name', 'Empfohlen von', 'Recruiting'),
  column('referrer_email', 'E-Mail Empfehlungsgeber', 'Recruiting'),
  column('notes', 'Notizen', 'Recruiting'),

  column('gdpr_consent_date', 'DSGVO-Einwilligung am', 'DSGVO'),
  column('gdpr_consent_type', 'DSGVO-Einwilligungsart', 'DSGVO'),
  column('gdpr_consent_expires', 'DSGVO-Einwilligung bis', 'DSGVO'),

  column('created_at', 'Angelegt am', 'System', { type: 'datetime' }),
  column('updated_at', 'Zuletzt geändert', 'System', { type: 'datetime' }),

  {
    key: 'work_history',
    label: 'Werdegang (strukturiert)',
    group: 'Lebenslauf',
    type: 'list',
    needs: 'workHistory',
    value: (row, related) => (related.workHistory.get(row.id) || []).map(entry => ({
      employer: entry.employer,
      position: entry.position,
      from: entry.from_date,
      to: entry.to_date,
      current: Boolean(entry.is_current),
      location: entry.location,
      description: entry.description,
    })),
  },
  {
    key: 'education_history',
    label: 'Ausbildung (strukturiert)',
    group: 'Lebenslauf',
    type: 'list',
    needs: 'educationHistory',
    value: (row, related) => (related.educationHistory.get(row.id) || []).map(entry => ({
      institution: entry.institution,
      degree: entry.degree,
      field_of_study: entry.field_of_study,
      from: entry.from_date,
      to: entry.to_date,
      description: entry.description,
    })),
  },
  {
    key: 'pipeline',
    label: 'Bewerbungen / Pipeline-Stufen',
    group: 'Recruiting',
    type: 'list',
    needs: 'pipeline',
    value: (row, related) => (related.pipeline.get(row.id) || []).map(entry => ({
      job_id: entry.job_id,
      job_title: entry.job_title,
      stage: entry.stage,
      since: entry.updated_at,
    })),
  },
];

function idPlaceholders(ids) {
  return ids.map(() => '?').join(',');
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = Number(row[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

const RELATED_LOADERS = {
  workHistory: (db, ids) => groupBy(db.prepare(
    `SELECT * FROM candidate_work_history WHERE candidate_id IN (${idPlaceholders(ids)}) ORDER BY is_current DESC, from_date DESC`
  ).all(...ids), 'candidate_id'),
  educationHistory: (db, ids) => groupBy(db.prepare(
    `SELECT * FROM candidate_education WHERE candidate_id IN (${idPlaceholders(ids)}) ORDER BY from_date DESC`
  ).all(...ids), 'candidate_id'),
  pipeline: (db, ids) => groupBy(db.prepare(`
    SELECT pe.candidate_id, pe.job_id, pe.stage, pe.updated_at, j.title AS job_title
    FROM pipeline_entries pe
    LEFT JOIN jobs j ON j.id = pe.job_id
    WHERE pe.candidate_id IN (${idPlaceholders(ids)})
    ORDER BY pe.updated_at DESC
  `).all(...ids), 'candidate_id'),
  customValues: (db, ids) => groupBy(db.prepare(
    `SELECT candidate_id, field_id, value FROM candidate_custom_values WHERE candidate_id IN (${idPlaceholders(ids)})`
  ).all(...ids), 'candidate_id'),
};

// Zusatzfelder werden zur Laufzeit aus den Definitionen erzeugt, damit neu
// angelegte Felder ohne Codeaenderung exportierbar sind.
function customFields(db) {
  let definitions = [];
  try {
    definitions = db.prepare('SELECT id, name, field_type FROM custom_field_definitions ORDER BY sort_order, id').all();
  } catch (_) {
    definitions = [];
  }
  return definitions.map(definition => ({
    key: `custom.${definition.id}`,
    label: definition.name,
    group: 'Zusatzfelder',
    type: definition.field_type || 'string',
    needs: 'customValues',
    value: (row, related) => {
      const match = (related.customValues.get(row.id) || []).find(v => Number(v.field_id) === Number(definition.id));
      return match ? match.value : null;
    },
  }));
}

const toArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map(item => String(item).trim())
    .filter(Boolean);
};

const FILTERS = [
  { key: 'ids', type: 'list', label: 'Nur diese Bewerber-IDs' },
  { key: 'status', type: 'list', label: 'Status (eines davon)' },
  { key: 'source', type: 'list', label: 'Quelle (eine davon)' },
  { key: 'tags', type: 'list', label: 'Tags (alle müssen vorhanden sein)' },
  { key: 'job_id', type: 'number', label: 'Nur Bewerber in der Pipeline dieser Stelle' },
  { key: 'stage', type: 'list', label: 'Pipeline-Stufe (nur zusammen mit job_id)' },
  { key: 'created_from', type: 'date', label: 'Angelegt ab' },
  { key: 'created_to', type: 'date', label: 'Angelegt bis' },
  { key: 'updated_since', type: 'datetime', label: 'Geändert seit (für inkrementelle Abzüge)' },
];

function buildWhere(filters = {}) {
  const conditions = [];
  const params = [];

  const requestedIds = toArray(filters.ids);
  if (requestedIds.length) {
    // Eine Auswahl ohne gueltige ID darf nicht zu "alle Bewerber" werden.
    const ids = requestedIds.map(Number).filter(Number.isFinite);
    conditions.push(ids.length ? `c.id IN (${idPlaceholders(ids)})` : '1 = 0');
    params.push(...ids);
  }
  const statuses = toArray(filters.status);
  if (statuses.length) {
    conditions.push(`COALESCE(c.status, 'Aktiv') IN (${idPlaceholders(statuses)})`);
    params.push(...statuses);
  }
  const sources = toArray(filters.source);
  if (sources.length) {
    conditions.push(`c.source IN (${idPlaceholders(sources)})`);
    params.push(...sources);
  }
  for (const tag of toArray(filters.tags)) {
    conditions.push('c.tags LIKE ?');
    params.push(`%${tag}%`);
  }
  const jobId = Number(filters.job_id);
  if (filters.job_id !== undefined && filters.job_id !== null && filters.job_id !== '' && Number.isFinite(jobId)) {
    const stages = toArray(filters.stage);
    const stageClause = stages.length ? ` AND pe.stage IN (${idPlaceholders(stages)})` : '';
    conditions.push(`c.id IN (SELECT pe.candidate_id FROM pipeline_entries pe WHERE pe.job_id = ?${stageClause})`);
    params.push(jobId, ...stages);
  }
  const date = (value) => (value && !Number.isNaN(Date.parse(value)) ? value : null);
  if (date(filters.created_from)) {
    conditions.push('c.created_at >= ?');
    params.push(date(filters.created_from));
  }
  if (date(filters.created_to)) {
    // Ein reines Datum meint den ganzen Tag.
    const to = /^\d{4}-\d{2}-\d{2}$/.test(filters.created_to) ? `${filters.created_to} 23:59:59.999` : filters.created_to;
    conditions.push('c.created_at <= ?');
    params.push(to);
  }
  if (date(filters.updated_since)) {
    conditions.push('COALESCE(c.updated_at, c.created_at) >= ?');
    params.push(date(filters.updated_since));
  }

  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

module.exports = {
  key: 'candidates',
  label: 'Bewerber',
  auditEntity: 'Candidate',
  filters: FILTERS,
  defaultFields: ['id', 'first_name', 'last_name', 'email', 'phone', 'location', 'status', 'updated_at'],

  fields(db) {
    return [...BASE_FIELDS, ...customFields(db)];
  },

  count(db, filters) {
    const { where, params } = buildWhere(filters);
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM candidates c${where}`).get(...params)?.count) || 0;
  },

  load(db, filters, { limit, offset } = {}) {
    const { where, params } = buildWhere(filters);
    let sql = `SELECT c.* FROM candidates c${where} ORDER BY c.id ASC`;
    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, Math.max(0, offset || 0));
    }
    return db.prepare(sql).all(...params);
  },

  loadRelated(db, rows, needs) {
    const ids = rows.map(row => Number(row.id));
    const related = {};
    for (const name of Object.keys(RELATED_LOADERS)) {
      related[name] = ids.length && needs.has(name) ? RELATED_LOADERS[name](db, ids) : new Map();
    }
    return related;
  },
};
