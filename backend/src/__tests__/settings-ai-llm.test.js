const express = require('express');
const request = require('supertest');

describe('settings AI llm-test route', () => {
  const nativeFetch = globalThis.fetch;

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    global.fetch = nativeFetch;
  });

  test('accepts Ollama thinking-only responses as a successful model answer', async () => {
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe('http://fake-ai/api/generate');
      expect(options?.method).toBe('POST');
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe('gemma4:26b');
      expect(payload.options).toEqual(expect.objectContaining({ think: false }));
      expect(payload.prompt).toContain('Reply with exactly: OK');

      return {
        ok: true,
        json: async () => ({
          thinking: 'OK',
          response: '',
        }),
      };
    });

    const settingsRouter = require('../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);

    const response = await request(app)
      .post('/api/settings/ai/llm-test')
      .send({
        baseUrl: 'http://fake-ai',
        provider: 'ollama',
        model: 'gemma4:26b',
        prompt: 'Reply with exactly: OK',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      reachable: true,
      provider: 'ollama',
      baseUrl: 'http://fake-ai',
      model: 'gemma4:26b',
      response: 'OK',
    }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('returns a provider-specific message when Ollama responds without answer text', async () => {
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        response: '',
        thinking: '',
      }),
    }));

    const settingsRouter = require('../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);

    const response = await request(app)
      .post('/api/settings/ai/llm-test')
      .send({
        baseUrl: 'http://fake-ai',
        provider: 'ollama',
        model: 'gemma4:26b',
        prompt: 'Reply with exactly: OK',
      });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/Ollama hat keine verwertbare Modellantwort geliefert/);
  });

  test('uses the docker runtime host for Ollama embedding tests', async () => {
    jest.doMock('fs', () => ({
      existsSync: (path) => path === '/.dockerenv',
    }));
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe('http://host.docker.internal:11434/api/embeddings');
      expect(options?.method).toBe('POST');
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe('qwen3-embedding:4b');
      expect(payload.prompt).toBe('Kubernetes');
      return {
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      };
    });

    const settingsRouter = require('../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);

    const response = await request(app)
      .post('/api/settings/ai/embedding-test')
      .send({
        baseUrl: 'http://localhost:11434',
        provider: 'ollama',
        embeddingModel: 'qwen3-embedding:4b',
        sampleText: 'Kubernetes',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      reachable: true,
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      embeddingModel: 'qwen3-embedding:4b',
      dims: 3,
    }));
  });

  test('forces Ollama dialect for the local Ollama port even if the request says openai', async () => {
    jest.doMock('fs', () => ({
      existsSync: (path) => path === '/.dockerenv',
    }));
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toBe('http://host.docker.internal:11434/api/embeddings');
      expect(options?.method).toBe('POST');
      return {
        ok: true,
        json: async () => ({ embedding: [1, 2, 3] }),
      };
    });

    const settingsRouter = require('../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);

    const response = await request(app)
      .post('/api/settings/ai/embedding-test')
      .send({
        baseUrl: 'http://localhost:11434',
        provider: 'openai',
        embeddingModel: 'qwen3-embedding:4b',
        sampleText: 'Kubernetes',
      });

    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('ollama');
  });

  test('replaces OpenAI embedding names with a discovered Ollama embedding on local Ollama', async () => {
    jest.doMock('fs', () => ({
      existsSync: (path) => path === '/.dockerenv',
    }));
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    global.fetch = jest.fn(async (url, options) => {
      const requestUrl = String(url);
      if (requestUrl === 'http://host.docker.internal:11434/api/tags') {
        return {
          ok: true,
          json: async () => ({
            models: [{ name: 'qwen3-embedding:4b' }],
          }),
        };
      }

      expect(requestUrl).toBe('http://host.docker.internal:11434/api/embeddings');
      expect(options?.method).toBe('POST');
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe('qwen3-embedding:4b');
      return {
        ok: true,
        json: async () => ({ embedding: [1, 2, 3] }),
      };
    });

    const settingsRouter = require('../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);

    const response = await request(app)
      .post('/api/settings/ai/embedding-test')
      .send({
        baseUrl: 'http://localhost:11434',
        provider: 'ollama',
        embeddingModel: 'openai/text-embedding-3-small',
        sampleText: 'Kubernetes',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      provider: 'ollama',
      embeddingModel: 'qwen3-embedding:4b',
      dims: 3,
    }));
  });
});
