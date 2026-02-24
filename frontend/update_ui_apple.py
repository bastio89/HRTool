import os

files = {}

files["src/index.css"] = r"""@import "tailwindcss";

:root {
  --apple-bg: #f5f5f7;
  --apple-text: #1d1d1f;
  --apple-blue: #0071e3;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--apple-bg);
  color: var(--apple-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  letter-spacing: -0.01em;
}

.fade-in {
  animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
"""

files["src/components/Layout.jsx"] = r"""import { NavLink, Outlet, Link } from 'react-router-dom'
import { LayoutDashboard, Users, GitCompare, History, Plus, Command } from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Übersicht' },
  { to: '/candidates', icon: Users, label: 'Bewerber' },
  { to: '/matching', icon: GitCompare, label: 'Matching' },
  { to: '/history', icon: History, label: 'Historie' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#f5f5f7] overflow-hidden selection:bg-[#0071e3] selection:text-white">
      {/* Sidebar */}
      <aside className="w-[280px] flex-shrink-0 flex flex-col py-10 px-8">
        <div className="flex items-center gap-4 px-2 mb-14">
          <div className="w-10 h-10 bg-black rounded-[14px] flex items-center justify-center shadow-md">
            <Command className="w-5 h-5 text-white" />
          </div>
          <span className="text-[22px] font-semibold tracking-tight text-black">HR System</span>
        </div>

        <nav className="flex-1 space-y-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-4 px-5 py-3.5 rounded-2xl text-[16px] font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-white text-[#0071e3] shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-200/60'
                    : 'text-gray-500 hover:bg-gray-200/50 hover:text-black border border-transparent'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-10">
          <Link to="/candidates/new" className="flex items-center justify-center gap-2 w-full py-4 bg-black hover:bg-gray-800 text-white rounded-2xl text-[16px] font-medium transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 duration-300">
            <Plus className="w-5 h-5" />
            Neuer Eintrag
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-white rounded-l-[48px] my-4 mr-4 shadow-[0_0_40px_rgba(0,0,0,0.03)] border border-gray-200/50 overflow-hidden flex flex-col relative">
        {/* Top Bar */}
        <header className="h-24 flex items-center justify-end px-14 flex-shrink-0 bg-white/80 backdrop-blur-2xl border-b border-gray-100/50 z-10 sticky top-0">
          <div className="flex items-center gap-5 cursor-pointer hover:opacity-80 transition-opacity">
            <div className="text-right">
              <p className="text-[16px] font-semibold text-black tracking-tight">Marcus White</p>
              <p className="text-[14px] text-gray-500 font-medium">HR Manager</p>
            </div>
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus" alt="Profile" className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 shadow-sm" />
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1200px] mx-auto p-14">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
"""

files["src/components/UI.jsx"] = r"""export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div 
      className={`bg-white rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/80 p-10 ${hover ? 'hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-500' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', className = '', disabled, ...props }) {
  const variants = {
    primary: 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-sm',
    secondary: 'bg-[#f5f5f7] hover:bg-[#e8e8ed] text-black',
    danger: 'bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30]',
    ghost: 'hover:bg-[#f5f5f7] text-gray-500 hover:text-black',
    dark: 'bg-black hover:bg-gray-800 text-white shadow-sm',
  }

  const sizes = {
    sm: 'px-5 py-2.5 text-[14px] rounded-full',
    md: 'px-7 py-3.5 text-[16px] rounded-full',
    lg: 'px-9 py-4 text-[17px] rounded-full',
  }

  return (
    <button
      className={`inline-flex items-center justify-center gap-2.5 font-medium transition-all duration-300 
        ${variants[variant]} ${sizes[size]} 
        ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}
        ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ label, className = '', ...props }) {
  return (
    <div className="space-y-3">
      {label && (
        <label className="block text-[15px] font-medium text-gray-600 ml-2">
          {label}
        </label>
      )}
      <input
        className={`w-full px-6 py-4 bg-[#f5f5f7] border border-transparent rounded-[20px] 
          text-black text-[16px] placeholder:text-gray-400
          focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10
          transition-all duration-300 ${className}`}
        {...props}
      />
    </div>
  )
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <div className="space-y-3">
      {label && (
        <label className="block text-[15px] font-medium text-gray-600 ml-2">
          {label}
        </label>
      )}
      <textarea
        className={`w-full px-6 py-5 bg-[#f5f5f7] border border-transparent rounded-[24px] 
          text-black text-[16px] placeholder:text-gray-400
          focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10
          transition-all duration-300 resize-y min-h-[180px] leading-relaxed ${className}`}
        {...props}
      />
    </div>
  )
}

export function ScoreRing({ score, size = 80, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score * circumference)
  
  const getColor = (s) => {
    if (s >= 0.8) return '#34c759'
    if (s >= 0.6) return '#0071e3'
    if (s >= 0.4) return '#ff9f0a'
    return '#ff3b30'
  }

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f5f5f7" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={getColor(score)}
          strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <span className="absolute font-semibold text-black tracking-tight" style={{ fontSize: size * 0.24 }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  )
}

export function ScoreBadge({ score }) {
  const getStyle = (s) => {
    if (s >= 0.8) return 'bg-[#34c759]/10 text-[#34c759]'
    if (s >= 0.6) return 'bg-[#0071e3]/10 text-[#0071e3]'
    if (s >= 0.4) return 'bg-[#ff9f0a]/10 text-[#ff9f0a]'
    return 'bg-[#ff3b30]/10 text-[#ff3b30]'
  }

  return (
    <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-[14px] font-semibold tracking-wide ${getStyle(score)}`}>
      {score.toFixed(2)}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      {Icon && (
        <div className="w-24 h-24 rounded-full bg-[#f5f5f7] flex items-center justify-center mb-10">
          <Icon className="w-10 h-10 text-gray-400" />
        </div>
      )}
      <h3 className="text-[28px] font-semibold tracking-tight text-black mb-4">{title}</h3>
      {description && (
        <p className="text-[18px] text-gray-500 max-w-lg mb-12 leading-relaxed">{description}</p>
      )}
      {action}
    </div>
  )
}

export function LoadingSpinner({ text = 'Laden...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-40">
      <div className="w-12 h-12 border-4 border-gray-100 border-t-[#0071e3] rounded-full animate-spin mb-8" />
      <p className="text-[17px] font-medium text-gray-500">{text}</p>
    </div>
  )
}
"""

files["src/pages/Dashboard.jsx"] = r"""import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, GitCompare, TrendingUp, TrendingDown, Clock, ArrowRight, MapPin, BarChart2, Activity } from 'lucide-react'
import { candidatesApi, matchingApi } from '../api'
import { Card, ScoreRing, LoadingSpinner } from '../components/UI'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentMatches, setRecentMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const [statsData, historyData] = await Promise.all([
          candidatesApi.getStats().catch(() => ({ totalCandidates: 0, newThisWeek: 0, topLocations: [] })),
          matchingApi.getHistory().catch(() => ({ data: [] }))
        ])
        setStats(statsData)
        setRecentMatches(historyData.data?.slice(0, 4) || [])
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
          <p className="text-[16px] font-medium text-gray-500 mb-6">Standorte</p>
          <h3 className="text-[56px] leading-none font-semibold tracking-tight text-black mb-8">{stats?.topLocations?.length || 0}</h3>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-[#0071e3]" />
            </div>
            <span className="text-[15px] font-medium text-[#0071e3]">Aktiv</span>
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
"""

files["src/pages/Candidates.jsx"] = r"""import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Trash2, Edit3, MapPin, Briefcase, GraduationCap, Globe, Award, Car, ChevronDown } from 'lucide-react'
import { candidatesApi } from '../api'
import { Card, Button, EmptyState, LoadingSpinner } from '../components/UI'

export default function Candidates() {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const navigate = useNavigate()

  const loadCandidates = async (searchTerm = '') => {
    setLoading(true)
    try {
      const data = await candidatesApi.getAll(searchTerm)
      setCandidates(data.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCandidates()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => loadCandidates(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleDelete = async (id) => {
    try {
      await candidatesApi.delete(id)
      setCandidates(prev => prev.filter(c => c.id !== id))
      setDeleteConfirm(null)
    } catch (err) {
      alert('Fehler beim Löschen: ' + err.message)
    }
  }

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-14">
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight text-black">Bewerber</h1>
          <p className="text-[18px] text-gray-500 mt-3">
            {candidates.length} Profile in der Datenbank
          </p>
        </div>
        <Link to="/candidates/new">
          <Button size="lg" variant="dark">
            <Plus className="w-5 h-5" />
            Neuer Bewerber
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-12">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
        <input
          type="text"
          placeholder="Suche nach Name, Skills, Standort..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-16 pr-8 py-5 bg-[#f5f5f7] border border-transparent rounded-[24px] 
            text-black text-[18px] placeholder:text-gray-400
            focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all duration-300 shadow-sm"
        />
      </div>

      {/* Candidates List */}
      {loading ? (
        <LoadingSpinner text="Bewerber werden geladen..." />
      ) : candidates.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={Briefcase}
            title="Keine Bewerber gefunden"
            description={search ? 'Passe deine Suche an oder füge neue Bewerber hinzu.' : 'Starte indem du deinen ersten Bewerber anlegst.'}
            action={
              <Link to="/candidates/new">
                <Button size="lg" variant="dark"><Plus className="w-5 h-5" /> Bewerber anlegen</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {candidates.map((candidate) => (
            <Card key={candidate.id} className="overflow-hidden p-0" hover>
              {/* Main row */}
              <div 
                className="flex items-center justify-between p-8 cursor-pointer"
                onClick={() => setExpandedId(expandedId === candidate.id ? null : candidate.id)}
              >
                <div className="flex items-center gap-8 flex-1 min-w-0">
                  {/* Avatar */}
                  <div className="w-20 h-20 rounded-full bg-[#f5f5f7] flex items-center justify-center flex-shrink-0 border border-gray-200/50">
                    <span className="text-[22px] font-semibold text-gray-600 tracking-tight">
                      {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-[24px] font-semibold tracking-tight text-black truncate">{candidate.name}</h3>
                    <div className="flex items-center gap-6 mt-3 flex-wrap">
                      {candidate.location && (
                        <span className="flex items-center gap-2 text-[15px] font-medium text-gray-500">
                          <MapPin className="w-4 h-4" /> {candidate.location}
                        </span>
                      )}
                      {candidate.availability && (
                        <span className="text-[15px] font-medium text-[#34c759]">{candidate.availability}</span>
                      )}
                    </div>
                  </div>

                  {/* Skills pills */}
                  {candidate.skills && (
                    <div className="hidden md:flex items-center gap-3 flex-wrap max-w-md">
                      {candidate.skills.split(',').slice(0, 3).map((skill, i) => (
                        <span key={i} className="px-4 py-2 rounded-full bg-[#f5f5f7] text-gray-700 text-[14px] font-medium">
                          {skill.trim()}
                        </span>
                      ))}
                      {candidate.skills.split(',').length > 3 && (
                        <span className="text-[14px] font-medium text-gray-400 px-2">
                          +{candidate.skills.split(',').length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 ml-8">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-12 h-12 !p-0 rounded-full"
                    onClick={(e) => { e.stopPropagation(); navigate(`/candidates/${candidate.id}/edit`) }}
                  >
                    <Edit3 className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-12 h-12 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(candidate.id) }}
                  >
                    <Trash2 className="w-5 h-5" />
                  </Button>
                  <div className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors ml-2">
                    <ChevronDown className={`w-6 h-6 text-gray-400 transition-transform duration-400 ${expandedId === candidate.id ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedId === candidate.id ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-10 pb-10 pt-4 border-t border-gray-100/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 pt-8">
                    {candidate.email && <DetailItem label="E-Mail" value={candidate.email} />}
                    {candidate.phone && <DetailItem label="Telefon" value={candidate.phone} />}
                    {candidate.education && <DetailItem label="Ausbildung" value={candidate.education} icon={GraduationCap} />}
                    {candidate.languages && <DetailItem label="Sprachen" value={candidate.languages} icon={Globe} />}
                    {candidate.certificates && <DetailItem label="Zertifikate" value={candidate.certificates} icon={Award} />}
                    {candidate.drivers_license && <DetailItem label="Führerschein" value={candidate.drivers_license} icon={Car} />}
                    {candidate.mobility && <DetailItem label="Mobilität" value={candidate.mobility} />}
                    {candidate.desired_salary && <DetailItem label="Gehaltsvorstellung" value={candidate.desired_salary} />}
                  </div>
                  {candidate.experience && (
                    <div className="mt-12">
                      <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Berufserfahrung</p>
                      <p className="text-[16px] text-gray-700 bg-[#f5f5f7] rounded-[24px] p-8 whitespace-pre-wrap leading-relaxed">
                        {candidate.experience}
                      </p>
                    </div>
                  )}
                  {candidate.notes && (
                    <div className="mt-8">
                      <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Notizen</p>
                      <p className="text-[16px] text-gray-700 bg-[#ff9f0a]/10 rounded-[24px] p-8 whitespace-pre-wrap leading-relaxed">
                        {candidate.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete confirmation */}
              {deleteConfirm === candidate.id && (
                <div className="px-10 py-6 flex items-center justify-end gap-4 border-t border-[#ff3b30]/20 bg-[#ff3b30]/5">
                  <span className="text-[16px] font-medium text-[#ff3b30] mr-auto">Bewerber wirklich löschen?</span>
                  <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
                  <Button variant="danger" onClick={() => handleDelete(candidate.id)}>Löschen</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-4">
      {Icon && <Icon className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />}
      <div>
        <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
        <p className="text-[16px] font-medium text-black mt-1.5">{value}</p>
      </div>
    </div>
  )
}
"""

files["src/pages/CandidateForm.jsx"] = r"""import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { candidatesApi } from '../api'
import { Card, Button, Input, Textarea, LoadingSpinner } from '../components/UI'

const emptyCandidate = {
  name: '', email: '', phone: '', location: '',
  experience: '', skills: '', education: '',
  desired_salary: '', availability: '', languages: '',
  certificates: '', drivers_license: '', mobility: '', notes: ''
}

export default function CandidateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(emptyCandidate)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isEdit) {
      candidatesApi.getById(id)
        .then(data => setForm({
          name: data.name || '', email: data.email || '', phone: data.phone || '', location: data.location || '',
          experience: data.experience || '', skills: data.skills || '', education: data.education || '',
          desired_salary: data.desired_salary || '', availability: data.availability || '', languages: data.languages || '',
          certificates: data.certificates || '', drivers_license: data.drivers_license || '', mobility: data.mobility || '', notes: data.notes || '',
        }))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [id, isEdit])

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      if (isEdit) {
        await candidatesApi.update(id, form)
      } else {
        await candidatesApi.create(form)
      }
      navigate('/candidates')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner text="Bewerber wird geladen..." />

  return (
    <div className="fade-in max-w-[800px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-8 mb-14">
        <button onClick={() => navigate('/candidates')} className="w-12 h-12 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-black" />
        </button>
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight text-black">
            {isEdit ? 'Bewerber bearbeiten' : 'Neuer Bewerber'}
          </h1>
          <p className="text-[18px] text-gray-500 mt-2">
            {isEdit ? 'Daten des Bewerbers aktualisieren' : 'Neuen Bewerber in der Kartei anlegen'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10">
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black mb-8">Persönliche Daten</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label="Name *" placeholder="Max Mustermann" value={form.name} onChange={handleChange('name')} required />
            <Input label="E-Mail" type="email" placeholder="max@example.com" value={form.email} onChange={handleChange('email')} />
            <Input label="Telefon" placeholder="+49 171 1234567" value={form.phone} onChange={handleChange('phone')} />
            <Input label="Wohnort" placeholder="Berlin" value={form.location} onChange={handleChange('location')} />
          </div>
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black mb-8">Berufliches Profil</h2>
          <div className="space-y-8">
            <Textarea 
              label="Berufserfahrung" 
              placeholder="5 Jahre Software-Entwicklung bei Firma XY, davon 2 Jahre als Teamlead..."
              value={form.experience} 
              onChange={handleChange('experience')}
              rows={4}
            />
            <Input 
              label="Skills / Kompetenzen" 
              placeholder="JavaScript, React, Node.js, Python (kommagetrennt)"
              value={form.skills} 
              onChange={handleChange('skills')} 
            />
            <Input 
              label="Ausbildung" 
              placeholder="B.Sc. Informatik, Universität Berlin"
              value={form.education} 
              onChange={handleChange('education')} 
            />
            <Input 
              label="Zertifikate" 
              placeholder="AWS Solutions Architect, PMP, Scrum Master"
              value={form.certificates} 
              onChange={handleChange('certificates')} 
            />
          </div>
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black mb-8">Erweiterte Informationen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label="Sprachen" placeholder="Deutsch (C2), Englisch (C1)" value={form.languages} onChange={handleChange('languages')} />
            <Input label="Führerschein" placeholder="B, BE" value={form.drivers_license} onChange={handleChange('drivers_license')} />
            <Input label="Mobilität" placeholder="Bundesweit, Remote bevorzugt" value={form.mobility} onChange={handleChange('mobility')} />
            <Input label="Gehaltsvorstellung" placeholder="55.000 - 65.000 € p.a." value={form.desired_salary} onChange={handleChange('desired_salary')} />
            <Input label="Verfügbarkeit" placeholder="Ab sofort / 3 Monate Kündigungsfrist" value={form.availability} onChange={handleChange('availability')} />
          </div>
        </Card>

        <Card className="p-12">
          <Textarea 
            label="Notizen" 
            placeholder="Interne Notizen zum Bewerber..."
            value={form.notes} 
            onChange={handleChange('notes')}
            rows={3}
          />
        </Card>

        <div className="flex items-center justify-end gap-5 pt-6 pb-12">
          <Button variant="secondary" size="lg" type="button" onClick={() => navigate('/candidates')}>
            Abbrechen
          </Button>
          <Button variant="dark" type="submit" size="lg" disabled={saving || !form.name.trim()}>
            <Save className="w-5 h-5" />
            {saving ? 'Wird gespeichert...' : (isEdit ? 'Aktualisieren' : 'Anlegen')}
          </Button>
        </div>
      </form>
    </div>
  )
}
"""

files["src/pages/Matching.jsx"] = r"""import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitCompare, FileText, Users, Search, CheckSquare, Square, Loader2, Zap } from 'lucide-react'
import { candidatesApi, matchingApi } from '../api'
import { Card, Button, Textarea, Input, EmptyState, LoadingSpinner } from '../components/UI'

export default function Matching() {
  const navigate = useNavigate()
  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [selectAll, setSelectAll] = useState(true)
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    candidatesApi.getAll()
      .then(data => {
        setCandidates(data.data || [])
        setSelectedIds((data.data || []).map(c => c.id))
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const toggleCandidate = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setSelectAll(false)
  }

  const toggleAll = () => {
    if (selectAll) {
      setSelectedIds([])
      setSelectAll(false)
    } else {
      setSelectedIds(candidates.map(c => c.id))
      setSelectAll(true)
    }
  }

  const handleMatch = async () => {
    if (!jobDescription.trim()) {
      setError('Bitte füge eine Stellenbeschreibung ein.')
      return
    }
    const idsToMatch = selectedIds.length > 0 ? selectedIds : undefined
    setError('')
    setMatching(true)

    try {
      const result = await matchingApi.run(jobDescription, jobTitle, idsToMatch)
      navigate(`/matching/results/${result.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setMatching(false)
    }
  }

  const filteredCandidates = candidates.filter(c =>
    !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) || (c.skills && c.skills.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  if (loading) return <LoadingSpinner text="Bewerber werden geladen..." />

  return (
    <div className="fade-in max-w-[1200px] mx-auto">
      <div className="mb-14">
        <h1 className="text-[40px] font-semibold tracking-tight text-black">Stellen-Matching</h1>
        <p className="text-[18px] text-gray-500 mt-3">
          Füge eine Stellenbeschreibung ein und finde die passendsten Bewerber
        </p>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          <Card className="p-12 h-full">
            <div className="flex items-center gap-5 mb-10">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] flex items-center justify-center">
                <FileText className="w-6 h-6 text-black" />
              </div>
              <h2 className="text-[24px] font-semibold tracking-tight text-black">Stellenbeschreibung</h2>
            </div>

            <Input
              label="Stellentitel"
              placeholder="z.B. Senior Frontend Developer (m/w/d)"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />

            <div className="mt-8">
              <Textarea
                label="Stellenbeschreibung"
                placeholder={`Füge hier die vollständige Stellenbeschreibung ein...\n\nBeispiel:\n- Aufgaben und Verantwortlichkeiten\n- Anforderungen und Qualifikationen\n- Gewünschte Skills\n- Standort und Arbeitsmodell`}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={18}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="p-10">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] flex items-center justify-center">
                <Users className="w-6 h-6 text-black" />
              </div>
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight text-black">Bewerberauswahl</h2>
                <p className="text-[15px] font-medium text-gray-500 mt-1">
                  {selectedIds.length} / {candidates.length} ausgewählt
                </p>
              </div>
            </div>

            {candidates.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Keine Bewerber"
                description="Lege zuerst Bewerber an."
                action={<Button variant="secondary" size="md" onClick={() => navigate('/candidates/new')}>Bewerber anlegen</Button>}
              />
            ) : (
              <>
                <div className="relative mb-6">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Filtern..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-14 pr-5 py-4 text-[15px] bg-[#f5f5f7] border border-transparent rounded-[20px] 
                      text-black font-medium focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
                  />
                </div>

                <button
                  onClick={toggleAll}
                  className="flex items-center gap-4 w-full px-5 py-4 rounded-[20px] hover:bg-[#f5f5f7] transition-colors text-[15px] font-semibold text-gray-700 cursor-pointer mb-4"
                >
                  {selectAll ? <CheckSquare className="w-6 h-6 text-[#0071e3]" /> : <Square className="w-6 h-6 text-gray-300" />}
                  Alle auswählen
                </button>

                <div className="space-y-2 max-h-[450px] overflow-y-auto pr-2">
                  {filteredCandidates.map(candidate => (
                    <button
                      key={candidate.id}
                      onClick={() => toggleCandidate(candidate.id)}
                      className="flex items-center gap-5 w-full px-5 py-4 rounded-[20px] hover:bg-[#f5f5f7] transition-colors text-left cursor-pointer"
                    >
                      {selectedIds.includes(candidate.id) ? <CheckSquare className="w-6 h-6 text-[#0071e3] flex-shrink-0" /> : <Square className="w-6 h-6 text-gray-300 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold text-black truncate">{candidate.name}</p>
                        {candidate.skills && (
                          <p className="text-[14px] font-medium text-gray-500 truncate mt-1">
                            {candidate.skills}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Button
            className="w-full py-5 text-[18px]"
            variant="dark"
            disabled={matching || !jobDescription.trim() || candidates.length === 0}
            onClick={handleMatch}
          >
            {matching ? (
              <><Loader2 className="w-6 h-6 animate-spin" /> Matching läuft...</>
            ) : (
              <><Zap className="w-6 h-6" /> Matching starten</>
            )}
          </Button>

          {matching && (
            <Card className="p-8 border-[#0071e3]/20 bg-[#0071e3]/5">
              <div className="flex items-center gap-5">
                <div className="w-4 h-4 rounded-full bg-[#0071e3] animate-pulse" />
                <div>
                  <p className="text-[16px] font-semibold text-[#0071e3]">KI analysiert...</p>
                  <p className="text-[15px] font-medium text-[#0071e3]/70 mt-1">
                    {selectedIds.length || candidates.length} Bewerber werden abgeglichen.
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
"""

files["src/pages/MatchingResults.jsx"] = r"""import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ThumbsUp, ThumbsDown, User, Clock, ChevronDown, ChevronUp, Trophy, Target, BarChart3 } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, ScoreBadge, LoadingSpinner } from '../components/UI'

export default function MatchingResults() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    matchingApi.getResult(id)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <LoadingSpinner text="Ergebnisse werden geladen..." />
  if (error) return (
    <div className="text-center py-32">
      <p className="text-[#ff3b30] font-medium mb-8 text-[18px]">{error}</p>
      <Button variant="secondary" size="lg" onClick={() => navigate('/history')}>Zurück zur Historie</Button>
    </div>
  )

  const results = data?.results?.results || []
  const matchedAt = data?.results?.matchedAt || data?.created_at
  const bestScore = results[0]?.score || 0
  const avgScore = results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0
  const topCount = results.filter(r => r.score >= 0.8).length

  return (
    <div className="fade-in max-w-[1200px] mx-auto">
      <div className="flex items-center gap-8 mb-14">
        <button onClick={() => navigate(-1)} className="w-12 h-12 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-black" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[40px] font-semibold tracking-tight text-black">Matching-Ergebnisse</h1>
          <div className="flex items-center gap-6 mt-3">
            <span className="text-[18px] font-medium text-gray-500">{data?.job_title}</span>
            {matchedAt && (
              <span className="flex items-center gap-2 text-[15px] font-medium text-gray-400">
                <Clock className="w-4 h-4" />
                {new Date(matchedAt).toLocaleString('de-DE')}
              </span>
            )}
          </div>
        </div>
        <Link to="/matching">
          <Button size="lg" variant="dark">Neues Matching</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-black">{results.length}</p>
              <p className="text-[16px] font-medium text-gray-500 mt-4">Geprüft</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#f5f5f7] flex items-center justify-center">
              <User className="w-6 h-6 text-gray-600" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#34c759]">
                {bestScore ? (bestScore * 100).toFixed(0) + '%' : '-'}
              </p>
              <p className="text-[16px] font-medium text-gray-500 mt-4">Best Match</p>
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
              <p className="text-[16px] font-medium text-gray-500 mt-4">Durchschnitt</p>
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
              <p className="text-[16px] font-medium text-gray-500 mt-4">Top (≥80%)</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#ff9f0a]/10 flex items-center justify-center">
              <Target className="w-6 h-6 text-[#ff9f0a]" />
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-[28px] font-semibold tracking-tight text-black mb-8">Ranking</h2>
        <div className="space-y-6">
          {results.map((result, idx) => (
            <Card key={result.candidateId || idx} className="overflow-hidden p-0" hover>
              <div
                className="flex items-center gap-10 p-10 cursor-pointer"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 text-[20px] font-semibold
                  ${idx === 0 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 
                    idx === 1 ? 'bg-gray-100 text-gray-600' : 
                    idx === 2 ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 
                    'bg-[#f5f5f7] text-gray-400'}`
                }>
                  {idx + 1}
                </div>

                <ScoreRing score={result.score} size={88} strokeWidth={6} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-5">
                    <h3 className="text-[26px] font-semibold tracking-tight text-black">{result.candidateName}</h3>
                    <ScoreBadge score={result.score} />
                  </div>
                  <p className="text-[16px] font-medium text-gray-500 mt-3 line-clamp-2 leading-relaxed">
                    {result.summary}
                  </p>
                </div>

                <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center hover:bg-[#f5f5f7] transition-colors">
                  <ChevronDown className={`w-7 h-7 text-gray-400 transition-transform duration-500 ${expandedIdx === idx ? 'rotate-180' : ''}`} />
                </div>
              </div>

              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedIdx === idx ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-10 pb-10 border-t border-gray-100/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-10">
                    {result.strengths?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center">
                            <ThumbsUp className="w-6 h-6 text-[#34c759]" />
                          </div>
                          <h4 className="text-[14px] font-semibold text-[#34c759] uppercase tracking-widest">Stärken</h4>
                        </div>
                        <ul className="space-y-5">
                          {result.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-4 text-[16px] font-medium text-gray-700 leading-relaxed">
                              <span className="w-2 h-2 rounded-full bg-[#34c759] mt-2.5 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {result.weaknesses?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 rounded-full bg-[#ff3b30]/10 flex items-center justify-center">
                            <ThumbsDown className="w-6 h-6 text-[#ff3b30]" />
                          </div>
                          <h4 className="text-[14px] font-semibold text-[#ff3b30] uppercase tracking-widest">Schwächen</h4>
                        </div>
                        <ul className="space-y-5">
                          {result.weaknesses.map((w, i) => (
                            <li key={i} className="flex items-start gap-4 text-[16px] font-medium text-gray-700 leading-relaxed">
                              <span className="w-2 h-2 rounded-full bg-[#ff3b30] mt-2.5 flex-shrink-0" />
                              {w}
                            </li>
                          ))}
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
          <p className="text-[20px] font-medium text-gray-500">Keine Ergebnisse verfügbar.</p>
        </Card>
      )}
    </div>
  )
}
"""

files["src/pages/History.jsx"] = r"""import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { History as HistoryIcon, Trash2, Clock, Users, ArrowRight } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, EmptyState, LoadingSpinner } from '../components/UI'

export default function History() {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    matchingApi.getHistory()
      .then(data => setResults(data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id) => {
    try {
      await matchingApi.deleteResult(id)
      setResults(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      alert('Fehler: ' + err.message)
    }
  }

  if (loading) return <LoadingSpinner text="Historie wird geladen..." />

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      <div className="mb-14">
        <h1 className="text-[40px] font-semibold tracking-tight text-black">Matching-Historie</h1>
        <p className="text-[18px] text-gray-500 mt-3">Vergangene Matching-Durchläufe</p>
      </div>

      {results.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={HistoryIcon}
            title="Noch keine Matchings"
            description="Starte dein erstes Matching um Ergebnisse zu sehen."
            action={
              <Link to="/matching">
                <Button size="lg" variant="dark">Matching starten</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {results.map((result) => {
            const matchResults = result.results?.results || []
            const topScore = matchResults[0]?.score || 0
            const avgScore = matchResults.length > 0 ? matchResults.reduce((s, r) => s + r.score, 0) / matchResults.length : 0

            return (
              <Card key={result.id} className="p-10" hover>
                <div className="flex items-center gap-10">
                  <ScoreRing score={topScore} size={80} strokeWidth={6} />

                  <div className="flex-1 min-w-0">
                    <h3 className="text-[24px] font-semibold tracking-tight text-black">{result.job_title}</h3>
                    <div className="flex items-center gap-8 mt-3">
                      <span className="flex items-center gap-2.5 text-[15px] font-medium text-gray-500">
                        <Clock className="w-4 h-4" />
                        {new Date(result.created_at).toLocaleString('de-DE')}
                      </span>
                      <span className="flex items-center gap-2.5 text-[15px] font-medium text-gray-500">
                        <Users className="w-4 h-4" />
                        {matchResults.length} Bewerber
                      </span>
                      <span className="text-[15px] font-semibold text-[#0071e3]">
                        ∅ {(avgScore * 100).toFixed(0)}%
                      </span>
                    </div>

                    {matchResults.length > 0 && (
                      <div className="flex items-center gap-5 mt-4">
                        {matchResults.slice(0, 3).map((r, i) => (
                          <span key={i} className="text-[14px] font-medium text-gray-500">
                            {i + 1}. {r.candidateName} 
                            <span className={`ml-1.5 font-semibold ${r.score >= 0.7 ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`}>
                              ({(r.score * 100).toFixed(0)}%)
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <Button variant="ghost" size="md" className="w-12 h-12 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]" onClick={() => handleDelete(result.id)}>
                      <Trash2 className="w-5 h-5" />
                    </Button>
                    <Link to={`/matching/results/${result.id}`}>
                      <Button variant="secondary" size="md" className="rounded-full">
                        Details <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
"""

for path, content in files.items():
    with open(path, "w") as f:
        f.write(content)
print("Apple UI updated successfully!")
