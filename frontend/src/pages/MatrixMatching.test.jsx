import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MatrixMatching from './MatrixMatching'
import { I18nProvider } from '../I18nContext'
import { candidatesApi, jobsApi, matchingApi } from '../api'

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    candidatesApi: { ...original.candidatesApi, getAll: vi.fn() },
    jobsApi: { ...original.jobsApi, getAll: vi.fn() },
    matchingApi: { ...original.matchingApi, runMatrix: vi.fn() },
  }
})

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <MatrixMatching />
      </I18nProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('hr-locale', 'de')
  candidatesApi.getAll.mockResolvedValue({ data: [{ id: 1 }] })
  jobsApi.getAll.mockResolvedValue({ data: [{ id: 2 }] })
  matchingApi.runMatrix.mockResolvedValue({ id: 42 })
})

test('Matrix berechnen verwendet ausschließlich die Neo4j-Engine', async () => {
  renderPage()

  await screen.findByRole('button', { name: 'Matrix berechnen' })
  expect(screen.queryByText('Python')).not.toBeInTheDocument()
  expect(screen.queryByText('Neo4j')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Matrix berechnen' }))

  await waitFor(() => {
    expect(matchingApi.runMatrix).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'all_jobs_all_candidates', engine: 'neo4j' }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
  })
})

test('zeigt Cache-, Neuberechnungs- und offene Paare aus dem Live-Fortschritt', async () => {
  let reportProgress
  matchingApi.runMatrix.mockImplementation((_payload, options) => {
    reportProgress = options.onProgress
    return new Promise(() => {})
  })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Matrix berechnen' }))
  await waitFor(() => expect(reportProgress).toEqual(expect.any(Function)))

  act(() => reportProgress({
    stage: 'matching',
    targetCount: 10,
    counters: {
      targetCount: 10,
      processedCount: 5,
      computedCount: 3,
      cachedCount: 1,
      sharedCount: 1,
      pendingCount: 5,
      progressPercent: 50,
    },
  }))

  expect(screen.getByText('Aus Cache').parentElement).toHaveTextContent('1')
  expect(screen.getByText('Übernommen').parentElement).toHaveTextContent('1')
  expect(screen.getByText('Neu berechnet').parentElement).toHaveTextContent('3')
  expect(screen.getByText('Noch offen').parentElement).toHaveTextContent('5')
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
})
