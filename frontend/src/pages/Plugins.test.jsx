import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import Plugins from './Plugins'
import { I18nProvider } from '../I18nContext'
import { pluginsApi } from '../api'

const refreshPluginsMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../plugins/PluginContext', () => ({
  usePlugins: () => ({
    getPlugin: (pluginId) => ({ id: pluginId, enabled: true }),
    refreshPlugins: refreshPluginsMock,
  }),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    pluginsApi: {
    getAll: vi.fn().mockResolvedValue({ plugins: [{ id: 'linkedin', enabled: true }, { id: 'jobs_ch', enabled: true }] }),
    setPluginEnabled: vi.fn().mockResolvedValue({}),
    getPlugin: vi.fn().mockResolvedValue({ id: 'linkedin', enabled: true }),
    runSkillMatchingCsvTest: vi.fn().mockResolvedValue({
      passed: true,
      embedding_model: { model: 'nomic-embed-text', provider: 'ollama' },
      matching_service: {
        implementation: 'services.skill_matching.SkillMatchingService',
        method: 'match',
        api_method: 'POST',
        api_path: '/match/skills',
        invocation: 'direct',
      },
      matrix: [{
        test_id: 'p1',
        need_skill: 'Schreiner',
        has_skill: 'Schreiner',
        need_resolution_status: 'unknown',
        has_resolution_status: 'unknown',
        similarity: 1,
        weighted_similarity: 1,
        best_candidate: true,
        score_contribution: 100,
        priority: 'mandatory',
        covered: true,
        match_type: 'semantic',
        reason: 'Identische Skill-Bezeichnung nach Normalisierung.',
      }],
      output: [
        'Testid | Soll-Score | Ist-Score | Differenz | Ergebnis',
        'exact_python | 100 | 100 | 0 | OK',
        'empty_candidate_gate | 0 | 0 | 0 | OK',
        '2 passed',
      ].join('\n'),
    }),
    getSkillMatchingTestCases: vi.fn().mockResolvedValue({
      cases: [{
        id: 1,
        test_id: 'exact_python',
        need_skills: [{ name: 'Python', priority: 'mandatory' }],
        has_skills: ['Python'],
        expected_score: 100,
      }],
    }),
    createSkillMatchingTestCase: vi.fn().mockResolvedValue({}),
    updateSkillMatchingTestCase: vi.fn().mockImplementation((id, testCase) => Promise.resolve({ id, ...testCase })),
    deleteSkillMatchingTestCase: vi.fn().mockResolvedValue({ deleted: true }),
    },
  }
})

describe('Plugins', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
    refreshPluginsMock.mockResolvedValue(undefined)
  })

  test('can toggle the jobs.ch plugin', async () => {
    render(
      <I18nProvider>
        <Plugins />
      </I18nProvider>
    )

    const jobsCard = await screen.findByText(/Jobs\.ch Plugin/i)
    const card = jobsCard.closest('div[class*="bg-white"]')
    const disableButton = within(card).getByRole('button', { name: /Deaktivieren/i })
    fireEvent.click(disableButton)

    await waitFor(() => {
      expect(pluginsApi.setPluginEnabled).toHaveBeenCalledWith('jobs_ch', false)
      expect(refreshPluginsMock).toHaveBeenCalled()
    })
  })

  test('can run the skill matching CSV integration test', async () => {
    render(
      <I18nProvider>
        <Plugins />
      </I18nProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: /CSV-Test starten/i }))

    await waitFor(() => {
      expect(pluginsApi.runSkillMatchingCsvTest).toHaveBeenCalled()
    })
    const table = await screen.findByRole('table', { name: 'Matching-Score-Ergebnisse' })
    expect(within(table).getByRole('columnheader', { name: 'Soll' })).toBeInTheDocument()
    expect(within(table).getByText('exact_python')).toBeInTheDocument()
    expect(within(table).getAllByText('100')).toHaveLength(2)
    expect(within(table).getAllByText('CSV-Integrationstest bestanden')).toHaveLength(2)
    expect(screen.getByText('nomic-embed-text (ollama)')).toBeInTheDocument()
    const serviceDetails = screen
      .getByText('services.skill_matching.SkillMatchingService.match()')
      .closest('div')
    expect(serviceDetails).toHaveTextContent('GraphRAG-API')
    expect(serviceDetails).toHaveTextContent('POST /match/skills')
    expect(serviceDetails).toHaveTextContent('Direkter Service-Aufruf (kein HTTP-Aufruf)')
    const matrix = screen.getByRole('table', { name: 'Matching-Matrix (alle Bedarf-/Kandidaten-Skill-Paare)' })
    expect(within(matrix).getAllByText('Schreiner')).toHaveLength(2)
    expect(within(matrix).getAllByText('1.0000')).toHaveLength(2)
    expect(within(matrix).getByText('Score-Beitrag (Punkte)')).toBeInTheDocument()
    expect(within(matrix).getByText('100.0000')).toBeInTheDocument()
  })

  test('saves edited test cases to the database API', async () => {
    render(
      <I18nProvider>
        <Plugins />
      </I18nProvider>
    )

    const testIdInput = await screen.findByDisplayValue('exact_python')
    const row = testIdInput.closest('tr')
    fireEvent.change(within(row).getByRole('textbox', { name: 'Benötigte Skills (CSV) exact_python' }), {
      target: { value: 'name,priority\nPython,mandatory\nExcel,nice_to_have' },
    })
    fireEvent.change(within(row).getByRole('textbox', { name: 'Vorhandene Skills (CSV) exact_python' }), {
      target: { value: 'skill\nPython\nPostgreSQL' },
    })
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '95' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(pluginsApi.updateSkillMatchingTestCase).toHaveBeenCalledWith(1, {
        test_id: 'exact_python',
        need_skills: [
          { name: 'Python', priority: 'mandatory' },
          { name: 'Excel', priority: 'nice_to_have' },
        ],
        has_skills: ['Python', 'PostgreSQL'],
        expected_score: 95,
      })
    })
  })
})
