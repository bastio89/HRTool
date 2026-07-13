import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import JobForm from './JobForm'
import { I18nProvider } from '../I18nContext'
import { ToastProvider } from '../components/Toast'
import { jobsApi } from '../api'

vi.mock('../api', () => ({
  jobsApi: {
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    generateDescription: vi.fn(),
    parseDescriptionFile: vi.fn(),
  },
}))

function renderJobForm() {
  return render(
    <MemoryRouter initialEntries={['/jobs/new']}>
      <I18nProvider>
        <ToastProvider>
          <Routes>
            <Route path="/jobs/new" element={<JobForm />} />
          </Routes>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('JobForm', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
  })

  test('übernimmt geparste Stellenbeschreibung und Anforderungen nach Dateiupload ins Formular', async () => {
    jobsApi.parseDescriptionFile.mockResolvedValue({
      filename: 'Java Developer Sopra Steria.pdf',
      text: 'Java Developer Sopra Steria Gesamtdokument',
      description: 'Java Developer bei Sopra Steria mit Fokus auf Beratung und Software-Entwicklung.',
      requirements: 'Java\nSpring Boot\nDeutsch C1',
    })

    const { container } = renderJobForm()
    const fileInput = container.querySelector('input[type="file"]')
    const titleField = screen.getByPlaceholderText('z.B. Senior Frontend Developer (m/w/d)')
    const descriptionField = screen.getByPlaceholderText('Was sind die Hauptaufgaben und Verantwortlichkeiten dieser Rolle?')
    const requirementsField = screen.getByPlaceholderText('Welche Skills, Erfahrungen und Qualifikationen werden erwartet?')
    const file = new File(['pdf-content'], 'Java Developer Sopra Steria.pdf', { type: 'application/pdf' })

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(jobsApi.parseDescriptionFile).toHaveBeenCalledWith(file)
    })

    await waitFor(() => {
      expect(titleField).toHaveValue('Java Developer Sopra Steria')
      expect(descriptionField).toHaveValue('Java Developer bei Sopra Steria mit Fokus auf Beratung und Software-Entwicklung.')
      expect(requirementsField).toHaveValue('Java\nSpring Boot\nDeutsch C1')
    })

    expect(screen.getByText('Java Developer Sopra Steria.pdf')).toBeInTheDocument()
    expect(screen.getByText('Stellenbeschreibung übernommen')).toBeInTheDocument()
  })
})