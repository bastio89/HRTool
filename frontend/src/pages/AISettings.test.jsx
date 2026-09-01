import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import AISettings from './AISettings'
import { I18nProvider } from '../I18nContext'
import { settingsApi } from '../api'

vi.mock('../api', () => ({
  settingsApi: {
    getAiConfig: vi.fn(),
    getAiModels: vi.fn(),
    getAiEmbeddingModels: vi.fn(),
    testAiConnection: vi.fn(),
    saveAiConfig: vi.fn(),
  },
}))

describe('AISettings', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
  })

  test('keeps a custom model when the host model list does not include it', async () => {
    settingsApi.getAiConfig.mockResolvedValue({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'qwen/qwen3.8-27b',
      embeddingModel: 'qwen3-embedding:4b',
      provider: 'openai',
      apiKeyConfigured: true,
      loggingEnabled: false,
      source: { baseUrl: 'settings', model: 'settings', embeddingModel: 'settings' },
    })
    settingsApi.getAiModels.mockResolvedValue({ models: [{ name: 'qwen/qwen3.8-flash' }] })
    settingsApi.getAiEmbeddingModels.mockResolvedValue({ models: [{ name: 'qwen3-embedding:4b' }] })

    render(
      <I18nProvider>
        <AISettings />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('qwen/qwen3.8-27b')).toBeInTheDocument()
    })

    await screen.findByRole('button', { name: /Speichern/i })
    settingsApi.saveAiConfig.mockClear()

    screen.getByRole('button', { name: /Speichern/i }).click()

    await waitFor(() => {
      expect(settingsApi.saveAiConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen/qwen3.8-27b',
        })
      )
    })
  })
})