import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import JobForm from './JobForm'
import { I18nProvider } from '../I18nContext'
import { ToastProvider } from '../components/Toast'
import { jobsApi } from '../api'
const auth = vi.hoisted(() => ({ role: 'recruiter' }))
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }))

vi.mock('../api', () => ({
  jobsApi: {
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    generateDescription: vi.fn(),
    parseDescriptionFile: vi.fn(),
  },
}))

// The app runs on a data router (createBrowserRouter) so that useUnsavedChanges
// can block navigation via useBlocker; the test router has to match, otherwise
// useBlocker throws "must be used within a data router".
function renderJobForm(initialEntry = '/jobs/new') {
  const element = (
    <I18nProvider>
      <ToastProvider>
        <JobForm />
      </ToastProvider>
    </I18nProvider>
  )
  const router = createMemoryRouter(
    [
      { path: '/jobs/new', element },
      { path: '/jobs/:id/edit', element },
      { path: '/jobs', element: <div>Stellenliste</div> },
    ],
    { initialEntries: [initialEntry] }
  )
  return render(<RouterProvider router={router} />)
}

describe('JobForm', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
    auth.role = 'recruiter'
  })

  test.each([
    ['de', 'Job-ID:'],
    ['en', 'Job ID:'],
  ])('zeigt die gespeicherte Job-ID im Kopfbereich (%s)', async (locale, label) => {
    localStorage.setItem('hr-locale', locale)
    jobsApi.getById.mockResolvedValue({ id: 42, title: 'Data Engineer' })

    renderJobForm('/jobs/42/edit')

    expect(await screen.findByText(label)).toHaveTextContent(`${label} 42`)
  })

  test.each(['admin', 'recruiter'])('keeps the import run acknowledgement visible after PDF upload (%s)', async role => {
    auth.role = role
    const runId = '00000000-0000-0000-0000-000000000001'
    jobsApi.parseDescriptionFile.mockResolvedValue({
      id: 42, job: { id: 42, title: 'Saved job' }, matchingRunId: runId, matchingStatus: 'queued',
    })
    const { container } = renderJobForm()
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(['pdf'], 'job.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('Import gespeichert, Matching eingeplant')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(runId) })).toHaveAttribute(
      'href', role === 'admin' ? `/admin/batches?runId=${runId}` : `/matching/runs/${runId}`,
    )
  })

  test('übernimmt geparste Stellenbeschreibung und Anforderungen nach Dateiupload ins Formular', async () => {
    jobsApi.parseDescriptionFile.mockResolvedValue({
      id: 'job-123',
      filename: 'Java Developer Sopra Steria.pdf',
      text: 'Java Developer Sopra Steria Gesamtdokument',
      description: 'Java Developer bei Sopra Steria mit Fokus auf Beratung und Software-Entwicklung.',
      requirements: 'Java\nSpring Boot\nDeutsch C1',
      skills: 'Java, Spring Boot, REST APIs',
      job: {
        id: 'job-123',
        title: 'Java Developer Sopra Steria',
        company: 'Sopra Steria',
        description: 'Java Developer bei Sopra Steria mit Fokus auf Beratung und Software-Entwicklung.',
        requirements: 'Java\nSpring Boot\nDeutsch C1',
        skills: 'Java, Spring Boot, REST APIs',
        benefits: '',
        about_us: '',
        location: '',
        type: 'Vollzeit',
        status: 'Offen',
        url: '',
      },
    })

    const { container } = renderJobForm()
    expect(screen.queryByText('Job-ID:')).not.toBeInTheDocument()
    const fileInput = container.querySelector('input[type="file"]')
    const titleField = screen.getByPlaceholderText('z.B. Senior Frontend Developer (m/w/d)')
    const companyField = screen.getByPlaceholderText('Unternehmen, das die Stelle ausschreibt')
    const descriptionField = screen.getByPlaceholderText('Was sind die Hauptaufgaben und Verantwortlichkeiten dieser Rolle?')
    const requirementsField = screen.getByPlaceholderText('Welche Skills, Erfahrungen und Qualifikationen werden erwartet?')
    const skillsField = screen.getByPlaceholderText('JavaScript, React, Node.js, Python (kommagetrennt)')
    const file = new File(['pdf-content'], 'Java Developer Sopra Steria.pdf', { type: 'application/pdf' })

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(jobsApi.parseDescriptionFile).toHaveBeenCalledWith(file, false, true)
    })
    expect(screen.getByText('Job-ID:')).toHaveTextContent('Job-ID: job-123')

    await waitFor(() => {
      expect(titleField).toHaveValue('Java Developer Sopra Steria')
      expect(companyField).toHaveValue('Sopra Steria')
      expect(descriptionField).toHaveValue('Java Developer bei Sopra Steria mit Fokus auf Beratung und Software-Entwicklung.')
      expect(requirementsField).toHaveValue('Java\nSpring Boot\nDeutsch C1')
      expect(skillsField).toHaveValue('Java, Spring Boot, REST APIs')
    })
    expect(screen.getByText('Java Developer Sopra Steria.pdf')).toBeInTheDocument()
    expect(screen.getByText('Stellenbeschreibung übernommen')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /aktualisieren|speichern/i }))

    await waitFor(() => {
      expect(jobsApi.update).toHaveBeenCalledWith('job-123', expect.objectContaining({
        title: 'Java Developer Sopra Steria',
        company: 'Sopra Steria',
      }))
    })

    expect(await screen.findByText('Stellenliste')).toBeInTheDocument()
  })
})