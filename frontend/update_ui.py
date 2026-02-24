import os

files = {}

files["src/index.css"] = r"""@import "tailwindcss";

@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

:root {
  --color-bg: #f4f7fe;
  --color-sidebar: #110e2d;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  background-color: var(--color-bg);
  color: #0f172a;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  line-height: 1.6;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Score ring animation */
@keyframes scoreRing {
  from { stroke-dashoffset: 283; }
}

.score-ring {
  animation: scoreRing 1.5s ease-out forwards;
}

/* Fade in animation */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.fade-in {
  animation: fadeIn 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.fade-in > * {
  opacity: 0;
  animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
.fade-in > *:nth-child(1) { animation-delay: 0ms; }
.fade-in > *:nth-child(2) { animation-delay: 60ms; }
.fade-in > *:nth-child(3) { animation-delay: 120ms; }
.fade-in > *:nth-child(4) { animation-delay: 180ms; }
.fade-in > *:nth-child(5) { animation-delay: 240ms; }

/* Pulse animation for loading */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(14, 165, 233, 0.2); }
  50% { box-shadow: 0 0 24px rgba(14, 165, 233, 0.4); }
}

.pulse-glow {
  animation: pulse-glow 2s ease-in-out infinite;
}
"""

files["src/components/Layout.jsx"] = r"""import { NavLink, Outlet, Link } from 'react-router-dom'
import { 
  LayoutDashboard, Users, GitCompare, History,
  Menu, Plus, Hexagon
} from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/candidates', icon: Users, label: 'Bewerber' },
  { to: '/matching', icon: GitCompare, label: 'Matching' },
  { to: '/history', icon: History, label: 'Historie' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#f4f7fe] font-sans">
      {/* Sidebar */}
      <aside className="w-[280px] flex-shrink-0 bg-[#110e2d] flex flex-col text-white">
        {/* Logo */}
        <div className="px-8 py-10 flex items-center gap-3">
          <Hexagon className="w-8 h-8 text-[#0ea5e9] fill-[#0ea5e9]" />
          <h1 className="text-2xl font-bold tracking-wide">Acme</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-0 py-4 space-y-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-4 px-8 py-4 text-base font-medium transition-all duration-200 border-l-4 ${
                  isActive
                    ? 'text-[#0ea5e9] border-[#0ea5e9] bg-white/5'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border-transparent'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom Action */}
        <div className="p-8">
          <Link to="/candidates/new" className="flex items-center justify-center gap-2 w-full py-4 bg-[#0ea5e9] hover:bg-[#0284c7] text-white rounded-xl font-semibold transition-colors shadow-lg shadow-sky-500/30">
            <Plus className="w-5 h-5" />
            Add new entry
          </Link>
        </div>
      </aside>

      {/* Main content wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-24 bg-white flex items-center justify-between px-10 flex-shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-4 text-slate-500">
            <Menu className="w-6 h-6 cursor-pointer hover:text-slate-800" />
            <span className="text-base font-medium">Hide Menu</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <span className="text-base font-semibold text-slate-700">Marcus White</span>
              <div className="w-12 h-12 rounded-full bg-slate-200 overflow-hidden border-2 border-white shadow-sm">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus" alt="Avatar" className="w-full h-full object-cover" />
              </div>
            </div>
          </div>
        </header>

        {/* Main scrollable area */}
        <main className="flex-1 overflow-auto p-10">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
"""

files["src/components/UI.jsx"] = r"""export function ScoreRing({ score, size = 80, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score * circumference)
  
  const getColor = (s) => {
    if (s >= 0.8) return '#22c55e'  // green
    if (s >= 0.6) return '#0ea5e9'  // sky blue
    if (s >= 0.4) return '#eab308'  // yellow
    return '#ef4444'                 // red
  }

  const color = getColor(score)

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="score-ring"
        />
      </svg>
      <span className="absolute font-bold text-slate-700" style={{ fontSize: size * 0.22 }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  )
}

export function ScoreBadge({ score }) {
  const getStyle = (s) => {
    if (s >= 0.8) return 'bg-green-100 text-green-700'
    if (s >= 0.6) return 'bg-sky-100 text-sky-700'
    if (s >= 0.4) return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${getStyle(score)}`}>
      {score.toFixed(2)}
    </span>
  )
}

export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div 
      className={`bg-white rounded-2xl shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] border border-slate-100 ${hover ? 'hover:shadow-md transition-shadow' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', className = '', disabled, ...props }) {
  const variants = {
    primary: 'bg-[#0ea5e9] hover:bg-[#0284c7] text-white shadow-md shadow-sky-500/20',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
    danger: 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
    ghost: 'hover:bg-slate-100 text-slate-600',
  }

  const sizes = {
    sm: 'px-4 py-2 text-sm rounded-xl',
    md: 'px-6 py-3 text-base rounded-xl',
    lg: 'px-8 py-4 text-lg rounded-xl',
  }

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 
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
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-semibold text-slate-700">
          {label}
        </label>
      )}
      <input
        className={`w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl 
          text-slate-900 text-base placeholder:text-slate-400
          focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 focus:bg-white
          transition-all duration-200 ${className}`}
        {...props}
      />
    </div>
  )
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-semibold text-slate-700">
          {label}
        </label>
      )}
      <textarea
        className={`w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl 
          text-slate-900 text-base placeholder:text-slate-400
          focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 focus:bg-white
          transition-all duration-200 resize-y min-h-[140px] leading-relaxed ${className}`}
        {...props}
      />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {Icon && (
        <div className="w-20 h-20 rounded-2xl bg-slate-50 flex items-center justify-center mb-6">
          <Icon className="w-10 h-10 text-slate-400" />
        </div>
      )}
      <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
      {description && (
        <p className="text-base text-slate-500 max-w-md mb-8 leading-relaxed">{description}</p>
      )}
      {action}
    </div>
  )
}

export function LoadingSpinner({ text = 'Laden...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin mb-4" />
      <p className="text-base font-medium text-slate-500">{text}</p>
    </div>
  )
}
"""

files["src/pages/Dashboard.jsx"] = r"""import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, GitCompare, TrendingUp, TrendingDown, Clock, ArrowRight, MapPin, BarChart2, DollarSign, Activity } from 'lucide-react'
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
    <div className="fade-in space-y-10">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <Card className="p-8">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-4xl font-bold text-slate-800">{stats?.totalCandidates || 0}</h3>
              <p className="text-base text-slate-500 mt-2 font-medium">Bewerber gesamt</p>
              <div className="flex items-center gap-2 mt-8">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-sm font-bold text-green-500">25%</span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-2xl bg-[#eab308] flex items-center justify-center shadow-lg shadow-yellow-500/20">
              <BarChart2 className="w-8 h-8 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-8">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-4xl font-bold text-slate-800">{stats?.newThisWeek || 0}</h3>
              <p className="text-base text-slate-500 mt-2 font-medium">Neue diese Woche</p>
              <div className="flex items-center gap-2 mt-8">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-sm font-bold text-green-500">15%</span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-2xl bg-[#0ea5e9] flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Users className="w-8 h-8 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-8">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-4xl font-bold text-slate-800">{recentMatches.length}</h3>
              <p className="text-base text-slate-500 mt-2 font-medium">Matchings</p>
              <div className="flex items-center gap-2 mt-8">
                <TrendingDown className="w-5 h-5 text-red-500" />
                <span className="text-sm font-bold text-red-500">5%</span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-2xl bg-[#22c55e] flex items-center justify-center shadow-lg shadow-green-500/20">
              <GitCompare className="w-8 h-8 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-8">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-4xl font-bold text-slate-800">{stats?.topLocations?.length || 0}</h3>
              <p className="text-base text-slate-500 mt-2 font-medium">Standorte</p>
              <div className="flex items-center gap-2 mt-8">
                <Activity className="w-5 h-5 text-sky-500" />
                <span className="text-sm font-bold text-sky-500">Aktiv</span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-2xl bg-[#8b5cf6] flex items-center justify-center shadow-lg shadow-purple-500/20">
              <MapPin className="w-8 h-8 text-white" />
            </div>
          </div>
        </Card>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Matches */}
        <Card className="lg:col-span-2 p-10">
          <div className="flex items-center justify-between mb-10">
            <h2 className="text-2xl font-bold text-slate-800">Letzte Matchings</h2>
            <Link to="/history" className="text-base font-semibold text-sky-500 hover:text-sky-600 flex items-center gap-2">
              Alle anzeigen <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          {recentMatches.length === 0 ? (
            <p className="text-lg text-slate-500 py-10 text-center">Noch keine Matchings durchgeführt</p>
          ) : (
            <div className="space-y-6">
              {recentMatches.map((match) => {
                const topScore = match.results?.results?.[0]?.score || 0
                return (
                  <Link key={match.id} to={`/matching/results/${match.id}`}>
                    <div className="flex items-center justify-between p-6 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                      <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-full bg-sky-100 flex items-center justify-center">
                          <GitCompare className="w-7 h-7 text-sky-600" />
                        </div>
                        <div>
                          <p className="text-xl font-bold text-slate-800">{match.job_title}</p>
                          <p className="text-base font-medium text-slate-500 mt-1 flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {new Date(match.created_at).toLocaleDateString('de-DE')}
                          </p>
                        </div>
                      </div>
                      <ScoreRing score={topScore} size={64} strokeWidth={5} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        {/* Top Locations */}
        <Card className="p-10">
          <h2 className="text-2xl font-bold text-slate-800 mb-10">Top Standorte</h2>
          {stats?.topLocations?.length > 0 ? (
            <div className="space-y-8">
              {stats.topLocations.map(({ location, count }, idx) => (
                <div key={location} className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xl
                      ${idx === 0 ? 'bg-sky-100 text-sky-600' : 
                        idx === 1 ? 'bg-purple-100 text-purple-600' : 
                        'bg-slate-100 text-slate-600'}`}>
                      {idx + 1}
                    </div>
                    <span className="text-lg font-semibold text-slate-700">{location}</span>
                  </div>
                  <span className="text-2xl font-bold text-slate-800">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-lg text-slate-500 text-center py-10">Keine Daten verfügbar</p>
          )}
        </Card>
      </div>
    </div>
  )
}
"""

files["src/pages/Candidates.jsx"] = r"""import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  Plus, Search, Trash2, Edit3, MapPin, Briefcase, 
  GraduationCap, Globe, Award, Car, ChevronDown
} from 'lucide-react'
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
    <div className="fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Bewerberkartei</h1>
          <p className="text-slate-500 mt-2 text-base font-medium">
            {candidates.length} Bewerber in der Datenbank
          </p>
        </div>
        <Link to="/candidates/new">
          <Button size="lg">
            <Plus className="w-5 h-5" />
            Neuer Bewerber
          </Button>
        </Link>
      </div>

      {/* Search */}
      <Card className="p-4 mb-8">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400" />
          <input
            type="text"
            placeholder="Suche nach Name, Skills, Standort..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-16 pr-6 py-4 bg-slate-50 border-none rounded-xl 
              text-slate-800 text-lg font-medium placeholder:text-slate-400
              focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all"
          />
        </div>
      </Card>

      {/* Candidates List */}
      {loading ? (
        <LoadingSpinner text="Bewerber werden geladen..." />
      ) : candidates.length === 0 ? (
        <Card className="p-12">
          <EmptyState
            icon={Briefcase}
            title="Keine Bewerber gefunden"
            description={search ? 'Passe deine Suche an oder füge neue Bewerber hinzu.' : 'Starte indem du deinen ersten Bewerber anlegst.'}
            action={
              <Link to="/candidates/new">
                <Button size="lg"><Plus className="w-5 h-5" /> Bewerber anlegen</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {candidates.map((candidate) => (
            <Card key={candidate.id} className="overflow-hidden" hover>
              {/* Main row */}
              <div 
                className="flex items-center justify-between p-6 cursor-pointer"
                onClick={() => setExpandedId(expandedId === candidate.id ? null : candidate.id)}
              >
                <div className="flex items-center gap-6 flex-1 min-w-0">
                  {/* Avatar */}
                  <div className="w-16 h-16 rounded-2xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xl font-bold text-sky-600">
                      {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-slate-800 truncate">{candidate.name}</h3>
                    <div className="flex items-center gap-6 mt-2 flex-wrap">
                      {candidate.location && (
                        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
                          <MapPin className="w-4 h-4" /> {candidate.location}
                        </span>
                      )}
                      {candidate.availability && (
                        <span className="text-sm font-bold text-green-500">{candidate.availability}</span>
                      )}
                    </div>
                  </div>

                  {/* Skills pills */}
                  {candidate.skills && (
                    <div className="hidden md:flex items-center gap-2 flex-wrap max-w-md">
                      {candidate.skills.split(',').slice(0, 3).map((skill, i) => (
                        <span key={i} className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold">
                          {skill.trim()}
                        </span>
                      ))}
                      {candidate.skills.split(',').length > 3 && (
                        <span className="text-sm font-bold text-slate-400">
                          +{candidate.skills.split(',').length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); navigate(`/candidates/${candidate.id}/edit`) }}
                  >
                    <Edit3 className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(candidate.id) }}
                  >
                    <Trash2 className="w-5 h-5 text-red-500" />
                  </Button>
                  <div className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors ml-2">
                    <ChevronDown className={`w-6 h-6 text-slate-400 transition-transform duration-300 ${expandedId === candidate.id ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {expandedId === candidate.id && (
                <div className="px-8 pb-8 pt-2 border-t border-slate-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-8">
                    {candidate.email && (
                      <DetailItem label="E-Mail" value={candidate.email} />
                    )}
                    {candidate.phone && (
                      <DetailItem label="Telefon" value={candidate.phone} />
                    )}
                    {candidate.education && (
                      <DetailItem label="Ausbildung" value={candidate.education} icon={GraduationCap} />
                    )}
                    {candidate.languages && (
                      <DetailItem label="Sprachen" value={candidate.languages} icon={Globe} />
                    )}
                    {candidate.certificates && (
                      <DetailItem label="Zertifikate" value={candidate.certificates} icon={Award} />
                    )}
                    {candidate.drivers_license && (
                      <DetailItem label="Führerschein" value={candidate.drivers_license} icon={Car} />
                    )}
                    {candidate.mobility && (
                      <DetailItem label="Mobilität" value={candidate.mobility} />
                    )}
                    {candidate.desired_salary && (
                      <DetailItem label="Gehaltsvorstellung" value={candidate.desired_salary} />
                    )}
                  </div>
                  {candidate.experience && (
                    <div className="mt-8">
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Berufserfahrung</p>
                      <p className="text-base text-slate-700 bg-slate-50 rounded-xl p-6 whitespace-pre-wrap leading-relaxed">
                        {candidate.experience}
                      </p>
                    </div>
                  )}
                  {candidate.notes && (
                    <div className="mt-6">
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Notizen</p>
                      <p className="text-base text-slate-600 bg-yellow-50 rounded-xl p-6 whitespace-pre-wrap leading-relaxed">
                        {candidate.notes}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Delete confirmation */}
              {deleteConfirm === candidate.id && (
                <div className="px-8 py-4 flex items-center justify-end gap-4 border-t border-red-100 bg-red-50">
                  <span className="text-base font-semibold text-red-600 mr-auto">Bewerber wirklich löschen?</span>
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
    <div className="flex items-start gap-3">
      {Icon && <Icon className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />}
      <div>
        <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-base font-medium text-slate-800 mt-1">{value}</p>
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
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          location: data.location || '',
          experience: data.experience || '',
          skills: data.skills || '',
          education: data.education || '',
          desired_salary: data.desired_salary || '',
          availability: data.availability || '',
          languages: data.languages || '',
          certificates: data.certificates || '',
          drivers_license: data.drivers_license || '',
          mobility: data.mobility || '',
          notes: data.notes || '',
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
    <div className="fade-in max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-6 mb-10">
        <button onClick={() => navigate('/candidates')} className="p-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-slate-600" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-slate-800">
            {isEdit ? 'Bewerber bearbeiten' : 'Neuer Bewerber'}
          </h1>
          <p className="text-slate-500 mt-2 text-base font-medium">
            {isEdit ? 'Daten des Bewerbers aktualisieren' : 'Neuen Bewerber in der Kartei anlegen'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-6 rounded-xl bg-red-50 border border-red-200 text-red-600 text-base font-medium mb-8">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Personal Info */}
        <Card className="p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6">Persönliche Daten</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input label="Name *" placeholder="Max Mustermann" value={form.name} onChange={handleChange('name')} required />
            <Input label="E-Mail" type="email" placeholder="max@example.com" value={form.email} onChange={handleChange('email')} />
            <Input label="Telefon" placeholder="+49 171 1234567" value={form.phone} onChange={handleChange('phone')} />
            <Input label="Wohnort" placeholder="Berlin" value={form.location} onChange={handleChange('location')} />
          </div>
        </Card>

        {/* Professional Info */}
        <Card className="p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6">Berufliches Profil</h2>
          <div className="space-y-6">
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

        {/* Extended Info */}
        <Card className="p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-6">Erweiterte Informationen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input label="Sprachen" placeholder="Deutsch (C2), Englisch (C1)" value={form.languages} onChange={handleChange('languages')} />
            <Input label="Führerschein" placeholder="B, BE" value={form.drivers_license} onChange={handleChange('drivers_license')} />
            <Input label="Mobilität" placeholder="Bundesweit, Remote bevorzugt" value={form.mobility} onChange={handleChange('mobility')} />
            <Input label="Gehaltsvorstellung" placeholder="55.000 - 65.000 € p.a." value={form.desired_salary} onChange={handleChange('desired_salary')} />
            <Input label="Verfügbarkeit" placeholder="Ab sofort / 3 Monate Kündigungsfrist" value={form.availability} onChange={handleChange('availability')} />
          </div>
        </Card>

        {/* Notes */}
        <Card className="p-8">
          <Textarea 
            label="Notizen" 
            placeholder="Interne Notizen zum Bewerber..."
            value={form.notes} 
            onChange={handleChange('notes')}
            rows={3}
          />
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-4 pt-4">
          <Button variant="secondary" size="lg" type="button" onClick={() => navigate('/candidates')}>
            Abbrechen
          </Button>
          <Button type="submit" size="lg" disabled={saving || !form.name.trim()}>
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
import { 
  GitCompare, FileText, Users, Search, CheckSquare, 
  Square, Loader2, Zap 
} from 'lucide-react'
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
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
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
    !searchTerm || 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.skills && c.skills.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  if (loading) return <LoadingSpinner text="Bewerber werden geladen..." />

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-slate-800">Stellen-Matching</h1>
        <p className="text-slate-500 mt-2 text-base font-medium">
          Füge eine Stellenbeschreibung ein und finde die passendsten Bewerber
        </p>
      </div>

      {error && (
        <div className="p-6 rounded-xl bg-red-50 border border-red-200 text-red-600 text-base font-medium mb-8">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Job Description - Left side */}
        <div className="lg:col-span-2">
          <Card className="p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center">
                <FileText className="w-6 h-6 text-sky-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Stellenbeschreibung</h2>
            </div>

            <Input
              label="Stellentitel"
              placeholder="z.B. Senior Frontend Developer (m/w/d)"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />

            <div className="mt-6">
              <Textarea
                label="Stellenbeschreibung"
                placeholder={`Füge hier die vollständige Stellenbeschreibung ein...\n\nBeispiel:\n- Aufgaben und Verantwortlichkeiten\n- Anforderungen und Qualifikationen\n- Gewünschte Skills\n- Standort und Arbeitsmodell`}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={16}
              />
            </div>
          </Card>
        </div>

        {/* Candidate Selection - Right side */}
        <div className="space-y-6">
          <Card className="p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                <Users className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">Bewerberauswahl</h2>
                <p className="text-sm font-medium text-slate-500 mt-1">
                  {selectedIds.length} / {candidates.length} ausgewählt
                </p>
              </div>
            </div>

            {candidates.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Keine Bewerber"
                description="Lege zuerst Bewerber an."
                action={
                  <Button variant="secondary" size="md" onClick={() => navigate('/candidates/new')}>
                    Bewerber anlegen
                  </Button>
                }
              />
            ) : (
              <>
                {/* Search */}
                <div className="relative mb-4">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filtern..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl 
                      text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 focus:bg-white transition-all"
                  />
                </div>

                {/* Select All */}
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-sm font-bold text-slate-600 cursor-pointer mb-2"
                >
                  {selectAll ? (
                    <CheckSquare className="w-5 h-5 text-sky-500" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-300" />
                  )}
                  Alle auswählen
                </button>

                {/* Candidate list */}
                <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
                  {filteredCandidates.map(candidate => (
                    <button
                      key={candidate.id}
                      onClick={() => toggleCandidate(candidate.id)}
                      className="flex items-center gap-4 w-full px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-left cursor-pointer"
                    >
                      {selectedIds.includes(candidate.id) ? (
                        <CheckSquare className="w-5 h-5 text-sky-500 flex-shrink-0" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-300 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-base font-bold text-slate-800 truncate">{candidate.name}</p>
                        {candidate.skills && (
                          <p className="text-sm font-medium text-slate-500 truncate mt-0.5">
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

          {/* Match Button */}
          <Button
            className="w-full"
            size="lg"
            disabled={matching || !jobDescription.trim() || candidates.length === 0}
            onClick={handleMatch}
          >
            {matching ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Matching läuft...
              </>
            ) : (
              <>
                <Zap className="w-6 h-6" />
                Matching starten
              </>
            )}
          </Button>

          {matching && (
            <Card className="p-6 pulse-glow border-sky-200 bg-sky-50">
              <div className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full bg-sky-500 animate-pulse" />
                <div>
                  <p className="text-sm font-bold text-sky-900">KI analysiert...</p>
                  <p className="text-sm font-medium text-sky-700 mt-1">
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
import { 
  ArrowLeft, ThumbsUp, ThumbsDown, User, MapPin, 
  Clock, FileText, ChevronDown, ChevronUp, Trophy, Target, BarChart3 
} from 'lucide-react'
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
    <div className="text-center py-24">
      <p className="text-red-500 font-medium mb-6 text-lg">{error}</p>
      <Button variant="secondary" size="lg" onClick={() => navigate('/history')}>Zurück zur Historie</Button>
    </div>
  )

  const results = data?.results?.results || []
  const matchedAt = data?.results?.matchedAt || data?.created_at
  const bestScore = results[0]?.score || 0
  const avgScore = results.length > 0
    ? results.reduce((s, r) => s + r.score, 0) / results.length
    : 0
  const topCount = results.filter(r => r.score >= 0.8).length

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="flex items-center gap-6 mb-10">
        <button onClick={() => navigate(-1)} className="p-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-slate-800">Matching-Ergebnisse</h1>
          <div className="flex items-center gap-6 mt-2">
            <span className="text-base font-medium text-slate-500">{data?.job_title}</span>
            {matchedAt && (
              <span className="flex items-center gap-2 text-sm font-medium text-slate-400">
                <Clock className="w-4 h-4" />
                {new Date(matchedAt).toLocaleString('de-DE')}
              </span>
            )}
          </div>
        </div>
        <Link to="/matching">
          <Button size="lg">Neues Matching</Button>
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
        <Card className="p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-4xl font-bold text-slate-800">{results.length}</p>
              <p className="text-base font-medium text-slate-500 mt-2">Geprüft</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center">
              <User className="w-7 h-7 text-purple-600" />
            </div>
          </div>
        </Card>
        <Card className="p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-4xl font-bold text-green-500">
                {bestScore ? (bestScore * 100).toFixed(0) + '%' : '-'}
              </p>
              <p className="text-base font-medium text-slate-500 mt-2">Best Match</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
              <Trophy className="w-7 h-7 text-green-600" />
            </div>
          </div>
        </Card>
        <Card className="p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-4xl font-bold text-sky-500">
                {results.length > 0 ? (avgScore * 100).toFixed(0) + '%' : '-'}
              </p>
              <p className="text-base font-medium text-slate-500 mt-2">Durchschnitt</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-sky-100 flex items-center justify-center">
              <BarChart3 className="w-7 h-7 text-sky-600" />
            </div>
          </div>
        </Card>
        <Card className="p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-4xl font-bold text-yellow-500">{topCount}</p>
              <p className="text-base font-medium text-slate-500 mt-2">Top (≥80%)</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-yellow-100 flex items-center justify-center">
              <Target className="w-7 h-7 text-yellow-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Results List */}
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-6">Ranking</h2>
        <div className="space-y-6">
          {results.map((result, idx) => (
            <Card key={result.candidateId || idx} className="overflow-hidden" hover>
              <div
                className="flex items-center gap-8 p-8 cursor-pointer"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              >
                {/* Rank */}
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl font-bold
                  ${idx === 0 ? 'bg-yellow-100 text-yellow-600' : 
                    idx === 1 ? 'bg-slate-200 text-slate-600' : 
                    idx === 2 ? 'bg-orange-100 text-orange-600' : 
                    'bg-slate-50 text-slate-400'}`
                }>
                  {idx + 1}
                </div>

                {/* Score Ring */}
                <ScoreRing score={result.score} size={80} strokeWidth={6} />

                {/* Name & Summary */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-4">
                    <h3 className="text-2xl font-bold text-slate-800">{result.candidateName}</h3>
                    <ScoreBadge score={result.score} />
                  </div>
                  <p className="text-base font-medium text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                    {result.summary}
                  </p>
                </div>

                {/* Expand arrow */}
                <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center hover:bg-slate-50 transition-colors">
                  {expandedIdx === idx ? (
                    <ChevronUp className="w-6 h-6 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-6 h-6 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expandedIdx === idx && (
                <div className="px-8 pb-8 border-t border-slate-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 pt-8">
                    {/* Strengths */}
                    {result.strengths?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-3 mb-5">
                          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                            <ThumbsUp className="w-5 h-5 text-green-600" />
                          </div>
                          <h4 className="text-sm font-bold text-green-600 uppercase tracking-wider">Stärken</h4>
                        </div>
                        <ul className="space-y-4">
                          {result.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-3 text-base font-medium text-slate-700 leading-relaxed">
                              <span className="w-2 h-2 rounded-full bg-green-500 mt-2.5 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Weaknesses */}
                    {result.weaknesses?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-3 mb-5">
                          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                            <ThumbsDown className="w-5 h-5 text-red-600" />
                          </div>
                          <h4 className="text-sm font-bold text-red-600 uppercase tracking-wider">Schwächen</h4>
                        </div>
                        <ul className="space-y-4">
                          {result.weaknesses.map((w, i) => (
                            <li key={i} className="flex items-start gap-3 text-base font-medium text-slate-700 leading-relaxed">
                              <span className="w-2 h-2 rounded-full bg-red-500 mt-2.5 flex-shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {results.length === 0 && (
        <Card className="p-16 text-center mt-8">
          <p className="text-lg font-medium text-slate-500">Keine Ergebnisse verfügbar.</p>
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
    <div className="fade-in">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-slate-800">Matching-Historie</h1>
        <p className="text-slate-500 mt-2 text-base font-medium">Vergangene Matching-Durchläufe</p>
      </div>

      {results.length === 0 ? (
        <Card className="p-12">
          <EmptyState
            icon={HistoryIcon}
            title="Noch keine Matchings"
            description="Starte dein erstes Matching um Ergebnisse zu sehen."
            action={
              <Link to="/matching">
                <Button size="lg">Matching starten</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {results.map((result) => {
            const matchResults = result.results?.results || []
            const topScore = matchResults[0]?.score || 0
            const avgScore = matchResults.length > 0
              ? matchResults.reduce((s, r) => s + r.score, 0) / matchResults.length
              : 0

            return (
              <Card key={result.id} className="p-8" hover>
                <div className="flex items-center gap-8">
                  <ScoreRing score={topScore} size={72} strokeWidth={5} />

                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-slate-800">{result.job_title}</h3>
                    <div className="flex items-center gap-6 mt-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-500">
                        <Clock className="w-4 h-4" />
                        {new Date(result.created_at).toLocaleString('de-DE')}
                      </span>
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-500">
                        <Users className="w-4 h-4" />
                        {matchResults.length} Bewerber
                      </span>
                      <span className="text-sm font-bold text-sky-500">
                        ∅ {(avgScore * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Top 3 candidates preview */}
                    {matchResults.length > 0 && (
                      <div className="flex items-center gap-4 mt-3">
                        {matchResults.slice(0, 3).map((r, i) => (
                          <span key={i} className="text-sm font-medium text-slate-500">
                            {i + 1}. {r.candidateName} 
                            <span className={`ml-1 font-bold ${r.score >= 0.7 ? 'text-green-500' : 'text-yellow-500'}`}>
                              ({(r.score * 100).toFixed(0)}%)
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="md" onClick={() => handleDelete(result.id)}>
                      <Trash2 className="w-5 h-5 text-red-500" />
                    </Button>
                    <Link to={`/matching/results/${result.id}`}>
                      <Button variant="secondary" size="md">
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
print("UI updated successfully!")
