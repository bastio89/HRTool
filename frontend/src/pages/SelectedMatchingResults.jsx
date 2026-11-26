import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, CheckCircle, ChevronDown, Download, FileText, Target, User, UserCheck, XCircle, CheckSquare, Square } from 'lucide-react'
import { matchingApi, matchingScorePercent, resolveMatchingResult } from '../api'
import MatchingResultMetadata, { MatchingRunNotice } from '../components/MatchingResultMetadata'
import SkillMatchingResult from '../components/SkillMatchingResult'
import { Card, Button, ScoreBadge, ScoreRing, LoadingSpinner, PageContainer } from '../components/UI'
import { useI18n } from '../I18nContext'
import { attachSkillMatchingResults } from '../utils/skillMatchingResults'

const STORAGE_KEY = 'hrtool:matching:selected-batch'

export default function SelectedMatchingResults() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMode, setLoadingMode] = useState(location.state?.mode || null)
  const [error, setError] = useState('')
  const [skillMatchingError, setSkillMatchingError] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [progress, setProgress] = useState(null)
  const requestRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    requestRef.current = controller
    let active = true
    setProgress(null)
    setSkillMatchingError('')
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw && !location.state?.pairs) {
      setLoading(false)
      return
    }

    const loadSelectedMatching = async () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {}
        const resume = parsed.navigationKey === location.key && Boolean(parsed.response)
        const fromStatePairs = location.state?.pairs
        const pairs = (resume ? parsed.pairs : fromStatePairs || parsed.pairs) || []
        const mode = (resume ? parsed.mode : location.state?.mode || parsed.mode) || 'ai'
        if (!['vector', 'ai'].includes(mode)) throw new Error(t('matching.method_mismatch'))
        const method = mode === 'vector' ? 'vector' : 'ai'
        setLoadingMode(mode)
        const precomputed = resume ? parsed.response : location.state?.precomputed || (!fromStatePairs && parsed.mode === mode ? parsed.response : null)
        const sourceJobDescription = location.state?.sourceJobDescription || parsed.sourceJobDescription || ''

        if (!Array.isArray(pairs) || pairs.length === 0) {
          setPayload(null)
          setLoading(false)
          return
        }

        setLoading(true)
        setError('')
        const engine = location.state?.engine || parsed.engine || 'python'
        const options = {
          signal: controller.signal,
          onProgress: current => {
            if (!active) return
            if (current.method && current.method !== method) throw new Error(t('matching.method_mismatch'))
            setProgress(current)
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
              ...parsed, pairs, mode, engine, sourceJobDescription, navigationKey: location.key,
              response: { ...current, status: 'pending' },
            }))
          },
        }
        let response = precomputed
          ? await resolveMatchingResult(precomputed, options)
          : mode === 'vector'
            ? await matchingApi.vectorMatchSelected(pairs, engine, options)
            : await matchingApi.runSelected(pairs, null, options)
        if (!active) return
        if (!Array.isArray(response?.results)) throw new Error(t('matching.invalid_results'))
        if (response?.method && response.method !== method) throw new Error(t('matching.method_mismatch'))
        let skillMatchResponse = response.skillMatchResults || null
        if (method === 'ai' && !skillMatchResponse && response.results.length > 0) {
          const skillPairs = response.results
            .filter(row => (row.jobId ?? row.sourceJobId) != null && (row.candidateId ?? row.sourceCandidateId) != null)
            .map(row => ({
              jobId: row.jobId ?? row.sourceJobId,
              sourceJobId: row.sourceJobId,
              jobTitle: row.jobTitle,
              candidateId: row.candidateId ?? row.sourceCandidateId,
              sourceCandidateId: row.sourceCandidateId,
              candidateName: row.candidateName,
            }))
          if (skillPairs.length > 0) {
            try {
              skillMatchResponse = await matchingApi.vectorMatchSelected(skillPairs, engine, { signal: controller.signal })
              if (!active) return
              if (skillMatchResponse?.method && skillMatchResponse.method !== 'vector') {
                throw new Error(t('matching.method_mismatch'))
              }
            } catch (failure) {
              if (!active || failure.name === 'AbortError') return
              setSkillMatchingError(failure.message)
            }
          }
        }
        const aiRows = method === 'ai' && skillMatchResponse
          ? attachSkillMatchingResults(response.results, skillMatchResponse)
          : response.results
        const rows = aiRows.map(row => {
          if (row.method && row.method !== method) throw new Error(t('matching.method_mismatch'))
          return { ...row, method, score: matchingScorePercent(row.score, method) }
        }).sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
        const failures = response?.failures || []
        const resultPayload = {
          ...response,
          ...(skillMatchResponse ? { skillMatchResults: skillMatchResponse } : {}),
          results: rows, failures, selectedCount: pairs.length, mode, method,
        }

        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...parsed,
          pairs,
          mode,
          navigationKey: location.key,
          sourceJobDescription,
          response: resultPayload,
        }))
        setPayload({ ...resultPayload, sourceJobDescription, sourceResultId: parsed.sourceResultId, historical: Boolean(precomputed && precomputed.status !== 'pending') })
        setProgress(null)
        setSelectedRowKeys([])
      } catch (err) {
        if (!active || err.name === 'AbortError') return
        setPayload(null)
        setError(err.message || 'KI-Matching konnte nicht gestartet werden.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadSelectedMatching()
    return () => { active = false; controller.abort() }
  }, [location.state, location.key])

  useEffect(() => () => requestRef.current?.abort(), [])

  const results = payload?.results || []
  const failures = payload?.failures || []
  const total = payload?.selectedCount ?? (results.length + failures.length)
  const bestScore = results.find(row => row.score != null)?.score ?? null
  const modeLabel = t(payload?.method === 'vector' ? 'matching.method_skill' : 'matching.method_ai')
  const pageTitle = payload?.mode === 'vector' ? t('selected_results.title_vector') : t('selected_results.title_ai')
  const loadingLabel = (loadingMode ?? payload?.mode) === 'vector'
    ? t('selected_results.loading_vector')
    : t('selected_results.loading_ai')
  const isVectorMode = payload?.mode === 'vector'
  const getRowKey = (row) => `${row.jobId}-${row.candidateId}`
  const hasStoredIds = row => Boolean((row.jobId ?? row.sourceJobId) && (row.candidateId ?? row.sourceCandidateId))
  const selectableRows = results.filter(hasStoredIds)
  const selectedRows = results.filter((row) => selectedRowKeys.includes(getRowKey(row)))
  const allRowsSelected = selectableRows.length > 0 && selectedRowKeys.length === selectableRows.length

  const toggleRowSelection = (row) => {
    const key = getRowKey(row)
    const scrollContainer = document.querySelector('[data-app-scroll-container]')
    const scrollTop = scrollContainer?.scrollTop ?? window.scrollY
    setSelectedRowKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
    requestAnimationFrame(() => {
      if (scrollContainer) scrollContainer.scrollTop = scrollTop
      else window.scrollTo({ top: scrollTop, behavior: 'instant' })
    })
  }

  const toggleAllRows = () => {
    setSelectedRowKeys((prev) => (prev.length === selectableRows.length ? [] : selectableRows.map(getRowKey)))
  }

  const handleRunSelectedAiMatching = async () => {
    if (selectedRows.length === 0) return
    if (selectedRows.length > 20) {
      setError(t('matching.selection_limit'))
      return
    }

    setLoadingMode('ai')
    setLoading(true)
    setError('')

    const batchPayload = selectedRows.map((row) => ({
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      sourceJobId: row.sourceJobId || null,
      sourceJobTitle: row.sourceJobTitle || row.jobTitle,
      jobDescription: row.jobDescription || payload?.sourceJobDescription || '',
      candidateId: row.candidateId,
      sourceCandidateId: row.sourceCandidateId || row.candidateId,
      candidateName: row.candidateName,
    }))
    const engine = payload?.engine || 'python'

    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await matchingApi.runSelected(batchPayload, null, {
        signal: controller.signal,
        onProgress: current => {
          if (controller.signal.aborted) return
          setProgress(current)
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            pairs: batchPayload, mode: 'ai', navigationKey: location.key,
            engine,
            sourceResultId: payload?.sourceResultId, sourceJobDescription: payload?.sourceJobDescription,
            response: { ...current, status: 'pending' },
          }))
        },
      })
      if (controller.signal.aborted) return
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        pairs: batchPayload,
        mode: 'ai',
        engine,
        sourceResultId: payload?.sourceResultId || null,
        sourceLabel: t('matching.method_skill'),
        sourceJobDescription: payload?.sourceJobDescription || '',
        response,
      }))
      navigate('/matching/results/selected', { state: { pairs: batchPayload, mode: 'ai', engine, precomputed: response } })
    } catch (err) {
      if (controller.signal.aborted || err.name === 'AbortError') return
      setError(err.message || 'KI-Matching konnte nicht gestartet werden.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const formatVectorScore = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return t('matching.score_missing')
    return value.toFixed(3)
  }

  const resolveMatchedSkillCategory = (skill) => {
    const explicitCategory = skill?.jobSkillCategory || skill?.candidateSkillCategory
    return explicitCategory === 'HardSkill' || explicitCategory === 'SoftSkill' ? explicitCategory : 'Unkategorisiert'
  }

  const getCategoryMatches = (row, category) => (row?.matchedSkills || []).filter(
    (skill) => resolveMatchedSkillCategory(skill) === category
  )

  const formatMatchedSkillLabel = (skill) => {
    const jobSkill = skill?.jobSkill || 'Unbekannt'
    const candidateSkill = skill?.candidateSkill || 'Unbekannt'
    const category = resolveMatchedSkillCategory(skill)
    const coverage = skill?.covered ? '' : ` · ${t('matching.skill_uncovered')}`
    return `${jobSkill} ↔ ${candidateSkill} · ${category} (${formatVectorScore(skill?.similarity)})${coverage}`
  }

  const renderCategoryDebug = (row) => {
    const hardMatches = getCategoryMatches(row, 'HardSkill')
    const softMatches = getCategoryMatches(row, 'SoftSkill')

    return (
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
        <div className="rounded-[16px] bg-[#0071e3]/5 border border-[#0071e3]/10 p-3">
          <div className="font-semibold text-[#0071e3] mb-2 flex items-center justify-between gap-3">
            <span>{t('matching.hard_skill')}</span>
            <span className="text-[11px] font-medium text-[#0071e3]/70">{t('matching.n_matches').replace('{count}', hardMatches.length)}</span>
          </div>
          <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
            {hardMatches.length > 0 ? hardMatches.map((skill, index) => (
              <div key={`hard-${row.jobId}-${row.candidateId}-${index}`}>{formatMatchedSkillLabel(skill)}</div>
            )) : <div>{t('matching.no_matches')}</div>}
          </div>
        </div>
        <div className="rounded-[16px] bg-[#34c759]/5 border border-[#34c759]/10 p-3">
          <div className="font-semibold text-[#34c759] mb-2 flex items-center justify-between gap-3">
            <span>{t('matching.soft_skill')}</span>
            <span className="text-[11px] font-medium text-[#34c759]/70">{t('matching.n_matches').replace('{count}', softMatches.length)}</span>
          </div>
          <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
            {softMatches.length > 0 ? softMatches.map((skill, index) => (
              <div key={`soft-${row.jobId}-${row.candidateId}-${index}`}>{formatMatchedSkillLabel(skill)}</div>
            )) : <div>{t('matching.no_matches')}</div>}
          </div>
        </div>
      </div>
    )
  }

  const exportCSV = () => {
    const escape = (v) => {
      if (v == null) return ''
      const text = String(v).replace(/"/g, '""')
      return text.includes(',') || text.includes('"') || text.includes('\n') ? `"${text}"` : text
    }

    const headers = ['Bewerber', 'Stelle', 'Score', 'Zusammenfassung', 'Stärken', 'Schwächen']
    const rows = results.map((row) => [
      row.candidateName,
      row.jobTitle,
      row.score,
      row.summary,
      (row.strengths || []).join('; '),
      (row.weaknesses || []).join('; '),
    ].map(escape).join(','))

    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `selected_matching_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const metrics = useMemo(() => ([
    { label: 'Ausgewählt', value: total, color: '#0071e3', icon: User },
    { label: 'Treffer', value: results.length, color: '#34c759', icon: CheckCircle },
    { label: 'Fehler', value: failures.length, color: '#ff3b30', icon: XCircle },
    { label: 'Bester Match', value: bestScore != null ? `${bestScore}%` : t('matching.score_missing'), color: '#ff9f0a', icon: Target },
  ]), [bestScore, failures.length, results.length, total, t])

  if (loading) return <PageContainer><LoadingSpinner text={loadingLabel} /><MatchingRunNotice progress={progress} /></PageContainer>

  if (!payload) {
    return (
      <PageContainer width="content" className="flex flex-col flex-1 min-h-[calc(100dvh-11rem)] pb-12">
        <MatchingRunNotice progress={progress} />
        <Card className="p-10 text-center">
          {error ? (
            <>
              <p role="alert" className="text-[18px] font-medium text-[#ff3b30] mb-6">
                {error}
              </p>
              <Button variant="dark" size="md" onClick={() => navigate(-1)}>
                <ArrowLeft className="w-5 h-5" />
                Zurück
              </Button>
            </>
          ) : (
            <>
          <p className="text-[18px] font-medium text-gray-500 dark:text-gray-400 mb-6">
            Keine Batch-Ergebnisse gefunden.
          </p>
          <Button variant="dark" size="md" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
            Zurück
          </Button>
            </>
          )}
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="content" className="flex flex-col flex-1 min-h-[calc(100dvh-11rem)] pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
          <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{pageTitle}</h1>
            <div className="flex items-center gap-3 sm:gap-6 mt-1 sm:mt-3 flex-wrap">
              <span className="text-[14px] sm:text-[18px] font-medium text-gray-500 dark:text-gray-400">
                {t('selected_results.summary').replace('{hits}', results.length).replace('{errors}', failures.length)}
              </span>
              <span className="text-[13px] font-semibold px-3 py-1 rounded-full bg-[#0071e3]/10 text-[#0071e3]">{modeLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 ml-14 sm:ml-0">
          <Button size="md" variant="secondary" onClick={exportCSV} disabled={results.length === 0}>
            <Download className="w-5 h-5" />
            <span className="hidden sm:inline">{t('matching.csv_export')}</span>
          </Button>
          <Link to="/matching"><Button size="md" variant="dark">{t('selected_results.new_selection')}</Button></Link>
        </div>
      </div>

      {error && <div role="alert" className="mb-6 text-[#ff3b30]">{error}</div>}
      {skillMatchingError && <div role="alert" className="mb-6 text-[#ff3b30]">{t('matching.skill_matching_error')}: {skillMatchingError}</div>}
      <MatchingRunNotice progress={progress} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
        {metrics.map(({ label, value, color, icon: Icon }) => (
          <Card key={label} className="p-10">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[48px] leading-none font-semibold tracking-tight" style={{ color }}>{value}</p>
                <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{label}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <Icon className="w-6 h-6" style={{ color }} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-8 sm:p-10 mb-12 min-h-[560px] flex flex-col">
        <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-6">{t('selected_results.result_list')}</h2>
        {results.length === 0 && failures.length === 0 ? (
          <p className="text-[15px] text-gray-500 dark:text-gray-400">{t('selected_results.none')}</p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 h-full">
            {isVectorMode && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <button
                  type="button"
                  onClick={toggleAllRows}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200/80 dark:border-gray-700 px-4 py-2.5 text-[14px] font-semibold text-gray-600 dark:text-gray-300 hover:border-[#0071e3]/40 hover:text-[#0071e3] transition-colors"
                >
                  {allRowsSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  {allRowsSelected ? 'Auswahl löschen' : 'Alle auswählen'}
                </button>
                <Button
                  size="md"
                  variant="dark"
                  onClick={handleRunSelectedAiMatching}
                  disabled={selectedRows.length === 0 || selectedRows.length > 20}
                >
                  {t('matching.run_selected_ai')}
                </Button>
                {selectedRows.length > 20 && <p role="alert">{t('matching.selection_limit')}</p>}
              </div>
            )}

            <div className="space-y-4 pr-1">
            {results.map((result, index) => {
              const hardScore = result.hardSkillScore
              const softScore = result.softSkillScore
              const displayScore = result.score
              const rowKey = getRowKey(result)
              const isSelected = selectedRowKeys.includes(rowKey)

              return (
                <div key={result.id || `${result.jobId}-${result.candidateId}-${index}`} className="rounded-[22px] bg-[#f5f5f7] dark:bg-[#2c2c2e] p-5 sm:p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-[56px_64px_1fr_1fr_180px] gap-4 items-center">
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Auswahl aufheben' : 'Auswählen'}: ${result.candidateName || ''}`}
                        disabled={!hasStoredIds(result)}
                        title={!hasStoredIds(result) ? t('matching.stored_selection_required') : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => toggleRowSelection(result)}
                        className="w-10 h-10 rounded-full bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-gray-700 flex items-center justify-center cursor-pointer"
                      >
                        {isSelected ? <CheckSquare className="h-5 w-5 text-[#0071e3]" /> : <Square className="h-5 w-5 text-gray-400" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-center">
                      <span className="text-[18px] font-semibold text-gray-500 dark:text-gray-400">#{index + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold text-black dark:text-white">{result.candidateName}</p>
                      <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 break-all">
                        {t('detail.candidate_id')}: <span className="font-mono select-all">{result.candidateId ?? result.sourceCandidateId ?? '—'}</span>
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold text-black dark:text-white">{result.jobTitle}</p>
                      <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 break-all">
                        {t('jobs.id')}: <span className="font-mono select-all">{result.jobId ?? result.sourceJobId ?? '—'}</span>
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-3">
                      {isVectorMode ? (
                        <div className="flex items-end gap-3">
                          <div className="flex flex-col items-end gap-1.5">
                            <span>{t('matching.method_skill')}: {displayScore != null ? `${displayScore}%` : t('matching.score_missing')}</span>
                            {typeof result.qualified === 'boolean' && <span>{t(result.qualified ? 'matching.qualified' : 'matching.not_qualified')}</span>}
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide bg-[#0071e3]/10 text-[#0071e3]">
                              HardSkill {formatVectorScore(hardScore)}
                            </span>
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide bg-[#34c759]/10 text-[#34c759]">
                              SoftSkill {formatVectorScore(softScore)}
                            </span>
                          </div>
                          <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0 mb-1" />
                        </div>
                      ) : (
                        displayScore == null ? <span>{t('matching.score_missing')}</span> : <div className="flex items-center gap-3">
                          <ScoreRing score={displayScore / 100} size={72} strokeWidth={5} />
                          <ScoreBadge score={displayScore / 100} />
                        </div>
                      )}
                    </div>
                  </div>

                  <MatchingResultMetadata result={result} historical={payload.historical} />
                  {isVectorMode && (result.summary || result.qualified === false) && (
                    <div className="mt-4 text-[13px] text-gray-600 dark:text-gray-300">
                      {result.summary && <p>{result.summary}</p>}
                      {result.qualified === false && (
                        <div className="mt-2 rounded-[14px] bg-[#ff9f0a]/10 p-3">
                          <p className="font-medium">{t('matching.mandatory_skills_explanation')}</p>
                          {result.weaknesses?.length > 0 && (
                            <ul className="list-disc pl-5 mt-2 space-y-1">
                              {result.weaknesses.map((weakness, weaknessIndex) => (
                                <li key={weaknessIndex}>{typeof weakness === 'object' ? weakness.text : weakness}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {isVectorMode ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5 text-[13px]">
                      <div className="rounded-[16px] bg-[#0071e3]/5 border border-[#0071e3]/10 p-4">
                        <p className="font-semibold text-[#0071e3] mb-2 flex items-center justify-between gap-3">
                          <span>{t('matching.hard_skill')}</span>
                          <span className="text-[11px] font-medium text-[#0071e3]/70">{t('matching.n_matches').replace('{count}', getCategoryMatches(result, 'HardSkill').filter(skill => skill.covered).length)}</span>
                        </p>
                        <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
                          {getCategoryMatches(result, 'HardSkill').length > 0
                            ? getCategoryMatches(result, 'HardSkill').map((skill, skillIndex) => (
                              <div key={`${result.id || index}-hard-${skillIndex}`}>{formatMatchedSkillLabel(skill)}</div>
                            ))
                            : <div>{t('matching.no_matches')}</div>}
                        </div>
                      </div>
                      <div className="rounded-[16px] bg-[#34c759]/5 border border-[#34c759]/10 p-4">
                        <p className="font-semibold text-[#34c759] mb-2 flex items-center justify-between gap-3">
                          <span>{t('matching.soft_skill')}</span>
                          <span className="text-[11px] font-medium text-[#34c759]/70">{t('matching.n_matches').replace('{count}', getCategoryMatches(result, 'SoftSkill').filter(skill => skill.covered).length)}</span>
                        </p>
                        <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
                          {getCategoryMatches(result, 'SoftSkill').length > 0
                            ? getCategoryMatches(result, 'SoftSkill').map((skill, skillIndex) => (
                              <div key={`${result.id || index}-soft-${skillIndex}`}>{formatMatchedSkillLabel(skill)}</div>
                            ))
                            : <div>{t('matching.no_matches')}</div>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <SkillMatchingResult result={result.skillMatch} failure={result.skillMatchFailure} />
                      <p className="mt-3 text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed">{result.summary}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-[13px]">
                        {result.strengths?.length > 0 && (
                          <div className="rounded-[14px] bg-[#34c759]/5 border border-[#34c759]/10 p-4">
                            <p className="font-semibold text-[#34c759] mb-2">{t('matching.strengths')}</p>
                            <ul className="list-disc space-y-1.5 pl-5 text-gray-600 dark:text-gray-300">
                              {result.strengths.map((item, itemIndex) => (
                                <li key={`${result.id || index}-strength-${itemIndex}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {result.weaknesses?.length > 0 && (
                          <div className="rounded-[14px] bg-[#ff3b30]/5 border border-[#ff3b30]/10 p-4">
                            <p className="font-semibold text-[#ff3b30] mb-2">{t('matching.weaknesses')}</p>
                            <ul className="list-disc space-y-1.5 pl-5 text-gray-600 dark:text-gray-300">
                              {result.weaknesses.map((item, itemIndex) => (
                                <li key={`${result.id || index}-weakness-${itemIndex}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {failures.length > 0 && (
              <div className="pt-4">
                <h3 className="text-[18px] font-semibold tracking-tight text-black dark:text-white mb-4">{t('selected_results.errors')}</h3>
                <div className="space-y-3">
                  {failures.map((item, index) => (
                    <div key={`${item.jobId || 'job'}-${item.candidateId || 'candidate'}-${index}`} className="p-5 rounded-[18px] bg-[#ff3b30]/5 border border-[#ff3b30]/10 text-[14px] text-[#ff3b30]">
                      <p className="font-semibold">{item.candidateName} · {item.jobTitle}</p>
                      <p className="mt-2">{item.error}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
