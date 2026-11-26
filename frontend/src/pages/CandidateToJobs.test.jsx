import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import CandidateToJobs from './CandidateToJobs'
import { I18nProvider } from '../I18nContext'
import { candidatesApi, jobsApi, matchingApi } from '../api'

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    candidatesApi: { ...original.candidatesApi, getAll: vi.fn() },
    jobsApi: { ...original.jobsApi, getAll: vi.fn() },
    matchingApi: { ...original.matchingApi, vectorMatch: vi.fn() },
  }
})

vi.mock('../components/CandidatePicker', () => ({
  default: ({ onToggle }) => <button onClick={() => onToggle(1)}>Select candidate</button>,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CandidateToJobs />
      </I18nProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('hr-locale', 'de')
  candidatesApi.getAll.mockResolvedValue({ data: [{ id: 1, name: 'Anna Muster' }] })
  jobsApi.getAll.mockResolvedValue({ data: [{ id: 2, title: 'Backend Engineer' }] })
  matchingApi.vectorMatch.mockResolvedValue({ id: 42 })
})

test('Kandidat-zu-Stellen-Matching verwendet Neo4j ohne Engine-Auswahl', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Select candidate' }))

  expect(screen.queryByRole('button', { name: 'Python' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Neo4j' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Gegen alle Stellen matchen' }))

  await waitFor(() => {
    expect(matchingApi.vectorMatch).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'candidate_to_jobs', candidateId: 1, engine: 'neo4j' }),
    )
  })
})
