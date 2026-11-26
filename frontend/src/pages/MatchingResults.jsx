import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ThumbsUp, ThumbsDown, User, Clock, ChevronDown, ChevronUp, Trophy, Target, BarChart3, Quote, Download, UserCheck, CheckCircle, CheckSquare, Square, FileText, GitMerge, Loader2 } from 'lucide-react'
import { matchingApi, matchingScorePercent } from '../api'
import { Card, Button, ScoreRing, ScoreBadge, LoadingSpinner, PageContainer } from '../components/UI'
import { KiDisclaimer, KiBadge } from '../components/KiBadge'
import { useI18n } from '../I18nContext'
import { localeTag } from '../utils/format'
import MatchingResultMetadata, { MatchingRunNotice } from '../components/MatchingResultMetadata'
import SkillMatchingResult from '../components/SkillMatchingResult'
import { attachSkillMatchingResults } from '../utils/skillMatchingResults'

export default function MatchingResults() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [error, setError] = useState('')
  const [skillMatchingError, setSkillMatchingError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [matchingRow, setMatchingRow] = useState(null)
  const [matchingError, setMatchingError] = useState('')
  const [selectedPairKeys, setSelectedPairKeys] = useState([])
  const [selectedBatchLoading, setSelectedBatchLoading] = useState(false)
  const [selectedBatchError, setSelectedBatchError] = useState('')
  const [progress, setProgress] = useState(null)
  const controllers = useRef(new Set())

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setSkillMatchingError('')
    setProgress(null)
    const load = async () => {
      try {
        const stored = JSON.parse(sessionStorage.getItem('hrtool:matching:selected-batch') || 'null')
        if (stored?.response?.status === 'pending' && String(stored.sourceResultId) === String(id)) {
          navigate('/matching/results/selected', { replace: true, state: { ...stored, precomputed: stored.response } })
          return
        }
        const result = await matchingApi.getResult(id, { signal: controller.signal })
        if (!active) return
        const details = result.results
        const normalize = row => ({
          ...row, method: row.method ?? details.method,
          score: matchingScorePercent(row.score, row.method ?? details.method),
        })
        const normalized = details && { ...details }
        if (normalized) {
          for (const key of ['results', 'matrix']) {
            if (Array.isArray(details[key])) normalized[key] = details[key].map(normalize)
          }
          for (const key of ['jobsRanked', 'candidatesRanked']) {
            if (Array.isArray(details[key])) normalized[key] = details[key].map(group => ({ ...group, results: (group.results || []).map(normalize) }))
          }
        }
        setData({ ...result, results: normalized })
        if (details?.method === 'ai' && Array.isArray(details.results) && details.results.length > 0) {
          const skillPairs = details.results
            .filter(row => (row.jobId ?? row.sourceJobId) != null && (row.candidateId ?? row.sourceCandidateId) != null)
            .map(row => ({
              jobId: row.jobId ?? row.sourceJobId,
              sourceJobId: row.sourceJobId,
              jobTitle: row.jobTitle || result.job_title,
              candidateId: row.candidateId ?? row.sourceCandidateId,
              sourceCandidateId: row.sourceCandidateId,
              candidateName: row.candidateName,
            }))
          if (skillPairs.length > 0) {
            try {
              const skillResponse = await matchingApi.vectorMatchSelected(skillPairs, details.engine || 'python', { signal: controller.signal })
              if (!active) return
              if (skillResponse?.method && skillResponse.method !== 'vector') {
                throw new Error(t('matching.method_mismatch'))
              }
              setData(current => current && ({
                ...current,
                results: {
                  ...current.results,
                  results: attachSkillMatchingResults(current.results.results || [], skillResponse),
                },
              }))
            } catch (failure) {
              if (!active || failure.name === 'AbortError') return
              setSkillMatchingError(failure.message)
            }
          }
        }
      } catch (err) {
        if (active && err.name !== 'AbortError') setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
      controller.abort()
      controllers.current.forEach(request => request.abort())
      controllers.current.clear()
    }
  }, [id, navigate])

  useEffect(() => {
    setMatchingRow(null)
    setMatchingError('')
    setExpandedIdx(null)
    setSelectedPairKeys([])
    setSelectedBatchLoading(false)
    setSelectedBatchError('')
  }, [id])

  const handleReview = async () => {
    setReviewing(true)
    try {
      await matchingApi.reviewResult(id)
      setData(prev => ({ ...prev, human_reviewed: 1, reviewed_by: 'Du', reviewed_at: new Date().toISOString() }))
    } catch (err) { setError(err.message) }
    finally { setReviewing(false) }
  }

  const handleMatchingRow = async (row) => {
    setMatchingRow(`${row.candidateId}-${row.jobId}`)
    setMatchingError('')
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const currentType = data?.results?.type
      const result = await matchingApi.vectorMatch({
        direction: 'job_to_candidates',
        jobId: row.jobId ?? row.sourceJobId,
        candidateIds: [row.candidateId ?? row.sourceCandidateId],
        engine: data?.results?.engine || (currentType === 'vectormatch_neo4j' ? 'neo4j' : 'python'),
      }, { signal: controller.signal, onProgress: setProgress })
      if (controller.signal.aborted) return
      navigate(`/matching/results/${result.id}`)
    } catch (err) {
      if (err.name === 'AbortError') return
      setMatchingError(err.message)
      setMatchingRow(null)
    } finally {
      controllers.current.delete(controller)
    }
  }

  if (loading) return <LoadingSpinner text={t('matching.results_loading')} />
  if (error) return (
    <div className="text-center py-32">
      <p className="text-[#ff3b30] font-medium mb-8 text-[18px]">{error}</p>
      <Button variant="secondary" size="lg" onClick={() => navigate('/history')}>{t('matching.back_history')}</Button>
    </div>
  )

  const matrixData = data?.results && ['matrix', 'vectormatch', 'vectormatch_neo4j'].includes(data.results.type) ? data.results : null
  const resultModeLabel = `${t(matrixData?.method === 'vector' ? 'matching.method_skill' : matrixData?.method === 'ai' ? 'matching.method_ai' : 'matching.method_unknown')}${matrixData?.engine ? ` (${matrixData.engine})` : ''}`

  if (matrixData) {
    const matrixRows = matrixData.matrix || []
    const topRows = matrixRows.slice(0, 12)
    const bestScoreMatrix = topRows.find(row => Number.isFinite(row.score))?.score ?? null
    const isVectorMatching = matrixData.type === 'vectormatch' || matrixData.type === 'vectormatch_neo4j'
    const embeddingModelLabel = matrixData.embeddingModel || 'unbekannt'
    const pairCount = matrixRows.length
    const jobCount = matrixData.jobs?.length || matrixData.jobsRanked?.length || new Set(
      matrixRows.map((row) => String(row.jobId ?? row.jobTitle ?? '')).filter(Boolean)
    ).size
    const candidateCount = matrixData.candidates?.length || matrixData.candidatesRanked?.length || new Set(
      matrixRows.map((row) => String(row.candidateId ?? row.candidateName ?? '')).filter(Boolean)
    ).size
    const getPairKey = (row) => `${row.jobId}-${row.candidateId}`
    const hasStoredIds = row => Boolean((row.jobId ?? row.sourceJobId) && (row.candidateId ?? row.sourceCandidateId))
    const selectableRows = matrixRows.filter(hasStoredIds)
    const selectedPairs = matrixRows.filter((row) => selectedPairKeys.includes(getPairKey(row)))
    const allPairsSelected = selectableRows.length > 0 && selectedPairKeys.length === selectableRows.length

    const togglePairSelection = (row) => {
      const key = getPairKey(row)
      setSelectedPairKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
    }

    const toggleAllPairs = () => {
      setSelectedPairKeys((prev) => (prev.length === selectableRows.length ? [] : selectableRows.map(getPairKey)))
    }

    const handleRunSelectedMatching = async () => {
      if (selectedPairs.length === 0) return
      if (selectedPairs.length > 20) {
        setSelectedBatchError(t('matching.selection_limit'))
        return
      }
      setSelectedBatchLoading(true)
      setSelectedBatchError('')
      const controller = new AbortController()
      controllers.current.add(controller)
      try {
        const sourceJobDescription = data?.job_description || data?.jobDescription || ''
        const batchPayload = selectedPairs.map((row) => ({
          jobId: row.jobId,
          jobTitle: row.jobTitle,
          sourceJobId: row.sourceJobId ?? data?.job_id ?? data?.jobId ?? null,
          sourceJobTitle: data?.job_title || data?.jobTitle || row.jobTitle,
          jobDescription: row.jobDescription || sourceJobDescription,
          candidateId: row.candidateId,
          sourceCandidateId: row.sourceCandidateId || row.candidateId,
          candidateName: row.candidateName,
        }))
        const response = await matchingApi.runSelected(batchPayload, null, {
          signal: controller.signal,
          onProgress: current => {
            if (controller.signal.aborted) return
            setProgress(current)
            sessionStorage.setItem('hrtool:matching:selected-batch', JSON.stringify({
              pairs: batchPayload, mode: 'ai', sourceResultId: id, sourceJobDescription,
              response: { ...current, status: 'pending' },
            }))
          },
        })
        if (controller.signal.aborted) return
        sessionStorage.setItem('hrtool:matching:selected-batch', JSON.stringify({
          pairs: batchPayload,
          engine: matrixData?.type === 'vectormatch_neo4j' ? 'neo4j' : 'python',
          sourceResultId: id,
          sourceLabel: resultModeLabel,
          sourceJobDescription,
          response,
        }))
        navigate('/matching/results/selected', { state: { pairs: batchPayload, sourceJobDescription, precomputed: response, mode: 'ai' } })
      } catch (err) {
        if (err.name === 'AbortError') return
        setSelectedBatchError(err.message)
      } finally {
        controllers.current.delete(controller)
        if (!controller.signal.aborted) setSelectedBatchLoading(false)
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

    const formatMatchedSkillLabel = (skill) => {
      const jobSkill = skill?.jobSkill || 'Unbekannt'
      const candidateSkill = skill?.candidateSkill || 'Unbekannt'
      const category = resolveMatchedSkillCategory(skill)
      const coverage = skill?.covered ? '' : ` · ${t('matching.skill_uncovered')}`
      return `${jobSkill} ↔ ${candidateSkill} · ${category} (${formatVectorScore(skill?.similarity)})${coverage}`
    }

    const getCategoryMatches = (row, category) => (row?.matchedSkills || []).filter(
      (skill) => resolveMatchedSkillCategory(skill) === category
    )

    const renderCategoryDebug = (row) => {
      const hardMatches = getCategoryMatches(row, 'HardSkill')
      const softMatches = getCategoryMatches(row, 'SoftSkill')
      return (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
          <div className="rounded-[16px] bg-[#0071e3]/5 border border-[#0071e3]/10 p-3">
            <div className="font-semibold text-[#0071e3] mb-2 flex items-center justify-between gap-3">
              <span>{t('matching.hard_skill')}</span>
              <span className="text-[11px] font-medium text-[#0071e3]/70">{t('matching.n_matches').replace('{count}', hardMatches.filter(skill => skill.covered).length)}</span>
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
              <span className="text-[11px] font-medium text-[#34c759]/70">{t('matching.n_matches').replace('{count}', softMatches.filter(skill => skill.covered).length)}</span>
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

    const exportMatrixCSV = () => {
      const escape = (v) => {
        if (!v) return ''
        const s = String(v).replace(/"/g, '""')
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
      }
      const headers = ['Stelle', 'Bewerber', 'Score', 'Zusammenfassung', 'Stärken', 'Schwächen']
      const rows = matrixRows.map((row) => [
        row.jobTitle,
        row.candidateName,
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
      a.download = `matrix_matching_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }

    return (
      <PageContainer width="content" className="flex flex-col flex-1 min-h-[calc(100dvh-11rem)] pb-12">
        <MatchingRunNotice progress={progress || (matrixData.pendingPairs?.length ? matrixData : null)} />
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
          <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
            <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
              <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{resultModeLabel}</h1>
              <div className="flex items-center gap-3 sm:gap-6 mt-1 sm:mt-3 flex-wrap">
                <span className="text-[14px] sm:text-[18px] font-medium text-gray-500 dark:text-gray-400">{data?.job_title}</span>
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[12px] sm:text-[14px] font-semibold">
                  Embedding: {embeddingModelLabel}
                </span>
                {matrixData.matchedAt && (
                  <span className="flex items-center gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                    <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    {new Date(matrixData.matchedAt).toLocaleString(localeTag(locale))}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 ml-14 sm:ml-0">
            <Button size="md" variant="secondary" onClick={exportMatrixCSV}>
              <Download className="w-5 h-5" />
              <span className="hidden sm:inline">{t('matching.csv_export')}</span>
            </Button>
            <Link to="/matching"><Button size="md" variant="dark">{t('matching.new')}</Button></Link>
          </div>
        </div>

        <KiDisclaimer feature="matching" className="mb-6" />

        {Array.isArray(matrixData.missing) && matrixData.missing.length > 0 && (
          <div role="status" className="p-5 rounded-[20px] bg-[#ff9500]/10 border border-[#ff9500]/20 mb-8">
            <p className="text-[15px] font-semibold text-[#a35b00] dark:text-[#ffb340]">
              {t('matching.missing_title').replace('{n}', matrixData.missing.length)}
            </p>
            <ul className="mt-2 space-y-1 text-[13px] text-gray-700 dark:text-gray-300">
              {matrixData.missing.map((entry) => (
                <li key={`${entry.type}-${entry.id}`}>
                  {entry.type === 'job' ? t('matching.missing_job') : t('matching.missing_candidate')}{' '}
                  <span className="font-semibold">{entry.name || `#${entry.id}`}</span>
                  {entry.reason ? ` – ${entry.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-black dark:text-white">{jobCount}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.stat_jobs')}</p></Card>
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-black dark:text-white">{candidateCount}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.stat_candidates')}</p></Card>
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-[#0071e3]">{pairCount}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.stat_pairs')}</p></Card>
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-[#34c759]">{bestScoreMatrix != null ? `${bestScoreMatrix}%` : t('matching.score_missing')}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.stat_best_match')}</p></Card>
        </div>

        <Card className="min-w-0 overflow-hidden p-8 sm:p-10 mb-12 min-h-[calc(100dvh-24rem)] flex flex-col">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('matching.best_pairs_overall')}</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-2">{t('matching.pairs_selected').replace('{selected}', selectedPairs.length).replace('{total}', pairCount)}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button size="md" variant="secondary" onClick={toggleAllPairs} disabled={matrixRows.length === 0}>
                {allPairsSelected ? 'Auswahl löschen' : 'Alle auswählen'}
              </Button>
              <Button size="md" variant="dark" onClick={handleRunSelectedMatching} disabled={selectedBatchLoading || selectedPairs.length === 0 || selectedPairs.length > 20} aria-busy={selectedBatchLoading}>
                {selectedBatchLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {selectedBatchLoading ? t('selected_results.loading_ai') : t('matching.run_selected_ai')}
              </Button>
            </div>
          </div>
          {matchingError && (
            <div className="p-4 rounded-[14px] bg-[#ff3b30]/10 text-[#ff3b30] text-[14px] font-medium mb-4">
              {matchingError}
            </div>
          )}
          {selectedPairs.length > 20 && <p role="alert">{t('matching.selection_limit')}</p>}
          {selectedBatchError && (
            <div role="alert" className="p-4 rounded-[14px] bg-[#ff3b30]/10 text-[#ff3b30] text-[14px] font-medium mb-4">
              {selectedBatchError}
            </div>
          )}
          <div className="min-h-0 max-h-[780px] flex-1 space-y-4 overflow-y-auto pr-2">
            {topRows.map((row, idx) => {
              const isLoading = matchingRow === `${row.candidateId}-${row.jobId}`
              const isSelected = selectedPairKeys.includes(getPairKey(row))
              return (
                <div
                  key={`${row.jobId}-${row.candidateId}-${idx}`}
                  className={`w-full min-w-0 grid grid-cols-1 lg:grid-cols-[56px_64px_minmax(0,1fr)_minmax(0,1fr)_180px] gap-4 items-center p-5 rounded-[20px] transition-colors text-left ${isSelected ? 'bg-[#0071e3]/5 dark:bg-[#0071e3]/10 ring-1 ring-[#0071e3]/20' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-gray-100 dark:hover:bg-[#3a3a3c]'}`}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Auswahl aufheben' : 'Auswählen'}: ${row.candidateName || ''}`}
                    disabled={!hasStoredIds(row)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation()
                      togglePairSelection(row)
                    }}
                    className="flex items-center justify-center cursor-pointer"
                  >
                    {isSelected ? <CheckSquare className="h-5 w-5 text-[#0071e3]" /> : <Square className="h-5 w-5 text-gray-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMatchingRow(row)}
                    disabled={isLoading || matchingRow !== null}
                    className="text-[18px] font-semibold text-gray-500 dark:text-gray-400 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    #{idx + 1}
                  </button>
                  <div className="min-w-0">
                    <p className="break-words text-[16px] font-semibold text-black dark:text-white">{row.candidateName}</p>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 break-all">
                      {t('detail.candidate_id')}: <span className="font-mono select-all">{row.candidateId ?? row.sourceCandidateId ?? '—'}</span>
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-[16px] font-semibold text-black dark:text-white">{row.jobTitle}</p>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 break-all">
                      {t('jobs.id')}: <span className="font-mono select-all">{row.jobId ?? row.sourceJobId ?? '—'}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#0071e3]" />
                    ) : (
                      <div className="flex items-end gap-3">
                        {isVectorMatching ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <span>{t('matching.method_skill')}: {row.score != null ? `${row.score}%` : t('matching.score_missing')}</span>
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide bg-[#0071e3]/10 text-[#0071e3]">
                              HardSkill {formatVectorScore(row.hardSkillScore)}
                            </span>
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide bg-[#34c759]/10 text-[#34c759]">
                              SoftSkill {formatVectorScore(row.softSkillScore)}
                            </span>
                          </div>
                        ) : (
                          <div className="text-[26px] font-semibold text-[#0071e3]">{row.score != null ? `${row.score}%` : t('matching.score_missing')}</div>
                        )}
                        <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0 mb-1" />
                      </div>
                    )}
                  </div>
                  <div className="col-span-full"><MatchingResultMetadata result={row} historical /></div>
                  {row.qualified === false && (
                    <div className="col-span-full rounded-[14px] bg-[#ff9f0a]/10 p-3 text-[13px] text-gray-600 dark:text-gray-300">
                      {row.summary && <p className="mb-2">{row.summary}</p>}
                      <p className="font-medium">{t('matching.mandatory_skills_explanation')}</p>
                      {row.weaknesses?.length > 0 && (
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                          {row.weaknesses.map((weakness, weaknessIndex) => (
                            <li key={weaknessIndex}>{typeof weakness === 'object' ? weakness.text : weakness}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {isVectorMatching && (
                    <div className="col-span-full lg:col-start-2 lg:col-end-5">
                      {renderCategoryDebug(row)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        <div className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-2">
          <Card className="flex min-w-0 flex-col overflow-hidden p-8 sm:p-10">
            <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-6">{t('matching.ranking_per_job')}</h2>
            <div className="min-h-0 max-h-[780px] flex-1 space-y-6 overflow-y-auto pr-2">
              {(matrixData.jobsRanked || []).map((job) => (
                <div key={job.jobId} className="pb-6 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <h3 className="break-words text-[17px] font-semibold text-black dark:text-white mb-3">{job.jobTitle}</h3>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3 break-all">
                    {t('jobs.id')}: <span className="font-mono select-all">{job.jobId ?? '—'}</span>
                  </p>
                  <div className="space-y-2">
                    {job.results.slice(0, 5).map((row, idx) => (
                      <div key={`${job.jobId}-${row.candidateId}`} className="text-[14px]">
                        <div className="flex min-w-0 items-center justify-between gap-4">
                          <span className="min-w-0 flex-1 truncate font-medium text-gray-600 dark:text-gray-300">{idx + 1}. {row.candidateName}</span>
                          {isVectorMatching ? (
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#0071e3]/10 text-[#0071e3]">
                                HardSkill {formatVectorScore(row.hardSkillScore)}
                              </span>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#34c759]/10 text-[#34c759]">
                                SoftSkill {formatVectorScore(row.softSkillScore)}
                              </span>
                            </div>
                          ) : (
                            <span className="font-semibold text-[#0071e3]">{row.score != null ? `${row.score}%` : t('matching.score_missing')}</span>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1 break-all">
                          {t('detail.candidate_id')}: <span className="font-mono select-all">{row.candidateId ?? row.sourceCandidateId ?? '—'}</span>
                        </p>
                        {isVectorMatching && renderCategoryDebug(row)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex min-w-0 flex-col overflow-hidden p-8 sm:p-10">
            <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-6">{t('matching.ranking_per_candidate')}</h2>
            <div className="min-h-0 max-h-[780px] flex-1 space-y-6 overflow-y-auto pr-2">
              {(matrixData.candidatesRanked || []).map((candidate) => (
                <div key={candidate.candidateId} className="pb-6 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <h3 className="text-[17px] font-semibold text-black dark:text-white mb-3">{candidate.candidateName}</h3>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3 break-all">
                    {t('detail.candidate_id')}: <span className="font-mono select-all">{candidate.candidateId ?? '—'}</span>
                  </p>
                  <div className="space-y-2">
                    {candidate.results.slice(0, 5).map((row, idx) => (
                      <div key={`${candidate.candidateId}-${row.jobId}`} className="text-[14px]">
                        <div className="flex min-w-0 items-center justify-between gap-4">
                          <span className="min-w-0 flex-1 truncate font-medium text-gray-600 dark:text-gray-300">{idx + 1}. {row.jobTitle}</span>
                          {isVectorMatching ? (
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#0071e3]/10 text-[#0071e3]">
                                HardSkill {formatVectorScore(row.hardSkillScore)}
                              </span>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#34c759]/10 text-[#34c759]">
                                SoftSkill {formatVectorScore(row.softSkillScore)}
                              </span>
                            </div>
                          ) : (
                            <span className="font-semibold text-[#0071e3]">{row.score != null ? `${row.score}%` : t('matching.score_missing')}</span>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1 break-all">
                          {t('jobs.id')}: <span className="font-mono select-all">{row.jobId ?? row.sourceJobId ?? '—'}</span>
                        </p>
                        {isVectorMatching && renderCategoryDebug(row)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </PageContainer>
    )
  }

  // API boundary normalizes legacy scores; UI rings use 0..1.
  const results = (data?.results?.results || []).map(r => ({
    ...r,
    score: r.score == null ? null : r.score / 100,
  })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const matchedAt = data?.results?.matchedAt
  const scoredResults = results.filter(row => row.score != null)
  const bestScore = scoredResults[0]?.score ?? null
  const avgScore = scoredResults.length ? scoredResults.reduce((sum, row) => sum + row.score, 0) / scoredResults.length : null
  const topCount = results.filter(r => r.score >= 0.8).length

  const exportCSV = () => {
    const escape = (v) => {
      if (v == null) return ''
      const s = String(v).replace(/"/g, '""')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
    }
    const headers = [t('matching.ranking'), t('matching.candidate'), t('matching.score'), t('matching.summary'), t('matching.strengths'), t('matching.weaknesses')]
    const rows = results.map((r, i) => [
      i + 1,
      r.candidateName,
      r.score == null ? '' : (r.score * 100).toFixed(0),
      r.summary,
      (r.strengths || []).map(s => typeof s === 'object' ? s.text : s).join('; '),
      (r.weaknesses || []).map(w => typeof w === 'object' ? w.text : w).join('; ')
    ].map(escape).join(','))
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `matching_${(data?.job_title || 'ergebnis').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PageContainer width="content" className="flex flex-col flex-1 min-h-[calc(100dvh-11rem)] pb-12">
      <MatchingRunNotice progress={progress || (data?.results?.pendingPairs?.length ? data.results : null)} />
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
          <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('matching.results')}</h1>
            <p>{t(data?.results?.method === 'vector' ? 'matching.method_skill' : data?.results?.method === 'ai' ? 'matching.method_ai' : 'matching.method_unknown')}</p>
            <div className="flex items-center gap-3 sm:gap-6 mt-1 sm:mt-3 flex-wrap">
              <span className="text-[14px] sm:text-[18px] font-medium text-gray-500 dark:text-gray-400">{data?.job_title}</span>
              {matchedAt && (
                <span className="flex items-center gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                  <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {new Date(matchedAt).toLocaleString(localeTag(locale))}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 ml-14 sm:ml-0">
          {results.length > 0 && (
            <>
              {data?.job_id && (
                <Link to={`/pipeline/${data.job_id}`}>
                  <Button size="md" variant="secondary">
                    <GitMerge className="w-5 h-5" />
                    <span className="hidden sm:inline">{t('matching.to_pipeline')}</span>
                  </Button>
                </Link>
              )}
              <Button size="md" variant="secondary" onClick={() => {
                const style = document.createElement('style')
                style.id = 'print-styles'
                style.textContent = `@media print { 
                  aside, header, nav, .no-print { display: none !important; } 
                  main { margin: 0 !important; padding: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
                  .fade-in { animation: none !important; }
                  * { print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
                }`
                document.head.appendChild(style)
                window.print()
                setTimeout(() => document.getElementById('print-styles')?.remove(), 500)
              }}>
                <FileText className="w-5 h-5" />
                <span className="hidden sm:inline">{t('matching.pdf_export')}</span>
              </Button>
              <Button size="md" variant="secondary" onClick={exportCSV}>
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline">{t('matching.csv_export')}</span>
              </Button>
            </>
          )}
          <Link to="/matching">
            <Button size="md" variant="dark">{t('matching.new')}</Button>
          </Link>
        </div>
      </div>

      {/* AI Act Art. 13: KI-Transparenzhinweis */}
      <KiDisclaimer feature="matching" className="mb-6" />
      {skillMatchingError && <div role="alert" className="mb-6 text-[#ff3b30]">{t('matching.skill_matching_error')}: {skillMatchingError}</div>}

      {/* AI Act Art. 14: Menschliche Aufsicht — Review-Status */}
      <Card className={`p-5 mb-10 border ${data?.human_reviewed ? 'border-[#34c759]/20 bg-[#34c759]/5' : 'border-[#ff9f0a]/20 bg-[#ff9f0a]/5'}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {data?.human_reviewed ? (
              <>
                <CheckCircle className="w-6 h-6 text-[#34c759]" />
                <div>
                  <p className="text-[15px] font-semibold text-[#34c759]">{t('matching.human_reviewed')}</p>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400">
                    {t('matching.reviewed_by')} {data.reviewed_by} {t('matching.reviewed_at')} {new Date(data.reviewed_at).toLocaleString(localeTag(locale))}
                  </p>
                </div>
              </>
            ) : (
              <>
                <UserCheck className="w-6 h-6 text-[#ff9f0a]" />
                <div>
                  <p className="text-[15px] font-semibold text-[#ff9f0a]">{t('matching.review_pending')}</p>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400">
                    {t('matching.review_hint')}
                  </p>
                </div>
              </>
            )}
          </div>
          {!data?.human_reviewed && (
            <Button size="md" variant="dark" onClick={handleReview} disabled={reviewing}>
              <UserCheck className="w-5 h-5" />
              {reviewing ? t('matching.confirming') : t('matching.mark_reviewed')}
            </Button>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-black dark:text-white">{results.length}</p>
              <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.checked')}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
              <User className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#34c759]">
                {bestScore != null ? (bestScore * 100).toFixed(0) + '%' : t('matching.score_missing')}
              </p>
              <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.best_match')}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-[#34c759]" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#0071e3]">
                {avgScore != null ? (avgScore * 100).toFixed(0) + '%' : t('matching.score_missing')}
              </p>
              <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.average')}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-[#0071e3]" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#ff9f0a]">{topCount}</p>
              <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{t('matching.top')}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#ff9f0a]/10 flex items-center justify-center">
              <Target className="w-6 h-6 text-[#ff9f0a]" />
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white mb-8">{t('matching.ranking')}</h2>
        {(data?.results?.failures || []).map((failure, index) => (
          <div role="alert" key={`${failure.jobId}-${failure.candidateId}-${index}`} className="mb-4 text-[#ff3b30]">
            {failure.candidateName || failure.candidateId}: {failure.error}
          </div>
        ))}
        <div className="space-y-6">
          {results.map((result, idx) => (
            <Card key={result.candidateId || idx} className="overflow-hidden p-0" hover>
              <div
                className="flex items-center gap-10 p-10 cursor-pointer"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 text-[20px] font-semibold
                  ${idx === 0 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 
                    idx === 1 ? 'bg-gray-100 dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400' : 
                    idx === 2 ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 
                    'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500 dark:text-gray-400'}`
                }>
                  {idx + 1}
                </div>

                {result.score != null ? <ScoreRing score={result.score} size={88} strokeWidth={6} /> : <span>{t('matching.score_missing')}</span>}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-5">
                    <h3 className="text-[26px] font-semibold tracking-tight text-black dark:text-white">{result.candidateName}</h3>
                    {result.score != null && <ScoreBadge score={result.score} />}
                    <KiBadge tooltip={t('matching.score_tooltip')} />
                  </div>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-2 break-all">
                    {t('detail.candidate_id')}: <span className="font-mono select-all">{result.candidateId ?? result.sourceCandidateId ?? '—'}</span>
                    {' · '}{t('jobs.id')}: <span className="font-mono select-all">{result.jobId ?? result.sourceJobId ?? data?.job_id ?? '—'}</span>
                  </p>
                  <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                    {result.summary}
                  </p>
                  <MatchingResultMetadata result={result} historical />
                  {data?.results?.method === 'ai' && (
                    <SkillMatchingResult result={result.skillMatch} failure={result.skillMatchFailure} />
                  )}
                </div>

                <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors">
                  <ChevronDown className={`w-7 h-7 text-gray-400 transition-transform duration-500 ${expandedIdx === idx ? 'rotate-180' : ''}`} />
                </div>
              </div>

              <div className={`overflow-hidden transition-[max-height,opacity] duration-500 ease-in-out ${expandedIdx === idx ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-10 pb-10 border-t border-gray-100/80 dark:border-gray-700/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-10">
                    {result.strengths?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center">
                            <ThumbsUp className="w-6 h-6 text-[#34c759]" />
                          </div>
                          <h4 className="text-[14px] font-semibold text-[#34c759] uppercase tracking-widest">{t('matching.strengths')}</h4>
                        </div>
                        <ul className="space-y-5">
                          {result.strengths.map((s, i) => {
                            const text = typeof s === 'object' ? s.text : s
                            const ref = typeof s === 'object' ? s.reference : ''
                            return (
                              <li key={i} className="text-[16px] font-medium text-gray-700 dark:text-gray-300 leading-relaxed">
                                <div className="flex items-start gap-4">
                                  <span className="w-2 h-2 rounded-full bg-[#34c759] mt-2.5 flex-shrink-0" />
                                  {text}
                                </div>
                                {ref && (
                                  <div className="ml-6 mt-2 flex items-start gap-2.5 px-4 py-2.5 bg-[#34c759]/5 rounded-[14px] border border-[#34c759]/10">
                                    <Quote className="w-3.5 h-3.5 text-[#34c759] mt-0.5 flex-shrink-0" />
                                    <span className="text-[13px] font-medium text-[#34c759]/80 italic">{ref}</span>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    {result.weaknesses?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 rounded-full bg-[#ff3b30]/10 flex items-center justify-center">
                            <ThumbsDown className="w-6 h-6 text-[#ff3b30]" />
                          </div>
                          <h4 className="text-[14px] font-semibold text-[#ff3b30] uppercase tracking-widest">{t('matching.weaknesses')}</h4>
                        </div>
                        <ul className="space-y-5">
                          {result.weaknesses.map((w, i) => {
                            const text = typeof w === 'object' ? w.text : w
                            const ref = typeof w === 'object' ? w.reference : ''
                            return (
                              <li key={i} className="text-[16px] font-medium text-gray-700 dark:text-gray-300 leading-relaxed">
                                <div className="flex items-start gap-4">
                                  <span className="w-2 h-2 rounded-full bg-[#ff3b30] mt-2.5 flex-shrink-0" />
                                  {text}
                                </div>
                                {ref && (
                                  <div className="ml-6 mt-2 flex items-start gap-2.5 px-4 py-2.5 bg-[#ff3b30]/5 rounded-[14px] border border-[#ff3b30]/10">
                                    <Quote className="w-3.5 h-3.5 text-[#ff3b30] mt-0.5 flex-shrink-0" />
                                    <span className="text-[13px] font-medium text-[#ff3b30]/80 italic">{ref}</span>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {results.length === 0 && (
        <Card className="p-20 text-center mt-10">
          <p className="text-[20px] font-medium text-gray-500 dark:text-gray-400">{t('matching.no_results')}</p>
        </Card>
      )}
    </PageContainer>
  )
}
