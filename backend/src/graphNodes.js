// Neo4j-Eintraege fuer das 3D-Matching sicherstellen.
//
// Das 3D-Matching sucht Bewerber und Stellen in Neo4j ueber ihre UUID. Ein
// Datensatz ist abgeglichen, wenn graph_candidate_id bzw. graph_job_id gleich
// seiner UUID ist. Fehlt der Eintrag (z. B. manuell angelegter Bewerber, der
// Hintergrund-Abgleich nach dem Speichern ist gescheitert, oder Altbestand),
// wird er hier vor dem Matching nachgeholt. Was danach immer noch fehlt,
// meldet der Aufrufer ausdruecklich, statt ein leeres Ergebnis zu liefern.

const { syncGraphCandidates } = require('./utils/graphRagCandidate');
const { syncGraphJobs } = require('./utils/graphRagJob');

function pendingIds(db, table, graphColumn, ids) {
  const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (list.length === 0) return [];
  return db.prepare(
    `SELECT id FROM ${table} WHERE id IN (${list.map(() => '?').join(',')}) AND ${graphColumn} IS DISTINCT FROM uuid::text`
  ).all(...list).map(row => Number(row.id));
}

async function syncPending(ids, sync, req, idKey) {
  if (ids.length === 0) return new Map();
  const errors = new Map();
  try {
    const result = await sync(ids, req);
    for (const entry of result?.errors || []) errors.set(Number(entry[idKey]), entry.error || 'Abgleich fehlgeschlagen');
  } catch (error) {
    for (const id of ids) errors.set(id, `Abgleich mit Neo4j fehlgeschlagen: ${error.message}`);
  }
  return errors;
}

/**
 * Gleicht noch nicht abgeglichene Bewerber und Stellen mit Neo4j ab.
 * Liefert je Seite eine Map PostgreSQL-ID -> Fehlermeldung fuer die
 * Datensaetze, deren Abgleich gescheitert ist.
 */
async function ensureGraphNodes(db, req, { candidateIds = [], jobIds = [] } = {}) {
  const [candidateErrors, jobErrors] = await Promise.all([
    syncPending(pendingIds(db, 'candidates', 'graph_candidate_id', candidateIds), syncGraphCandidates, req, 'candidate_id'),
    syncPending(pendingIds(db, 'jobs', 'graph_job_id', jobIds), syncGraphJobs, req, 'job_id'),
  ]);
  return { candidateErrors, jobErrors };
}

module.exports = { ensureGraphNodes };
