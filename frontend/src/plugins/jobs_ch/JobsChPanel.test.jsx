import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import JobsChPanel from './JobsChPanel'
import { I18nProvider } from '../../I18nContext'
import { jobsApi } from '../../api'

const toastMock = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}

vi.mock('../../components/Toast', () => ({
  useToast: () => toastMock,
}))

vi.mock('../../api', () => ({
  jobsApi: {
    exportJobsChPdfs: vi.fn(),
    importJobsChDescriptions: vi.fn(),
  },
}))

describe('JobsChPanel', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
  })

  test('loads jobs.ch links into the database', async () => {
    jobsApi.importJobsChDescriptions.mockResolvedValue({ imported: 2, failed: 0, warning: null, items: [] })

    render(
      <I18nProvider>
        <JobsChPanel />
      </I18nProvider>
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://www.jobs.ch/de/stellenangebote/detail/12345/' },
    })

    fireEvent.click(screen.getByRole('button', { name: /In die Datenbank laden/i }))

    await waitFor(() => {
      expect(jobsApi.importJobsChDescriptions).toHaveBeenCalledWith(['https://www.jobs.ch/de/stellenangebote/detail/12345/'])
      expect(toastMock.success).toHaveBeenCalled()
    })
  })

  test('shows row feedback after import', async () => {
    jobsApi.importJobsChDescriptions.mockResolvedValue({
      imported: 1,
      failed: 0,
      warning: null,
      items: [
        {
          link: 'https://www.jobs.ch/de/stellenangebote/detail/12345/',
          title: 'Mitarbeiter/in Grafik - Marketing',
          imported: true,
          error: null,
        },
      ],
    })

    render(
      <I18nProvider>
        <JobsChPanel />
      </I18nProvider>
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://www.jobs.ch/de/stellenangebote/detail/12345/' },
    })

    fireEvent.click(screen.getByRole('button', { name: /In die Datenbank laden/i }))

    expect(await screen.findByText(/Rückmeldung/i)).toBeInTheDocument()
    expect(screen.getByText(/Gelesen/i)).toBeInTheDocument()
    expect(screen.getByText(/Importiert/i)).toBeInTheDocument()
    expect(screen.getByText(/Mitarbeiter\/in Grafik - Marketing/i)).toBeInTheDocument()
  })
})
