const path = require('path');

describe('aiConfig', () => {
  const nativeEnv = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
    AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };

  afterEach(() => {
    Object.entries(nativeEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    jest.resetModules();
  });

  test('prefers GUI settings and AI_* environment variables over Ollama defaults', () => {
    process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.AI_MODEL = 'openai/gpt-4o-mini';
    process.env.AI_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_API_KEY = 'env-api-key';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_MODEL = 'qwen3.6:35b';

    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined }),
    }));

    jest.isolateModules(() => {
      const { getAiConfig } = require('../aiConfig');
      expect(getAiConfig()).toEqual({
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-4o-mini',
        embeddingModel: 'openai/text-embedding-3-small',
        provider: 'openrouter',
        apiKey: 'env-api-key',
        loggingEnabled: false,
        source: {
          baseUrl: 'env',
          model: 'env',
          embeddingModel: 'env',
          provider: 'env',
          apiKey: 'env',
        },
      });
    });
  });

  test('defaults to the OpenRouter base URL when provider is openrouter and no base URL is set', () => {
    process.env.AI_PROVIDER = 'openrouter';

    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined }),
    }));

    jest.isolateModules(() => {
      const { getAiConfig } = require('../aiConfig');
      expect(getAiConfig()).toMatchObject({
        baseUrl: 'https://openrouter.ai/api/v1',
        embeddingModel: 'openai/text-embedding-3-small',
      });
    });
  });

  test('filters embedding model names from a mixed model list', () => {
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined }),
    }));

    jest.isolateModules(() => {
      const { filterModelsByKind } = require('../aiConfig');
      const models = filterModelsByKind(
        [
          { name: 'llama3.2' },
          { name: 'qwen3.6:35b' },
          { name: 'qwen3-embedding:4b' },
          { name: 'nomic-embed-text' },
          { name: 'bge-m3' },
          { name: 'openai/text-embedding-3-small' },
        ],
        'embedding',
      ).map((model) => model.name);

      expect(models).toEqual([
        'qwen3-embedding:4b',
        'nomic-embed-text',
        'bge-m3',
        'openai/text-embedding-3-small',
      ]);
    });
  });
});