/**
 * Eindeutige Identitaet: Eine Person gibt es nur einmal (Name + Geburtsdatum,
 * Geburtsdatum Pflicht), eine Stelle nur einmal (URL oder Titel + Firma +
 * Ort). Jeder Datensatz traegt eine UUID, die auch der Neo4j-Knoten nutzt.
 * Laeuft gegen die echte Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');

const nativeFetch = global.fetch;
const db = require('../database');
const candidatesRouter = require('../routes/candidates');
const jobsRouter = require('../routes/jobs');
const { identityIndexStatus, normalizeBirthDate } = require('../identity');

const marker = `id-${Date.now()}`;
const createdCandidates = [];
const createdJobs = [];
let graphCalls = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/candidates', candidatesRouter);
  app.use('/api/jobs', jobsRouter);
  return app;
}

const app = buildApp();
const person = (overrides = {}) => ({ name: `Lena Lorenz ${marker}`, birth_date: '14.02.1990', email: `lena.${marker}@example.com`, ...overrides });

beforeEach(() => {
  graphCalls = [];
  process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
  global.fetch = jest.fn(async (url, options) => {
    graphCalls.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null, method: options?.method });
    const jobId = new URL(String(url)).searchParams.get('job_id');
    return { ok: true, json: async () => ({ id: jobId || 'graph-id', deleted: true, profile: {} }) };
  });
});

afterAll(() => {
  global.fetch = nativeFetch;
  if (createdCandidates.length) {
    db.prepare(`DELETE FROM candidates WHERE id IN (${createdCandidates.map(() => '?').join(',')})`).run(...createdCandidates);
  }
  db.prepare("DELETE FROM candidates WHERE name LIKE ?").run(`%${marker}%`);
  if (createdJobs.length) {
    db.prepare(`DELETE FROM jobs WHERE id IN (${createdJobs.map(() => '?').join(',')})`).run(...createdJobs);
  }
  db.prepare("DELETE FROM jobs WHERE title LIKE ?").run(`%${marker}%`);
});

describe('birth date', () => {
  test('accepts German and ISO dates and rejects impossible ones', () => {
    expect(normalizeBirthDate('3.7.1985')).toBe('1985-07-03');
    expect(normalizeBirthDate('03/07/1985')).toBe('1985-07-03');
    expect(normalizeBirthDate('1985-07-03')).toBe('1985-07-03');
    expect(normalizeBirthDate('')).toBeNull();
    expect(() => normalizeBirthDate('31.02.1990')).toThrow(/Ungültiges Geburtsdatum/);
    expect(() => normalizeBirthDate('01.01.2999')).toThrow(/Unplausibles/);
    expect(() => normalizeBirthDate('gestern')).toThrow();
  });
});

describe('candidates are unique by name and birth date', () => {
  test('the identity indexes are active', () => {
    const status = Object.fromEntries(identityIndexStatus(db).map(entry => [entry.key, entry.active]));
    expect(status).toMatchObject({ candidates_uuid: true, candidates_identity: true, jobs_uuid: true });
  });

  test('the birth date is optional, but an invalid one is rejected', async () => {
    const invalid = await request(app).post('/api/candidates').send(person({ birth_date: '31.02.1990' }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.field).toBe('birth_date');

    // Ohne Geburtsdatum keine Dublettenpruefung: Namensvettern sind erlaubt.
    const first = await request(app).post('/api/candidates').send(person({ name: `Ohne Datum ${marker}`, birth_date: '' }));
    const second = await request(app).post('/api/candidates').send(person({ name: `Ohne Datum ${marker}`, birth_date: null }));
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.birth_date).toBeNull();
    db.prepare('DELETE FROM candidates WHERE id IN (?, ?)').run(first.body.id, second.body.id);
  });

  test('creates the candidate with a UUID and queues the Neo4j sync', async () => {
    const res = await request(app).post('/api/candidates').send(person());
    expect(res.status).toBe(201);
    createdCandidates.push(res.body.id);
    expect(res.body.birth_date).toBe('1990-02-14');
    expect(res.body.uuid).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise(resolve => setImmediate(resolve));
    expect(graphCalls.find(call => call.url.endsWith('/sync/candidates')).body).toEqual({ candidate_ids: [res.body.id] });
  });

  test('blocks the same person regardless of case, spacing and date format', async () => {
    const res = await request(app).post('/api/candidates').send(person({ name: `  lena   LORENZ ${marker} `, birth_date: '1990-02-14', email: 'andere@example.com' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_CANDIDATE');
    expect(res.body.existing.id).toBe(createdCandidates[0]);
    expect(res.body.error).toMatch(/bereits im Tool angelegt/);
  });

  test('allows a namesake with a different birth date', async () => {
    const res = await request(app).post('/api/candidates').send(person({ birth_date: '15.02.1990' }));
    expect(res.status).toBe(201);
    createdCandidates.push(res.body.id);
  });

  test('blocks renaming into an existing person and allows removing the birth date on update', async () => {
    const [first, second] = createdCandidates;
    const clash = await request(app).put(`/api/candidates/${second}`).send(person({ birth_date: '14.02.1990' }));
    expect(clash.status).toBe(409);
    expect(clash.body.existing.id).toBe(first);

    const withoutDate = await request(app).put(`/api/candidates/${second}`).send(person({ birth_date: null }));
    expect(withoutDate.status).toBe(200);
    expect(withoutDate.body.birth_date).toBeNull();
    const restored = await request(app).put(`/api/candidates/${second}`).send(person({ birth_date: '15.02.1990' }));
    expect(restored.status).toBe(200);

    const ok = await request(app).put(`/api/candidates/${first}`).send(person({ location: 'Bern' }));
    expect(ok.status).toBe(200);
    expect(ok.body.location).toBe('Bern');
  });

  test('check-duplicate marks name + birth date as blocking and name alone as hint', async () => {
    const res = await request(app).post('/api/candidates/check-duplicate').send({ name: person().name, birth_date: '14.02.1990' });
    expect(res.status).toBe(200);
    const blocking = res.body.duplicates.filter(entry => entry.blocking);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toMatchObject({ id: createdCandidates[0], matchType: 'identity' });
    expect(res.body.duplicates.some(entry => entry.id === createdCandidates[1] && entry.matchType === 'name' && !entry.blocking)).toBe(true);
  });

  test('the database rejects a duplicate even when the check is bypassed', () => {
    expect(() => db.prepare('INSERT INTO candidates (name, birth_date) VALUES (?, ?)').run(`LENA LORENZ ${marker}`, '1990-02-14'))
      .toThrow(/uq_candidates_identity/);
  });

  test('CSV import accepts rows without birth date and skips duplicates, also within the file', async () => {
    const res = await request(app).post('/api/candidates/import').send({
      skipDuplicates: false,
      rows: [
        { name: `Mara Moser ${marker}`, birth_date: '1988-11-02' },
        { name: `mara moser ${marker}`, birth_date: '02.11.1988' },
        { name: `Lena Lorenz ${marker}`, birth_date: '14.02.1990' },
        { name: `Ohne Datum ${marker}` },
        { name: `Falsches Datum ${marker}`, birth_date: '30.02.1990' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 5, imported: 2, skipped: 2, errors: 1 });
    expect(res.body.duplicates.map(entry => entry.row)).toEqual([2, 3]);
    expect(res.body.errorDetails.map(entry => entry.row)).toEqual([5]);
    expect(db.prepare('SELECT birth_date FROM candidates WHERE name = ?').get(`Ohne Datum ${marker}`).birth_date).toBeNull();
    const rows = db.prepare('SELECT id FROM candidates WHERE name ILIKE ?').all(`mara moser ${marker}`);
    expect(rows).toHaveLength(1);
    createdCandidates.push(rows[0].id);
  });

  test('deleting a candidate removes the CV full text as well', async () => {
    const id = createdCandidates.pop();
    db.prepare("INSERT INTO candidate_texts (candidate_id, original_text) VALUES (CAST(? AS TEXT), 'CV') RETURNING candidate_id").run(id);
    const res = await request(app).delete(`/api/candidates/${id}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT 1 FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').get(id)).toBeUndefined();
  });
});

describe('jobs are unique by URL or title + company + location', () => {
  test('creates a job and hands its UUID to GraphRAG as Neo4j id', async () => {
    const res = await request(app).post('/api/jobs').send({ title: `Backend Engineer ${marker}`, company: 'ACME AG', location: 'Zürich', url: `https://jobs.example.com/${marker}/` });
    expect(res.status).toBe(201);
    createdJobs.push(res.body.id);
    expect(res.body.uuid).toMatch(/^[0-9a-f-]{36}$/);
    const ingest = graphCalls.find(call => call.url.includes('/ingest/job'));
    expect(ingest.url).toContain(`job_id=${res.body.uuid}`);
    expect(res.body.graph_job_id).toBe(res.body.uuid);
  });

  test('blocks the same URL (protocol, www and trailing slash ignored)', async () => {
    const res = await request(app).post('/api/jobs').send({ title: 'Ganz anders', url: `http://www.jobs.example.com/${marker}` });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'DUPLICATE_JOB', reason: 'url' });
    expect(res.body.existing.id).toBe(createdJobs[0]);
  });

  test('blocks the same title at the same company and location', async () => {
    const res = await request(app).post('/api/jobs').send({ title: ` backend   engineer ${marker}`, company: 'acme ag', location: 'zürich' });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('title_company_location');
  });

  test('allows the same title at another location and blocks renaming into a duplicate', async () => {
    const other = await request(app).post('/api/jobs').send({ title: `Backend Engineer ${marker}`, company: 'ACME AG', location: 'Bern' });
    expect(other.status).toBe(201);
    createdJobs.push(other.body.id);

    const clash = await request(app).put(`/api/jobs/${other.body.id}`).send({ title: `Backend Engineer ${marker}`, company: 'ACME AG', location: 'Zürich' });
    expect(clash.status).toBe(409);
  });

  test('deleting a job only removes its own Neo4j node', async () => {
    const id = createdJobs.pop();
    const job = db.prepare('SELECT uuid FROM jobs WHERE id = ?').get(id);
    const res = await request(app).delete(`/api/jobs/${id}`);
    expect(res.status).toBe(200);
    const call = graphCalls.find(entry => entry.method === 'DELETE');
    expect(call.body).toMatchObject({ scope: 'neo4j', job_id: job.uuid });
    expect(db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)).toBeUndefined();
  });
});
