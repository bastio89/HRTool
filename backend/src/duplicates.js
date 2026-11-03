// Dubletten im Bestand finden und zusammenfuehren.
//
// Neu angelegte Datensaetze koennen keine Dubletten mehr werden (siehe
// src/identity.js). Der Bestand aus der Zeit davor wird hier bereinigt:
//   - Bewerber: gleicher Name + Geburtsdatum (sichere Dublette) sowie gleiche
//     E-Mail, Telefonnummer oder gleicher Name (moegliche Dublette, solange
//     sich die Personen nicht durch verschiedene Geburtsdaten unterscheiden).
//   - Stellen: gleiche URL oder gleicher Titel bei gleicher Firma und Ort.
// Zusammengefuehrt wird nur auf ausdrueckliche Anweisung eines Admins.

const { enableIdentityIndexes, identityIndexStatus, textKey, urlKey } = require('./identity');
const { ensureMatchingPairSchema } = require('./matchingPairs');

const MAX_GROUPS = 200;

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function dedupeGroups(groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    const signature = [...group.ids].sort((a, b) => a - b).join(',');
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(group);
  }
  return out.slice(0, MAX_GROUPS);
}

// Gruppen ueberspringen, deren Mitglieder sich alle durch verschiedene
// Geburtsdaten unterscheiden: das sind nach der Regel verschiedene Personen.
const NOT_ALL_DISTINCT_BIRTH_DATES = 'COUNT(DISTINCT birth_date) < COUNT(*)';

function findCandidateGroups(db) {
  const queries = [
    ['identity', `
      SELECT ${textKey('name')} AS key, array_agg(id ORDER BY id) AS ids FROM candidates
      WHERE birth_date IS NOT NULL GROUP BY ${textKey('name')}, birth_date HAVING COUNT(*) > 1`],
    ['email', `
      SELECT lower(btrim(email)) AS key, array_agg(id ORDER BY id) AS ids FROM candidates
      WHERE email IS NOT NULL AND btrim(email) <> ''
      GROUP BY lower(btrim(email)) HAVING COUNT(*) > 1 AND ${NOT_ALL_DISTINCT_BIRTH_DATES}`],
    ['phone', `
      SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS key, array_agg(id ORDER BY id) AS ids FROM candidates
      WHERE length(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) >= 6
      GROUP BY regexp_replace(phone, '[^0-9]', '', 'g') HAVING COUNT(*) > 1 AND ${NOT_ALL_DISTINCT_BIRTH_DATES}`],
    ['name', `
      SELECT ${textKey('name')} AS key, array_agg(id ORDER BY id) AS ids FROM candidates
      GROUP BY ${textKey('name')} HAVING COUNT(*) > 1 AND ${NOT_ALL_DISTINCT_BIRTH_DATES}`],
  ];
  const groups = dedupeGroups(queries.flatMap(([reason, sql]) => db.prepare(sql).all()
    .map(row => ({ reason, key: row.key, ids: row.ids.map(Number) }))));
  const ids = [...new Set(groups.flatMap(group => group.ids))];
  const members = ids.length ? new Map(db.prepare(`
    SELECT c.id, c.uuid::text AS uuid, c.name, c.birth_date, c.email, c.phone, c.location, c.status,
      c.created_at, c.updated_at,
      (SELECT COUNT(*) FROM pipeline_entries p WHERE p.candidate_id = c.id) AS pipeline_count,
      (SELECT COUNT(*) FROM candidate_files f WHERE f.candidate_id = c.id) AS file_count
    FROM candidates c WHERE c.id IN (${placeholders(ids)})
  `).all(...ids).map(row => [Number(row.id), row])) : new Map();
  return groups.map(group => ({ ...group, members: group.ids.map(id => members.get(id)).filter(Boolean) }));
}

function findJobGroups(db) {
  const queries = [
    ['url', `
      SELECT ${urlKey('url')} AS key, array_agg(id ORDER BY id) AS ids FROM jobs
      WHERE url IS NOT NULL AND btrim(url) <> '' GROUP BY ${urlKey('url')} HAVING COUNT(*) > 1`],
    ['title_company_location', `
      SELECT concat_ws(' · ', ${textKey('title')}, ${textKey('company')}, ${textKey('location')}) AS key, array_agg(id ORDER BY id) AS ids
      FROM jobs GROUP BY ${textKey('title')}, ${textKey('company')}, ${textKey('location')} HAVING COUNT(*) > 1`],
  ];
  const groups = dedupeGroups(queries.flatMap(([reason, sql]) => db.prepare(sql).all()
    .map(row => ({ reason, key: row.key, ids: row.ids.map(Number) }))));
  const ids = [...new Set(groups.flatMap(group => group.ids))];
  const members = ids.length ? new Map(db.prepare(`
    SELECT j.id, j.uuid::text AS uuid, j.title, j.company, j.location, j.url, j.status, j.created_at,
      (SELECT COUNT(*) FROM pipeline_entries p WHERE p.job_id = j.id) AS pipeline_count
    FROM jobs j WHERE j.id IN (${placeholders(ids)})
  `).all(...ids).map(row => [Number(row.id), row])) : new Map();
  return groups.map(group => ({ ...group, members: group.ids.map(id => members.get(id)).filter(Boolean) }));
}

function duplicateOverview(db) {
  const count = (sql) => Number(db.prepare(sql).get()?.count) || 0;
  return {
    rules: identityIndexStatus(db),
    candidates: {
      groups: findCandidateGroups(db),
      total: count('SELECT COUNT(*) AS count FROM candidates'),
      withoutBirthDate: count('SELECT COUNT(*) AS count FROM candidates WHERE birth_date IS NULL'),
      // Neo4j-Knoten fehlt oder traegt noch eine andere ID als die UUID.
      notSynced: count('SELECT COUNT(*) AS count FROM candidates WHERE graph_candidate_id IS DISTINCT FROM uuid::text'),
    },
    jobs: {
      groups: findJobGroups(db),
      total: count('SELECT COUNT(*) AS count FROM jobs'),
      notSynced: count('SELECT COUNT(*) AS count FROM jobs WHERE graph_job_id IS DISTINCT FROM uuid::text'),
    },
  };
}

class MergeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const CANDIDATE_FILL_FIELDS = [
  'birth_date', 'gender', 'email', 'phone', 'location', 'experience', 'skills', 'education',
  'desired_salary', 'availability', 'languages', 'certificates', 'drivers_license', 'mobility', 'notes',
  'source', 'linkedin_url', 'xing_url', 'github_url', 'portfolio_url', 'nationality', 'work_permit',
  'work_permit_until', 'notice_period', 'available_from', 'current_employer', 'current_position',
  'referrer_name', 'referrer_email', 'salary_min', 'salary_max', 'gdpr_consent_date', 'gdpr_consent_type',
  'gdpr_consent_expires', 'photo_filename', 'parsing_method',
];

const isEmpty = (value) => value === null || value === undefined || String(value).trim() === '';

// Pipeline-Eintraege des wegfallenden Datensatzes uebernehmen. Gibt es fuer
// dieselbe Stelle (bzw. denselben Bewerber) schon einen Eintrag, werden
// Interviews, Notizen und Bewertungen dorthin umgehaengt statt geloescht.
function movePipelineEntries(db, { column, otherColumn, keepId, mergeId }) {
  const keepEntries = new Map(db.prepare(`SELECT id, ${otherColumn} AS other FROM pipeline_entries WHERE ${column} = ?`)
    .all(keepId).map(row => [Number(row.other), Number(row.id)]));
  for (const entry of db.prepare(`SELECT id, ${otherColumn} AS other FROM pipeline_entries WHERE ${column} = ?`).all(mergeId)) {
    const target = keepEntries.get(Number(entry.other));
    if (target === undefined) {
      db.prepare(`UPDATE pipeline_entries SET ${column} = ? WHERE id = ?`).run(keepId, entry.id);
      continue;
    }
    db.prepare('UPDATE interviews SET pipeline_entry_id = ? WHERE pipeline_entry_id = ?').run(target, entry.id);
    db.prepare('UPDATE pipeline_notes SET pipeline_entry_id = ? WHERE pipeline_entry_id = ?').run(target, entry.id);
    db.prepare('UPDATE scorecard_responses SET pipeline_entry_id = ? WHERE pipeline_entry_id = ?').run(target, entry.id);
    db.prepare('DELETE FROM pipeline_entries WHERE id = ?').run(entry.id);
  }
}

// Die Tabelle muss vor der Transaktion existieren (ensureMatchingPairSchema):
// ein Fehler darin wuerde die ganze PostgreSQL-Transaktion abbrechen.
function moveMatchingPairs(db, { column, otherColumn, keepId, mergeId }) {
  db.prepare(`
    UPDATE matching_pair_results m SET ${column} = ?
    WHERE m.${column} = ? AND NOT EXISTS (
      SELECT 1 FROM matching_pair_results k WHERE k.${column} = ? AND k.method = m.method AND k.${otherColumn} = m.${otherColumn}
    )
  `).run(keepId, mergeId, keepId);
}

/**
 * Fuehrt den Bewerber mergeId in keepId zusammen und liefert den behaltenen
 * Bewerber sowie die Neo4j-IDs, die danach entfernt werden muessen (der
 * Aufrufer stoesst dafuer den Abgleich an).
 */
function mergeCandidates(db, keepId, mergeId) {
  if (!keepId || !mergeId) throw new MergeError('keepId und mergeId sind erforderlich');
  if (Number(keepId) === Number(mergeId)) throw new MergeError('Ein Bewerber kann nicht mit sich selbst zusammengeführt werden');
  const keep = db.prepare('SELECT * FROM candidates WHERE id = ?').get(keepId);
  const merge = db.prepare('SELECT * FROM candidates WHERE id = ?').get(mergeId);
  if (!keep || !merge) throw new MergeError('Kandidat nicht gefunden', 404);
  ensureMatchingPairSchema(db);

  db.transaction(() => {
    db.prepare('UPDATE activities SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE candidate_files SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE candidate_ratings SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE candidate_work_history SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE candidate_education SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE candidate_custom_values SET candidate_id = ? WHERE candidate_id = ? AND field_id NOT IN (SELECT field_id FROM candidate_custom_values WHERE candidate_id = ?)').run(keep.id, merge.id, keep.id);
    db.prepare('UPDATE comments SET entity_id = ? WHERE entity_type = ? AND entity_id = ?').run(keep.id, 'candidate', merge.id);
    db.prepare('UPDATE email_log SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE scorecard_responses SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    movePipelineEntries(db, { column: 'candidate_id', otherColumn: 'job_id', keepId: keep.id, mergeId: merge.id });
    db.prepare('UPDATE interviews SET candidate_id = ? WHERE candidate_id = ?').run(keep.id, merge.id);
    moveMatchingPairs(db, { column: 'candidate_id', otherColumn: 'job_id', keepId: keep.id, mergeId: merge.id });

    // CV-Volltext: der des behaltenen Bewerbers gilt, sonst wird der andere uebernommen.
    const keepText = db.prepare('SELECT 1 AS present FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').get(keep.id);
    if (keepText) {
      db.prepare('DELETE FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').run(merge.id);
    } else {
      db.prepare('UPDATE candidate_texts SET candidate_id = CAST(? AS TEXT) WHERE candidate_id = CAST(? AS TEXT) RETURNING candidate_id').run(keep.id, merge.id);
    }

    // Die Neo4j-Knoten des wegfallenden Bewerbers merkt sich der behaltene;
    // der Abgleich entfernt sie danach (siehe GraphRAG /sync/candidates).
    db.prepare(`
      UPDATE candidates k SET graph_candidate_ids = ARRAY(
        SELECT DISTINCT unnest(
          COALESCE(k.graph_candidate_ids, ARRAY[]::TEXT[])
          || COALESCE(m.graph_candidate_ids, ARRAY[]::TEXT[])
          || ARRAY[m.uuid::text]
          || CASE WHEN m.graph_candidate_id IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[m.graph_candidate_id] END
        )
      )
      FROM candidates m WHERE k.id = ? AND m.id = ?
    `).run(keep.id, merge.id);

    // Erst die Identitaet des wegfallenden Datensatzes loesen, dann leere
    // Felder (auch das Geburtsdatum) des behaltenen fuellen - sonst greift
    // der Eindeutigkeitsindex Name + Geburtsdatum zwischen beiden.
    db.prepare('UPDATE candidates SET birth_date = NULL WHERE id = ?').run(merge.id);
    const updates = [];
    const params = [];
    for (const field of CANDIDATE_FILL_FIELDS) {
      if (isEmpty(keep[field]) && !isEmpty(merge[field])) {
        updates.push(`${field} = ?`);
        params.push(merge[field]);
      }
    }
    const tags = [...new Set([keep.tags, merge.tags].flatMap(value => String(value || '').split(',')).map(tag => tag.trim()).filter(Boolean))];
    updates.push('tags = ?');
    params.push(tags.join(', ') || null);
    db.prepare(`UPDATE candidates SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params, keep.id);

    db.prepare('DELETE FROM candidates WHERE id = ?').run(merge.id);
  })();

  enableIdentityIndexes(db);
  return { candidate: db.prepare('SELECT * FROM candidates WHERE id = ?').get(keep.id), merged: merge };
}

const JOB_FILL_FIELDS = ['company', 'about_us', 'description', 'requirements', 'skills', 'benefits', 'location', 'url', 'source'];

function mergeJobs(db, keepId, mergeId) {
  if (!keepId || !mergeId) throw new MergeError('keepId und mergeId sind erforderlich');
  if (Number(keepId) === Number(mergeId)) throw new MergeError('Eine Stelle kann nicht mit sich selbst zusammengeführt werden');
  const keep = db.prepare('SELECT * FROM jobs WHERE id = ?').get(keepId);
  const merge = db.prepare('SELECT * FROM jobs WHERE id = ?').get(mergeId);
  if (!keep || !merge) throw new MergeError('Stelle nicht gefunden', 404);
  ensureMatchingPairSchema(db);

  db.transaction(() => {
    movePipelineEntries(db, { column: 'job_id', otherColumn: 'candidate_id', keepId: keep.id, mergeId: merge.id });
    db.prepare('UPDATE interviews SET job_id = ? WHERE job_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE scorecard_templates SET job_id = ? WHERE job_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE matching_results SET job_id = ? WHERE job_id = ?').run(keep.id, merge.id);
    db.prepare('UPDATE user_job_access SET job_id = ? WHERE job_id = ? AND user_id NOT IN (SELECT user_id FROM user_job_access WHERE job_id = ?)').run(keep.id, merge.id, keep.id);
    moveMatchingPairs(db, { column: 'job_id', otherColumn: 'candidate_id', keepId: keep.id, mergeId: merge.id });

    // URL des wegfallenden Datensatzes loesen, bevor der behaltene sie erhaelt.
    db.prepare('UPDATE jobs SET url = NULL WHERE id = ?').run(merge.id);
    const updates = [];
    const params = [];
    for (const field of JOB_FILL_FIELDS) {
      if (isEmpty(keep[field]) && !isEmpty(merge[field])) {
        updates.push(`${field} = ?`);
        params.push(merge[field]);
      }
    }
    if (updates.length) db.prepare(`UPDATE jobs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params, keep.id);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(merge.id);
  })();

  enableIdentityIndexes(db);
  return { job: db.prepare('SELECT * FROM jobs WHERE id = ?').get(keep.id), merged: merge };
}

module.exports = { MergeError, duplicateOverview, mergeCandidates, mergeJobs };
