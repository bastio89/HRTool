import { NavLink, Outlet, Link } from 'react-router-dom'
import { LayoutDashboard, Users, GitCompare, History, Plus, Command, Briefcase, LogOut, Shield } from 'lucide-react'
import { useAuth } from '../AuthContext'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Übersicht' },
  { to: '/candidates', icon: Users, label: 'Bewerber' },
  { to: '/jobs', icon: Briefcase, label: 'Stellen' },
  { to: '/matching', icon: GitCompare, label: 'Matching' },
  { to: '/history', icon: History, label: 'Historie' },
]

export default function Layout() {
  const { user, logout, isAdmin } = useAuth()
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
          {isAdmin && (
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `flex items-center gap-4 px-5 py-3.5 rounded-2xl text-[16px] font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-white text-[#0071e3] shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-200/60'
                    : 'text-gray-500 hover:bg-gray-200/50 hover:text-black border border-transparent'
                }`
              }
            >
              <Shield className="w-5 h-5" />
              Benutzer
            </NavLink>
          )}
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
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-[16px] font-semibold text-black tracking-tight">{user?.display_name || user?.username}</p>
              <p className="text-[14px] text-gray-500 font-medium">{user?.role === 'admin' ? 'Administrator' : 'Recruiter'}</p>
            </div>
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.display_name || user?.username}`} alt="Profile" className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 shadow-sm" />
            <button onClick={logout} className="p-2.5 text-gray-400 hover:text-[#ff3b30] hover:bg-red-50 rounded-xl transition-all" title="Abmelden">
              <LogOut className="w-5 h-5" />
            </button>
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
