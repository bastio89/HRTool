const { deleteGraphCandidate, deleteGraphCandidates } = require('../utils/graphRagCandidate');
const express = require('express');
const request = require('supertest');

const nativeFetch = globalThis.fetch;
const nativeGraphRagBaseUrl = process.env.GRAPHRAG_BASE_URL;
const nativeGraphRagApiKey = process.env.GRAPHRAG_API_KEY;

describe('GraphRAG candidate deletion', () => {
  beforeEach(() => {
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag/';
    delete process.env.GRAPHRAG_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    if (nativeGraphRagBaseUrl === undefined) delete process.env.GRAPHRAG_BASE_URL;
    else process.env.GRAPHRAG_BASE_URL = nativeGraphRagBaseUrl;
    if (nativeGraphRagApiKey === undefined) delete process.env.GRAPHRAG_API_KEY;
    else process.env.GRAPHRAG_API_KEY = nativeGraphRagApiKey;
  });

  test('deletes by the stored graph ID and forwards the user token', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ deleted: true, neo4j_deleted: 1 }),
    }));

    const deleted = await deleteGraphCandidate(
      { graph_candidate_id: 'graph-candidate-123', name: 'Daniel Huber' },
      { headers: { authorization: 'Bearer test-token' } },
    );

    expect(deleted).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://fake-graphrag/ingest/candidate',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({
          candidate_id: 'graph-candidate-123',
          email: null,
          phone: null,
          name: null,
          location: null,
        }),
      }),
    );
  });

  test('uses email for legacy candidates and skips candidates without a safe identity', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ deleted: true, neo4j_deleted: 1 }),
    }));

    await deleteGraphCandidates([
      { id: 1, name: 'Daniel Huber', email: 'daniel@example.com' },
      { id: 2, name: 'Unknown Candidate' },
    ], { headers: {} });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      candidate_id: null,
      email: 'daniel@example.com',
      phone: null,
      name: null,
      location: null,
    });
  });

  test('deletes every graph profile linked to a candidate', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ deleted: true, neo4j_deleted: 1 }),
    }));

    const deleted = await deleteGraphCandidate(
      { graph_candidate_ids: ['graph-candidate-old', 'graph-candidate-new'] },
      { headers: {} },
    );

    expect(deleted).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls.map(([, options]) => JSON.parse(options.body).candidate_id))
      .toEqual(['graph-candidate-old', 'graph-candidate-new']);
  });

  test('candidate delete route removes the graph node before the local row', async () => {
    const candidate = { id: 17, name: 'Daniel Huber', graph_candidate_id: 'graph-candidate-17' };
    let localDeleted = false;
    const db = {
      prepare(sql) {
        if (sql.includes('SELECT * FROM candidates WHERE id = ?')) {
          return { get: () => candidate };
        }
        if (sql.includes('SELECT filename FROM candidate_files')) {
          return { all: () => [] };
        }
        if (sql.includes('DELETE FROM candidates WHERE id = ?')) {
          return { run: () => { localDeleted = true; return { changes: 1 }; } };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    jest.doMock('../database', () => db);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.resetModules();
    const candidatesRouter = require('../routes/candidates');
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ deleted: true, neo4j_deleted: 1 }),
    }));

    const app = express();
    app.use(express.json());
    app.use('/api/candidates', candidatesRouter);
    const response = await request(app).delete('/api/candidates/17');

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(localDeleted).toBe(true);
  });
});