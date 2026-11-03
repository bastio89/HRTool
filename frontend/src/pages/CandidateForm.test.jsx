import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import CandidateForm from './CandidateForm'
import { I18nProvider } from '../I18nContext'
import { ToastProvider } from '../components/Toast'
import { candidatesApi } from '../api'

vi.mock('../api', () => ({
  candidatesApi: {
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    checkDuplicate: vi.fn(),
  },
  cvParserApi: { parse: vi.fn() },
  uploadsApi: { upload: vi.fn() },
  candidateDetailsApi: {
    getCustomFieldDefinitions: vi.fn().mockResolvedValue({ data: [] }),
    bulkWorkHistory: vi.fn(),
    bulkEducation: vi.fn(),
    saveCustomValues: vi.fn(),
  },
}))

vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))

// Wie in der App: Datenrouter, sonst wirft useBlocker (useUnsavedChanges).
function renderForm() {
  localStorage.setItem('hr-locale', 'de')
  const router = createMemoryRouter(
    [
      { path: '/candidates/new', element: <I18nProvider><ToastProvider><CandidateForm /></ToastProvider></I18nProvider> },
      { path: '/candidates', element: <div>Bewerberliste</div> },
      { path: '/candidates/:id', element: <div>Bewerberdetail</div> },
    ],
    { initialEntries: ['/candidates/new'] },
  )
  return render(<RouterProvider router={router} />)
}

const saveButton = () => screen.getByRole('button', { name: 'Anlegen' })

describe('CandidateForm – eine Person gibt es nur einmal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    candidatesApi.checkDuplicate.mockResolvedValue({ duplicates: [] })
  })

  test('requires the date of birth before saving', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Anna Muster' } })
    expect(saveButton().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Geburtsdatum *'), { target: { value: '1990-02-14' } })
    expect(saveButton().disabled).toBe(false)
  })

  test('blocks saving when the same name and birth date exist and links the existing person', async () => {
    candidatesApi.checkDuplicate.mockResolvedValue({
      duplicates: [{ id: 42, name: 'Anna Muster', matchType: 'identity', blocking: true }],
    })
    renderForm()
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Anna Muster' } })
    fireEvent.change(screen.getByLabelText('Geburtsdatum *'), { target: { value: '1990-02-14' } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/bereits angelegt/)
    expect(screen.getByRole('link', { name: 'Vorhandenen Bewerber öffnen' }).getAttribute('href')).toBe('/candidates/42')
    expect(saveButton().disabled).toBe(true)
    await waitFor(() => expect(candidatesApi.checkDuplicate).toHaveBeenLastCalledWith('Anna Muster', '', undefined, '1990-02-14'))
  })

  test('shows the existing person when the server rejects the save as duplicate', async () => {
    const duplicate = Object.assign(new Error('Diese Person ist bereits im Tool angelegt: Anna Muster (ID 7)'), {
      status: 409,
      code: 'DUPLICATE_CANDIDATE',
      existing: { id: 7, name: 'Anna Muster' },
    })
    candidatesApi.create.mockRejectedValue(duplicate)
    renderForm()
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Anna Muster' } })
    fireEvent.change(screen.getByLabelText('Geburtsdatum *'), { target: { value: '1990-02-14' } })
    fireEvent.click(saveButton())

    await screen.findByRole('link', { name: 'Vorhandenen Bewerber öffnen' })
    expect(candidatesApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Anna Muster', birth_date: '1990-02-14' }))
    expect(screen.queryByText('Bewerberliste')).toBeNull()
  })
})
