// Generische Export-Schnittstelle. Ein Export wird durch eine Spezifikation
// beschrieben:
//
//   {
//     entity: 'candidates',
//     format: 'csv' | 'json' | 'ndjson' | 'xml',
//     format_options: { ... },              // je Format, siehe listFormats()
//     fields: [{ key: 'email', as: 'contact.mail' }, ...],
//     filters: { status: ['Aktiv'], updated_since: '2026-01-01', ... },
//   }
//
// "as" bildet ein internes Feld auf den Feldnamen des Zielsystems ab. Punkte
// erzeugen in JSON/XML verschachtelte Objekte. Weitere Entitaeten (z. B.
// Stellen) werden in ENTITIES registriert und nutzen dieselbe Schnittstelle.

const { getFormat, listFormats } = require('./formats');

const ENTITIES = {
  candidates: require('./entities/candidates'),
};

const MAX_ROWS = 50000;

class ExportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportValidationError';
    this.status = 400;
  }
}

function getEntity(key) {
  return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : null;
}

function describeEntities(db) {
  return Object.values(ENTITIES).map(entity => ({
    key: entity.key,
    label: entity.label,
    defaultFields: entity.defaultFields,
    filters: entity.filters,
    fields: entity.fields(db).map(({ key, label, group, type }) => ({ key, label, group, type })),
  }));
}

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

// Prueft eine Spezifikation und bringt sie in eine feste Form. Wirft
// ExportValidationError mit einer fuer Anwender lesbaren Meldung.
function normalizeSpec(db, raw = {}) {
  const entity = getEntity(raw.entity || 'candidates');
  if (!entity) throw new ExportValidationError(`Unbekannte Entitaet "${raw.entity}". Verfuegbar: ${Object.keys(ENTITIES).join(', ')}`);

  const formatKey = raw.format || 'json';
  const format = getFormat(formatKey);
  if (!format) throw new ExportValidationError(`Unbekanntes Format "${formatKey}". Verfuegbar: ${listFormats().map(f => f.key).join(', ')}`);

  const available = new Map(entity.fields(db).map(field => [field.key, field]));
  let requested = parseMaybeJson(raw.fields, null);
  if (!Array.isArray(requested) || requested.length === 0) requested = entity.defaultFields;

  const seenTargets = new Set();
  const fields = requested.map((entry) => {
    const key = typeof entry === 'string' ? entry : entry?.key;
    if (!available.has(key)) throw new ExportValidationError(`Unbekanntes Feld "${key}" fuer ${entity.label}`);
    const as = String((typeof entry === 'object' && entry?.as) || key).trim();
    if (!as || as.split('.').some(part => !part)) throw new ExportValidationError(`Ungueltiger Zielfeldname "${as}"`);
    if (seenTargets.has(as)) throw new ExportValidationError(`Zielfeld "${as}" ist mehrfach belegt`);
    seenTargets.add(as);
    return { key, as };
  });

  const formatOptions = parseMaybeJson(raw.format_options, {}) || {};
  const filters = parseMaybeJson(raw.filters, {}) || {};
  if (typeof formatOptions !== 'object' || Array.isArray(formatOptions)) throw new ExportValidationError('format_options muss ein Objekt sein');
  if (typeof filters !== 'object' || Array.isArray(filters)) throw new ExportValidationError('filters muss ein Objekt sein');

  const allowedFilters = new Set(entity.filters.map(filter => filter.key));
  const unknownFilter = Object.keys(filters).find(key => !allowedFilters.has(key));
  if (unknownFilter) throw new ExportValidationError(`Unbekannter Filter "${unknownFilter}"`);

  return { entity: entity.key, format: formatKey, format_options: formatOptions, fields, filters };
}

// Fuehrt einen Export aus. Eine Spezifikation wird vorher normalisiert;
// limit/offset erlauben seitenweises Abholen durch Fremdsysteme.
function runExport(db, rawSpec, { limit, offset, filename } = {}) {
  const spec = normalizeSpec(db, rawSpec);
  const entity = getEntity(spec.entity);
  const format = getFormat(spec.format);

  const total = entity.count(db, spec.filters);
  const pageLimit = Number(limit) > 0 ? Math.min(Number(limit), MAX_ROWS) : 0;
  const pageOffset = Number(offset) > 0 ? Number(offset) : 0;
  if (!pageLimit && total > MAX_ROWS) {
    throw new ExportValidationError(`Zu viele Datensaetze (${total}). Bitte filtern oder mit limit/offset seitenweise abrufen (max. ${MAX_ROWS}).`);
  }

  const definitions = new Map(entity.fields(db).map(field => [field.key, field]));
  const selected = spec.fields.map(field => ({ ...field, definition: definitions.get(field.key) }));
  const needs = new Set(selected.map(field => field.definition.needs).filter(Boolean));

  const rows = entity.load(db, spec.filters, { limit: pageLimit, offset: pageOffset });
  const related = entity.loadRelated(db, rows, needs);
  const records = rows.map((row) => {
    const record = {};
    for (const field of selected) record[field.as] = field.definition.value(row, related);
    return record;
  });

  const exportedAt = new Date().toISOString();
  const meta = {
    entity: spec.entity,
    exported_at: exportedAt,
    count: records.length,
    total,
    offset: pageOffset,
    limit: pageLimit || null,
  };
  const body = format.render(records, {
    columns: selected.map(field => field.as),
    options: spec.format_options,
    meta,
  });

  const base = String(filename || `${spec.entity}-export`).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
  return {
    spec,
    body,
    count: records.length,
    total,
    contentType: format.contentType,
    filename: `${base}_${exportedAt.slice(0, 10)}.${format.extension}`,
  };
}

module.exports = {
  ExportValidationError,
  describeEntities,
  listFormats,
  normalizeSpec,
  runExport,
};
