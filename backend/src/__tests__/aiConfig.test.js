const path = require('path');

describe('aiConfig', () => {
  const nativeEnv = {
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
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
        provider: 'openrouter',
        apiKey: 'env-api-key',
        source: {
          baseUrl: 'env',
          model: 'env',
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
      expect(getAiConfig().baseUrl).toBe('https://openrouter.ai/api/v1');
    });
  });
});