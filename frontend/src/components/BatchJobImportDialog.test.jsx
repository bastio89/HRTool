import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import BatchJobImportDialog from './BatchJobImportDialog'
import { I18nProvider } from '../I18nContext'
import { jobsApi } from '../api'

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
    const { container } = render(
      <I18nProvider>
        <BatchJobImportDialog onClose={onClose} onImported={onImported} />
      </I18nProvider>
    )

    const file = new File(['job text'], 'Senior Backend Engineer.pdf', { type: 'application/pdf' })
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByText('Senior Backend Engineer.pdf')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /1 Stellen importieren/i }))

    await waitFor(() => {
      expect(screen.getByText(/GraphRAG-Sync fehlgeschlagen: GraphRAG HTTP 503: service unavailable/i)).toBeInTheDocument()
    })

    expect(jobsApi.parseDescriptionFile).toHaveBeenCalledWith(file, false, false, true)
    expect(onImported).toHaveBeenCalledTimes(1)
  })
})
