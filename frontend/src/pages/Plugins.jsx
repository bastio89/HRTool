import { useEffect, useState } from 'react'
import { Loader2, Play, ToggleLeft, ToggleRight } from 'lucide-react'
import { parseCsvText, pluginsApi } from '../api'
import { usePlugins } from '../plugins/PluginContext'
import { Card, Button, PageContainer } from '../components/UI'
import { useI18n } from '../I18nContext'

const PLUGIN_CONFIGS = [
  {
    id: 'linkedin',
    titleKey: 'plugin.linkedin_title',
    descKey: 'plugin.linkedin_desc',
    enableKey: 'plugin.linkedin_enable',
    disableKey: 'plugin.linkedin_disable',
    route: '/api/plugins/linkedin/*',
  },
  {
    id: 'jobs_ch',
    titleKey: 'plugin.jobs_ch_title',
    descKey: 'plugin.jobs_ch_desc',
    enableKey: 'plugin.jobs_ch_enable',
    disableKey: 'plugin.jobs_ch_disable',
    route: '/api/plugins/jobs_ch/*',
  },
  {
    id: 'skill_matching_tests',
    titleKey: 'plugin.skill_matching_tests_title',
    descKey: 'plugin.skill_matching_tests_desc',
    enableKey: 'plugin.skill_matching_tests_enable',
    disableKey: 'plugin.skill_matching_tests_disable',
    route: '/api/plugins/skill_matching_tests/run',
    canRunCsvTest: true,
  },
]

function parseMatchingScoreRows(output) {
  return String(output || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(OK|FEHLER)\s*$/)
    if (!match) return []

    return [{
      testId: match[1],
      expectedScore: Number(match[2]),
      actualScore: Number(match[3]),
      difference: Number(match[4]),
      passed: match[5] === 'OK',
    }]
  })
}

function caseToDraft(testCase) {
  return {
    id: testCase.id ?? null,
    clientKey: String(testCase.id ?? `new-${Date.now()}-${Math.random()}`),
    test_id: testCase.test_id ?? '',
    needSkillsText: formatNeedSkillsCsv(testCase.need_skills ?? [{ name: 'Python', priority: 'mandatory' }]),
    hasSkillsText: formatHasSkillsCsv(testCase.has_skills ?? ['Python']),
    expectedScoreText: String(testCase.expected_score ?? 100),
  }
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function formatNeedSkillsCsv(skills) {
  return [
    'name,priority',
    ...skills.map((skill) => `${escapeCsvValue(skill.name)},${escapeCsvValue(skill.priority || 'mandatory')}`),
  ].join('\n')
}

function formatHasSkillsCsv(skills) {
  return ['skill', ...skills.map(escapeCsvValue)].join('\n')
}

function parseNeedSkillsCsv(value, errorMessage) {
  const rows = parseCsvText(value)
  if (!rows.length || rows.some((row) => !row.name?.trim())) {
    throw new Error(errorMessage)
  }
  return rows.map((row) => {
    const priority = (row.priority || 'mandatory').trim()
    if (!['mandatory', 'nice_to_have'].includes(priority)) {
      throw new Error(errorMessage)
    }
    return { name: row.name.trim(), priority }
  })
}

function parseHasSkillsCsv(value, errorMessage) {
  const rows = parseCsvText(value)
  if (!rows.length || rows.some((row) => !(row.skill ?? row.name)?.trim())) {
    throw new Error(errorMessage)
  }
  return rows.map((row) => (row.skill ?? row.name).trim())
}

export default function Plugins() {
  const { t } = useI18n()
  const { getPlugin, refreshPlugins } = usePlugins()
  const skillMatchingTestsEnabled = Boolean(getPlugin('skill_matching_tests')?.enabled)
  const [savingPluginId, setSavingPluginId] = useState('')
  const [runningCsvTest, setRunningCsvTest] = useState(false)
  const [csvTestResult, setCsvTestResult] = useState(null)
  const [csvTestError, setCsvTestError] = useState('')
  const [testCases, setTestCases] = useState([])
  const [loadingTestCases, setLoadingTestCases] = useState(false)
  const [savingTestCaseKey, setSavingTestCaseKey] = useState('')
  const [caseEditorError, setCaseEditorError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!skillMatchingTestsEnabled) {
      setTestCases([])
      setCaseEditorError('')
      return () => {
        cancelled = true
      }
    }

    setLoadingTestCases(true)
    setCaseEditorError('')
    pluginsApi.getSkillMatchingTestCases()
      .then((response) => {
        if (!cancelled) {
          setTestCases((response?.cases || []).map(caseToDraft))
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCaseEditorError(error?.message || t('plugin.skill_matching_cases_load_error'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTestCases(false)
      })

    return () => {
      cancelled = true
    }
  }, [skillMatchingTestsEnabled, t])

  const handleToggle = async (pluginId, enabled) => {
    setSavingPluginId(pluginId)
    try {
      await pluginsApi.setPluginEnabled(pluginId, !enabled)
      await refreshPlugins()
    } finally {
      setSavingPluginId('')
    }
  }

  const handleRunCsvTest = async () => {
    setRunningCsvTest(true)
    setCsvTestError('')
    setCsvTestResult(null)
    try {
      setCsvTestResult(await pluginsApi.runSkillMatchingCsvTest())
    } catch (error) {
      setCsvTestError(error?.message || t('plugin.skill_matching_tests_error'))
    } finally {
      setRunningCsvTest(false)
    }
  }

  const handleAddTestCase = () => {
    setCaseEditorError('')
    setTestCases((current) => [
      ...current,
      caseToDraft({ test_id: `new_test_case_${current.length + 1}` }),
    ])
  }

  const handleEditTestCase = (clientKey, field, value) => {
    setTestCases((current) => current.map((testCase) => (
      testCase.clientKey === clientKey ? { ...testCase, [field]: value } : testCase
    )))
  }

  const handleSaveTestCase = async (testCase) => {
    setSavingTestCaseKey(testCase.clientKey)
    setCaseEditorError('')
    try {
      const needSkills = parseNeedSkillsCsv(
        testCase.needSkillsText,
        t('plugin.skill_matching_cases_csv_error'),
      )
      const hasSkills = parseHasSkillsCsv(
        testCase.hasSkillsText,
        t('plugin.skill_matching_cases_csv_error'),
      )
      if (!testCase.expectedScoreText.trim()) {
        throw new Error(t('plugin.skill_matching_cases_score_error'))
      }
      const expectedScore = Number(testCase.expectedScoreText)
      if (!Number.isInteger(expectedScore) || expectedScore < 0 || expectedScore > 100) {
        throw new Error(t('plugin.skill_matching_cases_score_error'))
      }
      const payload = {
        test_id: testCase.test_id,
        need_skills: needSkills,
        has_skills: hasSkills,
        expected_score: expectedScore,
      }
      const savedCase = testCase.id
        ? await pluginsApi.updateSkillMatchingTestCase(testCase.id, payload)
        : await pluginsApi.createSkillMatchingTestCase(payload)
      setTestCases((current) => current.map((row) => (
        row.clientKey === testCase.clientKey ? caseToDraft(savedCase) : row
      )))
    } catch (error) {
      setCaseEditorError(error?.message || t('plugin.skill_matching_cases_save_error'))
    } finally {
      setSavingTestCaseKey('')
    }
  }

  const handleDeleteTestCase = async (testCase) => {
    setCaseEditorError('')
    if (!testCase.id) {
      setTestCases((current) => current.filter((row) => row.clientKey !== testCase.clientKey))
      return
    }
    setSavingTestCaseKey(testCase.clientKey)
    try {
      await pluginsApi.deleteSkillMatchingTestCase(testCase.id)
      setTestCases((current) => current.filter((row) => row.clientKey !== testCase.clientKey))
    } catch (error) {
      setCaseEditorError(error?.message || t('plugin.skill_matching_cases_delete_error'))
    } finally {
      setSavingTestCaseKey('')
    }
  }

  const scoreRows = csvTestResult ? parseMatchingScoreRows(csvTestResult.output) : []

  return (
    <PageContainer width="full" className="space-y-8">
      <div>
        <h1 className="text-[26px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">
          {t('plugins.title')}
        </h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">
          {t('plugins.subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        {PLUGIN_CONFIGS.map((pluginConfig) => {
          const plugin = getPlugin(pluginConfig.id)
          const enabled = Boolean(plugin?.enabled)

          return (
            <Card key={pluginConfig.id} className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-[19px] font-semibold text-black dark:text-white">{t(pluginConfig.titleKey)}</h2>
                  <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{t(pluginConfig.descKey)}</p>
                </div>
                <Button
                  variant={enabled ? 'secondary' : 'dark'}
                  size="md"
                  onClick={() => handleToggle(pluginConfig.id, enabled)}
                  disabled={savingPluginId === pluginConfig.id}
                >
                  {savingPluginId === pluginConfig.id ? <Loader2 className="w-5 h-5 animate-spin" /> : enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                  {enabled ? t(pluginConfig.disableKey) : t(pluginConfig.enableKey)}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('plugin.status')}</div>
                  <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">{enabled ? t('plugin.enabled') : t('plugin.disabled')}</div>
                </div>
                <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('plugin.route')}</div>
                  <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">{pluginConfig.route}</div>
                </div>
              </div>
              {pluginConfig.canRunCsvTest && enabled && (
                <div className="space-y-3">
                  <section className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="text-base font-semibold text-black dark:text-white">
                          {t('plugin.skill_matching_cases_title')}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t('plugin.skill_matching_cases_help')}
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" onClick={handleAddTestCase} disabled={loadingTestCases}>
                        {t('plugin.skill_matching_cases_add')}
                      </Button>
                    </div>
                    {caseEditorError && (
                      <p role="alert" className="text-sm text-red-600 dark:text-red-400">{caseEditorError}</p>
                    )}
                    {loadingTestCases ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('plugin.skill_matching_cases_loading')}</p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                        <table className="w-full min-w-[980px] text-left text-sm">
                          <thead className="bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-300">
                            <tr>
                              <th scope="col" className="px-3 py-3 font-semibold">{t('plugin.skill_matching_tests_testid')}</th>
                              <th scope="col" className="px-3 py-3 font-semibold">{t('plugin.skill_matching_cases_need')}</th>
                              <th scope="col" className="px-3 py-3 font-semibold">{t('plugin.skill_matching_cases_has')}</th>
                              <th scope="col" className="px-3 py-3 font-semibold">{t('plugin.skill_matching_tests_expected')}</th>
                              <th scope="col" className="px-3 py-3 font-semibold">{t('plugin.skill_matching_cases_actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {testCases.map((testCase) => {
                              const saving = savingTestCaseKey === testCase.clientKey
                              return (
                                <tr key={testCase.clientKey} className="border-t border-gray-200 dark:border-gray-700 align-top">
                                  <td className="p-2">
                                    <input
                                      aria-label={`${t('plugin.skill_matching_tests_testid')} ${testCase.test_id}`}
                                      value={testCase.test_id}
                                      onChange={(event) => handleEditTestCase(testCase.clientKey, 'test_id', event.target.value)}
                                      className="w-36 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2c2c2e] px-2 py-2 text-black dark:text-white"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <textarea
                                      aria-label={`${t('plugin.skill_matching_cases_need')} ${testCase.test_id}`}
                                      value={testCase.needSkillsText}
                                      onChange={(event) => handleEditTestCase(testCase.clientKey, 'needSkillsText', event.target.value)}
                                      rows={4}
                                      className="w-64 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2c2c2e] px-2 py-2 font-mono text-xs text-black dark:text-white"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <textarea
                                      aria-label={`${t('plugin.skill_matching_cases_has')} ${testCase.test_id}`}
                                      value={testCase.hasSkillsText}
                                      onChange={(event) => handleEditTestCase(testCase.clientKey, 'hasSkillsText', event.target.value)}
                                      rows={4}
                                      className="w-56 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2c2c2e] px-2 py-2 font-mono text-xs text-black dark:text-white"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      aria-label={`${t('plugin.skill_matching_tests_expected')} ${testCase.test_id}`}
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={testCase.expectedScoreText}
                                      onChange={(event) => handleEditTestCase(testCase.clientKey, 'expectedScoreText', event.target.value)}
                                      className="w-20 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2c2c2e] px-2 py-2 text-black dark:text-white"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <div className="flex flex-col gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleSaveTestCase(testCase)}
                                        disabled={saving}
                                      >
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('plugin.skill_matching_cases_save')}
                                      </Button>
                                      <Button
                                        variant="danger"
                                        size="sm"
                                        onClick={() => handleDeleteTestCase(testCase)}
                                        disabled={saving}
                                      >
                                        {t('plugin.skill_matching_cases_delete')}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                            {testCases.length === 0 && (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                                  {t('plugin.skill_matching_cases_empty')}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleRunCsvTest}
                    disabled={runningCsvTest}
                  >
                    {runningCsvTest ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                    {runningCsvTest ? t('plugin.skill_matching_tests_running') : t('plugin.skill_matching_tests_run')}
                  </Button>
                  {csvTestError && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">{csvTestError}</p>
                  )}
                  {csvTestResult && (
                    <div className="space-y-2">
                      <p className={`text-sm font-semibold ${csvTestResult.passed ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {csvTestResult.passed ? t('plugin.skill_matching_tests_passed') : t('plugin.skill_matching_tests_failed')}
                      </p>
                      {csvTestResult.embedding_model && (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          <span className="font-semibold">{t('plugin.skill_matching_embedding_model')}:</span>{' '}
                          {csvTestResult.embedding_model.model} ({csvTestResult.embedding_model.provider})
                        </p>
                      )}
                      {csvTestResult.matching_service && (
                        <div className="text-sm text-gray-700 dark:text-gray-300">
                          <p>
                            <span className="font-semibold">{t('plugin.skill_matching_service')}:</span>{' '}
                            {csvTestResult.matching_service.implementation}.{csvTestResult.matching_service.method}()
                          </p>
                          <p>
                            <span className="font-semibold">{t('plugin.skill_matching_api')}:</span>{' '}
                            {csvTestResult.matching_service.api_method} {csvTestResult.matching_service.api_path}
                          </p>
                          <p>
                            <span className="font-semibold">{t('plugin.skill_matching_invocation')}:</span>{' '}
                            {t(`plugin.skill_matching_invocation_${csvTestResult.matching_service.invocation}`)}
                          </p>
                        </div>
                      )}
                      {csvTestResult.matrix?.length > 0 && (
                        <section className="space-y-2">
                          <h3 className="text-sm font-semibold text-black dark:text-white">
                            {t('plugin.skill_matching_matrix_title')}
                          </h3>
                          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                            <table
                              aria-label={t('plugin.skill_matching_matrix_title')}
                              className="w-full min-w-[1200px] text-left text-xs"
                            >
                              <thead className="bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-300">
                                <tr>
                                  {[
                                    'testid',
                                    'need',
                                    'has',
                                    'need_resolution',
                                    'has_resolution',
                                    'similarity',
                                    'weighted_similarity',
                                    'best_candidate',
                                    'score_contribution',
                                    'priority',
                                    'covered',
                                    'match_type',
                                    'reason',
                                  ].map((column) => (
                                    <th key={column} scope="col" className="px-3 py-3 font-semibold">
                                      {t(`plugin.skill_matching_matrix_${column}`)}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {csvTestResult.matrix.map((match, index) => (
                                  <tr key={`${match.test_id}-${index}`} className="border-t border-gray-200 dark:border-gray-700">
                                    <td className="px-3 py-3 font-medium text-black dark:text-white">{match.test_id}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{match.need_skill}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{match.has_skill || t('plugin.skill_matching_matrix_no_candidate')}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{t(`plugin.skill_matching_matrix_resolution_${match.need_resolution_status}`)}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                                      {match.has_resolution_status
                                        ? t(`plugin.skill_matching_matrix_resolution_${match.has_resolution_status}`)
                                        : '—'}
                                    </td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{Number(match.similarity).toFixed(4)}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{Number(match.weighted_similarity).toFixed(4)}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                                      {match.best_candidate ? t('plugin.skill_matching_matrix_yes') : t('plugin.skill_matching_matrix_no')}
                                    </td>
                                    <td className="px-3 py-3 font-semibold text-gray-700 dark:text-gray-300">
                                      {Number(match.score_contribution).toFixed(4)}
                                    </td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{t(`plugin.skill_matching_matrix_priority_${match.priority}`)}</td>
                                    <td className={`px-3 py-3 font-semibold ${match.covered ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                      {match.covered ? t('plugin.skill_matching_matrix_yes') : t('plugin.skill_matching_matrix_no')}
                                    </td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{t(`plugin.skill_matching_matrix_type_${match.match_type}`)}</td>
                                    <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{match.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      )}
                      {scoreRows.length > 0 && (
                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                          <table
                            aria-label={t('plugin.skill_matching_scores_table')}
                            className="w-full text-left text-sm"
                          >
                            <thead className="bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-300">
                              <tr>
                                <th scope="col" className="px-4 py-3 font-semibold">{t('plugin.skill_matching_tests_testid')}</th>
                                <th scope="col" className="px-4 py-3 font-semibold">{t('plugin.skill_matching_tests_expected')}</th>
                                <th scope="col" className="px-4 py-3 font-semibold">{t('plugin.skill_matching_tests_actual')}</th>
                                <th scope="col" className="px-4 py-3 font-semibold">{t('plugin.skill_matching_tests_difference')}</th>
                                <th scope="col" className="px-4 py-3 font-semibold">{t('plugin.skill_matching_tests_result')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scoreRows.map((score) => (
                                <tr key={score.testId} className="border-t border-gray-200 dark:border-gray-700">
                                  <td className="px-4 py-3 font-medium text-black dark:text-white">{score.testId}</td>
                                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{score.expectedScore}</td>
                                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{score.actualScore}</td>
                                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{score.difference}</td>
                                  <td className={`px-4 py-3 font-semibold ${score.passed ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {score.passed ? t('plugin.skill_matching_tests_passed') : t('plugin.skill_matching_tests_failed')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <details className="text-sm text-gray-600 dark:text-gray-300">
                        <summary className="cursor-pointer">{t('plugin.skill_matching_tests_raw_output')}</summary>
                        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 text-xs text-gray-800 dark:text-gray-200">
                          {csvTestResult.output}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </PageContainer>
  )
}
