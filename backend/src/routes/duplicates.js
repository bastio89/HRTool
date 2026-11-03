const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');
const { MergeError, duplicateOverview, mergeCandidates, mergeJobs } = require('../duplicates');
const { syncGraphCandidates, syncGraphCandidatesInBackground } = require('../utils/graphRagCandidate');
const { deleteJobFromGraphRag } = require('../utils/graphRagJob');

// Administration -> Dubletten: Bestand pruefen, Dubletten zusammenfuehren und
// den Neo4j-Abgleich nachholen. Nur fuer Admins.
const router = express.Router();

router.use((req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren dürfen Dubletten bereinigen' });
  next();
});

function mergeIdsFrom(body) {
  const keepId = Number(body?.keepId);
  const ids = (Array.isArray(body?.mergeIds) ? body.mergeIds : [body?.mergeId])
    .map(Number).filter(id => Number.isInteger(id) && id > 0 && id !== keepId);
  if (!Number.isInteger(keepId) || keepId <= 0 || ids.length === 0) {
    throw new MergeError('keepId und mindestens eine mergeId sind erforderlich');
  }
  return { keepId, mergeIds: [...new Set(ids)] };
}

function sendError(res, error, fallback) {
  if (error instanceof MergeError) return res.status(error.status).json({ error: error.message });
  console.error(fallback, error);
  return res.status(500).json({ error: fallback, details: error.message });
}

/**
 * @swagger
 * /duplicates:
 *   get:
 *     summary: Dubletten-Uebersicht (Bewerber und Stellen) und Status der Eindeutigkeitsregeln
 *     tags: [Duplicates]
 */
router.get('/', (req, res) => {
  try {
    res.json(duplicateOverview(db));
  } catch (error) {
    sendError(res, error, 'Fehler beim Laden der Dubletten');
  }
});

/**
 * @swagger
 * /duplicates/candidates/merge:
 *   post:
 *     summary: Bewerber zusammenfuehren (mergeIds werden in keepId uebernommen)
 *     tags: [Duplicates]
 */
router.post('/candidates/merge', (req, res) => {
  try {
    const { keepId, mergeIds } = mergeIdsFrom(req.body);
    let result = null;
    const merged = [];
    for (const mergeId of mergeIds) {
      result = mergeCandidates(db, keepId, mergeId);
      merged.push({ id: result.merged.id, name: result.merged.name });
    }
    logAudit(req, 'zusammengeführt', 'Candidate', keepId, result.candidate.name, { merged });
    // Neo4j: Knoten mit der UUID schreiben und die der zusammengefuehrten
    // Bewerber entfernen.
    syncGraphCandidatesInBackground([keepId], req);
    res.json({ candidate: result.candidate, merged });
  } catch (error) {
    sendError(res, error, 'Fehler beim Zusammenführen der Bewerber');
  }
});

/**
 * @swagger
 * /duplicates/jobs/merge:
 *   post:
 *     summary: Stellen zusammenfuehren (mergeIds werden in keepId uebernommen)
 *     tags: [Duplicates]
 */
router.post('/jobs/merge', async (req, res) => {
  try {
    const { keepId, mergeIds } = mergeIdsFrom(req.body);
    let result = null;
    const merged = [];
    for (const mergeId of mergeIds) {
      result = mergeJobs(db, keepId, mergeId);
      merged.push(result.merged);
    }
    logAudit(req, 'zusammengeführt', 'Job', keepId, result.job.title, { merged: merged.map(job => ({ id: job.id, title: job.title })) });
    const neo4jErrors = [];
    for (const job of merged) {
      try {
        await deleteJobFromGraphRag(req, job);
      } catch (error) {
        neo4jErrors.push({ id: job.id, error: error.message });
      }
    }
    res.json({ job: result.job, merged: merged.map(job => ({ id: job.id, title: job.title })), neo4jErrors });
  } catch (error) {
    sendError(res, error, 'Fehler beim Zusammenführen der Stellen');
  }
});

/**
 * @swagger
 * /duplicates/sync-candidates:
 *   post:
 *     summary: Neo4j-Abgleich fuer Bewerber nachholen, deren Knoten fehlt oder eine alte ID traegt
 *     tags: [Duplicates]
 */
router.post('/sync-candidates', async (req, res) => {
  try {
    const ids = db.prepare(
      'SELECT id FROM candidates WHERE graph_candidate_id IS DISTINCT FROM uuid::text ORDER BY id LIMIT 500'
    ).all().map(row => Number(row.id));
    const result = ids.length ? await syncGraphCandidates(ids, req) : { synced: 0, failed: 0, removed_stale_nodes: 0, errors: [] };
    const remaining = Number(db.prepare('SELECT COUNT(*) AS count FROM candidates WHERE graph_candidate_id IS DISTINCT FROM uuid::text').get()?.count) || 0;
    logAudit(req, 'neo4j-abgleich', 'Candidate', null, null, { requested: ids.length, synced: result.synced, failed: result.failed });
    res.json({ requested: ids.length, ...result, remaining });
  } catch (error) {
    res.status(502).json({ error: 'Neo4j-Abgleich fehlgeschlagen – ist GraphRAG erreichbar?', details: error.message });
  }
});

module.exports = router;
