const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrtool-job-'));
    const filePath = path.join(tempDir, 'job.txt');
    fs.writeFileSync(filePath, 'Senior Backend Engineer with Node.js and SQL');

    const response = await request(app)
      .post(`/api/jobs/parse-description?persist=${requestedPersist}`)
      .attach('file', filePath, { contentType: 'text/plain' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Senior Backend Engineer');
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

  test('sends a supplied fast-parser profile to GraphRAG without raw text', async () => {
    jest.resetModules();
    const savedJob = {
      id: 42,
      title: 'Senior Backend Engineer',
      company: 'Acme AG',
      source: 'Job-Fast-Import',
      description: 'Full extracted job description',
      requirements: 'Pensum: 80–100 %',
    };
    const insertJob = jest.fn(() => ({ lastInsertRowid: savedJob.id }));
    jest.doMock('../aiLogger', () => ({ logAiCall: jest.fn() }));
    jest.doMock('../database', () => ({
      prepare: (sql) => {
        if (sql.includes('INSERT INTO jobs')) {
          return { run: insertJob };
        }
        if (sql.startsWith('SELECT * FROM jobs WHERE id = ?')) {
          return { get: () => savedJob };
        }
        return { get: () => undefined, all: () => [], run: () => ({}) };
      },
      exec: () => ({}),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    let jobsRouter;
    jest.isolateModules(() => {
      jobsRouter = require('../routes/jobs');
    });

    const graphRagProfile = {
      title: savedJob.title,
      company: savedJob.company,
      source: savedJob.source,
      description: savedJob.description,
      required_skills: [{ name: 'Python', category: 'HardSkill', priority: 'Mandatory' }],
    };
    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe('http://fake-graphrag/ingest/job?persist=neo4j');
      expect(JSON.parse(options.body)).toEqual({ profile: graphRagProfile });
      return {
        ok: true,
        json: async () => ({ id: 'graph-job-42', message: 'Job ingested successfully' }),
      };
    });

    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const response = await request(app).post('/api/jobs').send({
      title: savedJob.title,
      company: savedJob.company,
      source: savedJob.source,
      description: savedJob.description,
      graphRagProfile,
    });

    expect(response.status).toBe(201);
    expect(response.body.graphRag.id).toBe('graph-job-42');
    expect(insertJob.mock.calls[0][1]).toBe(savedJob.company);
    expect(insertJob.mock.calls[0].at(-1)).toBe('Job-Fast-Import');
  });

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