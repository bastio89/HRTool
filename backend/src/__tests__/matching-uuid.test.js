/**
 * 3D-Matching ueber die UUID: Bewerber und Stellen werden in Neo4j per UUID
 * gesucht, fehlende Neo4j-Eintraege (z. B. manuell angelegter Bewerber) vor
 * dem Matching nachgeholt, und was dann noch fehlt, wird gemeldet statt
 * stillschweigend ausgelassen. GraphRAG wird per fetch-Mock ersetzt.
 * Laeuft gegen die echte Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');

// Mehr als 5 Matching-Aufrufe pro Minute: die Ratenbegrenzung ist hier aus.
jest.mock('../middleware/rateLimiter', () => ({
  ...jest.requireActual('../middleware/rateLimiter'),
  matchingRateLimiter: (req, res, next) => next(),
}));

const nativeFetch = global.fetch;
const db = require('../database');
const matchingRouter = require('../routes/matching');

const marker = `mu-${Date.now()}`;
let graphCalls = [];
let graphHandlers = {};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, res, next) => {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    next();
  });
  instance.use('/api/matching', matchingRouter);
  return instance;
}

const insertCandidate = (name) => db.prepare('INSERT INTO candidates (name, skills) VALUES (?, ?)').run(`${name} ${marker}`, 'Python').lastInsertRowid;
const insertJob = (title) => db.prepare('INSERT INTO jobs (title, skills) VALUES (?, ?)').run(`${title} ${marker}`, 'Python').lastInsertRowid;
const record = (table, id) => (table === 'candidates'
  ? db.prepare('SELECT id, uuid, name, graph_candidate_id AS graph_id FROM candidates WHERE id = ?').get(id)
  : db.prepare('SELECT id, uuid, title, graph_job_id AS graph_id FROM jobs WHERE id = ?').get(id));

// Wie GraphRAG: der Abgleich traegt die UUID als Neo4j-ID ein.
const markSynced = (table, ids) => {
  const column = table === 'candidates' ? 'graph_candidate_id' : 'graph_job_id';
  for (const id of ids) db.prepare(`UPDATE ${table} SET ${column} = uuid::text WHERE id = ?`).run(id);
};

function vectorRow(job, candidate, score) {
  return { jobId: job.uuid, jobTitle: 'Neo4j-Titel', candidateId: candidate.uuid, candidateName: 'Neo4j-Name', score, hardSkillScore: 0.5, softSkillScore: 0.2, matchedSkills: [] };
}

beforeEach(() => {
  graphCalls = [];
  graphHandlers = {
    '/sync/candidates': (body) => { markSynced('candidates', body.candidate_ids); return { synced: body.candidate_ids.length, failed: 0, errors: [] }; },
    '/sync/jobs': (body) => { markSynced('jobs', body.job_ids); return { synced: body.job_ids.length, failed: 0, errors: [] }; },
  };
  process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
  global.fetch = jest.fn(async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = options?.body ? JSON.parse(options.body) : null;
    graphCalls.push({ path, body });
    const handler = graphHandlers[path];
    if (!handler) return { ok: false, status: 404, json: async () => ({ detail: `kein Mock fuer ${path}` }) };
    const result = handler(body);
    if (result && result.__status) return { ok: false, status: result.__status, json: async () => result.body };
    return { ok: true, json: async () => result };
  });
});

afterAll(() => {
  global.fetch = nativeFetch;
  db.prepare('DELETE FROM candidates WHERE name LIKE ?').run(`%${marker}%`);
  db.prepare('DELETE FROM jobs WHERE title LIKE ?').run(`%${marker}%`);
  db.prepare('DELETE FROM candidate_texts WHERE candidate_name LIKE ?').run(`%${marker}%`);
});

describe('3D matching of selected pairs', () => {
  test('a manually created candidate without Neo4j entry is synced first and matched by UUID', async () => {
    const manual = insertCandidate('Manuel Manuell');
    const job = insertJob('Backend Engineer');
    const candidate = record('candidates', manual);
    const jobRecord = record('jobs', job);
    expect(candidate.graph_id).toBeNull();
    graphHandlers['/match/vectormatch'] = () => ({ type: 'vectormatch', model: 'graph-rag-python-skill-vector-match', matrix: [vectorRow(jobRecord, candidate, 73)], missingJobIds: [], missingCandidateIds: [] });

    const res = await request(app()).post('/api/matching/vectormatch-selected').send({ pairs: [{ jobId: job, candidateId: manual }], engine: 'python' });

    expect(res.status).toBe(200);
    expect(graphCalls.map(call => call.path)).toEqual(expect.arrayContaining(['/sync/candidates', '/sync/jobs']));
    const match = graphCalls.find(call => call.path === '/match/vectormatch');
    expect(match.body).toEqual({ jobIds: [jobRecord.uuid], cvIds: [candidate.uuid], engine: 'python' });
    expect(res.body.failures).toEqual([]);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ jobId: job, candidateId: manual, candidateName: `Manuel Manuell ${marker}`, sourceCandidateId: candidate.uuid, score: 73 });
    expect(db.prepare("SELECT score FROM matching_pair_results WHERE method = 'vector' AND candidate_id = ? AND job_id = ?").get(manual, job).score).toBe(73);
  });

  test('reports candidates that cannot be synced or are missing in Neo4j instead of dropping them', async () => {
    const ok = insertCandidate('Olga Ok');
    const broken = insertCandidate('Bruno Broken');
    const ghost = insertCandidate('Gina Geist');
    markSynced('candidates', [ok, ghost]);
    const job = insertJob('Data Scientist');
    markSynced('jobs', [job]);
    const [okRecord, ghostRecord, jobRecord] = [record('candidates', ok), record('candidates', ghost), record('jobs', job)];
    graphHandlers['/sync/candidates'] = () => ({ synced: 0, failed: 1, errors: [{ candidate_id: broken, error: 'Embedding-Dienst nicht erreichbar' }] });
    graphHandlers['/match/vectormatch'] = (body) => {
      expect(body.cvIds).toEqual([okRecord.uuid, ghostRecord.uuid]);
      return { matrix: [vectorRow(jobRecord, okRecord, 55)], missingJobIds: [], missingCandidateIds: [ghostRecord.uuid] };
    };

    const res = await request(app()).post('/api/matching/vectormatch-selected').send({
      pairs: [{ jobId: job, candidateId: ok }, { jobId: job, candidateId: broken }, { jobId: job, candidateId: ghost }, { jobId: job, candidateId: 999999999 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.results.map(row => row.candidateId)).toEqual([ok]);
    const failures = Object.fromEntries(res.body.failures.map(failure => [failure.candidateId, failure.error]));
    expect(failures[broken]).toBe('Bewerber nicht in Neo4j: Embedding-Dienst nicht erreichbar');
    expect(failures[ghost]).toBe('Kein Eintrag in Neo4j');
    expect(failures[999999999]).toBe('Bewerber nicht gefunden');
  });

  test('namesakes are kept apart because results are mapped by UUID, not by name', async () => {
    const first = insertCandidate('Max Gleich');
    const second = insertCandidate('Max Gleich');
    const job = insertJob('Frontend Engineer');
    markSynced('candidates', [first, second]);
    markSynced('jobs', [job]);
    const [a, b, jobRecord] = [record('candidates', first), record('candidates', second), record('jobs', job)];
    graphHandlers['/match/vectormatch'] = () => ({ matrix: [vectorRow(jobRecord, a, 90), vectorRow(jobRecord, b, 20)] });

    const res = await request(app()).post('/api/matching/vectormatch').send({ jobId: job, candidateIds: [first, second], engine: 'neo4j' });

    expect(res.status).toBe(200);
    const byCandidate = Object.fromEntries(res.body.results.matrix.map(row => [row.candidateId, row.score]));
    expect(byCandidate).toEqual({ [first]: 90, [second]: 20 });
    expect(graphCalls.some(call => call.path.startsWith('/sync'))).toBe(false);
  });
});

describe('3D matching candidate -> all jobs', () => {
  test('explains with the name when GraphRAG finds the candidate nowhere', async () => {
    const id = insertCandidate('Nina Nirgends');
    markSynced('candidates', [id]);
    const candidate = record('candidates', id);
    graphHandlers['/match/vectormatch'] = () => ({ __status: 404, body: { detail: { error: 'Keiner der angegebenen Bewerber ist in Neo4j vorhanden', missingJobIds: [], missingCandidateIds: [candidate.uuid] } } });

    const res = await request(app()).post('/api/matching/vectormatch').send({ direction: 'candidate_to_jobs', candidateId: id });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(`Keiner der angegebenen Bewerber ist in Neo4j vorhanden: Nina Nirgends ${marker}`);
    const match = graphCalls.find(call => call.path === '/match/vectormatch');
    expect(match.body.cvIds).toEqual([candidate.uuid]);
    expect(match.body).not.toHaveProperty('candidateNames');
  });

  test('fails clearly when the candidate cannot be synced', async () => {
    const id = insertCandidate('Sina Syncfehler');
    graphHandlers['/sync/candidates'] = () => ({ __status: 503, body: { detail: 'GraphRAG nicht bereit' } });

    const res = await request(app()).post('/api/matching/vectormatch').send({ direction: 'candidate_to_jobs', candidateId: id });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Sina Syncfehler .* ist nicht in Neo4j und konnte nicht übertragen werden: Abgleich mit Neo4j fehlgeschlagen: GraphRAG nicht bereit/);
    expect(graphCalls.some(call => call.path === '/match/vectormatch')).toBe(false);
  });
});

describe('KI matching of selected pairs', () => {
  test('resolves UUIDs to PostgreSQL ids and gives manual candidates their CV text first', async () => {
    const id = insertCandidate('Karl Ki');
    const job = insertJob('ML Engineer');
    const [candidate, jobRecord] = [record('candidates', id), record('jobs', job)];
    graphHandlers['/match/ki_match_pairs'] = (body) => ({
      results: body.pairs.map(pair => ({ ...pair, score: 81, strengths: [], weaknesses: [], summary: 'ok' })),
      failures: [],
      matchedCount: body.pairs.length,
    });

    const res = await request(app()).post('/api/matching/run-selected').send({
      pairs: [
        { sourceJobId: jobRecord.uuid, sourceCandidateId: candidate.uuid },
        { jobId: job, candidateId: 'gibt-es-nicht' },
      ],
    });

    expect(res.status).toBe(200);
    expect(graphCalls.map(call => call.path)).toEqual(['/sync/candidates', '/match/ki_match_pairs']);
    expect(graphCalls[1].body.pairs).toEqual([{ jobId: String(job), jobTitle: `ML Engineer ${marker}`, candidateId: String(id), candidateName: `Karl Ki ${marker}` }]);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.failures).toEqual([expect.objectContaining({ candidateId: 'gibt-es-nicht', error: 'Bewerber nicht gefunden' })]);
    expect(res.body.failedCount).toBe(1);
  });
});
