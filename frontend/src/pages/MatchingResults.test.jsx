import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import MatchingResults from './MatchingResults'
import History from './History'
import { I18nProvider } from '../I18nContext'
import { matchingApi } from '../api'

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal(),
  matchingApi: { getResult: vi.fn(), getHistory: vi.fn() },
}))

const row = {
  candidateId: 5, candidateName: 'Anna Muster', sourceCandidateId: 'candidate-uuid',
  jobId: 38, jobTitle: 'Data Engineer', sourceJobId: 'job-uuid',
  method: 'vector', score: 50, qualified: false, hardSkillScore: 0.5, softSkillScore: null,
  summary: 'Anna deckt 1/2 erforderliche Skills ab.',
  weaknesses: ['SQL: Semantische Ähnlichkeit 0.7000 liegt unter dem Cutoff 0.75.'],
  matchedSkills: [
    { jobSkill: 'Python', candidateSkill: 'Python', jobSkillCategory: 'HardSkill', similarity: 1, covered: true, priority: 'mandatory' },
    { jobSkill: 'SQL', candidateSkill: 'Python', jobSkillCategory: 'HardSkill', similarity: 0.7, covered: false, priority: 'mandatory' },
  ],
}

function renderResult(results) {
  matchingApi.getResult.mockResolvedValue({
    id: 21, job_id: 38, job_title: 'Data Engineer', created_at: '2026-11-25T07:38:00Z', results,
  })
  return render(
    <MemoryRouter initialEntries={['/matching/results/21']}>
      <I18nProvider>
        <Routes>
          <Route path="/matching/results/:id" element={<MatchingResults />} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('hr-locale', 'de')
  vi.clearAllMocks()
  sessionStorage.clear()
})

test.each(['matrix', 'vectormatch'])('zeigt IDs und Teilabdeckung trotz fehlender Muss-Skills in %s und Rankings', async (type) => {
  renderResult({
    type, method: 'vector', matrix: [row],
    jobsRanked: [{ jobId: 38, jobTitle: row.jobTitle, results: [row] }],
    candidatesRanked: [{ candidateId: 5, candidateName: row.candidateName, results: [row] }],
  })

  const candidateIds = await screen.findAllByText('Bewerber-ID:')
  expect(candidateIds).toHaveLength(3)
  candidateIds.forEach(node => expect(node).toHaveTextContent('Bewerber-ID: 5'))
  const jobIds = screen.getAllByText('Job-ID:')
  expect(jobIds).toHaveLength(3)
  jobIds.forEach(node => expect(node).toHaveTextContent('Job-ID: 38'))
  expect(screen.queryByText('candidate-uuid')).not.toBeInTheDocument()
  expect(screen.queryByText('job-uuid')).not.toBeInTheDocument()
  expect(screen.getByText(/fehlende Muss-Skills setzen ihn nicht auf 0 %/)).toBeInTheDocument()
  expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0)
  expect(screen.getByText(row.weaknesses[0])).toBeInTheDocument()
  expect(screen.getByText(row.summary)).toBeInTheDocument()
})

test('zeigt beide IDs auch im AI-Ergebnis ohne das Skill-Gate anzuwenden', async () => {
  renderResult({
    method: 'ai', results: [{ ...row, method: 'ai', score: 85, qualified: null, summary: 'AI-Gesamtbewertung' }],
  })

  expect(await screen.findByText(/Bewerber-ID:/)).toHaveTextContent('Bewerber-ID: 5 · Job-ID: 38')
  expect(screen.queryByText(/fehlende Muss-Skills setzen ihn nicht auf 0 %/)).not.toBeInTheDocument()
  expect(screen.getAllByText('85%').length).toBeGreaterThan(0)
})

test.each([
  ['de', 'Beim Aufruf aus dem Cache geladen', 'Historischer Stand: aktuelle Gültigkeit nicht erneut geprüft'],
  ['en', 'Loaded from cache on this request', 'Historical result: current validity has not been rechecked'],
])('cached AI scores retain units and original timestamp (%s)', async (locale, cacheLabel, historyLabel) => {
    localStorage.setItem('hr-locale', locale)
    const matchedAt = '2025-01-01T10:00:00Z'
    renderResult({ method: 'ai', results: [{ ...row, method: 'ai', score: 1, vectorScore: 0.85, matchedAt, evaluationId: 31, cacheStatus: 'hit' }] })
    expect(await screen.findByText(cacheLabel)).toBeInTheDocument()
    expect(screen.getAllByText('1%').length).toBeGreaterThan(0)
    expect(screen.queryByText('85%')).not.toBeInTheDocument()
    expect(document.querySelector('time')).toHaveAttribute('datetime', matchedAt)
    expect(screen.getByText(historyLabel)).toBeInTheDocument()
  })

  test('historic rows without validity evidence are explicitly unverified and missing scores stay missing', async () => {
    renderResult({ results: [{ ...row, method: undefined, score: null }] })
    expect(await screen.findByText('Unverifiziert: kein Gültigkeitsnachweis vorhanden')).toBeInTheDocument()
    expect(screen.getAllByText('Nicht berechnet').length).toBeGreaterThan(0)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(document.querySelector('time')).toBeNull()
  })

  test('history separates AI, missing scores and unverified legacy rows without inventing timestamps', async () => {
    const matchedAt = '2025-01-01T10:00:00Z'
    matchingApi.getHistory.mockResolvedValue({ data: [
      { id: 1, job_title: 'AI result', created_at: '2026-01-02T00:00:00Z', summary: {
        method: 'ai', topScore: 0.01, averageScore: 0.01, candidateCount: 1,
        topCandidates: [{ candidateName: 'Anna', method: 'ai', score: 0.01, matchedAt, evaluationId: 31, cacheStatus: 'hit' }],
      } },
      { id: 2, job_title: 'Legacy result', created_at: '2026-01-02T00:00:00Z', summary: { candidateCount: 1, topScore: null, averageScore: null } },
    ] })
    render(<MemoryRouter><I18nProvider><History /></I18nProvider></MemoryRouter>)
    expect((await screen.findAllByText('AI result')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Nicht berechnet').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unverifiziert: kein Gültigkeitsnachweis vorhanden').length).toBeGreaterThan(0)
    expect(screen.getByText('Matching-Methode nicht dokumentiert')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(document.querySelector('time')).toHaveAttribute('datetime', matchedAt)
  })

