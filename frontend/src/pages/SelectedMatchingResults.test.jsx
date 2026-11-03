import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import SelectedMatchingResults from './SelectedMatchingResults'
import { matchingApi } from '../api'

vi.mock('../api', () => ({
  matchingApi: {
    vectorMatchSelected: vi.fn(),
    runSelected: vi.fn(),
  },
}))

const pairs = [
  { jobId: 2, jobTitle: 'Backend Engineer', candidateId: 7, candidateName: 'Anna Muster' },
  { jobId: 2, jobTitle: 'Backend Engineer', candidateId: 9, candidateName: 'Manuel Manuell' },
]

function renderPage() {
  sessionStorage.setItem('hrtool:matching:selected-batch', JSON.stringify({ pairs, mode: 'vector', engine: 'neo4j' }))
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/matching/results/selected', state: { pairs, mode: 'vector', engine: 'neo4j' } }]}>
      <SelectedMatchingResults />
    </MemoryRouter>,
  )
}

describe('SelectedMatchingResults – 3D-Matching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  test('matches all pairs in one backend call and shows pairs that could not be matched', async () => {
    matchingApi.vectorMatchSelected.mockResolvedValue({
      results: [{ jobId: 2, jobTitle: 'Backend Engineer', candidateId: 7, candidateName: 'Anna Muster', score: 64, hardSkillScore: 0.7, softSkillScore: 0.3, matchedSkills: [] }],
      failures: [{ jobId: 2, jobTitle: 'Backend Engineer', candidateId: 9, candidateName: 'Manuel Manuell', error: 'Bewerber nicht in Neo4j: Embedding-Dienst nicht erreichbar' }],
      selectedCount: 2,
    })
    renderPage()

    expect(await screen.findByText('Anna Muster')).toBeTruthy()
    expect(matchingApi.vectorMatchSelected).toHaveBeenCalledTimes(1)
    expect(matchingApi.vectorMatchSelected).toHaveBeenCalledWith(pairs, 'neo4j')
    expect(screen.getByText('Bewerber nicht in Neo4j: Embedding-Dienst nicht erreichbar')).toBeTruthy()
  })

  test('shows the error message when the 3D matching fails as a whole', async () => {
    matchingApi.vectorMatchSelected.mockRejectedValue(new Error('Keiner der angegebenen Bewerber ist in Neo4j vorhanden: Manuel Manuell'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Keiner der angegebenen Bewerber ist in Neo4j vorhanden: Manuel Manuell')).toBeTruthy())
  })
})
