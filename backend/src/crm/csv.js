// CSV lesen und schreiben fuer die CRM-Schnittstelle (RFC 4180: Felder in
// doppelten Anfuehrungszeichen, "" als Escape, Zeilenumbrueche in Feldern
// erlaubt). Siehe README, Abschnitt "CRM-Schnittstelle".

const BOM = '﻿';

// Erkennt das Trennzeichen an der Kopfzeile (ausserhalb von Anfuehrungszeichen).
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char] += 1;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

// Liefert die Zeilen als Arrays von Zellen; leere Zeilen entfallen.
function parseCsv(input, delimiter = null) {
  const text = String(input || '').replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;

  const endField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
  };
  const endRow = () => {
    endField();
    if (row.some(cell => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (char === sep) {
      endField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
      atFieldStart = false;
    }
  }
  if (quoted) throw new Error('CSV ungültig: Anführungszeichen wird nicht geschlossen');
  if (field !== '' || row.length) endRow();
  return rows;
}

// Das CRM stellt Werten, die (nach fuehrenden Leerzeichen) mit =, +, -, @,
// Tab oder Wagenruecklauf beginnen, einen Apostroph voran (Schutz in
// Tabellenkalkulationen). Hier wird der Originalwert wiederhergestellt.
function unprotectCell(value) {
  const text = String(value ?? '');
  if (text.startsWith("'") && /^[ ]*[=+\-@\t\r]/.test(text.slice(1))) return text.slice(1);
  return text;
}

// Gleicher Schutz beim Schreiben, wie ihn das CRM selbst verwendet.
function protectCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[ ]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function toCsv(rows, { delimiter = ';', bom = true } = {}) {
  const escape = (value) => {
    const text = protectCell(value);
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map(row => row.map(escape).join(delimiter)).join('\r\n');
  return `${bom ? BOM : ''}${body}\r\n`;
}

module.exports = { detectDelimiter, parseCsv, protectCell, toCsv, unprotectCell };
