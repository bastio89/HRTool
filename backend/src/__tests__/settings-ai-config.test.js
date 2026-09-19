const express = require('express');
const request = require('supertest');

describe('settings ai config save route', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('persists the embedding model in the settings table', async () => {
    const settingsStore = {};

    jest.doMock('../database', () => ({
      prepare: (sql) => {
        const normalizedSql = String(sql || '');
        if (normalizedSql.includes('SELECT value FROM settings WHERE key = ?')) {
          return {
            get: (key) => (settingsStore[key] !== undefined ? { value: settingsStore[key] } : undefined),
          };
        }

        if (normalizedSql.includes('INSERT OR REPLACE INTO settings')) {
          return {
            run: (key, value) => {
              settingsStore[key] = value;
              return { changes: 1 };
            },
          };
        }

        return {
          get: () => undefined,
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      },
      transaction: (callback) => (...args) => callback(...args),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    const settingsRouter = require('../routes/settings');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { role: 'admin' };
      next();
    });
    app.use('/api/settings', settingsRouter);

    const response = await request(app)
      .put('/api/settings/ai/config')
      .send({
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2',
        embeddingModel: 'nomic-embed-text',
        provider: 'ollama',
        loggingEnabled: true,
        reasoningLevel: 'none',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
      embeddingModel: 'nomic-embed-text',
      provider: 'ollama',
    }));
    expect(settingsStore.ai_embedding_model).toBe('nomic-embed-text');
    expect(settingsStore.ai_base_url).toBe('http://localhost:11434');
    expect(settingsStore.ai_model).toBe('llama3.2');
    expect(settingsStore.ai_provider).toBe('ollama');
  });
});