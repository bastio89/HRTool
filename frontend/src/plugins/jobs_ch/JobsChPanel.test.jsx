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

    fireEvent.change(screen.getByPlaceholderText(/stellenangebote\/detail/i), {
      target: { value: 'https://www.jobs.ch/de/stellenangebote/detail/12345/' },
    })

    fireEvent.click(screen.getByTestId('jobs-ch-import'))

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

    fireEvent.change(screen.getByPlaceholderText(/stellenangebote\/detail/i), {
      target: { value: 'https://www.jobs.ch/de/stellenangebote/detail/12345/' },
    })

    fireEvent.click(screen.getAllByRole('button', { name: /In die Datenbank laden/i })[0])

    expect(await screen.findByText(/Rückmeldung/i)).toBeInTheDocument()
    expect(screen.getByText(/Gelesen/i)).toBeInTheDocument()
    expect(screen.getByText(/Importiert/i)).toBeInTheDocument()
    expect(screen.getByText(/Mitarbeiter\/in Grafik - Marketing/i)).toBeInTheDocument()
  })

  test('searches jobs.ch and imports selected results', async () => {
    jobsApi.searchJobsCh = vi.fn().mockResolvedValue({
      query: 'pflege',
      count: 1,
      items: [
        {
          title: 'Pflegefachperson HF',
          link: 'https://www.jobs.ch/de/stellenangebote/detail/abc123/',
          company: 'Beispiel AG',
          location: 'Bern',
        },
      ],
    })
    jobsApi.importJobsChDescriptions.mockResolvedValue({ imported: 1, failed: 0, warning: null, items: [] })

    render(
      <I18nProvider>
        <JobsChPanel />
      </I18nProvider>
    )

    fireEvent.change(screen.getByPlaceholderText(/Suchbegriff eingeben/i), {
      target: { value: 'pflege' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Suchen/i }))

    expect(await screen.findByText(/Pflegefachperson HF/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getAllByRole('button', { name: /Ausgewählte importieren/i })[0])

    await waitFor(() => {
      expect(jobsApi.importJobsChDescriptions).toHaveBeenCalledWith(['https://www.jobs.ch/de/stellenangebote/detail/abc123/'])
    })
  })

  test('combines manual links and selected search results for top actions', async () => {
    jobsApi.searchJobsCh = vi.fn().mockResolvedValue({
      query: 'pflege',
      count: 1,
      items: [
        {
          title: 'Pflegefachperson HF',
          link: 'https://www.jobs.ch/de/stellenangebote/detail/abc123/',
          company: 'Beispiel AG',
          location: 'Bern',
        },
      ],
    })
    jobsApi.importJobsChDescriptions.mockResolvedValue({ imported: 2, failed: 0, warning: null, items: [] })
    jobsApi.exportJobsChPdfs.mockResolvedValue({ blob: new Blob(['zip']), filename: 'jobs-ch-pdfs.zip', warning: null })

    render(
      <I18nProvider>
        <JobsChPanel />
      </I18nProvider>
    )

    fireEvent.change(screen.getByPlaceholderText(/stellenangebote\/detail/i), {
      target: { value: 'https://www.jobs.ch/de/stellenangebote/detail/12345/' },
    })
    await waitFor(() => {
      expect(screen.getByDisplayValue('https://www.jobs.ch/de/stellenangebote/detail/12345/')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/Suchbegriff eingeben/i), {
      target: { value: 'pflege' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Suchen/i }))

    expect(await screen.findByText(/Pflegefachperson HF/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getAllByRole('button', { name: /In die Datenbank laden/i })[0])

    await waitFor(() => {
      expect(jobsApi.importJobsChDescriptions).toHaveBeenCalledWith([
        'https://www.jobs.ch/de/stellenangebote/detail/12345/',
        'https://www.jobs.ch/de/stellenangebote/detail/abc123/',
      ])
    })

    fireEvent.click(screen.getByTestId('jobs-ch-export'))

    await waitFor(() => {
      expect(jobsApi.exportJobsChPdfs).toHaveBeenCalledWith([
        'https://www.jobs.ch/de/stellenangebote/detail/12345/',
        'https://www.jobs.ch/de/stellenangebote/detail/abc123/',
      ])
    })
  })
})
