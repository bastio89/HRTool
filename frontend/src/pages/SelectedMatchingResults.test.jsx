import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import SelectedMatchingResults from './SelectedMatchingResults'
import { matchingApi } from '../api'

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal(),
  matchingApi: {
    vectorMatchSelected: vi.fn(),
    runSelected: vi.fn(),
  },
}))

const pairs = [
  { jobId: 2, jobTitle: 'Backend Engineer', candidateId: 7, candidateName: 'Anna Muster' },
  { jobId: 2, jobTitle: 'Backend Engineer', candidateId: 9, candidateName: 'Manuel Manuell' },
]

function renderPage({ mode = 'vector', precomputed, preserveStorage = false } = {}) {
  if (!preserveStorage) sessionStorage.setItem('hrtool:matching:selected-batch', JSON.stringify({ pairs, mode, engine: 'neo4j' }))
  return render(
    <MemoryRouter initialEntries={[{ key: 'selected-page', pathname: '/matching/results/selected', state: { pairs, mode, precomputed, engine: 'neo4j' } }]}>
      <SelectedMatchingResults />
    </MemoryRouter>,
  )
}

describe('SelectedMatchingResults – 3D-Matching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matchingApi.vectorMatchSelected.mockResolvedValue({ method: 'vector', results: [], failures: [] })
    vi.stubGlobal('scrollTo', vi.fn())
    sessionStorage.clear()
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  test('matches all pairs in one backend call and shows pairs that could not be matched', async () => {
    matchingApi.vectorMatchSelected.mockResolvedValue({
      results: [{ jobId: 2, sourceJobId: 'job-uuid', jobTitle: 'Backend Engineer', candidateId: 7, sourceCandidateId: 'candidate-uuid', candidateName: 'Anna Muster', score: 64, hardSkillScore: 0.7, softSkillScore: 0.3, matchedSkills: [] }],
      failures: [{ jobId: 2, jobTitle: 'Backend Engineer', candidateId: 9, candidateName: 'Manuel Manuell', error: 'Bewerber nicht in Neo4j: Embedding-Dienst nicht erreichbar' }],
      selectedCount: 2,
    })
    renderPage()

    expect(await screen.findByText('Anna Muster')).toBeTruthy()
    expect(screen.getByText('Bewerber-ID:')).toHaveTextContent('Bewerber-ID: 7')
    expect(screen.getByText('Job-ID:')).toHaveTextContent('Job-ID: 2')
    expect(screen.queryByText('candidate-uuid')).not.toBeInTheDocument()
    expect(screen.queryByText('job-uuid')).not.toBeInTheDocument()
    expect(matchingApi.vectorMatchSelected).toHaveBeenCalledTimes(1)
    expect(matchingApi.vectorMatchSelected).toHaveBeenCalledWith(pairs, 'neo4j', expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }))
    expect(screen.getByText('Bewerber nicht in Neo4j: Embedding-Dienst nicht erreichbar')).toBeTruthy()
  })

  test('shows the error message when the 3D matching fails as a whole', async () => {
    matchingApi.vectorMatchSelected.mockRejectedValue(new Error('Keiner der angegebenen Bewerber ist in Neo4j vorhanden: Manuel Manuell'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Keiner der angegebenen Bewerber ist in Neo4j vorhanden: Manuel Manuell')).toBeTruthy())
  })

  test('missing mandatory skills preserve partial coverage and only explicitly selected pairs start AI matching', async () => {
    matchingApi.vectorMatchSelected.mockResolvedValue({
      method: 'vector',
      results: pairs.map((pair, index) => ({
        ...pair, method: 'vector', score: index === 0 ? 50 : 60, qualified: index !== 0,
        summary: index === 0 ? 'Anna deckt 1/2 erforderliche Skills ab.' : '',
        weaknesses: index === 0 ? ['SQL: Semantische Ähnlichkeit 0.7000 liegt unter dem Cutoff 0.75.'] : [],
      })),
      failures: [],
    })
    matchingApi.runSelected.mockRejectedValue(new Error('AI-Modell nicht erreichbar'))
    renderPage()
    expect(await screen.findByRole('img', { name: 'Skill-Abdeckung: 50%' })).toBeTruthy()
    expect(screen.getByText('Muss-Skills fehlen')).toBeTruthy()
    expect(screen.getByText('Anna deckt 1/2 erforderliche Skills ab.')).toBeInTheDocument()
    expect(screen.getByText(/fehlende Muss-Skills setzen ihn nicht auf 0 %/)).toBeInTheDocument()
    expect(screen.getByText('SQL: Semantische Ähnlichkeit 0.7000 liegt unter dem Cutoff 0.75.')).toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'AI-Matching für Auswahl' })
    expect(start.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Auswählen: Anna Muster' }))
    fireEvent.click(start)
    await waitFor(() => expect(matchingApi.runSelected).toHaveBeenCalledTimes(1))
    expect(matchingApi.runSelected.mock.calls[0][0]).toEqual([expect.objectContaining({ jobId: 2, candidateId: 7 })])
    expect(matchingApi.runSelected.mock.calls[0][1]).toBeNull()
    expect(matchingApi.runSelected.mock.calls[0][2]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI-Modell nicht erreichbar')
  })

  test('AI percentages remain distinct from the skill score and each pair shows its skill result', async () => {
    matchingApi.vectorMatchSelected.mockResolvedValue({
      method: 'vector',
      results: [{ ...pairs[0], score: 55, hardSkillScore: 0.6, softSkillScore: 0.4 }],
      failures: [{ ...pairs[1], error: 'Skill-Daten nicht verfügbar' }],
    })
    renderPage({ mode: 'ai', precomputed: {
      method: 'ai',
      results: [
        { ...pairs[0], method: 'ai', score: 1, qualified: false },
        { ...pairs[1], method: 'ai', score: null, vectorScore: 0.85 },
      ], failures: [],
    } })
    expect(await screen.findByText('AI-Matching: Auswahl')).toBeTruthy()
    expect(screen.getAllByText('1%').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'Skill-Matching: 55%' })).toBeInTheDocument()
    expect(screen.getByText('HardSkill: 0.600')).toBeInTheDocument()
    expect(screen.getByText('Skill-Daten nicht verfügbar')).toBeInTheDocument()
    expect(screen.getByText('Nicht berechnet')).toBeTruthy()
    expect(screen.queryByText('100%')).toBeNull()
    expect(screen.queryByText('85%')).toBeNull()
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByText(/fehlende Muss-Skills setzen ihn nicht auf 0 %/)).toBeNull()
    expect(screen.getAllByText('Bewerber-ID:').map(node => node.textContent)).toEqual(['Bewerber-ID: 7', 'Bewerber-ID: 9'])
    expect(matchingApi.runSelected).not.toHaveBeenCalled()
    expect(matchingApi.vectorMatchSelected).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ jobId: 2, candidateId: 7 })]),
      'neo4j',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  test('rejects AI results received on a skill path instead of relabeling their score', async () => {
    matchingApi.vectorMatchSelected.mockResolvedValue({ method: 'ai', results: [{ ...pairs[0], method: 'ai', score: 85 }] })
    renderPage()
    expect(await screen.findByText('Die Antwort enthält eine andere Matching-Methode.')).toBeTruthy()
    expect(screen.queryByText('85%')).toBeNull()
    expect(matchingApi.runSelected).not.toHaveBeenCalled()
  })

  test('shows available cached rows and pending IDs, then uses the original result timestamp', async () => {
    vi.useFakeTimers()
    const runId = '00000000-0000-0000-0000-000000000001'
    const matchedAt = '2025-01-01T10:00:00Z'
    const cached = { ...pairs[0], method: 'vector', score: 75, cacheStatus: 'hit', evaluationId: 31, matchedAt }
    const pending = { status: 'pending', runId, availableResults: [cached], pendingPairs: [{ candidateId: '9', jobId: '2', status: 'running' }] }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ runId, stage: 'completed', resultPayload: { method: 'vector', results: [cached], failures: [] } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { renderPage({ precomputed: pending }) })
    expect(screen.getByText('Anna Muster · Backend Engineer: 75%')).toBeInTheDocument()
    expect(screen.getByText(/Bewerber-ID: 9 · Job-ID: 2 · In Bearbeitung/)).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('hrtool:matching:selected-batch')).response.runId).toBe(runId)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getByText('Beim Aufruf aus dem Cache geladen')).toBeInTheDocument()
    expect(document.querySelector('time')).toHaveAttribute('datetime', matchedAt)
    expect(JSON.parse(sessionStorage.getItem('hrtool:matching:selected-batch')).response.results[0]).toMatchObject({ evaluationId: 31, matchedAt, cacheStatus: 'hit' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(matchingApi.vectorMatchSelected).not.toHaveBeenCalled()
  })

  test('reload resumes the saved AI run, not the older skill route state or another POST', async () => {
    vi.useFakeTimers()
    const runId = '00000000-0000-0000-0000-000000000002'
    const skillResponse = { method: 'vector', results: pairs.map(pair => ({ ...pair, method: 'vector', score: 80 })) }
    let activeSignal
    matchingApi.runSelected.mockImplementation((_pairs, _weights, options) => {
      activeSignal = options.signal
      options.onProgress({ status: 'pending', method: 'ai', runId, pendingPairs: [{ candidateId: '7', jobId: '2', status: 'queued' }] })
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    })
    let page
    await act(async () => { page = renderPage({ precomputed: skillResponse }) })
    fireEvent.click(screen.getByRole('button', { name: 'Auswählen: Anna Muster' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'AI-Matching für Auswahl' })) })
    expect(screen.getByRole('link', { name: runId })).toBeInTheDocument()
    page.unmount()
    expect(activeSignal.aborted).toBe(true)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({
        runId, stage: 'completed', resultPayload: { method: 'ai', results: [{ ...pairs[0], method: 'ai', score: 1 }], failures: [] },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    let restored
    await act(async () => { restored = renderPage({ precomputed: skillResponse, preserveStorage: true }) })
    expect(screen.queryByText('Skill-Abdeckung: 80%')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getAllByText('1%').length).toBeGreaterThan(0)
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/matching/runs/${runId}`)
    expect(matchingApi.runSelected).toHaveBeenCalledTimes(1)
    expect(matchingApi.vectorMatchSelected).toHaveBeenCalledTimes(1)
    restored.unmount()
    await act(async () => { renderPage({ precomputed: skillResponse, preserveStorage: true }) })
    expect(screen.getAllByText('1%').length).toBeGreaterThan(0)
    expect(screen.queryByText('Skill-Abdeckung: 80%')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(matchingApi.runSelected).toHaveBeenCalledTimes(1)
  })
})
