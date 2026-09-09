import { afterEach, describe, expect, test, vi } from 'vitest'

import { settingsApi } from '../api'

describe('settingsApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('normalizes object error payloads from embedding tests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'OpenRouter rejected the request' } }),
    }))

    await expect(
      settingsApi.testEmbeddingModel('https://openrouter.ai/api/v1', '', 'openai', 'qwen3-embedding:4b')
    ).rejects.toThrow('OpenRouter rejected the request')
  })
})