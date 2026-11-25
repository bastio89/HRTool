import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import CandidateDetail from './CandidateDetail'
import { I18nProvider } from '../I18nContext'
import { ToastProvider } from '../components/Toast'

vi.mock('../api', () => ({
  candidatesApi: {
    getById: vi.fn().mockResolvedValue({ id: 42, uuid: 'candidate-uuid', name: 'Anna Muster' }),
    getHistory: vi.fn().mockResolvedValue({ entries: [], stageChanges: [], interviews: [] }),
  },
  activitiesApi: { getByCandidate: vi.fn().mockResolvedValue({ data: [] }) },
  uploadsApi: { getByCandidate: vi.fn().mockResolvedValue({ data: [] }) },
  ratingsApi: { getByCandidate: vi.fn().mockResolvedValue({ data: [], averages: {}, overall: null }) },
  candidateDetailsApi: {
    getWorkHistory: vi.fn().mockResolvedValue({ data: [] }),
    getEducation: vi.fn().mockResolvedValue({ data: [] }),
    getCustomValues: vi.fn().mockResolvedValue({ data: [] }),
  },
  scorecardsApi: { getResponses: vi.fn().mockResolvedValue({ data: [] }) },
}))

vi.mock('../components/CommentSection', () => ({ default: () => null }))

test.each([
  ['de', 'Bewerber-ID:'],
  ['en', 'Candidate ID:'],
])('zeigt die gespeicherte Bewerber-ID im Profilkopf (%s)', async (locale, label) => {
  localStorage.setItem('hr-locale', locale)
  render(
    <MemoryRouter initialEntries={['/candidates/42/detail']}>
      <I18nProvider>
        <ToastProvider>
          <Routes>
            <Route path="/candidates/:id/detail" element={<CandidateDetail />} />
          </Routes>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByText(label)).toHaveTextContent(`${label} 42`)
  expect(screen.queryByText('candidate-uuid')).not.toBeInTheDocument()
})
