import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ThumbsUp, ThumbsDown, User, Clock, ChevronDown, ChevronUp, Trophy, Target, BarChart3, Quote, Download, UserCheck, CheckCircle, FileText, GitMerge, Loader2 } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, ScoreBadge, LoadingSpinner, PageContainer } from '../components/UI'
import { KiDisclaimer, KiBadge } from '../components/KiBadge'
import { useI18n } from '../I18nContext'
import { localeTag } from '../utils/format'

export default function MatchingResults() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [error, setError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [matchingRow, setMatchingRow] = useState(null)
  const [matchingError, setMatchingError] = useState('')
  const [selectedPairKeys, setSelectedPairKeys] = useState([])
  const [selectedBatchLoading, setSelectedBatchLoading] = useState(false)
  const [selectedBatchError, setSelectedBatchError] = useState('')

  useEffect(() => {
    matchingApi.getResult(id)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

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
    try {
      const currentType = data?.results?.type
      const currentDirection = data?.results?.direction
      const sourceJobDescription = data?.job_description || data?.jobDescription || row.jobDescription || row.jobTitle || ''
      const result = currentType === 'vectormatch_neo4j' || currentType === 'vectormatch'
        ? await matchingApi.vectorMatch({
            direction: currentDirection || 'job_to_candidates',
            ...(currentDirection === 'candidate_to_jobs'
              ? { candidateId: row.candidateId, candidateName: row.candidateName }
              : { jobId: row.jobId, jobTitle: row.jobTitle, candidateIds: [row.candidateId] }),
            engine: currentType === 'vectormatch_neo4j' ? 'neo4j' : 'python',
          })
        : await matchingApi.run(
            sourceJobDescription,
            row.jobTitle,
            [row.candidateId],
            {}
          )
      navigate(`/matching/results/${result.id}`)
    } catch (err) {
      setMatchingError(err.message)
      setMatchingRow(null)
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
  const resultModeLabel = matrixData?.type === 'vectormatch_neo4j'
    ? 'Vector-Matching (Neo4j)'
    : matrixData?.type === 'vectormatch'
      ? 'Vector-Matching (Python)'
      : matrixData?.model === 'graph-rag-neo4j-skill-vector-match'
        ? 'Matrix-Matching (Neo4j Vector)'
        : matrixData?.model === 'graph-rag-vector-matrix'
          ? 'Matrix-Matching (Python Vector)'
          : 'Matrix-Matching'

  if (matrixData) {
    const matrixRows = matrixData.matrix || []
    const topRows = matrixRows.slice(0, 12)
    const bestScoreMatrix = topRows[0]?.score || 0
    const isVectorMatching = matrixData.type === 'vectormatch' || matrixData.type === 'vectormatch_neo4j'
    const pairCount = matrixRows.length
    const getPairKey = (row) => `${row.jobId}-${row.candidateId}`
    const selectedPairs = matrixRows.filter((row) => selectedPairKeys.includes(getPairKey(row)))
    const allPairsSelected = matrixRows.length > 0 && selectedPairKeys.length === matrixRows.length

    const togglePairSelection = (row) => {
      const key = getPairKey(row)
      setSelectedPairKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
    }

    const toggleAllPairs = () => {
      setSelectedPairKeys((prev) => (prev.length === matrixRows.length ? [] : matrixRows.map(getPairKey)))
    }

    const handleRunSelectedMatching = async () => {
      if (selectedPairs.length === 0) return
      try {
        const batchPayload = selectedPairs.map((row) => ({
          jobId: row.jobId,
          jobTitle: row.jobTitle,
          sourceJobId: data?.job_id || data?.jobId || null,
          sourceJobTitle: data?.job_title || data?.jobTitle || row.jobTitle,
          jobDescription: data?.job_description || data?.jobDescription || row.jobDescription || '',
          candidateId: row.candidateId,
          candidateName: row.candidateName,
        }))
        sessionStorage.setItem('hrtool:matching:selected-batch', JSON.stringify({
          pairs: batchPayload,
          engine: matrixData?.type === 'vectormatch_neo4j' ? 'neo4j' : 'python',
          sourceResultId: id,
          sourceLabel: resultModeLabel,
        }))
        navigate('/matching/results/selected', { state: { pairs: batchPayload } })
      } catch (err) {
        setSelectedBatchError(err.message)
      }
    }

    const formatVectorScore = (value) => {
      if (typeof value !== 'number' || Number.isNaN(value)) return '0.000'
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
      return `${jobSkill} ↔ ${candidateSkill} · ${category} (${formatVectorScore(skill?.similarity ?? 0)})`
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
              <span>HardSkill</span>
              <span className="text-[11px] font-medium text-[#0071e3]/70">{hardMatches.length} Matches</span>
            </div>
            <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
              {hardMatches.length > 0 ? hardMatches.map((skill, index) => (
                <div key={`hard-${row.jobId}-${row.candidateId}-${index}`}>{formatMatchedSkillLabel(skill)}</div>
              )) : <div>keine Treffer</div>}
            </div>
          </div>
          <div className="rounded-[16px] bg-[#34c759]/5 border border-[#34c759]/10 p-3">
            <div className="font-semibold text-[#34c759] mb-2 flex items-center justify-between gap-3">
              <span>SoftSkill</span>
              <span className="text-[11px] font-medium text-[#34c759]/70">{softMatches.length} Matches</span>
            </div>
            <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
              {softMatches.length > 0 ? softMatches.map((skill, index) => (
                <div key={`soft-${row.jobId}-${row.candidateId}-${index}`}>{formatMatchedSkillLabel(skill)}</div>
              )) : <div>keine Treffer</div>}
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
      <PageContainer width="content">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
          <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
            <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
              <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{resultModeLabel}</h1>
              <div className="flex items-center gap-3 sm:gap-6 mt-1 sm:mt-3 flex-wrap">
                <span className="text-[14px] sm:text-[18px] font-medium text-gray-500 dark:text-gray-400">{data?.job_title}</span>
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
              <span className="hidden sm:inline">CSV Export</span>
            </Button>
            <Link to="/matching"><Button size="md" variant="dark">{t('matching.new')}</Button></Link>
          </div>
        </div>

        <KiDisclaimer feature="matching" className="mb-6" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-black dark:text-white">{matrixData.jobs?.length || 0}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">Stellen</p></Card>
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-black dark:text-white">{matrixData.candidates?.length || 0}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">Bewerber</p></Card>
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-[#0071e3]">{pairCount}</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">Paarungen</p></Card>
          <Card className="p-10"><p className="text-[48px] leading-none font-semibold tracking-tight text-[#34c759]">{bestScoreMatrix}%</p><p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">Bester Match</p></Card>
        </div>

        <Card className="p-8 sm:p-10 mb-12">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white">Beste Paarungen übergreifend</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-2">{selectedPairs.length} von {pairCount} Paarungen ausgewählt</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button size="md" variant="secondary" onClick={toggleAllPairs} disabled={matrixRows.length === 0}>
                {allPairsSelected ? 'Auswahl löschen' : 'Alle auswählen'}
              </Button>
              <Button size="md" variant="dark" onClick={handleRunSelectedMatching} disabled={selectedBatchLoading || selectedPairs.length === 0}>
                {selectedBatchLoading ? 'KI-Matching läuft...' : 'KI-Matching selektierte'}
              </Button>
            </div>
          </div>
          {matchingError && (
            <div className="p-4 rounded-[14px] bg-[#ff3b30]/10 text-[#ff3b30] text-[14px] font-medium mb-4">
              {matchingError}
            </div>
          )}
          <div className="space-y-4">
            {topRows.map((row, idx) => {
              const isLoading = matchingRow === `${row.candidateId}-${row.jobId}`
              const isSelected = selectedPairKeys.includes(getPairKey(row))
              return (
                <div
                  key={`${row.jobId}-${row.candidateId}-${idx}`}
                  className={`w-full grid grid-cols-1 lg:grid-cols-[56px_64px_1fr_1fr_180px] gap-4 items-center p-5 rounded-[20px] transition-colors text-left ${isSelected ? 'bg-[#0071e3]/5 dark:bg-[#0071e3]/10 ring-1 ring-[#0071e3]/20' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-gray-100 dark:hover:bg-[#3a3a3c]'}`}
                >
                  <label className="flex items-center justify-center cursor-pointer" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePairSelection(row)}
                      className="h-5 w-5 rounded border-gray-300 text-[#0071e3] focus:ring-[#0071e3]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleMatchingRow(row)}
                    disabled={isLoading || matchingRow !== null}
                    className="text-[18px] font-semibold text-gray-500 dark:text-gray-400 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    #{idx + 1}
                  </button>
                  <div>
                    <p className="text-[16px] font-semibold text-black dark:text-white">{row.candidateName}</p>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">Bewerber</p>
                  </div>
                  <div>
                    <p className="text-[16px] font-semibold text-black dark:text-white">{row.jobTitle}</p>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">Stelle</p>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#0071e3]" />
                    ) : (
                      <div className="flex items-end gap-3">
                        {isVectorMatching ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide bg-[#0071e3]/10 text-[#0071e3]">
                              HardSkill {formatVectorScore(row.hardSkillScore ?? 0)}
                            </span>
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide bg-[#34c759]/10 text-[#34c759]">
                              SoftSkill {formatVectorScore(row.softSkillScore ?? 0)}
                            </span>
                          </div>
                        ) : (
                          <div className="text-[26px] font-semibold text-[#0071e3]">{row.score}%</div>
                        )}
                        <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0 mb-1" />
                      </div>
                    )}
                  </div>
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <Card className="p-8 sm:p-10">
            <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-6">Ranking pro Stelle</h2>
            <div className="space-y-6 max-h-[780px] overflow-y-auto pr-2">
              {(matrixData.jobsRanked || []).map((job) => (
                <div key={job.jobId} className="pb-6 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <h3 className="text-[17px] font-semibold text-black dark:text-white mb-3">{job.jobTitle}</h3>
                  <div className="space-y-2">
                    {job.results.slice(0, 5).map((row, idx) => (
                      <div key={`${job.jobId}-${row.candidateId}`} className="text-[14px]">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-medium text-gray-600 dark:text-gray-300 truncate">{idx + 1}. {row.candidateName}</span>
                          {isVectorMatching ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#0071e3]/10 text-[#0071e3]">
                                HardSkill {formatVectorScore(row.hardSkillScore ?? 0)}
                              </span>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#34c759]/10 text-[#34c759]">
                                SoftSkill {formatVectorScore(row.softSkillScore ?? 0)}
                              </span>
                            </div>
                          ) : (
                            <span className="font-semibold text-[#0071e3]">{row.score}%</span>
                          )}
                        </div>
                        {isVectorMatching && renderCategoryDebug(row)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-8 sm:p-10">
            <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-6">Ranking pro Bewerber</h2>
            <div className="space-y-6 max-h-[780px] overflow-y-auto pr-2">
              {(matrixData.candidatesRanked || []).map((candidate) => (
                <div key={candidate.candidateId} className="pb-6 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <h3 className="text-[17px] font-semibold text-black dark:text-white mb-3">{candidate.candidateName}</h3>
                  <div className="space-y-2">
                    {candidate.results.slice(0, 5).map((row, idx) => (
                      <div key={`${candidate.candidateId}-${row.jobId}`} className="text-[14px]">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-medium text-gray-600 dark:text-gray-300 truncate">{idx + 1}. {row.jobTitle}</span>
                          {isVectorMatching ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#0071e3]/10 text-[#0071e3]">
                                HardSkill {formatVectorScore(row.hardSkillScore ?? 0)}
                              </span>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#34c759]/10 text-[#34c759]">
                                SoftSkill {formatVectorScore(row.softSkillScore ?? 0)}
                              </span>
                            </div>
                          ) : (
                            <span className="font-semibold text-[#0071e3]">{row.score}%</span>
                          )}
                        </div>
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

  // Normalize scores: Ollama returns 0-100, UI expects 0-1, then sort descending
  const results = (data?.results?.results || []).map(r => ({
    ...r,
    score: r.score > 1 ? r.score / 100 : r.score,
  })).sort((a, b) => b.score - a.score)
  const matchedAt = data?.results?.matchedAt || data?.created_at
  const bestScore = results[0]?.score || 0
  const avgScore = results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0
  const topCount = results.filter(r => r.score >= 0.8).length

  const exportCSV = () => {
    const escape = (v) => {
      if (!v) return ''
      const s = String(v).replace(/"/g, '""')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
    }
    const headers = [t('matching.ranking'), t('matching.candidate'), t('matching.score'), t('matching.summary'), t('matching.strengths'), t('matching.weaknesses')]
    const rows = results.map((r, i) => [
      i + 1,
      r.candidateName,
      (r.score * 100).toFixed(0),
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
    <PageContainer width="content">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
          <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('matching.results')}</h1>
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
                <span className="hidden sm:inline">PDF Export</span>
              </Button>
              <Button size="md" variant="secondary" onClick={exportCSV}>
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline">CSV Export</span>
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
                {bestScore ? (bestScore * 100).toFixed(0) + '%' : '-'}
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
                {results.length > 0 ? (avgScore * 100).toFixed(0) + '%' : '-'}
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

                <ScoreRing score={result.score} size={88} strokeWidth={6} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-5">
                    <h3 className="text-[26px] font-semibold tracking-tight text-black dark:text-white">{result.candidateName}</h3>
                    <ScoreBadge score={result.score} />
                    <KiBadge tooltip={t('matching.score_tooltip')} />
                  </div>
                  <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                    {result.summary}
                  </p>
                </div>

                <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors">
                  <ChevronDown className={`w-7 h-7 text-gray-400 transition-transform duration-500 ${expandedIdx === idx ? 'rotate-180' : ''}`} />
                </div>
              </div>

              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedIdx === idx ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
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
