const express = require('express');
const request = require('supertest');

describe('add/job proxy route', () => {
  const nativeFetch = globalThis.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = nativeFetch;
  });

  test('forwards plaintext job text to GraphRAG and returns the created job payload', async () => {
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe('http://fake-graphrag/add/job/');
      expect(options?.method).toBe('POST');
      expect(options?.headers?.['Content-Type']).toBe('text/plain');
      expect(String(options?.body || '')).toContain('Java Developer');
      return {
        ok: true,
        json: async () => ({
          id: 'graph-job-1',
          message: 'Job ingested successfully',
          profile: { title: 'Java Developer' },
        }),
      };
    });

    const addJobRouter = require('../routes/add-job');
    const app = express();
    app.use('/api/add/job', addJobRouter);

    const response = await request(app)
      .post('/api/add/job/')
      .set('Content-Type', 'text/plain')
      .send('Java Developer with Spring Boot and SQL');

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'graph-job-1',
      message: 'Job ingested successfully',
      profile: { title: 'Java Developer' },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});