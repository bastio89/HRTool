import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Duplicates from './Duplicates'
import { duplicatesApi } from '../api'

vi.mock('../api', () => ({
  duplicatesApi: {
    getOverview: vi.fn(),
    mergeCandidates: vi.fn(),
    mergeJobs: vi.fn(),
    syncCandidates: vi.fn(),
  },
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../components/Toast', () => ({ useToast: () => toast }))
const confirm = vi.hoisted(() => vi.fn())
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => confirm }))

const overview = {
  rules: [
    { key: 'candidates_identity', label: 'Bewerber: Name + Geburtsdatum', active: true },
    { key: 'jobs_url', label: 'Stellen: URL', active: false },
  ],
  candidates: {
    total: 12,
    withoutBirthDate: 5,
    notSynced: 2,
    groups: [{
      reason: 'email',
      key: 'anna@example.com',
      ids: [3, 8],
      members: [
        { id: 3, name: 'Anna Alt', email: 'anna@example.com', birth_date: null, pipeline_count: 1, created_at: '2026-01-02T10:00:00Z' },
        { id: 8, name: 'Anna Alt', email: 'ANNA@example.com', birth_date: '1990-02-14', pipeline_count: 0, created_at: '2026-03-04T10:00:00Z' },
      ],
    }],
  },
  jobs: { total: 4, notSynced: 0, groups: [] },
}

function renderPage() {
  return render(<MemoryRouter><Duplicates /></MemoryRouter>)
}

describe('Duplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    duplicatesApi.getOverview.mockResolvedValue(overview)
    duplicatesApi.mergeCandidates.mockResolvedValue({})
    confirm.mockResolvedValue(true)
  })

  test('shows rule status, missing birth dates and the duplicate group', async () => {
    renderPage()
    expect(await screen.findByText('Gleiche E-Mail')).toBeTruthy()
    expect(screen.getByText('Stellen: URL')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('14.02.1990')).toBeTruthy()
    expect(screen.getByText('Keine Stellen-Dubletten gefunden.')).toBeTruthy()
  })

  test('merges the other records into the chosen one after confirmation', async () => {
    renderPage()
    await screen.findByText('Gleiche E-Mail')
    fireEvent.click(screen.getByLabelText('Behalten: Anna Alt (ID 8)'))
    fireEvent.click(screen.getByRole('button', { name: /Zusammenführen/ }))

    await waitFor(() => expect(duplicatesApi.mergeCandidates).toHaveBeenCalledWith(8, [3]))
    expect(confirm.mock.calls[0][0].message).toContain('„Anna Alt“ (#3)')
    expect(duplicatesApi.getOverview).toHaveBeenCalledTimes(2)
  })

  test('does nothing when the merge is not confirmed', async () => {
    confirm.mockResolvedValue(false)
    renderPage()
    await screen.findByText('Gleiche E-Mail')
    fireEvent.click(screen.getByRole('button', { name: /Zusammenführen/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(duplicatesApi.mergeCandidates).not.toHaveBeenCalled()
  })
})
