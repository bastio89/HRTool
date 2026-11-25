/**
 * 3D-Matching ueber die UUID: Bewerber und Stellen werden in Neo4j per UUID
 * gesucht, fehlende Neo4j-Eintraege (z. B. manuell angelegter Bewerber) vor
 * dem Matching nachgeholt, und was dann noch fehlt, wird gemeldet statt
 * stillschweigend ausgelassen. GraphRAG wird per fetch-Mock ersetzt.
 * Laeuft gegen die echte Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');
const { randomUUID } = require('node:crypto');

// Mehr als 5 Matching-Aufrufe pro Minute: die Ratenbegrenzung ist hier aus.
jest.mock('../middleware/rateLimiter', () => ({
  ...jest.requireActual('../middleware/rateLimiter'),
  matchingRateLimiter: (req, res, next) => next(),
}));
jest.mock('../middleware/apiKey', () => (req, res, next) => next());

const nativeFetch = global.fetch;
const db = require('../database');
const matchingRouter = require('../routes/matching');

const marker = `mu-${Date.now()}`;
let graphCalls = [];
let graphHandlers = {};

function app(userId = 1) {
  const instance = express();
  instance.use(express.json());
  instance.use((req, res, next) => {
    req.user = { id: userId, username: 'admin', role: 'admin' };
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
  return { method: 'vector', qualified: true, jobId: job.uuid, jobTitle: 'Neo4j-Titel', candidateId: candidate.uuid, candidateName: 'Neo4j-Name', score, hardSkillScore: 0.5, softSkillScore: 0.2, matchedSkills: [] };
}

beforeEach(() => {
  graphCalls = [];
  graphHandlers = {
    '/sync/candidates': (body) => { markSynced('candidates', body.candidate_ids); return { synced: body.candidate_ids.length, failed: 0, errors: [] }; },
    '/sync/jobs': (body) => { markSynced('jobs', body.job_ids); return { synced: body.job_ids.length, failed: 0, errors: [] }; },
  };
  process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
  process.env.GRAPHRAG_API_KEY = 'matching-test-api-key';
  global.fetch = jest.fn(async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = options?.body ? JSON.parse(options.body) : null;
    graphCalls.push({ path, body, headers: options?.headers });
    const handler = graphHandlers[path];
    if (!handler) return { ok: false, status: 404, json: async () => ({ detail: `kein Mock fuer ${path}` }) };
    const result = handler(body);
    if (result && result.__status) return { ok: result.__status >= 200 && result.__status < 300, status: result.__status, json: async () => result.body };
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
    graphHandlers['/match/vectormatch-selected'] = () => ({ mode: 'vector', model: 'graph-rag-python-skill-vector-match', results: [vectorRow(jobRecord, candidate, 73)], failures: [] });

    const res = await request(app()).post('/api/matching/vectormatch-selected').send({ pairs: [{ jobId: job, candidateId: manual }], engine: 'python' });

    expect(res.status).toBe(200);
    expect(graphCalls.map(call => call.path)).toEqual(expect.arrayContaining(['/sync/candidates', '/sync/jobs']));
    const match = graphCalls.find(call => call.path === '/match/vectormatch-selected');
    expect(match.body).toEqual({ pairs: [{ jobId: job, candidateId: manual }], engine: 'python', localFailures: [], selectedCount: 1 });
    expect(res.body.failures).toEqual([]);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ jobId: job, candidateId: manual, candidateName: `Manuel Manuell ${marker}`, sourceCandidateId: candidate.uuid, score: 73 });
    expect(res.body).toMatchObject({ method: 'vector', pairsPersisted: true });
    expect(res.body.results[0]).toMatchObject({ method: 'vector', qualified: true });
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
    graphHandlers['/match/vectormatch-selected'] = (body) => {
      expect(body.pairs).toEqual([{ jobId: job, candidateId: ok }, { jobId: job, candidateId: ghost }]);
      return { results: [vectorRow(jobRecord, okRecord, 55)], failures: [
        ...body.localFailures, { jobId: job, candidateId: ghost, error: 'Kein Eintrag in Neo4j' },
      ] };
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

  test('selected skill pairs preserve zero and gate without any AI endpoint', async () => {
    const id = insertCandidate('Gated Skill');
    const job = insertJob('Gated Job');
    const [candidate, jobRecord] = [record('candidates', id), record('jobs', job)];
    graphHandlers['/match/vectormatch-selected'] = () => ({ method: 'vector', results: [{ ...vectorRow(jobRecord, candidate, 0), qualified: false }], failures: [] });
    const res = await request(app()).post('/api/matching/vectormatch-selected').send({ pairs: [{ jobId: job, candidateId: id }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ jobId: job, candidateId: id, method: 'vector', score: 0, qualified: false });
    expect(graphCalls.some(call => call.path.includes('ki_match'))).toBe(false);
    expect(db.prepare("SELECT score, qualified FROM matching_pair_results WHERE method = 'vector' AND candidate_id = ? AND job_id = ?").get(id, job)).toMatchObject({ score: 0, qualified: false });
  });

  test('selected skill pairs report a write failure instead of returning an unpersisted success', async () => {
    const id = insertCandidate('Write Failure');
    const job = insertJob('Write Failure Job');
    const [candidate, jobRecord] = [record('candidates', id), record('jobs', job)];
    graphHandlers['/match/vectormatch-selected'] = () => ({ results: [vectorRow(jobRecord, candidate, 50)], failures: [] });
    const prepare = db.prepare.bind(db);
    const spy = jest.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.includes('INSERT INTO matching_pair_results')) throw new Error('Pair write failed');
      return prepare(sql);
    });
    try {
      const res = await request(app()).post('/api/matching/vectormatch-selected').send({ pairs: [{ jobId: job, candidateId: id }] });
      expect(res.status).toBe(500);
      expect(res.body.details).toBe('Pair write failed');
    } finally {
      spy.mockRestore();
    }
  });
});

test('external skill adapter preserves stored IDs, priorities, categories and zero metadata', async () => {
  const id = insertCandidate('External Skill');
  const job = insertJob('External Job');
  const requiredSkills = [{ name: 'Python', priority: 'NiceToHave', category: 'HardSkill' }];
  const candidateSkills = [{ name: 'Python', category: 'HardSkill' }];
  graphHandlers['/match/external/run'] = body => {
    expect(body.job.required_skills).toEqual(requiredSkills);
    expect(body.candidates[0]).toMatchObject({ id, has_skill: candidateSkills });
    return { method: 'vector', results: [{ jobId: job, candidateId: id, score: 0, qualified: false, method: 'vector' }] };
  };
  const res = await request(app()).post('/api/matching/external/run').send({
    job: { id: job, title: 'Prepared Job', required_skills: requiredSkills },
    candidates: [{ id, name: 'Prepared Candidate', has_skill: candidateSkills }],
  });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ method: 'vector', pairsPersisted: true });
  expect(res.body.results[0]).toMatchObject({ candidateId: id, externalCandidateId: String(id), score: 0, qualified: false, method: 'vector' });
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
  test.each([
    { jobDescription: 'Python Engineer', candidateIds: [1] },
    { jobId: 1 },
    { jobId: 1, candidateIds: [] },
    { jobId: 1, candidateNames: ['Alice'] },
    { jobDescription: 'Python Engineer' },
  ])('rejects implicit selection or free text before any remote call: %j', async (payload) => {
    const res = await request(app()).post('/api/matching/run').send(payload);
    expect(res.status).toBe(400);
    expect(graphCalls).toEqual([]);
  });

  describe('durable matching proxy', () => {
    const runIds = [];
    beforeAll(() => {
      // GraphRAG owns this table; HTTP mocks need its persistence contract too.
      db.exec(`CREATE TABLE IF NOT EXISTS matching_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), import_event_key TEXT UNIQUE,
        source TEXT NOT NULL, request_kind TEXT NOT NULL DEFAULT 'import',
        method TEXT NOT NULL DEFAULT 'vector', entity_type TEXT, entity_id BIGINT,
        actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, stage TEXT NOT NULL DEFAULT 'queued',
        target_count BIGINT, expansion_cursor BIGINT, lease_owner UUID, lease_until TIMESTAMPTZ,
        error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec('ALTER TABLE matching_runs ADD COLUMN IF NOT EXISTS client_context JSONB');
      db.exec('ALTER TABLE matching_runs ADD COLUMN IF NOT EXISTS result_payload JSONB');
    });
    afterAll(() => {
      for (const runId of runIds) {
        db.prepare('DELETE FROM matching_results WHERE matching_run_id = ?').run(runId);
        db.prepare('DELETE FROM matching_runs WHERE id = ?').run(runId);
      }
    });

    function run(method = 'vector') {
      const id = randomUUID();
      db.prepare(`INSERT INTO matching_runs (id, source, request_kind, actor_user_id, method, stage)
        VALUES (?, '/match/test', 'interactive', 1, ?, 'matching')`).run(id, method);
      runIds.push(id);
      return id;
    }

    test.each([
      ['/vectormatch', '/match/vectormatch', 'vector'],
      ['/run-matrix', '/match/external/matrix', 'vector'],
      ['/run', '/match/ki_match_pairs', 'ai'],
    ])('%s preserves pending and completes exactly one history entry across polling', async (route, endpoint, method) => {
      const candidateId = insertCandidate(`Durable Candidate ${route}`);
      const jobId = insertJob(`Durable Job ${route}`);
      const candidate = record('candidates', candidateId);
      const job = record('jobs', jobId);
      markSynced('candidates', [candidateId]);
      markSynced('jobs', [jobId]);
      const runId = run(method);
      const statusPath = `/matching/runs/${runId}`;
      const pending = {
        runId, status: 'pending', statusUrl: statusPath,
        pendingPairs: [{ method, jobId: String(jobId), candidateId: String(candidateId), status: 'queued' }],
        availableResults: [],
      };
      graphHandlers[endpoint] = () => ({ __status: 202, body: pending });
      graphHandlers[statusPath] = () => ({ ...pending, stage: 'matching', resultPayload: null });
      const payload = {
        jobId, candidateIds: method === 'ai' ? [candidateId, 999999999] : [candidateId],
        jobIds: [jobId], engine: 'python',
      };
      const response = await request(app()).post(`/api/matching${route}`)
        .set('Authorization', 'Bearer durable-user').send(payload);
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ runId, status: 'pending', statusUrl: `/api/matching/runs/${runId}` });
      expect(response.body).not.toHaveProperty('score');
      expect(db.prepare('SELECT id FROM matching_results WHERE matching_run_id = ?').get(runId)).toBeUndefined();
      const savedContext = db.prepare('SELECT client_context FROM matching_runs WHERE id = ?').get(runId).client_context;
      expect(JSON.stringify(savedContext)).not.toContain('durable-user');
      expect((await request(app()).get(response.body.statusUrl)).body.stage).toBe('matching');
      expect((await request(app(999999999)).get(response.body.statusUrl)).status).toBe(404);

      const matchedAt = '2025-01-03T11:12:13Z';
      const row = {
        ...vectorRow(job, candidate, 0), method, qualified: method === 'ai' ? null : false,
        ...(route === '/run-matrix' ? { jobId, candidateId } : {}),
        evaluationId: 1234, cacheStatus: 'hit', model: 'original-model', matchedAt,
      };
      const result = {
        runId, statusUrl: statusPath, method, pairsPersisted: true, model: 'original-model',
        ...(method === 'ai' ? { results: [row], failures: [] } : { matrix: [row] }),
      };
      db.prepare("UPDATE matching_runs SET stage = 'completed', result_payload = ?::jsonb WHERE id = ?")
        .run(JSON.stringify(result), runId);
      graphHandlers[statusPath] = () => ({
        runId, stage: 'completed', pendingPairs: [], availableResults: [row],
        updatedAt: matchedAt, resultPayload: result,
      });
      const prepare = db.prepare.bind(db);
      const spy = jest.spyOn(db, 'prepare').mockImplementation(sql => {
        if (sql.includes('INSERT INTO matching_pair_results')) throw new Error('Second pair persistence');
        return prepare(sql);
      });
      try {
        const first = await request(app()).get(response.body.statusUrl).set('Authorization', 'Bearer durable-user');
        const second = await request(app()).get(response.body.statusUrl).set('Authorization', 'Bearer durable-user');
        expect(first.status).toBe(200);
        expect(second.body.resultPayload).toEqual(first.body.resultPayload);
        const complete = first.body.resultPayload;
        expect(complete).toMatchObject({ runId, candidateCount: method === 'ai' ? 2 : 1 });
        if (method === 'ai') expect(complete.results.failures).toEqual([
          expect.objectContaining({ candidateId: 999999999, error: 'Bewerber nicht gefunden' }),
        ]);
        expect((complete.results.matrix || complete.results.results)[0]).toMatchObject({
          jobId, candidateId, score: 0, qualified: row.qualified,
          evaluationId: 1234, cacheStatus: 'hit', model: 'original-model', matchedAt,
        });
        const histories = db.prepare('SELECT * FROM matching_results WHERE matching_run_id = ?').all(runId);
        expect(histories).toHaveLength(1);
        expect(histories[0]).toMatchObject({ id: complete.id, pairs_recorded: 1 });
        const stored = JSON.parse(histories[0].results);
        expect((stored.matrix || stored.results)[0]).toMatchObject({ cacheStatus: 'hit', evaluationId: 1234, matchedAt });
        expect(graphCalls.filter(call => call.path === endpoint)).toHaveLength(1);
        expect(graphCalls.filter(call => call.path === statusPath).at(-1).headers.Authorization).toBe('Bearer durable-user');
      } finally {
        spy.mockRestore();
      }
    });

    test('selected multi-job skills use one durable parent without losing local failures', async () => {
      const candidateId = insertCandidate('Parent Candidate');
      const firstJob = insertJob('Parent First Job');
      const secondJob = insertJob('Parent Second Job');
      markSynced('candidates', [candidateId]);
      markSynced('jobs', [firstJob, secondJob]);
      const runId = run();
      let forwarded;
      graphHandlers['/match/vectormatch-selected'] = body => {
        forwarded = body;
        return { __status: 202, body: {
          runId, status: 'pending', statusUrl: `/matching/runs/${runId}`, pendingPairs: [], availableResults: [],
        } };
      };
      const response = await request(app()).post('/api/matching/vectormatch-selected').send({
        pairs: [
          { jobId: firstJob, candidateId }, { jobId: secondJob, candidateId },
          { jobId: firstJob, candidateId: 999999999 },
        ],
      });
      expect(response.status).toBe(202);
      expect(forwarded.pairs).toEqual([{ jobId: firstJob, candidateId }, { jobId: secondJob, candidateId }]);
      expect(forwarded.localFailures).toEqual([expect.objectContaining({ error: 'Bewerber nicht gefunden' })]);
      expect(forwarded.selectedCount).toBe(3);
      expect(graphCalls.map(call => call.path)).toEqual(['/match/vectormatch-selected']);
      graphHandlers[`/matching/runs/${runId}`] = () => ({
        runId, stage: 'completed_with_errors', resultPayload: {
          runId, method: 'vector', mode: 'vector', pairsPersisted: true,
          results: [
            { jobId: firstJob, candidateId, score: 50, method: 'vector', qualified: false },
            { jobId: secondJob, candidateId, score: 70, method: 'vector', qualified: true },
          ],
          failures: forwarded.localFailures,
        },
      });
      const completed = await request(app()).get(response.body.statusUrl);
      expect(completed.status).toBe(200);
      expect(completed.body.resultPayload).toMatchObject({ runId, selectedCount: 3, matchedCount: 2, failedCount: 1 });
      expect(completed.body.resultPayload.failures).toEqual(forwarded.localFailures);
    });
  });

  test('run delegates explicit stored UUID pairs and forwards both authentication headers', async () => {
    const id = insertCandidate('Selected Ai');
    const job = insertJob('Selected Job');
    const [candidate, jobRecord] = [record('candidates', id), record('jobs', job)];
    graphHandlers['/match/ki_match_pairs'] = (body) => ({
      method: 'ai', model: 'selected-ai', matchedCount: 1,
      results: body.pairs.map(pair => ({ ...pair, method: 'ai', qualified: null, score: 85, strengths: [], weaknesses: [], summary: 'AI only' })),
      failures: [],
    });
    const res = await request(app()).post('/api/matching/run')
      .set('Authorization', 'Bearer selected-user')
      .send({ jobId: jobRecord.uuid, candidateIds: [candidate.uuid] });

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(job);
    expect(res.body.results.results[0]).toMatchObject({ method: 'ai', qualified: null, score: 85 });
    const call = graphCalls.find(item => item.path === '/match/ki_match_pairs');
    expect(call.body.pairs).toEqual([{ jobId: String(job), jobTitle: jobRecord.title, candidateId: String(id), candidateName: candidate.name }]);
    expect(call.headers).toMatchObject({ Authorization: 'Bearer selected-user', 'X-API-Key': 'matching-test-api-key' });
    expect(db.prepare("SELECT score FROM matching_pair_results WHERE method = 'ai' AND candidate_id = ? AND job_id = ?").get(id, job).score).toBe(85);
    db.prepare('DELETE FROM matching_results WHERE id = ?').run(res.body.id);
  });

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
