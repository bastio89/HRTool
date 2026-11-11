import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import CrmExchange from './CrmExchange'
import { crmApi } from '../api'

vi.mock('../api', () => ({
  crmApi: {
    inspectArchive: vi.fn(),
    importCandidate: vi.fn(),
    discardImport: vi.fn(),
    previewReturn: vi.fn(),
    downloadReturn: vi.fn(),
  },
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../components/Toast', () => ({ useToast: () => toast }))

const MARIA = '11111111-1111-4111-8111-111111111111'
const OTTO = '22222222-2222-4222-8222-222222222222'
const inspection = {
  token: '33333333-3333-4333-8333-333333333333',
  summary: { total: 3, new: 1, update: 1, errors: 1 },
  rows: [
    { line: 2, uuid: MARIA, firstName: 'Maria', lastName: 'Beispiel', labels: ['Deutsch', 'Projektleiter'], cvPath: `cvs/${MARIA}.pdf`, cvSize: 52000, action: 'new', existingId: null, error: null },
    { line: 3, uuid: OTTO, firstName: 'Otto', lastName: 'Da', labels: [], cvPath: `cvs/${OTTO}.docx`, cvSize: 2048, action: 'update', existingId: 9, existingName: 'Otto Da', error: null },
    { line: 4, uuid: 'kaputt', firstName: 'Kai', lastName: 'Kaputt', labels: [], cvPath: 'cvs/x.pdf', cvSize: null, action: null, error: 'UUID fehlt oder ist ungültig' },
  ],
}

function renderPage() {
  return render(<MemoryRouter><CrmExchange /></MemoryRouter>)
}

async function uploadZip() {
  fireEvent.change(screen.getByLabelText('hr-matching-kandidaten.zip auswählen'), { target: { files: [new File(['zip'], 'hr-matching-kandidaten.zip', { type: 'application/zip' })] } })
  fireEvent.click(screen.getByRole('button', { name: 'ZIP prüfen' }))
  await screen.findByText('Maria Beispiel')
}

describe('CrmExchange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    crmApi.inspectArchive.mockResolvedValue(inspection)
  })

  test('shows the check result and imports the valid candidates one by one', async () => {
    crmApi.importCandidate
      .mockResolvedValueOnce({ uuid: MARIA, status: 'created', warning: null, candidate: { id: 5 } })
      .mockRejectedValueOnce(new Error('Im CV wurde kein lesbarer Text gefunden'))
    renderPage()
    await uploadZip()

    expect(screen.getByText('UUID fehlt oder ist ungültig')).toBeTruthy()
    expect(screen.getByText('Bereits im Tool als Otto Da')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Import starten (2)' }))

    await screen.findByText('Angelegt')
    await screen.findByText('Im CV wurde kein lesbarer Text gefunden')
    expect(crmApi.importCandidate.mock.calls).toEqual([[inspection.token, MARIA], [inspection.token, OTTO]])
    expect(screen.getByText('2 von 2 verarbeitet, davon 1 fehlgeschlagen')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Maria Beispiel' }).getAttribute('href')).toBe('/candidates/5')

    // Ein zweiter Lauf versucht nur den fehlgeschlagenen erneut.
    crmApi.importCandidate.mockResolvedValueOnce({ uuid: OTTO, status: 'unchanged', candidate: { id: 9 } })
    fireEvent.click(screen.getByRole('button', { name: 'Fehlgeschlagene erneut versuchen (1)' }))
    await screen.findByText('Aktualisiert (CV unverändert)')
    expect(crmApi.importCandidate).toHaveBeenLastCalledWith(inspection.token, OTTO)
    expect(crmApi.importCandidate).toHaveBeenCalledTimes(3)
  })

  test('shows why the ZIP was rejected', async () => {
    crmApi.inspectArchive.mockRejectedValue(new Error('kandidaten.csv fehlt im Archiv'))
    renderPage()
    fireEvent.change(screen.getByLabelText('hr-matching-kandidaten.zip auswählen'), { target: { files: [new File(['x'], 'a.zip')] } })
    fireEvent.click(screen.getByRole('button', { name: 'ZIP prüfen' }))
    expect((await screen.findByRole('alert')).textContent).toBe('kandidaten.csv fehlt im Archiv')
  })

  test('explains an empty return instead of showing nothing', async () => {
    crmApi.previewReturn.mockResolvedValue({
      method: 'ai', methodLabel: 'KI-Matching', threshold: null, rowCount: 0, candidateCount: 0, parts: [],
      excludedCount: 0, excludedReasons: {}, excluded: [], sample: [],
      diagnostics: { totalPairs: 42, notCrmPairs: 42, notCrmCandidates: 7, belowThreshold: 0, crmCandidates: 1, crmCandidatesUnmatched: 1 },
    })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))

    const box = await screen.findByRole('status')
    expect(within(box).getByText(/^42 Paarungen von 7 Kandidaten, die nicht über das CRM-ZIP importiert wurden/)).toBeTruthy()
    expect(within(box).getByText('1 von 1 CRM-Kandidaten wurden mit KI-Matching noch nicht gematcht.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rückgabe-CSV herunterladen' })).toBeNull()
  })

  test('previews the return, lists excluded pairs and downloads each part', async () => {
    crmApi.previewReturn.mockResolvedValue({
      method: 'vector', methodLabel: '3D-Matching', threshold: 70, rowCount: 6200, candidateCount: 40,
      parts: [{ part: 1, rows: 5000 }, { part: 2, rows: 1200 }],
      excludedCount: 1, excludedReasons: { 'Stelle ohne URL': 1 },
      excluded: [{ candidateId: 5, candidateName: 'Maria Beispiel', jobId: 7, jobTitle: 'Projektleitung', score: 88, reasons: ['Stelle ohne URL'] }],
      sample: [],
    })
    crmApi.downloadReturn.mockResolvedValue({ filename: 'hr-matching-rueckgabe-3d-teil-2-von-2.csv' })
    renderPage()

    fireEvent.change(screen.getByLabelText('Matching'), { target: { value: 'vector' } })
    fireEvent.change(screen.getByLabelText('Nur Matchingwert größer als (%)'), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))

    expect(await screen.findByText('6200 Zeilen für 40 Kandidaten (3D-Matching).')).toBeTruthy()
    expect(crmApi.previewReturn).toHaveBeenCalledWith('vector', '70')
    const excluded = screen.getByRole('link', { name: 'Projektleitung' }).closest('tr')
    expect(within(excluded).getByText('Stelle ohne URL')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Teil 2 von 2/ }))
    await waitFor(() => expect(crmApi.downloadReturn).toHaveBeenCalledWith('vector', '70', 2))
    expect(toast.success).toHaveBeenCalledWith('hr-matching-rueckgabe-3d-teil-2-von-2.csv heruntergeladen')
  })
})
