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
  }, {
    key: 'matching_vector',
    label: '3D-Matching (Bewerber × Stellen)',
    description: 'N:N',
    defaultFormat: 'csv',
    defaultFields: ['candidate_id', 'job_id', 'score'],
    filters: [
      { key: 'score_above', type: 'number', min: 0, max: 100, unit: '%', primary: true, label: 'Nur Matchingwert größer als (%)' },
      { key: 'job_ids', type: 'list', label: 'Nur diese Stellen-IDs' },
      { key: 'job_status', type: 'list', options: ['Offen', 'Besetzt'], label: 'Status der Stelle' },
      { key: 'updated_since', type: 'datetime', label: 'Gematcht seit' },
    ],
    fields: [
      { key: 'candidate_id', label: 'Bewerber-ID', group: 'Bewerber', type: 'number' },
      { key: 'job_id', label: 'Stellen-ID', group: 'Stelle', type: 'number' },
      { key: 'job_uuid', label: 'Stellen-UUID (GraphRAG/Neo4j)', group: 'Stelle', type: 'string' },
      { key: 'score', label: 'Matchingwert (%)', group: 'Matching', type: 'number' },
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

  it('exports N:N matching results above the entered threshold', async () => {
    renderPage('/admin/export?entity=matching_vector&ids=4')
    await screen.findByText('Verfügbare Felder')

    expect(screen.getByRole('radio', { name: '3D-Matching' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('Nur Matchingwert größer als'), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('Stellen-IDs (kommagetrennt)'), { target: { value: '3, 9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Offen' }))
    fireEvent.click(screen.getByLabelText(/^Stellen-UUID/))
    fireEvent.click(screen.getByRole('button', { name: /Herunterladen/ }))

    await waitFor(() => expect(exportsApi.run).toHaveBeenCalledTimes(1))
    expect(exportsApi.run).toHaveBeenCalledWith({
      entity: 'matching_vector',
      format: 'csv',
      format_options: {},
      fields: [{ key: 'candidate_id', as: 'candidate_id' }, { key: 'job_id', as: 'job_id' }, { key: 'score', as: 'score' }, { key: 'job_uuid', as: 'job_uuid' }],
      // Die Bewerberauswahl aus der URL gilt nur fuer den Bewerber-Export.
      filters: { score_above: 70, job_ids: [3, 9], job_status: ['Offen'] },
    })
  })

  it('switching the data source starts a fresh draft with its own fields and filters', async () => {
    renderPage('/admin/export?ids=4')
    await screen.findByText('Verfügbare Felder')
    expect(screen.getByText('Welche Bewerber?')).toBeTruthy()
    expect(screen.queryByLabelText('Nur Matchingwert größer als')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: '3D-Matching' }))
    expect(screen.getByText('Welche Matchings?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Herunterladen/ }))

    await waitFor(() => expect(exportsApi.run).toHaveBeenCalledTimes(1))
    expect(exportsApi.run.mock.calls[0][0]).toMatchObject({
      entity: 'matching_vector',
      fields: [{ key: 'candidate_id', as: 'candidate_id' }, { key: 'job_id', as: 'job_id' }, { key: 'score', as: 'score' }],
      filters: {},
    })
  })

  it('restores the threshold of a saved matching profile', async () => {
    exportsApi.getProfiles.mockResolvedValue([{
      id: 5, name: 'Top-Matches', description: '', entity: 'matching_vector', format: 'csv', format_options: {},
      fields: [{ key: 'job_id', as: 'stelle' }], filters: { score_above: 85, job_status: ['Besetzt'] }, external_enabled: false,
    }])
    renderPage()
    fireEvent.click(await screen.findByText('Top-Matches'))
    expect(screen.getByLabelText('Nur Matchingwert größer als').value).toBe('85')
    expect(screen.getByRole('button', { name: 'Besetzt' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('hides profile management from non-admins', async () => {
    auth.role = 'recruiter'
    renderPage()
    await screen.findByText('Verfügbare Felder')
    expect(screen.queryByRole('button', { name: /Als Profil speichern/ })).toBeNull()
    expect(screen.queryByText(/Fremdsysteme freigeben/)).toBeNull()
  })
})
