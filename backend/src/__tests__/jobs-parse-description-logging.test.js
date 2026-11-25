const express = require('express');
const request = require('supertest');

describe('jobs parse-description logging', () => {
  const nativeFetch = globalThis.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = nativeFetch;
  });

  test('logs the AI call and returns a parsed job title', async () => {
    jest.resetModules();
    const logAiCall = jest.fn();
    jest.doMock('../aiLogger', () => ({ logAiCall }));
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
      exec: () => ({})
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    // Die Route leitet den persist-Wert der Anfrage an GraphRAG weiter:
    let jobsRouter;
    jest.isolateModules(() => {
      jobsRouter = require('../routes/jobs');
    });
    // und Anfrage muessen deshalb zusammenpassen - beide haengen an dieser
    // Konstante, damit sie nicht wieder auseinanderlaufen koennen.
    const requestedPersist = '0';
    const forwardedPersist = requestedPersist === '1' ? 'neo4j' : '0';
    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe(`http://fake-graphrag/ingest/job?persist=${forwardedPersist}`);
      expect(options?.method).toBe('POST');
      const payload = JSON.parse(options.body);
      expect(payload.raw_text).toContain('Senior Backend Engineer');
      return {
        ok: true,
        json: async () => ({
          id: 'graph-job-1',
          message: 'Job ingested successfully',
          profile: { title: 'Senior Backend Engineer' },
        }),
      };
    });
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const response = await request(app)
      .post(`/api/jobs/parse-description?persist=${requestedPersist}`)
      .attach('file', Buffer.from('Senior Backend Engineer with Node.js and SQL'), { filename: 'job.txt', contentType: 'text/plain' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Senior Backend Engineer');
    expect(response.body.importSteps.graphRagSaved.ok).toBe(false);
    expect(response.body.matchingRunId).toBeNull();
    expect(response.body.graphRag).toEqual({
      id: 'graph-job-1',
      message: 'Job ingested successfully',
      profile: { title: 'Senior Backend Engineer' },
    });

    expect(logAiCall).toHaveBeenCalledTimes(1);
    expect(logAiCall.mock.calls[0][0]).toEqual(expect.objectContaining({
      feature: 'job-import',
      success: true,
    }));
  });
});

describe('Durable job imports against isolated PostgreSQL', () => {
  const nativeFetch = globalThis.fetch;
  const originalBaseUrl = process.env.GRAPHRAG_BASE_URL;
  let db;
  let app;
  let actorId;
  let baseMarker;
  let marker;
  let profile;
  let rawText;

  beforeAll(() => {
    jest.resetModules();
    jest.dontMock('../database');
    jest.doMock('../aiLogger', () => ({ logAiCall: jest.fn() }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    db = require('../database');
    baseMarker = `atomic-job-import-${require('node:crypto').randomUUID()}`;
    actorId = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role)
      VALUES (?, 'test-only', 'Job Import Test', 'recruiter')
    `).run(baseMarker).lastInsertRowid;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: actorId, role: 'recruiter' };
      next();
    });
    app.use('/api/jobs', require('../routes/jobs'));
  });

  beforeEach(() => {
    marker = `${baseMarker}-${require('node:crypto').randomUUID()}`;
    rawText = `${marker}\nJava and teamwork\nComplete original job description`;
    profile = {
      title: marker, company: 'Test Employer', location: 'Test Location',
      description: rawText, requirements: 'Java experience',
      required_skills: [
        { name: 'Java', category: 'HardSkill', priority: 'NiceToHave' },
        { name: 'Teamwork', category: 'SoftSkill', priority: 'Mandatory' },
      ],
    };
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async (url, options) => {
      const target = new URL(String(url));
      if (target.pathname !== '/ingest/job') throw new Error(`Unexpected matching or provider call: ${target.pathname}`);
      const body = JSON.parse(options.body);
      if (target.searchParams.get('persist') === '0') {
        expect(body).toEqual({ raw_text: rawText });
        return { ok: true, json: async () => ({ id: '', profile, persisted: false }) };
      }
      expect(target.searchParams.get('persist')).toBe('neo4j');
      expect(body).not.toHaveProperty('raw_text');
      const saved = db.prepare('SELECT * FROM jobs WHERE uuid = CAST(? AS UUID)').get(target.searchParams.get('job_id'));
      expect(saved).toBeDefined();
      expect(JSON.parse(saved.parsed_profile_json)).toEqual(body.profile);
      expect(db.prepare('SELECT id FROM matching_runs WHERE entity_type = ? AND entity_id = ?').get('job', saved.id)).toBeDefined();
      return {
        ok: true,
        json: async () => ({ id: saved.uuid, profile: body.profile, preparationStatus: 'ready', preparedRevision: 'confirmed-by-preparation-service' }),
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.prepare('DELETE FROM matching_runs WHERE actor_user_id = ?').run(actorId);
    db.prepare('DELETE FROM jobs WHERE title LIKE ?').run(`${baseMarker}%`);
    global.fetch = nativeFetch;
    if (originalBaseUrl === undefined) delete process.env.GRAPHRAG_BASE_URL;
    else process.env.GRAPHRAG_BASE_URL = originalBaseUrl;
  });

  afterAll(async () => {
    db.prepare('DELETE FROM users WHERE id = ?').run(actorId);
    await db.close();
  });

  const upload = (persist) => request(app).post(`/api/jobs/parse-description?persist=${persist}`)
    .attach('file', Buffer.from(rawText), { filename: 'job.txt', contentType: 'text/plain' });
  const create = (overrides = {}) => request(app).post('/api/jobs').send({
    title: profile.title, graphRagProfile: profile, source: 'Job-Fast-Import', ...overrides,
  });
  const runs = () => db.prepare('SELECT * FROM matching_runs WHERE actor_user_id = ? ORDER BY created_at').all(actorId);

  test('saves the full fast profile, priorities, source text and owned outbox before graph preparation', async () => {
    const response = await create();
    expect(response.status).toBe(201);
    const saved = db.prepare('SELECT * FROM jobs WHERE id = ?').get(response.body.id);
    expect(saved.raw_text).toBe(rawText);
    expect(saved.skills).toBe('Java, Teamwork');
    expect(JSON.parse(saved.parsed_profile_json).required_skills).toEqual(profile.required_skills);
    expect(response.body.preparationStatus).toBe('ready');
    expect(response.body.matchingStatus).toBe('queued');
    expect(response.body.matchingStatusUrl).toContain(response.body.matchingRunId);
    expect(runs()).toEqual([expect.objectContaining({
      id: response.body.matchingRunId, actor_user_id: actorId, entity_id: saved.id,
      method: 'vector', request_kind: 'import', stage: 'queued',
    })]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('parse-only creates neither a source nor an outbox and never reports a saved graph', async () => {
    const response = await upload(0);
    expect(response.status).toBe(200);
    expect(response.body.importSteps).toEqual({
      aiParsed: { ok: true }, graphRagSaved: { ok: false }, dbSaved: { ok: false },
    });
    expect(response.body.matchingStatus).toBe('not_requested');
    expect(runs()).toHaveLength(0);
    expect(db.prepare('SELECT id FROM jobs WHERE title = ?').get(marker)).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('LLM reimport refreshes actual changes once while retaining ID, UUID, status and unchanged duplicates', async () => {
    const first = await upload(1);
    expect(first.status).toBe(200);
    const { id } = first.body.job;
    const original = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    db.prepare("UPDATE jobs SET status = 'Archiviert', salary = 'existing CRM salary' WHERE id = ?").run(id);
    rawText += '\nChanged requirements';
    profile = { ...profile, description: rawText, required_skills: [{ name: 'Java', category: 'HardSkill', priority: 'Mandatory' }] };
    const changed = await upload(1);
    expect(changed.status).toBe(200);
    expect(changed.body.job).toEqual(expect.objectContaining({
      id, uuid: original.uuid, status: 'Archiviert', salary: 'existing CRM salary', skills: 'Java', changed: true,
    }));
    expect(changed.body.matchingRunId).not.toBe(first.body.matchingRunId);
    expect(JSON.parse(changed.body.job.parsed_profile_json).required_skills).toEqual(profile.required_skills);
    expect(runs()).toHaveLength(2);
    const callsBefore = global.fetch.mock.calls.length;
    const unchanged = await upload(1);
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.matchingStatus).toBe('not_required');
    expect(unchanged.body.matchingRunId).toBeNull();
    expect(unchanged.body.job.changed).toBe(false);
    expect(runs()).toHaveLength(2);
    expect(global.fetch.mock.calls.length - callsBefore).toBe(1);
  });

  test('unchanged fast imports do not enqueue or prepare again; manual duplicate creation stays explicit', async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const duplicate = await create();
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.matchingStatus).toBe('not_required');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const manual = await request(app).post('/api/jobs').send({ title: marker, company: profile.company, location: profile.location });
    expect(manual.status).toBe(409);
    expect(manual.body.existing.id).toBe(first.body.id);
    expect(runs()).toHaveLength(1);
  });

  test('bookkeeping changes do not turn an unchanged structured import without source text into a new version', async () => {
    profile = { title: marker, required_skills: [{ name: 'Java' }] };
    const first = await create();
    expect(first.status).toBe(201);
    db.prepare("UPDATE jobs SET status = 'Archiviert' WHERE id = ?").run(first.body.id);
    const duplicate = await create({ source: 'Another import label' });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.matchingStatus).toBe('not_required');
    expect(duplicate.body.status).toBe('Archiviert');
    expect(runs()).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('profile-only reimport resolves the original job URL even when its imported title changes', async () => {
    profile.description += `\nQuelle: https://example.invalid/jobs/${marker}`;
    const first = await create();
    expect(first.status).toBe(201);
    profile = { ...profile, title: `${marker} updated` };
    const changed = await create();
    expect(changed.status).toBe(200);
    expect(changed.body.id).toBe(first.body.id);
    expect(changed.body.uuid).toBe(first.body.uuid);
    expect(changed.body.title).toBe(profile.title);
    expect(runs()).toHaveLength(2);
    expect(runs().every(run => run.entity_id === first.body.id)).toBe(true);
  });

  test.each([false, true])('failure after outbox insertion rolls back the source and profile (reimport: %s)', async (reimport) => {
    let previous;
    if (reimport) {
      expect((await create()).status).toBe(201);
      previous = db.prepare('SELECT * FROM jobs WHERE title = ?').get(marker);
      profile = { ...profile, description: `${rawText}\nChanged profile` };
      global.fetch.mockClear();
    }
    const transaction = db.transactionAsync.bind(db);
    jest.spyOn(db, 'transactionAsync').mockImplementation(callback => transaction(async (tx) => {
      const prepare = tx.prepare.bind(tx);
      jest.spyOn(tx, 'prepare').mockImplementation(sql => {
        const statement = prepare(sql);
        if (!sql.includes('INSERT INTO matching_runs')) return statement;
        const run = statement.run.bind(statement);
        return { ...statement, run: async (...args) => { await run(...args); throw new Error('injected enqueue failure'); } };
      });
      return callback(tx);
    }));
    const response = await create();
    expect(response.status).toBe(500);
    expect(db.prepare('SELECT * FROM jobs WHERE title = ?').get(marker)).toEqual(previous);
    expect(runs()).toHaveLength(reimport ? 1 : 0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('graph failure retains the committed profile and queued run with explicit preparation status', async () => {
    global.fetch.mockRejectedValue(new Error('graph unavailable'));
    const response = await create();
    expect(response.status).toBe(201);
    expect(response.body.preparationStatus).toBe('required');
    expect(response.body.preparationError).toBe('graph_preparation_failed');
    expect(response.body.graphRag.error).toBe('graph unavailable');
    expect(runs()[0].id).toBe(response.body.matchingRunId);
    expect(JSON.parse(db.prepare('SELECT * FROM jobs WHERE id = ?').get(response.body.id).parsed_profile_json).required_skills)
      .toEqual(profile.required_skills);
  });

  test('parallel imports retain every acknowledged source and exactly one owned run each', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => {
      const title = `${marker}-${index}`;
      return create({ title, graphRagProfile: { ...profile, title } });
    }));
    expect(responses.map(response => response.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map(response => response.body.id)).size).toBe(4);
    expect(runs()).toHaveLength(4);
    for (const response of responses) {
      expect(db.prepare('SELECT * FROM jobs WHERE id = ?').get(response.body.id)).toBeDefined();
      expect(runs().some(run => run.id === response.body.matchingRunId && run.entity_id === response.body.id)).toBe(true);
    }
  });
});
describe('jobs updates', () => {
  afterEach(() => jest.restoreAllMocks());
  test('updates a job employer company', async () => {
    jest.resetModules();
    const company = 'Updated Employer GmbH';
    const updateJob = jest.fn();
    const updatedJob = { id: 42, title: 'Backend Engineer', company };
    jest.doMock('../database', () => ({
      prepare: (sql) => {
        if (sql.includes('UPDATE jobs SET title=?, company=?')) return { run: updateJob };
        if (sql.includes('SELECT * FROM jobs WHERE id = ?')) return { get: () => updatedJob };
        return { get: () => undefined, all: () => [], run: () => ({}) };
      },
      exec: () => ({}),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    let jobsRouter;
    jest.isolateModules(() => {
      jobsRouter = require('../routes/jobs');
    });
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const response = await request(app).put('/api/jobs/42').send({
      title: updatedJob.title,
      company,
      about_us: '',
      description: '',
      requirements: '',
      skills: '',
      benefits: '',
      location: '',
      type: 'Vollzeit',
      status: 'Offen',
      url: '',
    });

    expect(response.status).toBe(200);
    expect(response.body.company).toBe(company);
    expect(updateJob.mock.calls[0][1]).toBe(company);
  });
});