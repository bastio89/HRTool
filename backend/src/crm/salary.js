// Lohn laut Stellenbeschreibung, fuer die Spalte "Lohnvorstellung" der
// CRM-Rueckgabe. Gilt nur, wenn die Stelle einen Lohn ausdruecklich nennt:
// ein Betrag mit Waehrung in der Naehe eines Lohn-Begriffs (oder hinter
// "Lohn:" usw.). Ein Betrag allein (z. B. ein Projektbudget) zaehlt nicht.

const KEYWORDS = String.raw`(?:brutto)?(?:jahres|monats|stunden)?(?:lohn|gehalt|salär|salaer|vergütung|verguetung|einkommen)(?:sband|spanne|srahmen|svorstellung|sangabe)?|lohnband|salary(?:\s+range)?|compensation|salaire|rémunération|remuneration|retribuzione|stipendio`;
const CURRENCY = String.raw`(?:CHF|SFr\.?|Fr\.|EUR|€|USD|\$)`;
// 120'000 / 120’000 / 120.000 / 120 000 / 120000 / 120k / 9'500.– / 45.50
const AMOUNT = String.raw`\d{1,3}(?:['’.  ]\d{3})+(?:[.,]\d{1,2})?|\d{2,7}(?:[.,]\d{1,2})?(?:\s?[kK]\b)?`;
const DASH = String.raw`\s?(?:\.[-–]|,[-–])?`;
const RANGE = String.raw`(?:\s?(?:-|–|—|bis|to|à)\s?${CURRENCY}?\s?(?:${AMOUNT})${DASH})?`;
const UNIT = String.raw`(?:\s?(?:pro|per|je|/|par)\s?(?:jahr|year|monat|month|stunde|std\.?|hour|h|an|mois|heure)\b|\s?p\.\s?a\.|\s?brutto|\s?x\s?1[23])*`;

const CURRENCY_FIRST = new RegExp(String.raw`${CURRENCY}\s?(?:${AMOUNT})${DASH}${RANGE}${UNIT}`, 'i');
const AMOUNT_FIRST = new RegExp(String.raw`(?:${AMOUNT})${DASH}${RANGE}\s?${CURRENCY}${UNIT}`, 'i');
const KEYWORD = new RegExp(KEYWORDS, 'gi');
const HEADING = new RegExp(String.raw`^[•*\-\s]*(?:${KEYWORDS})[\s:]*$`, 'i');
const LABELLED = new RegExp(String.raw`(?:^|\n)[ \t•*-]*(?:${KEYWORDS})[ \t]*[:–-][ \t]*([^\n]{2,80})`, 'i');

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function findAmount(text) {
  const matches = [CURRENCY_FIRST.exec(text), AMOUNT_FIRST.exec(text)].filter(Boolean);
  if (!matches.length) return null;
  const first = matches.sort((a, b) => a.index - b.index)[0];
  return { index: first.index, text: first[0].replace(/\s+/g, ' ').trim() };
}

// texts: Liste von Stellentexten (Rohtext, Beschreibung, Anforderungen ...).
// Liefert z. B. "CHF 100'000 - 120'000" oder null.
function extractJobSalary(texts) {
  for (const raw of (Array.isArray(texts) ? texts : [texts])) {
    const text = stripHtml(raw);
    if (!text.trim()) continue;

    const labelled = LABELLED.exec(text);
    if (labelled && /\d/.test(labelled[1])) {
      const amount = findAmount(labelled[1]);
      if (amount) return amount.text;
      // "Lohn: nach Vereinbarung" o. ae. enthaelt keinen Betrag.
    }

    // Betrag mit Waehrung hoechstens 80 Zeichen hinter einem Lohn-Begriff in
    // derselben Zeile. Steht der Begriff allein in einer Zeile (Ueberschrift
    // "Lohn"), zaehlt auch die naechste Zeile.
    const lines = text.split('\n');
    lines.forEach((line, index) => { lines[index] = line.trim(); });
    for (let index = 0; index < lines.length; index += 1) {
      for (const keyword of lines[index].matchAll(KEYWORD)) {
        let window = lines[index].slice(keyword.index, keyword.index + keyword[0].length + 80);
        if (HEADING.test(lines[index])) window += ` ${lines.slice(index + 1).find(Boolean) || ''}`;
        const amount = findAmount(window);
        if (amount) return amount.text;
      }
    }
  }
  return null;
}

module.exports = { extractJobSalary };
