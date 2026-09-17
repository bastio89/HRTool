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

  test('reads AI config only from the settings table', () => {
    jest.doMock('../database', () => ({
      prepare: () => ({
        get: (key) => {
          const values = {
            ai_base_url: 'https://openrouter.ai/api/v1',
            ai_model: 'settings-chat-model',
            ai_embedding_model: 'settings-embedding-model',
            ai_provider: 'openrouter',
            ai_api_key: 'db-api-key',
            ai_reasoning_level: 'low',
            ai_log_llm_calls: '1',
          };
          return values[key] ? { value: values[key] } : undefined;
        },
      }),
    }));

    jest.isolateModules(() => {
      const { getAiConfig } = require('../aiConfig');
      expect(getAiConfig()).toEqual({
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'settings-chat-model',
        embeddingModel: 'settings-embedding-model',
        provider: 'openrouter',
        apiKey: 'db-api-key',
        loggingEnabled: true,
        reasoningLevel: 'low',
        source: {
          baseUrl: 'settings',
          model: 'settings',
          embeddingModel: 'settings',
          provider: 'settings',
          apiKey: 'settings',
          reasoningLevel: 'settings',
        },
      });
    });
  });

  test('returns empty values when no settings exist', () => {
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined }),
    }));

    jest.isolateModules(() => {
      const { getAiConfig } = require('../aiConfig');
      expect(getAiConfig()).toMatchObject({
        baseUrl: '',
        model: '',
        embeddingModel: '',
        provider: 'auto',
        apiKey: null,
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
          { name: 'chat-model-y' },
          { name: 'chat-model-x' },
          { name: 'Qwen/Qwen3 Embedding 4B' },
             { name: 'embedding-model-x' },
          { name: 'nomic-embed-text' },
          { name: 'bge-m3' },
          { name: 'openai/text-embedding-3-small' },
        ],
        'embedding',
      ).map((model) => model.name);

      expect(models).toEqual([
        'Qwen/Qwen3 Embedding 4B',
           'embedding-model-x',
        'nomic-embed-text',
        'bge-m3',
        'openai/text-embedding-3-small',
      ]);
    });
  });

  test('rewrites localhost AI URLs to host.docker.internal inside Docker', () => {
    jest.doMock('fs', () => ({
      existsSync: (path) => path === '/.dockerenv',
    }));
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined }),
    }));

    jest.isolateModules(() => {
      const { resolveAiRuntimeBaseUrl } = require('../aiConfig');
      expect(resolveAiRuntimeBaseUrl('http://localhost:11434')).toBe('http://host.docker.internal:11434');
      expect(resolveAiRuntimeBaseUrl('http://127.0.0.1:11434')).toBe('http://host.docker.internal:11434');
      expect(resolveAiRuntimeBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1');
    });
  });
});