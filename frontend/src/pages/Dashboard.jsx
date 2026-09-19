import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, GitCompare, TrendingUp, TrendingDown, Clock, ArrowRight, MapPin, BarChart2, Activity, Briefcase, CheckCircle, Share2, ShieldAlert, Calendar, Video, Phone, Timer, Zap, FileText, Search, Square, CheckSquare, X } from 'lucide-react'
import { candidatesApi, matchingApi, pipelineApi, settingsApi, interviewsApi, searchApi } from '../api'
import { Card, ScoreRing, LoadingSpinner, PageContainer, EmptyState } from '../components/UI'
import { useWidgetConfig } from '../hooks/useWidgetConfig'
import WidgetConfigurator from '../components/WidgetConfigurator'
import { useAuth } from '../AuthContext'
import { useI18n } from '../I18nContext'
import { localeTag } from '../utils/format'

const PERIOD_OPTIONS = [
  { value: 7, labelKey: 'dashboard.period_7' },
  { value: 30, labelKey: 'dashboard.period_30' },
  { value: 90, labelKey: 'dashboard.period_90' },
]

export default function Dashboard() {
  const { isAdmin } = useAuth()
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [recentMatches, setRecentMatches] = useState([])
  const [activePipelines, setActivePipelines] = useState([])
  const [sourceStats, setSourceStats] = useState(null)
  const [timeToHire, setTimeToHire] = useState(null)
  const [dsgvoData, setDsgvoData] = useState(null)
  const [upcomingInterviews, setUpcomingInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodDays, setPeriodDays] = useState(30)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState({ jobs: [], candidates: [], matchings: [], totalJobs: 0, totalCandidates: 0, totalMatchings: 0 })
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedJobs, setSelectedJobs] = useState([])
  const [selectedCandidates, setSelectedCandidates] = useState([])
  const [selectionError, setSelectionError] = useState('')
  const { widgets, visibleWidgets, toggleWidget, reorder, resetToDefault } = useWidgetConfig()

  const selectedPairs = useMemo(() => selectedJobs.flatMap((job) => selectedCandidates.map((candidate) => ({
    jobId: job.id,
    jobTitle: job.title,
    jobDescription: job.description || job.full_text || '',
    candidateId: candidate.id,
    candidateName: candidate.name,
  }))), [selectedJobs, selectedCandidates])

  const selectionPairsOverLimit = selectedPairs.length > 20

  const toggleSelectedJob = (job) => {
    setSelectionError('')
    setSelectedJobs((prev) => (
      prev.some((item) => item.id === job.id)
        ? prev.filter((item) => item.id !== job.id)
        : [...prev, job]
    ))
  }

  const toggleSelectedCandidate = (candidate) => {
    setSelectionError('')
    setSelectedCandidates((prev) => (
      prev.some((item) => item.id === candidate.id)
        ? prev.filter((item) => item.id !== candidate.id)
        : [...prev, candidate]
    ))
  }

  const removeSelectedJob = (jobId) => {
    setSelectedJobs((prev) => prev.filter((item) => item.id !== jobId))
  }

  const removeSelectedCandidate = (candidateId) => {
    setSelectedCandidates((prev) => prev.filter((item) => item.id !== candidateId))
  }

  const clearSelection = () => {
    setSelectedJobs([])
    setSelectedCandidates([])
    setSelectionError('')
  }

  const toggleAllSelectedJobs = () => {
    const currentIds = new Set(searchResults.jobs.map((job) => job.id))
    const allSelected = searchResults.jobs.length > 0 && searchResults.jobs.every((job) => selectedJobs.some((item) => item.id === job.id))

    setSelectionError('')
    setSelectedJobs((prev) => {
      if (allSelected) {
        return prev.filter((item) => !currentIds.has(item.id))
      }
      const map = new Map(prev.map((item) => [item.id, item]))
      searchResults.jobs.forEach((job) => map.set(job.id, job))
      return [...map.values()]
    })
  }

  const toggleAllSelectedCandidates = () => {
    const currentIds = new Set(searchResults.candidates.map((candidate) => candidate.id))
    const allSelected = searchResults.candidates.length > 0 && searchResults.candidates.every((candidate) => selectedCandidates.some((item) => item.id === candidate.id))

    setSelectionError('')
    setSelectedCandidates((prev) => {
      if (allSelected) {
        return prev.filter((item) => !currentIds.has(item.id))
      }
      const map = new Map(prev.map((item) => [item.id, item]))
      searchResults.candidates.forEach((candidate) => map.set(candidate.id, candidate))
      return [...map.values()]
    })
  }

  const handleMatchSelected = (mode) => {
    if (selectedJobs.length === 0 || selectedCandidates.length === 0) {
      setSelectionError(t('dashboard.selection_missing'))
      return
    }

    if (selectionPairsOverLimit) {
      setSelectionError(t('dashboard.selection_limit'))
      return
    }

    sessionStorage.setItem('hrtool:matching:selected-batch', JSON.stringify({
      pairs: selectedPairs,
      mode,
      sourceLabel: 'Dashboard selection',
    }))
    navigate('/matching/results/selected', { state: { pairs: selectedPairs, mode } })
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsData, historyData, pipelineData, sourceData, tthData] = await Promise.all([
        candidatesApi.getStats(periodDays).catch(() => ({ totalCandidates: 0, newThisWeek: 0, topLocations: [] })),
        matchingApi.getHistory().catch(() => ({ data: [] })),
        pipelineApi.getActiveJobs().catch(() => ({ data: [] })),
        candidatesApi.getSourceStats().catch(() => ({ sources: [], total: 0 })),
        candidatesApi.getTimeToHire().catch(() => null),
      ])
      const dsgvoResult = await settingsApi.getExpired().catch(() => null)
      const interviewsResult = await interviewsApi.getUpcoming().catch(() => ({ data: [] }))
      setDsgvoData(dsgvoResult)
      setUpcomingInterviews(interviewsResult.data || [])
      setStats(statsData)
      setTimeToHire(tthData)
      setRecentMatches(historyData.data?.slice(0, 4) || [])
      setActivePipelines(pipelineData.data || [])
      setSourceStats(sourceData)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [periodDays])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (!debouncedSearchQuery || debouncedSearchQuery.length < 2) {
      setSearchResults({ jobs: [], candidates: [], matchings: [], totalJobs: 0, totalCandidates: 0, totalMatchings: 0 })
      return
    }

    let cancelled = false
    setSearchLoading(true)
    searchApi.global(debouncedSearchQuery, 6)
      .then((result) => {
        if (cancelled) return
        setSearchResults({
          jobs: result.jobs || [],
          candidates: result.candidates || [],
          matchings: result.matchings || [],
          totalJobs: result.totalJobs || 0,
          totalCandidates: result.totalCandidates || 0,
          totalMatchings: result.totalMatchings || 0,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setSearchResults({ jobs: [], candidates: [], matchings: [], totalJobs: 0, totalCandidates: 0, totalMatchings: 0 })
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedSearchQuery])

  if (loading) return <LoadingSpinner text={t('dashboard.loading')} />

  return (
    <PageContainer width="content" className="space-y-8 sm:space-y-14">
      <div className="mb-4 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-4">
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.title')}</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('dashboard.subtitle')}</p>
          <div className="relative w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dashboard.search_placeholder')}
              className="w-full rounded-full border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] pl-12 pr-5 py-4 text-[15px] text-black dark:text-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] outline-none transition focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full p-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriodDays(opt.value)}
                className={`px-4 py-2 rounded-full text-[13px] font-semibold transition duration-300 cursor-pointer ${
                  periodDays === opt.value
                    ? 'bg-white dark:bg-[#3a3a3c] text-[#0071e3] dark:text-[#0a84ff] shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const style = document.createElement('style')
              style.id = 'print-styles'
              style.textContent = `
                @media print { 
                  aside, header, nav, .no-print { display: none !important; } 
                  main { margin: 0 !important; padding: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
                  .fade-in { animation: none !important; }
                  * { print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
                }
              `
              document.head.appendChild(style)
              // Delay to let browser apply styles before triggering print
              requestAnimationFrame(() => {
                setTimeout(() => {
                  window.print()
                  setTimeout(() => document.getElementById('print-styles')?.remove(), 1000)
                }, 100)
              })
            }}
            className="w-10 h-10 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition cursor-pointer"
            title={t('dashboard.pdf_export')}
            aria-label={t('dashboard.pdf_export')}
          >
            <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
          <WidgetConfigurator
          widgets={widgets}
          onToggle={toggleWidget}
          onReorder={reorder}
          onReset={resetToDefault}
        />
        </div>
      </div>

      {debouncedSearchQuery.length >= 2 && (
        <Card className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-[22px] sm:text-[28px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.search_results')}</h2>
              <p className="text-[14px] sm:text-[15px] text-gray-500 dark:text-gray-400 mt-1">{searchLoading ? t('dashboard.loading') : `${searchResults.totalCandidates + searchResults.totalJobs + searchResults.totalMatchings} Treffer`}</p>
            </div>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-[13px] font-medium text-gray-500 hover:text-black dark:hover:text-white transition-colors"
            >
              {t('common.clear')}
            </button>
          </div>

          {!searchLoading && searchResults.jobs.length === 0 && searchResults.candidates.length === 0 && searchResults.matchings.length === 0 ? (
            <EmptyState title={t('dashboard.search_no_results')} description={searchQuery} />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
              <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                <SearchResultGroup
                  title={t('dashboard.search_candidates')}
                  count={searchResults.totalCandidates}
                  items={searchResults.candidates}
                  actionLabel={t('dashboard.select_all_candidates')}
                  actionChecked={searchResults.candidates.length > 0 && searchResults.candidates.every((candidate) => selectedCandidates.some((item) => item.id === candidate.id))}
                  onActionToggle={toggleAllSelectedCandidates}
                  emptyLabel={t('dashboard.search_no_results')}
                  renderItem={(candidate) => {
                    const isSelected = selectedCandidates.some((item) => item.id === candidate.id)
                    return (
                      <div key={`candidate-${candidate.id}`} className={`relative rounded-[22px] border p-4 sm:p-5 transition ${isSelected ? 'border-[#0071e3]/40 bg-[#0071e3]/5' : 'border-gray-100/80 dark:border-gray-700/70 hover:border-[#0071e3]/30 hover:bg-[#0071e3]/5'}`}>
                        <button
                          type="button"
                          onClick={() => toggleSelectedCandidate(candidate)}
                          aria-label={isSelected ? `${candidate.name} ${t('dashboard.deselect')}` : `${candidate.name} ${t('dashboard.select')}`}
                          className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border transition ${isSelected ? 'border-[#0071e3] bg-[#0071e3] text-white' : 'border-gray-300 text-gray-400 hover:border-[#0071e3] hover:text-[#0071e3]'}`}
                        >
                          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                        </button>
                        <div className="pr-12">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[16px] font-semibold text-black dark:text-white">{candidate.name}</p>
                              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{candidate.location || candidate.current_position || candidate.current_employer || ' '}</p>
                            </div>
                            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#0071e3]/10 text-[#0071e3]">CV</span>
                          </div>
                          {candidate.full_text && (
                            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-3 line-clamp-2">{candidate.full_text}</p>
                          )}
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <Link to={`/candidates/${candidate.id}/detail`} className="text-[13px] font-semibold text-[#0071e3] hover:opacity-70 transition-opacity">
                              {t('dashboard.open_result')}
                            </Link>
                            {isSelected && <span className="text-[11px] font-semibold text-[#0071e3]">{t('dashboard.selected')}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />

                <SearchResultGroup
                  title={t('dashboard.search_jobs')}
                  count={searchResults.totalJobs}
                  items={searchResults.jobs}
                  actionLabel={t('dashboard.select_all_jobs')}
                  actionChecked={searchResults.jobs.length > 0 && searchResults.jobs.every((job) => selectedJobs.some((item) => item.id === job.id))}
                  onActionToggle={toggleAllSelectedJobs}
                  emptyLabel={t('dashboard.search_no_results')}
                  renderItem={(job) => {
                    const isSelected = selectedJobs.some((item) => item.id === job.id)
                    return (
                      <div key={`job-${job.id}`} className={`relative rounded-[22px] border p-4 sm:p-5 transition ${isSelected ? 'border-[#8b5cf6]/40 bg-[#8b5cf6]/5' : 'border-gray-100/80 dark:border-gray-700/70 hover:border-[#8b5cf6]/30 hover:bg-[#8b5cf6]/5'}`}>
                        <button
                          type="button"
                          onClick={() => toggleSelectedJob(job)}
                          aria-label={isSelected ? `${job.title} ${t('dashboard.deselect')}` : `${job.title} ${t('dashboard.select')}`}
                          className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border transition ${isSelected ? 'border-[#8b5cf6] bg-[#8b5cf6] text-white' : 'border-gray-300 text-gray-400 hover:border-[#8b5cf6] hover:text-[#8b5cf6]'}`}
                        >
                          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                        </button>
                        <div className="pr-12">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[16px] font-semibold text-black dark:text-white">{job.title}</p>
                              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{job.location || job.company || ' '}</p>
                            </div>
                            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6]">Job</span>
                          </div>
                          {job.description && (
                            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-3 line-clamp-2">{job.description}</p>
                          )}
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <Link to={`/jobs/${job.id}/edit`} className="text-[13px] font-semibold text-[#8b5cf6] hover:opacity-70 transition-opacity">
                              {t('dashboard.open_result')}
                            </Link>
                            {isSelected && <span className="text-[11px] font-semibold text-[#8b5cf6]">{t('dashboard.selected')}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />

                <SearchResultGroup
                  title={t('dashboard.search_matchings')}
                  count={searchResults.totalMatchings}
                  items={searchResults.matchings}
                  emptyLabel={t('dashboard.search_no_results')}
                  renderItem={(matching) => (
                    <Link key={`matching-${matching.id}`} to={`/matching/results/${matching.id}`} className="block rounded-[22px] border border-gray-100/80 dark:border-gray-700/70 p-4 sm:p-5 hover:border-[#34c759]/30 hover:bg-[#34c759]/5 transition">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[16px] font-semibold text-black dark:text-white">{matching.job_title || `Matching ${matching.id}`}</p>
                          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{matching.reviewed_by || matching.created_at || ' '}</p>
                        </div>
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#34c759]/10 text-[#34c759]">Match</span>
                      </div>
                      {matching.review_notes || matching.results ? (
                        <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-3 line-clamp-2">{matching.review_notes || matching.results}</p>
                      ) : null}
                    </Link>
                  )}
                />
              </div>

              <aside className="xl:sticky xl:top-6 rounded-[28px] border border-gray-100/80 dark:border-gray-700/70 bg-white dark:bg-[#1c1c1e] p-5 sm:p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)] min-h-[min(60vh,560px)] flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('dashboard.selection_title')}</h3>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                      {t('dashboard.selection_summary').replace('{jobs}', String(selectedJobs.length)).replace('{candidates}', String(selectedCandidates.length)).replace('{pairs}', String(selectedPairs.length))}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-[13px] font-medium text-gray-500 hover:text-black dark:hover:text-white transition-colors"
                  >
                    {t('common.clear')}
                  </button>
                </div>

                {selectionError && (
                  <p className="mt-4 rounded-[16px] bg-[#ff3b30]/10 px-4 py-3 text-[13px] font-medium text-[#ff3b30]">
                    {selectionError}
                  </p>
                )}

                <div className="mt-5 space-y-5 max-h-[min(60vh,560px)] overflow-y-auto pr-1 flex-1 min-h-0">
                  <SelectionSection
                    title={t('dashboard.selected_jobs')}
                    count={selectedJobs.length}
                    items={selectedJobs}
                    emptyLabel={t('dashboard.selection_empty_jobs')}
                    accent="#8b5cf6"
                    onRemove={removeSelectedJob}
                    renderLabel={(job) => job.title}
                    renderMeta={(job) => [job.location, job.company].filter(Boolean).join(' · ')}
                  />
                  <SelectionSection
                    title={t('dashboard.selected_candidates')}
                    count={selectedCandidates.length}
                    items={selectedCandidates}
                    emptyLabel={t('dashboard.selection_empty_candidates')}
                    accent="#0071e3"
                    onRemove={removeSelectedCandidate}
                    renderLabel={(candidate) => candidate.name}
                    renderMeta={(candidate) => [candidate.location, candidate.current_position].filter(Boolean).join(' · ')}
                  />
                </div>

                <div className="mt-6 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleMatchSelected('vector')}
                      disabled={selectedJobs.length === 0 || selectedCandidates.length === 0 || selectionPairsOverLimit}
                      className="w-full rounded-full border border-[#8b5cf6]/30 bg-[#8b5cf6]/10 px-5 py-4 text-[15px] font-semibold text-[#8b5cf6] transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('dashboard.match_selected_vector')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMatchSelected('ai')}
                      disabled={selectedJobs.length === 0 || selectedCandidates.length === 0 || selectionPairsOverLimit}
                      className="w-full rounded-full bg-black px-5 py-4 text-[15px] font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                    >
                      {t('dashboard.match_selected_ai')}
                    </button>
                  </div>
                  <p className={`text-[12px] ${selectionPairsOverLimit ? 'text-[#ff3b30]' : 'text-gray-500 dark:text-gray-400'}`}>
                    {selectionPairsOverLimit ? t('dashboard.selection_limit') : t('dashboard.selection_hint')}
                  </p>
                </div>
              </aside>
            </div>
          )}
        </Card>
      )}

      {/* Render widgets in configured order */}
      {visibleWidgets.map(widget => {
        switch (widget.id) {
          case 'stats': return <StatsWidget key="stats" stats={stats} periodDays={periodDays} t={t} />
          case 'pipelines': return activePipelines.length > 0 ? <PipelinesWidget key="pipelines" pipelines={activePipelines} t={t} /> : null
          case 'matches': return <MatchesAndLocationsWidget key="matches" matches={recentMatches} stats={stats} visibleWidgets={visibleWidgets} t={t} />
          case 'locations': return null // rendered inside matches when both visible, standalone otherwise handled below
          case 'sources': return sourceStats?.sources?.length > 0 ? <SourcesWidget key="sources" sourceStats={sourceStats} t={t} /> : null
          case 'timetohire': return timeToHire ? <TimeToHireWidget key="timetohire" data={timeToHire} t={t} /> : null
          case 'dsgvo': return (dsgvoData && isAdmin) ? <DSGVOWidget key="dsgvo" data={dsgvoData} t={t} /> : null
          case 'calendar': return <CalendarWidget key="calendar" interviews={upcomingInterviews} t={t} />
          default: return null
        }
      })}

      {/* Render standalone locations if matches is hidden but locations visible */}
      {visibleWidgets.some(w => w.id === 'locations') && !visibleWidgets.some(w => w.id === 'matches') && (
        <Card className="p-12">
          <LocationsContent stats={stats} t={t} />
        </Card>
      )}
    </PageContainer>
  )
}

function SearchResultGroup({ title, count, items, emptyLabel, renderItem, actionLabel, actionChecked, onActionToggle }) {
  return (
    <div className="rounded-[28px] border border-gray-100/80 dark:border-gray-700/70 bg-white dark:bg-[#1c1c1e] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-[18px] font-semibold text-black dark:text-white">{title}</h3>
        <div className="flex items-center gap-2">
          {onActionToggle && (
            <button
              type="button"
              onClick={onActionToggle}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200/80 dark:border-gray-700 px-3 py-1.5 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:border-[#0071e3]/40 hover:text-[#0071e3] transition-colors"
            >
              {actionChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {actionLabel}
            </button>
          )}
          <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400">{count}</span>
        </div>
      </div>
      <div className="space-y-3">
        {items.length > 0 ? items.map(renderItem) : <p className="text-[14px] text-gray-500 dark:text-gray-400">{emptyLabel}</p>}
      </div>
    </div>
  )
}

function SelectionSection({ title, count, items, emptyLabel, accent, onRemove, renderLabel, renderMeta }) {
  return (
    <section className="rounded-[22px] bg-[#f5f5f7] dark:bg-[#2c2c2e] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h4 className="text-[15px] font-semibold text-black dark:text-white">{title}</h4>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{count}</p>
        </div>
      </div>
      <div className="space-y-2">
        {items.length > 0 ? items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 rounded-[16px] bg-white dark:bg-[#1c1c1e] px-3 py-2.5 shadow-sm">
            <div className="mt-0.5 h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-black dark:text-white truncate">{renderLabel(item)}</p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{renderMeta(item) || ' '}</p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:text-black dark:hover:text-white transition-colors"
              aria-label={title}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )) : <p className="text-[13px] text-gray-500 dark:text-gray-400">{emptyLabel}</p>}
      </div>
    </section>
  )
}

/* === Widget Components === */

function StatsWidget({ stats, periodDays, t }) {
  const periodLabel = periodDays === 7 ? t('dashboard.vs_prev_week') : periodDays === 30 ? t('dashboard.vs_prev_month') : t('dashboard.vs_prev_period')
  const monthPct = stats?.newLastMonth > 0
    ? Math.round(((stats?.newThisMonth - stats?.newLastMonth) / stats?.newLastMonth) * 100)
    : stats?.newThisMonth > 0 ? 100 : 0
  const weekPct = stats?.newPrevWeek > 0
    ? Math.round(((stats?.newThisWeek - stats?.newPrevWeek) / stats?.newPrevWeek) * 100)
    : stats?.newThisWeek > 0 ? 100 : 0
  const matchPct = stats?.matchingsPrevWeek > 0
    ? Math.round(((stats?.matchingsThisWeek - stats?.matchingsPrevWeek) / stats?.matchingsPrevWeek) * 100)
    : stats?.matchingsThisWeek > 0 ? 100 : 0
  const trend = (pct) => pct >= 0
    ? { icon: TrendingUp, color: '#34c759', text: `+${pct}%` }
    : { icon: TrendingDown, color: '#ff3b30', text: `${pct}%` }
  const mTrend = trend(monthPct)
  const wTrend = trend(weekPct)
  const maTrend = trend(matchPct)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">{t('dashboard.total_candidates')}</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.totalCandidates || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${mTrend.color}15` }}>
            <mTrend.icon className="w-4 h-4" style={{ color: mTrend.color }} />
          </div>
          <span className="text-[15px] font-medium" style={{ color: mTrend.color }}>{mTrend.text} {t('dashboard.this_month')}</span>
        </div>
      </Card>

      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">{t('dashboard.new_period').replace('{days}', periodDays)}</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.newThisWeek || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${wTrend.color}15` }}>
            <wTrend.icon className="w-4 h-4" style={{ color: wTrend.color }} />
          </div>
          <span className="text-[15px] font-medium" style={{ color: wTrend.color }}>{wTrend.text} {periodLabel}</span>
        </div>
      </Card>

      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">{t('dashboard.matchings')}</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.matchingsTotal || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${maTrend.color}15` }}>
            <maTrend.icon className="w-4 h-4" style={{ color: maTrend.color }} />
          </div>
          <span className="text-[15px] font-medium" style={{ color: maTrend.color }}>{maTrend.text} {periodLabel}</span>
        </div>
      </Card>

      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">{t('dashboard.open_jobs')}</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.openJobs || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#8b5cf6]/10 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-[#8b5cf6]" />
          </div>
          {stats?.closedThisMonth > 0 ? (
            <span className="text-[15px] font-medium text-[#34c759]">{stats.closedThisMonth} {t('dashboard.closed_this_month')}</span>
          ) : (
            <Link to="/jobs" className="text-[15px] font-medium text-[#8b5cf6] hover:opacity-70 transition-opacity">{t('dashboard.manage_jobs')}</Link>
          )}
        </div>
      </Card>
    </div>
  )
}

function PipelinesWidget({ pipelines, t }) {
  const stageColors = {
    'Beworben': 'bg-[#007aff]/10 text-[#007aff]',
    'Vorauswahl': 'bg-[#5856d6]/10 text-[#5856d6]',
    'Interview': 'bg-[#ff9500]/10 text-[#ff9500]',
    'Angebot': 'bg-[#34c759]/10 text-[#34c759]',
    'Hired': 'bg-[#30d158]/10 text-[#30d158]',
    'Abgesagt': 'bg-[#ff3b30]/10 text-[#ff3b30]',
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.active_pipelines')}</h2>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">{t('dashboard.active_pipelines_sub')}</p>
        </div>
        <Link to="/jobs" className="text-[16px] font-medium text-[#0071e3] hover:text-[#0077ed] flex items-center gap-2 transition-colors">
          {t('dashboard.all_jobs')} <ArrowRight className="w-5 h-5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {pipelines.map(job => (
          <Link key={job.id} to={`/pipeline/${job.id}`}>
            <Card hover className="p-8 h-full">
              <div className="flex items-start gap-5 mb-6">
                <div className="w-12 h-12 rounded-full bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-6 h-6 text-[#0071e3]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[18px] font-semibold tracking-tight text-black dark:text-white truncate">{job.title}</p>
                  {job.location && (
                    <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> {job.location}
                    </p>
                  )}
                </div>
                <span className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[14px] font-bold">
                  {job.total}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(job.stages).map(([stage, count]) => (
                  <span key={stage} className={`px-3 py-1 rounded-full text-[13px] font-semibold ${stageColors[stage] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                    {count} {stage}
                  </span>
                ))}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

function LocationsContent({ stats, t }) {
  return (
    <>
      <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white mb-2">{t('dashboard.top_locations')}</h2>
      <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-12">{t('dashboard.top_locations_sub')}</p>
      {stats?.topLocations?.length > 0 ? (
        <div className="space-y-8">
          {stats.topLocations.map(({ location, count }, idx) => (
            <div key={location} className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center font-semibold text-[18px] text-gray-500 dark:text-gray-400">
                  {idx + 1}
                </div>
                <span className="text-[18px] font-medium text-black dark:text-white">{location}</span>
              </div>
              <span className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={BarChart2} title={t('dashboard.no_data')} size="sm" />
      )}
    </>
  )
}

function MatchesAndLocationsWidget({ matches, stats, visibleWidgets, t }) {
  const { locale } = useI18n()
  const showLocations = visibleWidgets.some(w => w.id === 'locations')
  return (
    <div className={`grid grid-cols-1 ${showLocations ? 'lg:grid-cols-3' : ''} gap-8`}>
      <Card className={`${showLocations ? 'lg:col-span-2' : ''} p-12`}>
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.recent_matches')}</h2>
          <Link to="/history" className="text-[16px] font-medium text-[#0071e3] hover:text-[#0077ed] flex items-center gap-2 transition-colors">
            {t('dashboard.show_all')} <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
        {matches.length === 0 ? (
          <p className="text-[18px] text-gray-500 dark:text-gray-400 py-12 text-center">{t('dashboard.no_matchings')}</p>
        ) : (
          <div className="space-y-4">
            {matches.map((match) => {
              const allScores = (match.results?.results || []).map(r => r.score || 0)
              const rawScore = allScores.length > 0 ? Math.max(...allScores) : 0
              const topScore = rawScore > 1 ? rawScore / 100 : rawScore
              return (
                <Link key={match.id} to={`/matching/results/${match.id}`} className="block">
                  <div className="flex items-center justify-between p-6 rounded-[24px] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition duration-300 border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50">
                    <div className="flex items-center gap-8">
                      <div className="w-16 h-16 rounded-full bg-white dark:bg-[#1c1c1e] shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-center">
                        <GitCompare className="w-7 h-7 text-black dark:text-white" />
                      </div>
                      <div>
                        <p className="text-[20px] font-semibold tracking-tight text-black dark:text-white">{match.job_title}</p>
                        <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          {new Date(match.created_at).toLocaleDateString(localeTag(locale))}
                        </p>
                      </div>
                    </div>
                    <ScoreRing score={topScore} size={68} strokeWidth={5} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Card>
      {showLocations && (
        <Card className="p-12">
          <LocationsContent stats={stats} t={t} />
        </Card>
      )}
    </div>
  )
}

function SourcesWidget({ sourceStats, t }) {
  const colors = ['#0071e3', '#34c759', '#ff9500', '#5856d6', '#ff3b30', '#30d158', '#ff2d55', '#007aff', '#af52de']
  return (
    <Card className="p-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.sources')}</h2>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">{t('dashboard.sources_sub')}</p>
        </div>
        <div className="w-14 h-14 rounded-full bg-[#5856d6]/10 flex items-center justify-center flex-shrink-0">
          <Share2 className="w-7 h-7 text-[#5856d6]" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sourceStats.sources.map((s, idx) => {
          const color = colors[idx % colors.length]
          return (
            <div key={s.source} className="p-6 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200/50 dark:border-gray-700/50">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[16px] font-semibold text-black dark:text-white">{s.source}</span>
                <span className="px-3 py-1 rounded-full text-[13px] font-bold" style={{ backgroundColor: `${color}15`, color }}>{s.percentage}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-600 mb-5">
                <div className="h-full rounded-full transition duration-700" style={{ width: `${s.percentage}%`, backgroundColor: color }} />
              </div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-gray-500 dark:text-gray-400"><span className="font-semibold text-black dark:text-white">{s.count}</span> {t('dashboard.candidates_label')}</span>
                {s.hired > 0 && (
                  <span className="text-[#34c759] font-semibold">{s.hired} Hired ({s.hiredRate}%)</span>
                )}
                {s.hired === 0 && s.inProcess > 0 && (
                  <span className="text-[#ff9500] font-medium">{s.inProcess} {t('dashboard.in_process')}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function TimeToHireWidget({ data, t }) {
  const { overview, stageMetrics, bottleneck, perJob, monthlyTrend, inPipeline } = data

  const stageColors = {
    'Beworben': '#007aff',
    'Vorauswahl': '#5856d6',
    'Interview': '#ff9500',
    'Angebot': '#34c759',
  }

  const maxStageDays = Math.max(...stageMetrics.filter(s => s.avgDays).map(s => s.avgDays), 1)
  const maxTrendDays = Math.max(...monthlyTrend.filter(m => m.avgDays).map(m => m.avgDays), 1)

  return (
    <Card className="p-6 sm:p-10">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#ff9500]/10 flex items-center justify-center">
            <Timer className="w-5 h-5 text-[#ff9500]" />
          </div>
          <div>
            <h2 className="text-[20px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.time_to_hire')}</h2>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">{t('dashboard.tth_sub')}</p>
          </div>
        </div>
        {bottleneck && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#ff3b30]/10">
            <Zap className="w-3.5 h-3.5 text-[#ff3b30]" />
            <span className="text-[12px] font-semibold text-[#ff3b30]">{t('dashboard.tth_bottleneck')}: {bottleneck.stage} ({bottleneck.avgDays}d)</span>
          </div>
        )}
      </div>

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <p className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('dashboard.tth_avg')}</p>
          <p className="text-[28px] font-semibold tracking-tight text-black dark:text-white">
            {overview.avgDaysToHire != null ? `${overview.avgDaysToHire}` : '—'}
            <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400 ml-1">{t('common.days')}</span>
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <p className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('dashboard.tth_median')}</p>
          <p className="text-[28px] font-semibold tracking-tight text-black dark:text-white">
            {overview.medianDays != null ? `${overview.medianDays}` : '—'}
            <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400 ml-1">{t('common.days')}</span>
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <p className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('dashboard.tth_fastest')}</p>
          <p className="text-[28px] font-semibold tracking-tight text-[#34c759]">
            {overview.minDays != null ? `${overview.minDays}` : '—'}
            <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400 ml-1">{t('common.days')}</span>
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <p className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('dashboard.tth_slowest')}</p>
          <p className="text-[28px] font-semibold tracking-tight text-[#ff3b30]">
            {overview.maxDays != null ? `${overview.maxDays}` : '—'}
            <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400 ml-1">{t('common.days')}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stage Duration Bars */}
        <div className="p-5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-4">{t('dashboard.tth_stage_duration')}</h3>
          <div className="space-y-4">
            {stageMetrics.map(s => {
              const color = stageColors[s.stage] || '#8e8e93'
              const widthPct = s.avgDays != null ? Math.max(4, (s.avgDays / maxStageDays) * 100) : 0
              return (
                <div key={s.stage}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[14px] font-medium text-black dark:text-white">{s.stage}</span>
                    <span className="text-[14px] font-semibold" style={{ color }}>
                      {s.avgDays != null ? `${s.avgDays} ${t('common.days')}` : '—'}
                      {s.count > 0 && <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">({s.count}x)</span>}
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-600">
                    {s.avgDays != null && (
                      <div
                        className="h-full rounded-full transition duration-700"
                        style={{ width: `${widthPct}%`, backgroundColor: color }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="p-5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-4">{t('dashboard.tth_monthly')}</h3>
          <div className="space-y-4">
            {monthlyTrend.map((m, idx) => {
              const widthPct = m.avgDays != null ? Math.max(4, (m.avgDays / maxTrendDays) * 100) : 0
              const prevAvg = idx > 0 ? monthlyTrend[idx - 1].avgDays : null
              const isImproved = prevAvg != null && m.avgDays != null && m.avgDays < prevAvg
              const isWorse = prevAvg != null && m.avgDays != null && m.avgDays > prevAvg
              return (
                <div key={m.month}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[14px] font-medium text-black dark:text-white">{m.month}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-black dark:text-white">
                        {m.avgDays != null ? `${m.avgDays}d` : '—'}
                      </span>
                      {isImproved && <TrendingDown className="w-3.5 h-3.5 text-[#34c759]" />}
                      {isWorse && <TrendingUp className="w-3.5 h-3.5 text-[#ff3b30]" />}
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{m.hired} hired</span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-600">
                    {m.avgDays != null && (
                      <div
                        className="h-full rounded-full transition duration-700"
                        style={{ width: `${widthPct}%`, backgroundColor: isImproved ? '#34c759' : isWorse ? '#ff3b30' : '#ff9500' }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Per-Job Time-to-Hire + In Pipeline info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {perJob.length > 0 && (
          <div className="p-5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
            <h3 className="text-[16px] font-semibold text-black dark:text-white mb-4">{t('dashboard.tth_per_job')}</h3>
            <div className="space-y-3">
              {perJob.map(j => (
                <div key={j.jobTitle} className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Briefcase className="w-4 h-4 text-[#0071e3] flex-shrink-0" />
                    <span className="text-[14px] font-medium text-black dark:text-white truncate">{j.jobTitle}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <span className="text-[13px] text-gray-500 dark:text-gray-400">{j.hired}x</span>
                    <span className="text-[14px] font-bold text-[#ff9500] tabular-nums">{j.avgDays}d</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-4">{t('dashboard.tth_in_pipeline')}</h3>
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <p className="text-[36px] font-semibold tracking-tight text-[#0071e3]">{inPipeline.count}</p>
              <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('dashboard.tth_in_progress')}</p>
            </div>
            <div className="flex-1">
              <p className="text-[36px] font-semibold tracking-tight text-[#ff9500]">
                {inPipeline.avgDaysWaiting != null ? `${inPipeline.avgDaysWaiting}` : '—'}
              </p>
              <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('dashboard.tth_avg_waiting')}</p>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-white/50 dark:bg-[#1c1c1e]/50">
            <p className="text-[12px] text-gray-500 dark:text-gray-400">
              {overview.totalHired > 0
                ? t('dashboard.tth_based_on').replace('{count}', overview.totalHired).replace('{median}', overview.medianDays)
                : t('dashboard.tth_no_hires')}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

function DSGVOWidget({ data, t }) {
  const isClean = data.expiredCount === 0
  return (
    <Card className="p-6 sm:p-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className={`w-5 h-5 ${isClean ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`} />
          <h2 className="text-[20px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.dsgvo_status')}</h2>
        </div>
        <Link to="/admin/dsgvo" className="text-[15px] font-medium text-[#0071e3] hover:underline flex items-center gap-1">
          {t('dashboard.dsgvo_manage')} <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {isClean ? (
        <div className="flex items-center gap-4 p-5 rounded-[16px] bg-[#34c759]/5">
          <CheckCircle className="w-8 h-8 text-[#34c759]" />
          <div>
            <p className="text-[16px] font-semibold text-[#34c759]">{t('dashboard.dsgvo_compliant')}</p>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('dashboard.dsgvo_compliant_sub').replace('{months}', data.retentionMonths)}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 p-5 rounded-[16px] bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
          <div className="w-14 h-14 rounded-full bg-[#ff9f0a]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[22px] font-bold text-[#ff9f0a]">{data.expiredCount}</span>
          </div>
          <div>
            <p className="text-[16px] font-semibold text-[#ff9f0a]">{t('dashboard.dsgvo_action')}</p>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">
              {t('dashboard.dsgvo_expired').replace('{count}', data.expiredCount).replace('{months}', data.retentionMonths)}
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

function CalendarWidget({ interviews, t }) {
  const { locale } = useI18n()
  const typeIcons = { 'Video': Video, 'Telefon': Phone, 'vor Ort': MapPin }
  const statusColors = {
    geplant: 'bg-[#0071e3]/10 text-[#0071e3]',
    bestätigt: 'bg-[#34c759]/10 text-[#34c759]',
    abgeschlossen: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    abgesagt: 'bg-[#ff3b30]/10 text-[#ff3b30]',
  }

  return (
    <Card className="p-6 sm:p-10">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#ff9f0a]" />
          <h2 className="text-[20px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('dashboard.upcoming_interviews')}</h2>
        </div>
        <span className="px-3 py-1 rounded-full bg-[#ff9f0a]/10 text-[#ff9f0a] text-[14px] font-bold">
          {interviews.length}
        </span>
      </div>

      {interviews.length === 0 ? (
        <EmptyState icon={Calendar} title={t('dashboard.no_interviews')} size="sm" />
      ) : (
        <div className="space-y-3">
          {interviews.slice(0, 6).map(iv => {
            const TypeIcon = typeIcons[iv.interview_type] || MapPin
            return (
              <div key={iv.id} className="flex items-center gap-4 p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors">
                <div className="w-12 h-12 rounded-[14px] bg-white dark:bg-[#1c1c1e] flex flex-col items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-[10px] font-bold text-[#ff9f0a] uppercase leading-none">
                    {new Date(iv.interview_date + 'T00:00:00').toLocaleDateString(localeTag(locale), { month: 'short' })}
                  </span>
                  <span className="text-[18px] font-bold text-black dark:text-white leading-tight">
                    {new Date(iv.interview_date + 'T00:00:00').getDate()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-black dark:text-white truncate">{iv.candidate_name}</p>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {iv.job_title}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {iv.interview_time && (
                    <span className="text-[13px] font-medium text-gray-500 dark:text-gray-400">{iv.interview_time}</span>
                  )}
                  <TypeIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusColors[iv.status] || statusColors.geplant}`}>
                    {iv.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
