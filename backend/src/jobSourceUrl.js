// Link zur Stellenausschreibung aus dem Stellentext. jobs.ch-Importe (Text
// und PDF) enden mit "Quelle: <Link>"; aeltere Importe haben diesen Link
// nur im Text und nicht in jobs.url gespeichert. Ohne URL nimmt das CRM
// die Rueckgabe nicht an (URL ist dort Pflicht und Schluessel).

const { urlKey } = require('./identity');

const SOURCE_URL = /^[ \t]*Quelle:[ \t]*(https?:\/\/\S+)/im;

function sourceUrlFromText(...texts) {
  for (const text of texts) {
    const match = SOURCE_URL.exec(String(text || ''));
    if (match) return match[1].replace(/[.,;)]+$/, '');
  }
  return null;
}

// Traegt bei Stellen ohne URL den Link aus dem Text nach. Gehoert der Link
// schon einer anderen Stelle (Dublette), bleibt die Stelle ohne URL; die
// Rueckgabe-Vorschau nennt sie dann mit "Stelle ohne URL".
function backfillJobUrls(db) {
  const rows = db.prepare(`
    SELECT id, raw_text, description FROM jobs
    WHERE (url IS NULL OR btrim(url) = '') AND (COALESCE(raw_text, '') ~* 'Quelle:' OR COALESCE(description, '') ~* 'Quelle:')
  `).all();
  let updated = 0;
  for (const row of rows) {
    const url = sourceUrlFromText(row.raw_text, row.description);
    if (!url) continue;
    const taken = db.prepare(`SELECT 1 AS found FROM jobs WHERE id <> ? AND url IS NOT NULL AND btrim(url) <> '' AND ${urlKey('url')} = ${urlKey('CAST(? AS TEXT)')}`).get(row.id, url);
    if (taken) continue;
    try {
      updated += db.prepare("UPDATE jobs SET url = ? WHERE id = ? AND (url IS NULL OR btrim(url) = '')").run(url, row.id).changes || 0;
    } catch (error) {
      console.warn(`URL für Stelle ${row.id} nicht übernommen:`, error.message);
    }
  }
  if (updated) console.log(`🔗 ${updated} Stellen-URL(s) aus dem Stellentext ("Quelle: …") übernommen`);
  return updated;
}

module.exports = { backfillJobUrls, sourceUrlFromText };
