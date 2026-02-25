import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, GitCompare, TrendingUp, TrendingDown, Clock, ArrowRight, MapPin, BarChart2, Activity, Briefcase, AlertTriangle, CheckCircle } from 'lucide-react'
import { candidatesApi, matchingApi, pipelineApi, healthApi } from '../api'
import { Card, ScoreRing, LoadingSpinner } from '../components/UI'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentMatches, setRecentMatches] = useState([])
  const [activePipelines, setActivePipelines] = useState([])
  const [loading, setLoading] = useState(true)
  const [n8nStatus, setN8nStatus] = useState(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [statsData, historyData, pipelineData, healthData] = await Promise.all([
          candidatesApi.getStats().catch(() => ({ totalCandidates: 0, newThisWeek: 0, topLocations: [] })),
          matchingApi.getHistory().catch(() => ({ data: [] })),
          pipelineApi.getActiveJobs().catch(() => ({ data: [] })),
          healthApi.check().catch(() => ({ n8nStatus: 'unreachable' })),
        ])
        setStats(statsData)
        setRecentMatches(historyData.data?.slice(0, 4) || [])
        setActivePipelines(pipelineData.data || [])
        setN8nStatus(healthData.n8nStatus || healthData.services?.n8n || 'unknown')
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) return <LoadingSpinner text="Dashboard wird geladen..." />

  return (
    <div className="fade-in space-y-8 sm:space-y-14">
      {/* n8n Warning */}
      {n8nStatus && n8nStatus !== 'ok' && (
        <div className="flex items-center gap-4 p-5 sm:p-6 rounded-[20px] bg-[#ff9f0a]/10 border border-[#ff9f0a]/20">
          <AlertTriangle className="w-6 h-6 text-[#ff9f0a] flex-shrink-0" />
          <div>
            <p className="text-[15px] sm:text-[17px] font-semibold text-[#ff9f0a]">n8n nicht erreichbar</p>
            <p className="text-[13px] sm:text-[15px] text-gray-500 mt-1">KI-Matching und CV-Analyse sind derzeit nicht verfügbar. Bitte prüfe ob n8n läuft.</p>
          </div>
        </div>
      )}

      <div className="mb-4">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black">Übersicht</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 mt-1 sm:mt-3">Willkommen zurück. Hier ist der aktuelle Stand.</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {(() => {
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
          return <>
            <Card className="p-10">
              <p className="text-[16px] font-medium text-gray-500 mb-6">Bewerber gesamt</p>
              <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.totalCandidates || 0}</h3>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${mTrend.color}15` }}>
                  <mTrend.icon className="w-4 h-4" style={{ color: mTrend.color }} />
                </div>
                <span className="text-[15px] font-medium" style={{ color: mTrend.color }}>{mTrend.text} diesen Monat</span>
              </div>
            </Card>

            <Card className="p-10">
              <p className="text-[16px] font-medium text-gray-500 mb-6">Neue diese Woche</p>
              <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.newThisWeek || 0}</h3>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${wTrend.color}15` }}>
                  <wTrend.icon className="w-4 h-4" style={{ color: wTrend.color }} />
                </div>
                <span className="text-[15px] font-medium" style={{ color: wTrend.color }}>{wTrend.text} zur Vorwoche</span>
              </div>
            </Card>

            <Card className="p-10">
              <p className="text-[16px] font-medium text-gray-500 mb-6">Matchings</p>
              <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.matchingsTotal || 0}</h3>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${maTrend.color}15` }}>
                  <maTrend.icon className="w-4 h-4" style={{ color: maTrend.color }} />
                </div>
                <span className="text-[15px] font-medium" style={{ color: maTrend.color }}>{maTrend.text} zur Vorwoche</span>
              </div>
            </Card>

            <Card className="p-10">
              <p className="text-[16px] font-medium text-gray-500 mb-6">Offene Stellen</p>
              <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.openJobs || 0}</h3>
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
          </>
        })()}
      </div>

      {/* Active Pipelines */}
      {activePipelines.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-[28px] font-semibold tracking-tight text-black">Aktive Pipelines</h2>
              <p className="text-[15px] text-gray-500 mt-1">Stellen mit Bewerbern in der Pipeline</p>
            </div>
            <Link to="/jobs" className="text-[16px] font-medium text-[#0071e3] hover:text-[#0077ed] flex items-center gap-2 transition-colors">
              Alle Stellen <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activePipelines.map(job => {
              const stageColors = {
                'Beworben': 'bg-[#007aff]/10 text-[#007aff]',
                'Vorauswahl': 'bg-[#5856d6]/10 text-[#5856d6]',
                'Interview': 'bg-[#ff9500]/10 text-[#ff9500]',
                'Angebot': 'bg-[#34c759]/10 text-[#34c759]',
                'Hired': 'bg-[#30d158]/10 text-[#30d158]',
                'Abgesagt': 'bg-[#ff3b30]/10 text-[#ff3b30]',
              }
              return (
                <Link key={job.id} to={`/pipeline/${job.id}`}>
                  <Card hover className="p-8 h-full">
                    <div className="flex items-start gap-5 mb-6">
                      <div className="w-12 h-12 rounded-full bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
                        <Briefcase className="w-6 h-6 text-[#0071e3]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[18px] font-semibold tracking-tight text-black truncate">{job.title}</p>
                        {job.location && (
                          <p className="text-[14px] font-medium text-gray-500 mt-1 flex items-center gap-1.5">
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
                        <span key={stage} className={`px-3 py-1 rounded-full text-[13px] font-semibold ${stageColors[stage] || 'bg-gray-100 text-gray-600'}`}>
                          {count} {stage}
                        </span>
                      ))}
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Matches */}
        <Card className="lg:col-span-2 p-12">
          <div className="flex items-center justify-between mb-12">
            <h2 className="text-[28px] font-semibold tracking-tight text-black">Letzte Matchings</h2>
            <Link to="/history" className="text-[16px] font-medium text-[#0071e3] hover:text-[#0077ed] flex items-center gap-2 transition-colors">
              Alle anzeigen <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          {recentMatches.length === 0 ? (
            <p className="text-[18px] text-gray-500 py-12 text-center">Noch keine Matchings durchgeführt</p>
          ) : (
            <div className="space-y-4">
              {recentMatches.map((match) => {
                const topScore = match.results?.results?.[0]?.score || 0
                return (
                  <Link key={match.id} to={`/matching/results/${match.id}`} className="block">
                    <div className="flex items-center justify-between p-6 rounded-[24px] hover:bg-[#f5f5f7] transition-all duration-300 border border-transparent hover:border-gray-200/50">
                      <div className="flex items-center gap-8">
                        <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center">
                          <GitCompare className="w-7 h-7 text-black" />
                        </div>
                        <div>
                          <p className="text-[20px] font-semibold tracking-tight text-black">{match.job_title}</p>
                          <p className="text-[15px] font-medium text-gray-500 mt-2 flex items-center gap-2">
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

        {/* Top Locations */}
        <Card className="p-12">
          <h2 className="text-[28px] font-semibold tracking-tight text-black mb-2">Top Standorte</h2>
          <p className="text-[15px] text-gray-500 mb-12">Nach Bewerberherkunft</p>
          {stats?.topLocations?.length > 0 ? (
            <div className="space-y-8">
              {stats.topLocations.map(({ location, count }, idx) => (
                <div key={location} className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="w-12 h-12 rounded-full bg-[#f5f5f7] flex items-center justify-center font-semibold text-[18px] text-gray-500">
                      {idx + 1}
                    </div>
                    <span className="text-[18px] font-medium text-black">{location}</span>
                  </div>
                  <span className="text-[22px] font-semibold tracking-tight text-black">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[18px] text-gray-500 text-center py-12">Keine Daten verfügbar</p>
          )}
        </Card>
      </div>
    </div>
  )
}
