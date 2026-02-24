import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, GitCompare, TrendingUp, TrendingDown, Clock, ArrowRight, MapPin, BarChart2, Activity, Briefcase } from 'lucide-react'
import { candidatesApi, matchingApi, jobsApi } from '../api'
import { Card, ScoreRing, LoadingSpinner } from '../components/UI'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentMatches, setRecentMatches] = useState([])
  const [openJobsCount, setOpenJobsCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const [statsData, historyData, jobsData] = await Promise.all([
          candidatesApi.getStats().catch(() => ({ totalCandidates: 0, newThisWeek: 0, topLocations: [] })),
          matchingApi.getHistory().catch(() => ({ data: [] })),
          jobsApi.getAll('Offen').catch(() => ({ jobs: [] }))
        ])
        setStats(statsData)
        setRecentMatches(historyData.data?.slice(0, 4) || [])
        setOpenJobsCount((jobsData.jobs || []).length)
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
    <div className="fade-in space-y-14">
      <div className="mb-4">
        <h1 className="text-[40px] font-semibold tracking-tight text-black">Übersicht</h1>
        <p className="text-[18px] text-gray-500 mt-3">Willkommen zurück. Hier ist der aktuelle Stand.</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <Card className="p-10">
          <p className="text-[16px] font-medium text-gray-500 mb-6">Bewerber gesamt</p>
          <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.totalCandidates || 0}</h3>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#34c759]/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-[#34c759]" />
            </div>
            <span className="text-[15px] font-medium text-[#34c759]">+25% diesen Monat</span>
          </div>
        </Card>

        <Card className="p-10">
          <p className="text-[16px] font-medium text-gray-500 mb-6">Neue diese Woche</p>
          <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.newThisWeek || 0}</h3>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#34c759]/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-[#34c759]" />
            </div>
            <span className="text-[15px] font-medium text-[#34c759]">+15% zur Vorwoche</span>
          </div>
        </Card>

        <Card className="p-10">
          <p className="text-[16px] font-medium text-gray-500 mb-6">Matchings</p>
          <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{recentMatches.length}</h3>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#ff3b30]/10 flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-[#ff3b30]" />
            </div>
            <span className="text-[15px] font-medium text-[#ff3b30]">-5% zur Vorwoche</span>
          </div>
        </Card>

        <Card className="p-10">
          <p className="text-[16px] font-medium text-gray-500 mb-6">Offene Stellen</p>
          <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{openJobsCount}</h3>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#8b5cf6]/10 flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-[#8b5cf6]" />
            </div>
            <Link to="/jobs" className="text-[15px] font-medium text-[#8b5cf6] hover:opacity-70 transition-opacity">Stellen verwalten</Link>
          </div>
        </Card>
      </div>

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
          <h2 className="text-[28px] font-semibold tracking-tight text-black mb-12">Top Standorte</h2>
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
