/**
 * Dubletten im Bestand: Uebersicht und Zusammenfuehren (Administration ->
 * Dubletten). Altlasten werden hier direkt per SQL angelegt, wie sie vor den
 * Eindeutigkeitsregeln entstehen konnten.
 * Laeuft gegen die echte Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');

const nativeFetch = global.fetch;
const db = require('../database');
const duplicatesRouter = require('../routes/duplicates');
const { identityIndexStatus } = require('../identity');
const { recordMatchingPairs } = require('../matchingPairs');

const marker = `dup-${Date.now()}`;
let graphCalls = [];

function app(role = 'admin') {
  const instance = express();
  instance.use(express.json());
  instance.use((req, res, next) => {
    req.user = { id: 1, username: role, role };
    next();
  });
  instance.use('/api/duplicates', duplicatesRouter);
  return instance;
}

const insertCandidate = (name, extra = {}) => db.prepare(
  'INSERT INTO candidates (name, email, phone, birth_date, graph_candidate_id) VALUES (?, ?, ?, ?, ?)'
).run(name, extra.email ?? null, extra.phone ?? null, extra.birth_date ?? null, extra.graph ?? null).lastInsertRowid;

beforeEach(() => {
  graphCalls = [];
  process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
  global.fetch = jest.fn(async (url, options) => {
    graphCalls.push({ url: String(url), method: options?.method, body: options?.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => ({ synced: 1, failed: 0, removed_stale_nodes: 1, errors: [], deleted: true }) };
  });
});

afterAll(() => {
  global.fetch = nativeFetch;
  db.prepare('DELETE FROM candidates WHERE name LIKE ?').run(`%${marker}%`);
  db.prepare('DELETE FROM jobs WHERE title LIKE ?').run(`%${marker}%`);
  db.prepare('DELETE FROM candidate_texts WHERE candidate_name LIKE ?').run(`%${marker}%`);
});

describe('duplicate overview', () => {
  test('is reserved for admins', async () => {
    const res = await request(app('recruiter')).get('/api/duplicates');
    expect(res.status).toBe(403);
  });

  test('lists possible duplicates but not namesakes with different birth dates', async () => {
    const anna = insertCandidate(`Anna Alt ${marker}`, { email: `anna.${marker}@example.com` });
    const annaCopy = insertCandidate(`anna alt ${marker}`, { email: `ANNA.${marker}@example.com `, birth_date: '1990-02-14' });
    insertCandidate(`Ben Namensvetter ${marker}`, { birth_date: '1980-01-01' });
    insertCandidate(`Ben Namensvetter ${marker}`, { birth_date: '1985-05-05' });

    const res = await request(app()).get('/api/duplicates');
    expect(res.status).toBe(200);
    const ours = res.body.candidates.groups.filter(group => group.members.some(member => member.name.includes(marker)));
    // Gleiche E-Mail und gleicher Name ergeben dieselbe Gruppe - sie wird nur einmal gezeigt.
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ reason: 'email', ids: [anna, annaCopy] });
    expect(res.body.candidates.withoutBirthDate).toBeGreaterThanOrEqual(1);
    expect(res.body.rules.map(rule => rule.key)).toEqual(expect.arrayContaining(['candidates_identity', 'jobs_url']));
  });
});

describe('merging candidates', () => {
  test('moves everything to the kept candidate and queues the Neo4j cleanup', async () => {
    const keep = insertCandidate(`Clara Keep ${marker}`, { email: `clara.${marker}@example.com` });
    const merge = insertCandidate(`Clara Keep ${marker}`, { email: `clara.${marker}@example.com`, birth_date: '1991-03-04', phone: '+41 79 111 22 33', graph: 'old-neo4j-node' });
    const job = db.prepare('INSERT INTO jobs (title) VALUES (?)').run(`Merge Job ${marker}`).lastInsertRowid;
    const otherJob = db.prepare('INSERT INTO jobs (title) VALUES (?)').run(`Other Job ${marker}`).lastInsertRowid;

    // Beide stehen in derselben Pipeline; das Interview haengt am wegfallenden Eintrag.
    const keepEntry = db.prepare('INSERT INTO pipeline_entries (job_id, candidate_id, stage) VALUES (?, ?, ?)').run(job, keep, 'Beworben').lastInsertRowid;
    const mergeEntry = db.prepare('INSERT INTO pipeline_entries (job_id, candidate_id, stage) VALUES (?, ?, ?)').run(job, merge, 'Interview').lastInsertRowid;
    const ownEntry = db.prepare('INSERT INTO pipeline_entries (job_id, candidate_id, stage) VALUES (?, ?, ?)').run(otherJob, merge, 'Angebot').lastInsertRowid;
    const interview = db.prepare('INSERT INTO interviews (pipeline_entry_id, candidate_id, job_id, interview_date) VALUES (?, ?, ?, ?)').run(mergeEntry, merge, job, '2026-12-01').lastInsertRowid;
    db.prepare('INSERT INTO pipeline_notes (pipeline_entry_id, content) VALUES (?, ?)').run(mergeEntry, 'Wichtige Notiz');
    db.prepare("INSERT INTO candidate_texts (candidate_id, candidate_name, original_text) VALUES (CAST(? AS TEXT), ?, 'CV-Text') RETURNING candidate_id").run(merge, `Clara Keep ${marker}`);
    recordMatchingPairs(db, 'vector', [{ candidateId: merge, jobId: otherJob, score: 77 }]);
    const mergeUuid = db.prepare('SELECT uuid FROM candidates WHERE id = ?').get(merge).uuid;

    const res = await request(app()).post('/api/duplicates/candidates/merge').send({ keepId: keep, mergeIds: [merge] });
    expect(res.status).toBe(200);
    expect(res.body.candidate).toMatchObject({ id: keep, birth_date: '1991-03-04', phone: '+41 79 111 22 33' });

    expect(db.prepare('SELECT 1 FROM candidates WHERE id = ?').get(merge)).toBeUndefined();
    expect(db.prepare('SELECT pipeline_entry_id, candidate_id FROM interviews WHERE id = ?').get(interview))
      .toEqual({ pipeline_entry_id: keepEntry, candidate_id: keep });
    expect(db.prepare('SELECT COUNT(*) AS count FROM pipeline_notes WHERE pipeline_entry_id = ?').get(keepEntry).count).toBe(1);
    expect(db.prepare('SELECT candidate_id FROM pipeline_entries WHERE id = ?').get(ownEntry).candidate_id).toBe(keep);
    expect(db.prepare('SELECT 1 AS ok FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').get(keep)).toEqual({ ok: 1 });
    expect(db.prepare("SELECT candidate_id FROM matching_pair_results WHERE method = 'vector' AND job_id = ?").get(otherJob).candidate_id).toBe(keep);
    const graphIds = db.prepare('SELECT graph_candidate_ids FROM candidates WHERE id = ?').get(keep).graph_candidate_ids;
    expect(graphIds).toEqual(expect.arrayContaining([mergeUuid, 'old-neo4j-node']));

    await new Promise(resolve => setImmediate(resolve));
    expect(graphCalls.find(call => call.url.endsWith('/sync/candidates')).body).toEqual({ candidate_ids: [keep] });
  });

  test('rejects merging a candidate into itself', async () => {
    const id = insertCandidate(`Solo ${marker}`);
    const res = await request(app()).post('/api/duplicates/candidates/merge').send({ keepId: id, mergeIds: [id] });
    expect(res.status).toBe(400);
  });
});

describe('merging jobs', () => {
  test('cleans up legacy job duplicates and activates the uniqueness rule afterwards', async () => {
    db.exec('DROP INDEX IF EXISTS uq_jobs_url');
    const url = `https://jobs.example.com/${marker}`;
    const keep = db.prepare('INSERT INTO jobs (title, url) VALUES (?, ?)').run(`Data Engineer ${marker}`, url).lastInsertRowid;
    const merge = db.prepare('INSERT INTO jobs (title, url, company) VALUES (?, ?, ?)').run(`Data Engineer (alt) ${marker}`, `${url}/`, 'DataCorp').lastInsertRowid;
    const candidate = insertCandidate(`Job Kandidat ${marker}`);
    const entry = db.prepare('INSERT INTO pipeline_entries (job_id, candidate_id) VALUES (?, ?)').run(merge, candidate).lastInsertRowid;
    const mergeUuid = db.prepare('SELECT uuid FROM jobs WHERE id = ?').get(merge).uuid;
    expect(identityIndexStatus(db).find(rule => rule.key === 'jobs_url').active).toBe(false);

    const overview = await request(app()).get('/api/duplicates');
    expect(overview.body.jobs.groups.some(group => group.reason === 'url' && group.ids.includes(keep) && group.ids.includes(merge))).toBe(true);

    const res = await request(app()).post('/api/duplicates/jobs/merge').send({ keepId: keep, mergeIds: [merge] });
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id: keep, company: 'DataCorp' });
    expect(db.prepare('SELECT job_id FROM pipeline_entries WHERE id = ?').get(entry).job_id).toBe(keep);
    expect(graphCalls.find(call => call.method === 'DELETE').body).toMatchObject({ scope: 'neo4j', job_id: mergeUuid });
    expect(identityIndexStatus(db).find(rule => rule.key === 'jobs_url').active).toBe(true);
  });
});

describe('Neo4j sync', () => {
  test('syncs candidates whose Neo4j node is missing or outdated', async () => {
    const id = insertCandidate(`Sync Kandidat ${marker}`);
    const res = await request(app()).post('/api/duplicates/sync-candidates').send({});
    expect(res.status).toBe(200);
    const call = graphCalls.find(entry => entry.url.endsWith('/sync/candidates'));
    expect(call.body.candidate_ids).toContain(id);
    expect(res.body).toMatchObject({ synced: 1 });
  });
});
