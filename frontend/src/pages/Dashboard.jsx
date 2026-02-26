import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Users, GitCompare, TrendingUp, TrendingDown, Clock, ArrowRight, MapPin, BarChart2, Activity, Briefcase, AlertTriangle, CheckCircle, Share2, ShieldAlert, Calendar, Video, Phone } from 'lucide-react'
import { candidatesApi, matchingApi, pipelineApi, healthApi, settingsApi, interviewsApi } from '../api'
import { Card, ScoreRing, LoadingSpinner } from '../components/UI'
import { useWidgetConfig } from '../hooks/useWidgetConfig'
import WidgetConfigurator from '../components/WidgetConfigurator'
import { useAuth } from '../AuthContext'

const PERIOD_OPTIONS = [
  { value: 7, label: '7 Tage' },
  { value: 30, label: '30 Tage' },
  { value: 90, label: '90 Tage' },
]

export default function Dashboard() {
  const { isAdmin } = useAuth()
  const [stats, setStats] = useState(null)
  const [recentMatches, setRecentMatches] = useState([])
  const [activePipelines, setActivePipelines] = useState([])
  const [sourceStats, setSourceStats] = useState(null)
  const [dsgvoData, setDsgvoData] = useState(null)
  const [upcomingInterviews, setUpcomingInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [n8nStatus, setN8nStatus] = useState(null)
  const [periodDays, setPeriodDays] = useState(30)
  const { widgets, visibleWidgets, toggleWidget, reorder, resetToDefault } = useWidgetConfig()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsData, historyData, pipelineData, healthData, sourceData] = await Promise.all([
        candidatesApi.getStats(periodDays).catch(() => ({ totalCandidates: 0, newThisWeek: 0, topLocations: [] })),
        matchingApi.getHistory().catch(() => ({ data: [] })),
        pipelineApi.getActiveJobs().catch(() => ({ data: [] })),
        healthApi.check().catch(() => ({ n8nStatus: 'unreachable' })),
        candidatesApi.getSourceStats().catch(() => ({ sources: [], total: 0 })),
      ])
      const dsgvoResult = await settingsApi.getExpired().catch(() => null)
      const interviewsResult = await interviewsApi.getUpcoming().catch(() => ({ data: [] }))
      setDsgvoData(dsgvoResult)
      setUpcomingInterviews(interviewsResult.data || [])
      setStats(statsData)
      setRecentMatches(historyData.data?.slice(0, 4) || [])
      setActivePipelines(pipelineData.data || [])
      setN8nStatus(healthData.n8nStatus || healthData.services?.n8n || 'unknown')
      setSourceStats(sourceData)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [periodDays])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <LoadingSpinner text="Dashboard wird geladen..." />

  return (
    <div className="fade-in space-y-8 sm:space-y-14">
      {/* n8n Warning */}
      {n8nStatus && n8nStatus !== 'ok' && (
        <div className="flex items-center gap-4 p-5 sm:p-6 rounded-[20px] bg-[#ff9f0a]/10 border border-[#ff9f0a]/20">
          <AlertTriangle className="w-6 h-6 text-[#ff9f0a] flex-shrink-0" />
          <div>
            <p className="text-[15px] sm:text-[17px] font-semibold text-[#ff9f0a]">n8n nicht erreichbar</p>
            <p className="text-[13px] sm:text-[15px] text-gray-500 dark:text-gray-400 mt-1">KI-Matching und CV-Analyse sind derzeit nicht verfügbar. Bitte prüfe ob n8n läuft.</p>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">Übersicht</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">Willkommen zurück. Hier ist der aktuelle Stand.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full p-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriodDays(opt.value)}
                className={`px-4 py-2 rounded-full text-[13px] font-semibold transition-all duration-300 cursor-pointer ${
                  periodDays === opt.value
                    ? 'bg-white dark:bg-[#3a3a3c] text-[#0071e3] dark:text-[#0a84ff] shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <WidgetConfigurator
          widgets={widgets}
          onToggle={toggleWidget}
          onReorder={reorder}
          onReset={resetToDefault}
        />
        </div>
      </div>

      {/* Render widgets in configured order */}
      {visibleWidgets.map(widget => {
        switch (widget.id) {
          case 'stats': return <StatsWidget key="stats" stats={stats} periodDays={periodDays} />
          case 'pipelines': return activePipelines.length > 0 ? <PipelinesWidget key="pipelines" pipelines={activePipelines} /> : null
          case 'matches': return <MatchesAndLocationsWidget key="matches" matches={recentMatches} stats={stats} visibleWidgets={visibleWidgets} />
          case 'locations': return null // rendered inside matches when both visible, standalone otherwise handled below
          case 'sources': return sourceStats?.sources?.length > 0 ? <SourcesWidget key="sources" sourceStats={sourceStats} /> : null
          case 'dsgvo': return (dsgvoData && isAdmin) ? <DSGVOWidget key="dsgvo" data={dsgvoData} /> : null
          case 'calendar': return <CalendarWidget key="calendar" interviews={upcomingInterviews} />
          default: return null
        }
      })}

      {/* Render standalone locations if matches is hidden but locations visible */}
      {visibleWidgets.some(w => w.id === 'locations') && !visibleWidgets.some(w => w.id === 'matches') && (
        <Card className="p-12">
          <LocationsContent stats={stats} />
        </Card>
      )}
    </div>
  )
}

/* === Widget Components === */

function StatsWidget({ stats, periodDays }) {
  const periodLabel = periodDays === 7 ? 'zur Vorwoche' : periodDays === 30 ? 'zum Vormonat' : 'zum Vorzeitraum'
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
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">Bewerber gesamt</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.totalCandidates || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${mTrend.color}15` }}>
            <mTrend.icon className="w-4 h-4" style={{ color: mTrend.color }} />
          </div>
          <span className="text-[15px] font-medium" style={{ color: mTrend.color }}>{mTrend.text} diesen Monat</span>
        </div>
      </Card>

      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">Neue ({periodDays} Tage)</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.newThisWeek || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${wTrend.color}15` }}>
            <wTrend.icon className="w-4 h-4" style={{ color: wTrend.color }} />
          </div>
          <span className="text-[15px] font-medium" style={{ color: wTrend.color }}>{wTrend.text} {periodLabel}</span>
        </div>
      </Card>

      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">Matchings</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.matchingsTotal || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${maTrend.color}15` }}>
            <maTrend.icon className="w-4 h-4" style={{ color: maTrend.color }} />
          </div>
          <span className="text-[15px] font-medium" style={{ color: maTrend.color }}>{maTrend.text} {periodLabel}</span>
        </div>
      </Card>

      <Card className="p-10">
        <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-6">Offene Stellen</p>
        <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black dark:text-white mb-8">{stats?.openJobs || 0}</h3>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#8b5cf6]/10 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-[#8b5cf6]" />
          </div>
          {stats?.closedThisMonth > 0 ? (
            <span className="text-[15px] font-medium text-[#34c759]">{stats.closedThisMonth} besetzt diesen Monat</span>
          ) : (
            <Link to="/jobs" className="text-[15px] font-medium text-[#8b5cf6] hover:opacity-70 transition-opacity">Stellen verwalten</Link>
          )}
        </div>
      </Card>
    </div>
  )
}

function PipelinesWidget({ pipelines }) {
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
          <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">Aktive Pipelines</h2>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">Stellen mit Bewerbern in der Pipeline</p>
        </div>
        <Link to="/jobs" className="text-[16px] font-medium text-[#0071e3] hover:text-[#0077ed] flex items-center gap-2 transition-colors">
          Alle Stellen <ArrowRight className="w-5 h-5" />
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

function LocationsContent({ stats }) {
  return (
    <>
      <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white mb-2">Top Standorte</h2>
      <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-12">Nach Bewerberherkunft</p>
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
        <p className="text-[18px] text-gray-500 dark:text-gray-400 text-center py-12">Keine Daten verfügbar</p>
      )}
    </>
  )
}

function MatchesAndLocationsWidget({ matches, stats, visibleWidgets }) {
  const showLocations = visibleWidgets.some(w => w.id === 'locations')
  return (
    <div className={`grid grid-cols-1 ${showLocations ? 'lg:grid-cols-3' : ''} gap-8`}>
      <Card className={`${showLocations ? 'lg:col-span-2' : ''} p-12`}>
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">Letzte Matchings</h2>
          <Link to="/history" className="text-[16px] font-medium text-[#0071e3] hover:text-[#0077ed] flex items-center gap-2 transition-colors">
            Alle anzeigen <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
        {matches.length === 0 ? (
          <p className="text-[18px] text-gray-500 dark:text-gray-400 py-12 text-center">Noch keine Matchings durchgeführt</p>
        ) : (
          <div className="space-y-4">
            {matches.map((match) => {
              const topScore = match.results?.results?.[0]?.score || 0
              return (
                <Link key={match.id} to={`/matching/results/${match.id}`} className="block">
                  <div className="flex items-center justify-between p-6 rounded-[24px] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-all duration-300 border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50">
                    <div className="flex items-center gap-8">
                      <div className="w-16 h-16 rounded-full bg-white dark:bg-[#1c1c1e] shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-center">
                        <GitCompare className="w-7 h-7 text-black dark:text-white" />
                      </div>
                      <div>
                        <p className="text-[20px] font-semibold tracking-tight text-black dark:text-white">{match.job_title}</p>
                        <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          {new Date(match.created_at).toLocaleDateString('de-DE')}
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
          <LocationsContent stats={stats} />
        </Card>
      )}
    </div>
  )
}

function SourcesWidget({ sourceStats }) {
  const colors = ['#0071e3', '#34c759', '#ff9500', '#5856d6', '#ff3b30', '#30d158', '#ff2d55', '#007aff', '#af52de']
  return (
    <Card className="p-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h2 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">Quellen-Analyse</h2>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">Woher kommen die Bewerber? Welche Quelle liefert die besten Ergebnisse?</p>
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
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s.percentage}%`, backgroundColor: color }} />
              </div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-gray-500 dark:text-gray-400"><span className="font-semibold text-black dark:text-white">{s.count}</span> Bewerber</span>
                {s.hired > 0 && (
                  <span className="text-[#34c759] font-semibold">{s.hired} Hired ({s.hiredRate}%)</span>
                )}
                {s.hired === 0 && s.inProcess > 0 && (
                  <span className="text-[#ff9500] font-medium">{s.inProcess} in Prozess</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function DSGVOWidget({ data }) {
  const isClean = data.expiredCount === 0
  return (
    <Card className="p-6 sm:p-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className={`w-5 h-5 ${isClean ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`} />
          <h2 className="text-[20px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white">DSGVO-Status</h2>
        </div>
        <Link to="/admin/dsgvo" className="text-[15px] font-medium text-[#0071e3] hover:underline flex items-center gap-1">
          Verwalten <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {isClean ? (
        <div className="flex items-center gap-4 p-5 rounded-[16px] bg-[#34c759]/5">
          <CheckCircle className="w-8 h-8 text-[#34c759]" />
          <div>
            <p className="text-[16px] font-semibold text-[#34c759]">Alles konform</p>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">Keine Bewerber mit abgelaufener Aufbewahrungsfrist ({data.retentionMonths} Monate)</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 p-5 rounded-[16px] bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
          <div className="w-14 h-14 rounded-full bg-[#ff9f0a]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[22px] font-bold text-[#ff9f0a]">{data.expiredCount}</span>
          </div>
          <div>
            <p className="text-[16px] font-semibold text-[#ff9f0a]">Handlungsbedarf</p>
            <p className="text-[14px] text-gray-500 dark:text-gray-400">
              {data.expiredCount} Bewerber haben die Aufbewahrungsfrist von {data.retentionMonths} Monaten überschritten
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

function CalendarWidget({ interviews }) {
  const typeIcons = { 'Video': Video, 'Telefon': Phone, 'vor Ort': MapPin }
  const statusColors = {
    geplant: 'bg-[#0071e3]/10 text-[#0071e3]',
    bestätigt: 'bg-[#34c759]/10 text-[#34c759]',
    abgeschlossen: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
    abgesagt: 'bg-[#ff3b30]/10 text-[#ff3b30]',
  }

  return (
    <Card className="p-6 sm:p-10">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#ff9f0a]" />
          <h2 className="text-[20px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white">Anstehende Interviews</h2>
        </div>
        <span className="px-3 py-1 rounded-full bg-[#ff9f0a]/10 text-[#ff9f0a] text-[14px] font-bold">
          {interviews.length}
        </span>
      </div>

      {interviews.length === 0 ? (
        <p className="text-[15px] text-gray-500 dark:text-gray-400 text-center py-8">Keine anstehenden Interviews in den nächsten 14 Tagen</p>
      ) : (
        <div className="space-y-3">
          {interviews.slice(0, 6).map(iv => {
            const TypeIcon = typeIcons[iv.interview_type] || MapPin
            return (
              <div key={iv.id} className="flex items-center gap-4 p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors">
                <div className="w-12 h-12 rounded-[14px] bg-white dark:bg-[#1c1c1e] flex flex-col items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-[10px] font-bold text-[#ff9f0a] uppercase leading-none">
                    {new Date(iv.interview_date + 'T00:00:00').toLocaleDateString('de-DE', { month: 'short' })}
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
                    <span className="text-[13px] font-medium text-gray-500">{iv.interview_time}</span>
                  )}
                  <TypeIcon className="w-4 h-4 text-gray-400" />
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
