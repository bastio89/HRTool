import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import DataExport from './DataExport'

const { exportsApi } = vi.hoisted(() => ({
  exportsApi: {
    getSchema: vi.fn(),
    getProfiles: vi.fn(),
    preview: vi.fn(),
    run: vi.fn(),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
  },
}))

vi.mock('../api', () => ({ exportsApi }))
const auth = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))

const schema = {
  entities: [{
    key: 'candidates',
    label: 'Bewerber',
    defaultFields: ['id', 'email'],
    filters: [],
    fields: [
      { key: 'id', label: 'Interne ID', group: 'Stammdaten', type: 'number' },
      { key: 'email', label: 'E-Mail', group: 'Stammdaten', type: 'string' },
      { key: 'phone', label: 'Telefon', group: 'Stammdaten', type: 'string' },
    ],
  }],
  formats: [
    { key: 'csv', label: 'CSV', options: [{ key: 'delimiter', type: 'enum', values: ['comma', 'semicolon'], default: 'comma', label: 'Trennzeichen' }] },
    { key: 'json', label: 'JSON', options: [] },
  ],
}

function renderPage(url = '/admin/export') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DataExport />
    </MemoryRouter>,
  )
}

describe('DataExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.role = 'admin'
    exportsApi.getSchema.mockResolvedValue(schema)
    exportsApi.getProfiles.mockResolvedValue([])
    exportsApi.run.mockResolvedValue({ count: 2, filename: 'x.csv' })
  })

  it('sends the mapped fields and the candidate selection from the URL', async () => {
    renderPage('/admin/export?ids=4,7')
    await screen.findByText('Verfügbare Felder')

    fireEvent.click(screen.getByLabelText(/^Telefon/))
    fireEvent.change(screen.getByLabelText('Zielfeldname: E-Mail'), { target: { value: 'contact.email' } })
    fireEvent.click(screen.getByRole('button', { name: /Herunterladen/ }))

    await waitFor(() => expect(exportsApi.run).toHaveBeenCalledTimes(1))
    expect(exportsApi.run).toHaveBeenCalledWith({
      entity: 'candidates',
      format: 'csv',
      format_options: {},
      fields: [{ key: 'id', as: 'id' }, { key: 'email', as: 'contact.email' }, { key: 'phone', as: 'phone' }],
      filters: { ids: [4, 7] },
    })
  })

  it('offers profile management to admins', async () => {
    renderPage()
    await screen.findByText('Verfügbare Felder')
    expect(screen.getByRole('button', { name: /Als Profil speichern/ })).toBeTruthy()
    expect(screen.getByText(/Fremdsysteme freigeben/)).toBeTruthy()
  })

  it('hides profile management from non-admins', async () => {
    auth.role = 'recruiter'
    renderPage()
    await screen.findByText('Verfügbare Felder')
    expect(screen.queryByRole('button', { name: /Als Profil speichern/ })).toBeNull()
    expect(screen.queryByText(/Fremdsysteme freigeben/)).toBeNull()
  })
})
