import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nProvider } from '../I18nContext'
import SystemStatusChip, { SystemStatusProvider } from './SystemStatus'

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  summary: vi.fn(),
  health: vi.fn(),
  getAiConfig: vi.fn(),
  testAiConnection: vi.fn(),
}))

vi.mock('../api', () => ({
  batchesApi: { summary: mocks.summary },
  healthApi: { check: mocks.health },
  settingsApi: { getAiConfig: mocks.getAiConfig, testAiConnection: mocks.testAiConnection },
}))
vi.mock('../AuthContext', () => ({ useAuth: () => ({ isAdmin: mocks.isAdmin }) }))

function renderStatus() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider>
        <Routes>
          <Route path="/" element={<SystemStatusProvider><SystemStatusChip /></SystemStatusProvider>} />
          <Route path="/admin/batches" element={<p>Batch route reached</p>} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('admin batch status in the system status popover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isAdmin = true
    localStorage.setItem('hr-locale', 'de')
    mocks.health.mockResolvedValue({
      services: { backend: 'ok', database: 'ok', graphrag: 'ok' },
      aiUsage: { calls: 10, total_tokens: 100 },
    })
    mocks.getAiConfig.mockResolvedValue({ baseUrl: 'https://example.test', provider: 'openai' })
    mocks.testAiConnection.mockResolvedValue({ reachable: true })
    mocks.summary.mockResolvedValue({
      queuedCount: 74, runningCount: 6, blockedCreditsCount: 0,
      needsReviewCount: 19, failedCount: 4, completedWithErrorsCount: 0,
    })
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('shows current queue counts and links to batch processing for admins', async () => {
    renderStatus()
    await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Systemstatus/ }))

    expect(await screen.findByText('6 aktiv · 74 wartend · 19 prüfen · 4 Fehler')).toBeInTheDocument()
    const batchLink = screen.getByRole('link', { name: /Batchverarbeitung: Prüfen/ })
    expect(batchLink).toHaveAttribute('href', '/admin/batches')
    fireEvent.pointerDown(batchLink)
    expect(batchLink).toBeInTheDocument()
    fireEvent.click(batchLink)
    expect(await screen.findByText('Batch route reached')).toBeInTheDocument()
  })

  it('does not request or expose global queue status to non-admin users', async () => {
    mocks.isAdmin = false
    renderStatus()
    await screen.findByRole('button', { name: /Systemstatus/ })
    fireEvent.click(screen.getByRole('button', { name: /Systemstatus/ }))

    expect(mocks.summary).not.toHaveBeenCalled()
    expect(screen.queryByText('Batchverarbeitung')).not.toBeInTheDocument()
  })

  it('shows an explicit unavailable state when the batch status request fails', async () => {
    mocks.summary.mockRejectedValue(new Error('offline'))
    renderStatus()
    await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Systemstatus/ }))

    expect(await screen.findByText('Status nicht verfügbar')).toBeInTheDocument()
    expect(screen.getByText('nicht verfügbar')).toBeInTheDocument()
  })
})
