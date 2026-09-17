import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import BatchJobImportDialog from './BatchJobImportDialog'
import { I18nProvider } from '../I18nContext'
import { jobsApi } from '../api'
import de from '../i18n/de'

vi.mock('../api', () => ({
  jobsApi: {
    parseDescriptionFile: vi.fn(),
  },
}))

describe('BatchJobImportDialog', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
  })

  test('shows GraphRAG sync error after job creation', async () => {
    jobsApi.parseDescriptionFile.mockResolvedValue({
      filename: 'Senior Backend Engineer.pdf',
      title: 'Senior Backend Engineer',
      text: 'Senior Backend Engineer at ACME with Node.js APIs, 5+ years experience, Home Office.',
      description: 'Node.js APIs',
      requirements: '5+ Jahre Erfahrung',
      benefits: 'Home Office',
    })
    jobsApi.parseDescriptionFile.mockResolvedValueOnce({
      id: 'job-1',
      profile: { title: 'Senior Backend Engineer' },
      graphRag: { error: 'GraphRAG HTTP 503: service unavailable' },
    })

    const onClose = vi.fn()
    const onImported = vi.fn()
    render(
      <I18nProvider>
        <BatchJobImportDialog onClose={onClose} onImported={onImported} />
      </I18nProvider>
    )

    const file = new File(['job text'], 'Senior Backend Engineer.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByText('Senior Backend Engineer.pdf')).toBeInTheDocument()
    })

    // Beschriftungen aus dem Woerterbuch ableiten statt abzutippen: der Test
    // prueft, dass der Sync-Fehler beim Nutzer ankommt, nicht den Wortlaut.
    // Eine abgetippte Fassung ist an einer Umformulierung gescheitert.
    const startLabel = de['batch_job_import.start'].replace('{n}', '1')
    fireEvent.click(screen.getByRole('button', { name: startLabel }))

    const syncError = de['batch_job_import.graph_rag_error'].replace(
      '{error}',
      'GraphRAG HTTP 503: service unavailable'
    )
    await waitFor(() => {
      expect(screen.getByText(syncError)).toBeInTheDocument()
    })

    expect(jobsApi.parseDescriptionFile).toHaveBeenCalledWith(file, false, false, true)
    expect(onImported).toHaveBeenCalledTimes(1)
  })
})
