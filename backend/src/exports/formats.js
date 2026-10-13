// Ausgabeformate fuer Datenexporte. Jedes Format bekommt die bereits
// abgebildeten Datensaetze (Objekte mit den Zielfeldnamen als Schluessel) und
// liefert den fertigen Dateiinhalt. Neue Formate werden hier eingetragen und
// stehen damit allen Export-Entitaeten zur Verfuegung.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = normalizeValue(inner);
    return out;
  }
  return value === undefined ? null : value;
}

// Zielfelder wie "kontakt.email" werden fuer strukturierte Formate zu
// verschachtelten Objekten, damit sich das Schema des Zielsystems direkt
// nachbilden laesst.
function setPath(target, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!isPlainObject(node[parts[i]])) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function nestRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) setPath(out, key, normalizeValue(value));
  return out;
}

// Flache Formate (CSV) brauchen pro Feld genau einen Text.
function flattenValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map(item => (isPlainObject(item) ? JSON.stringify(normalizeValue(item)) : flattenValue(item)))
      .filter(item => item !== '')
      .join('; ');
  }
  if (isPlainObject(value)) return JSON.stringify(normalizeValue(value));
  return String(value);
}

const CSV_DELIMITERS = { comma: ',', semicolon: ';', tab: '\t' };

function toCsv(records, columns, options = {}) {
  const delimiter = CSV_DELIMITERS[options.delimiter] || ',';
  const escape = (raw) => {
    let text = flattenValue(raw);
    // Formel-Injection in Tabellenkalkulationen verhindern. Reine Zahlen und
    // Telefonnummern ("+41 79 ...", "-5") bleiben unveraendert, sonst kaeme
    // das Zielsystem an verfaelschte Werte.
    if (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^[+-][\d\s()./-]*$/.test(text))) text = `'${text}`;
    if (text.includes(delimiter) || /["\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [];
  if (options.header !== false) lines.push(columns.map(escape).join(delimiter));
  for (const record of records) lines.push(columns.map(column => escape(record[column])).join(delimiter));
  const body = lines.join('\r\n');
  return options.bom === false ? body : `﻿${body}`;
}

function xmlName(name, fallback) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]+/, '');
  return cleaned || fallback;
}

function xmlEscape(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlNode(name, value, indent) {
  const tag = xmlName(name, 'field');
  if (value === null || value === undefined) return `${indent}<${tag}/>`;
  if (Array.isArray(value)) {
    const children = value.map(item => xmlNode('item', item, `${indent}  `)).join('\n');
    return children ? `${indent}<${tag}>\n${children}\n${indent}</${tag}>` : `${indent}<${tag}/>`;
  }
  if (isPlainObject(value)) {
    const children = Object.entries(value).map(([key, inner]) => xmlNode(key, inner, `${indent}  `)).join('\n');
    return children ? `${indent}<${tag}>\n${children}\n${indent}</${tag}>` : `${indent}<${tag}/>`;
  }
  return `${indent}<${tag}>${xmlEscape(value)}</${tag}>`;
}

const FORMATS = {
  json: {
    label: 'JSON',
    contentType: 'application/json; charset=utf-8',
    extension: 'json',
    options: [
      { key: 'envelope', type: 'boolean', default: true, label: 'Metadaten-Hülle (meta + data) statt nacktem Array' },
    ],
    render(records, { options = {}, meta }) {
      const data = records.map(nestRecord);
      const payload = options.envelope === false ? data : { meta, data };
      return JSON.stringify(payload, null, 2);
    },
  },
  ndjson: {
    label: 'NDJSON (ein JSON-Objekt pro Zeile)',
    contentType: 'application/x-ndjson; charset=utf-8',
    extension: 'ndjson',
    options: [],
    render(records) {
      return records.map(record => JSON.stringify(nestRecord(record))).join('\n');
    },
  },
  csv: {
    label: 'CSV',
    contentType: 'text/csv; charset=utf-8',
    extension: 'csv',
    options: [
      { key: 'delimiter', type: 'enum', values: Object.keys(CSV_DELIMITERS), default: 'comma', label: 'Trennzeichen' },
      { key: 'header', type: 'boolean', default: true, label: 'Kopfzeile ausgeben' },
      { key: 'bom', type: 'boolean', default: true, label: 'UTF-8-BOM (für Excel)' },
    ],
    render(records, { columns, options = {} }) {
      return toCsv(records, columns, options);
    },
  },
  xml: {
    label: 'XML',
    contentType: 'application/xml; charset=utf-8',
    extension: 'xml',
    options: [
      { key: 'root', type: 'string', default: 'export', label: 'Wurzelelement' },
      { key: 'item', type: 'string', default: 'record', label: 'Element pro Datensatz' },
    ],
    render(records, { options = {} }) {
      const root = xmlName(options.root, 'export');
      const item = xmlName(options.item, 'record');
      const body = records.map(record => xmlNode(item, nestRecord(record), '  ')).join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>${body ? `\n${body}\n` : ''}</${root}>\n`;
    },
  },
};

function getFormat(key) {
  return Object.prototype.hasOwnProperty.call(FORMATS, key) ? FORMATS[key] : null;
}

function listFormats() {
  return Object.entries(FORMATS).map(([key, format]) => ({
    key,
    label: format.label,
    contentType: format.contentType,
    extension: format.extension,
    options: format.options,
  }));
}

module.exports = { getFormat, listFormats, flattenValue, nestRecord };
