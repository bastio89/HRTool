import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nProvider } from '../I18nContext'
import Layout from '../components/Layout'
import Breadcrumb from '../components/Breadcrumb'
import BatchProcessing, { OwnMatchingRunStatus } from './BatchProcessing'

const mocks = vi.hoisted(() => ({
  role: 'admin',
  list: vi.fn(), get: vi.fn(), retry: vi.fn(), getRun: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('../api', () => ({
  batchesApi: { list: mocks.list, get: mocks.get, retry: mocks.retry },
  matchingApi: { getRun: mocks.getRun },
  billingApi: { getMe: vi.fn().mockResolvedValue({ current_balance: 1 }) },
  subscribeCreditRefresh: () => () => {},
}))
vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: mocks.role, username: 'test' },
    isAdmin: mocks.role === 'admin', isRecruiter: mocks.role === 'recruiter', logout: vi.fn(),
  }),
}))
vi.mock('../ThemeContext', () => ({ useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }) }))
vi.mock('../plugins/PluginContext', () => ({ usePlugins: () => ({ isEnabled: () => false }) }))
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../components/NotificationBell', () => ({ default: () => null }))
vi.mock('../components/SystemStatus', () => ({ default: () => null }))

const runId = '00000000-0000-0000-0000-000000000001'

it.each([
  ['de', '/admin/batches', 'Batchverarbeitung'],
  ['en', '/admin/batches', 'Batch processing'],
  ['de', `/matching/runs/${runId}`, 'Matching-Auftrag'],
  ['en', `/matching/runs/${runId}`, 'Matching request'],
])('localizes the new breadcrumb without an invalid run link (%s, %s)', (locale, path, label) => {
  localStorage.setItem('hr-locale', locale)
  render(<MemoryRouter initialEntries={[path]}><I18nProvider><Breadcrumb /></I18nProvider></MemoryRouter>)
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
  expect(screen.queryByText(runId)).not.toBeInTheDocument()
})

const counters = {
  targetCount: 8, processedCount: 6, computedCount: 3, cachedCount: 2, sharedCount: 0,
  failedCount: 1, skippedCount: 0, needsReviewCount: 0, preparationRequiredCount: 0,
  pendingCount: 2, queuedCount: 2, runningCount: 0, progressPercent: 75, updatedAt: '2025-01-01T10:00:00Z',
}
const run = {
  runId, source: 'CV-Import', actorUserId: 1, method: 'vector', stage: 'matching',
  creditStatus: 'charged', chargedAmount: '-0.10', createdAt: '2025-01-01T09:00:00Z',
}
const detail = {
  run, counters, pairs: [
    { pairId: 101, evaluationId: 9001, candidateId: '4', jobId: '9', status: 'needs_review', matchedAt: null, resultPayload: null },
    { pairId: 102, evaluationId: 9002, candidateId: '4', jobId: '10', status: 'computed', matchedAt: '2025-01-01T10:00:00Z', resultPayload: { score: 80 } },
  ], nextCursor: null,
}

function renderPage(path = `/admin/batches?runId=${runId}`) {
  return render(<MemoryRouter initialEntries={[path]}><I18nProvider><Routes>
    <Route path="/admin/batches" element={<BatchProcessing />} />
    <Route path="/matching/runs/:runId" element={<OwnMatchingRunStatus />} />
    <Route path="/" element={<h1>Home</h1>} />
  </Routes></I18nProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = 'admin'
  localStorage.setItem('hr-locale', 'de')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  mocks.list.mockResolvedValue({ items: [{ run, counters }], nextCursor: null })
  mocks.get.mockResolvedValue(detail)
  mocks.retry.mockResolvedValue({ runId, stage: 'queued' })
  mocks.getRun.mockResolvedValue({ ...run, counters })
  mocks.confirm.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('protected batch navigation', () => {
  it.each(['admin', 'recruiter'])('shows the sidebar entry only for an administrator (%s)', async role => {
    mocks.role = role
    render(<MemoryRouter initialEntries={['/admin/batches']}><I18nProvider><Layout /></I18nProvider></MemoryRouter>)
    await act(async () => {})
    if (role === 'admin') expect(screen.getByRole('link', { name: 'Batchverarbeitung' })).toHaveAttribute('href', '/admin/batches')
    else expect(screen.queryByRole('link', { name: 'Batchverarbeitung' })).not.toBeInTheDocument()
  })

  it('refuses a direct non-admin call without fetching any global queue', async () => {
    mocks.role = 'recruiter'
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })
})

it('shows confirmed 6/8 and exactly 75 percent, target IDs and the original timestamp', async () => {
  renderPage()
  expect(await screen.findByText('6/8 (75%)')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '75')
  expect(screen.getByText('101')).toBeInTheDocument()
  expect(screen.queryByText('9001')).not.toBeInTheDocument()
  expect(screen.getByText('2025-01-01T10:00:00Z')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Auswählen 102' })).toBeDisabled()
  expect(screen.getByText('Neu berechnet', { selector: 'dt' }).nextSibling).toHaveTextContent('3')
  expect(screen.getByText('Cache-Treffer', { selector: 'dt' }).nextSibling).toHaveTextContent('2')
  fireEvent.change(screen.getByRole('combobox', { name: /^Paarstatus/ }), { target: { value: 'failed' } })
  await waitFor(() => expect(mocks.get).toHaveBeenLastCalledWith(runId, { pairStatus: 'failed', cursor: null, limit: 25 }, expect.any(Object)))
})

it('keeps preparation without a fabricated percentage and lets non-admins read only their own status', async () => {
  mocks.role = 'recruiter'
  mocks.getRun.mockResolvedValue({ stage: 'preparing', counters: { ...counters, targetCount: null, progressPercent: null } })
  renderPage(`/matching/runs/${runId}`)
  expect(await screen.findByText('Zielmenge wird vorbereitet')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.getRun).toHaveBeenCalledWith(runId, expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('preserves the last confirmed state and timestamp when a refresh fails', async () => {
  renderPage()
  await screen.findByText('6/8 (75%)')
  mocks.list.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('letzter bestätigter Stand: offline')
  expect(screen.getByText('6/8 (75%)')).toBeInTheDocument()
  expect(screen.getByText(/Letzte erfolgreiche Abfrage:/)).not.toHaveTextContent('Noch nicht geladen')
})

it('requires explicit provider-cost consent and submits pair target IDs, not evaluation IDs', async () => {
  renderPage()
  await screen.findByText('6/8 (75%)')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Auswählen 101' }))
  mocks.confirm.mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: 'Ausgewählte Paare wiederholen' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Ausgewählte Paare wiederholen' }))
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith(runId, [101], true))
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('zusätzliche Providerkosten') }))
})

it('polls only while visible, aborts on hide and cleans up on unmount', async () => {
  vi.useFakeTimers()
  const view = renderPage()
  await act(async () => {})
  expect(mocks.list).toHaveBeenCalledTimes(1)
  const firstSignal = mocks.list.mock.calls[0][1].signal
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(mocks.list).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  fireEvent(document, new Event('visibilitychange'))
  expect(firstSignal.aborted).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
  expect(mocks.list).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => {})
  expect(mocks.list).toHaveBeenCalledTimes(3)
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
  expect(mocks.list).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})

it('renders the same confirmed state in English', async () => {
  localStorage.setItem('hr-locale', 'en')
  renderPage()
  await screen.findByText('6/8 (75%)')
  expect(screen.getByRole('heading', { name: 'Batch processing' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry selected pairs' })).toBeInTheDocument()
  expect(screen.queryByText('Batchverarbeitung')).not.toBeInTheDocument()
})
