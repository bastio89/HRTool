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
    const logAiCall = jest.fn();
    jest.doMock('../aiLogger', () => ({ logAiCall }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    // Die Route leitet den persist-Wert der Anfrage an GraphRAG weiter:
    // persist=1 wird zu persist=neo4j, alles andere zu persist=0. Erwartung
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

    const jobsRouter = require('../routes/jobs');
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
});