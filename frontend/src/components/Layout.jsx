import { useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { LayoutDashboard, Users, GitCompare, History, Plus, Command, Briefcase, LogOut, Shield, Menu, X, Moon, Sun } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useTheme } from '../ThemeContext'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Übersicht' },
  { to: '/candidates', icon: Users, label: 'Bewerber' },
  { to: '/jobs', icon: Briefcase, label: 'Stellen' },
  { to: '/matching', icon: GitCompare, label: 'Matching' },
  { to: '/history', icon: History, label: 'Historie' },
]

export default function Layout() {
  const { user, logout, isAdmin } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen bg-[#f5f5f7] dark:bg-black overflow-hidden selection:bg-[#0071e3] selection:text-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-[280px] flex-shrink-0 flex flex-col py-8 lg:py-10 px-6 lg:px-8
        bg-[#f5f5f7] dark:bg-black lg:bg-transparent
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center justify-between lg:justify-start gap-4 px-2 mb-10 lg:mb-14">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-black dark:bg-white rounded-[14px] flex items-center justify-center shadow-md">
              <Command className="w-5 h-5 text-white dark:text-black" />
            </div>
            <span className="text-[22px] font-semibold tracking-tight text-black dark:text-white">HR System</span>
          </div>
          <button
            onClick={closeSidebar}
            className="lg:hidden w-10 h-10 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <nav className="flex-1 space-y-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-4 px-5 py-3.5 rounded-2xl text-[16px] font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-white dark:bg-[#1c1c1e] text-[#0071e3] dark:text-[#0a84ff] shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-200/60 dark:border-gray-700/60'
                    : 'text-gray-500 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 hover:text-black dark:hover:text-white border border-transparent'
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
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-4 px-5 py-3.5 rounded-2xl text-[16px] font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-white dark:bg-[#1c1c1e] text-[#0071e3] dark:text-[#0a84ff] shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-200/60 dark:border-gray-700/60'
                    : 'text-gray-500 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 hover:text-black dark:hover:text-white border border-transparent'
                }`
              }
            >
              <Shield className="w-5 h-5" />
              Benutzer
            </NavLink>
          )}
        </nav>

        <div className="mt-auto pt-10 space-y-3">
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] text-gray-600 dark:text-gray-300 rounded-2xl text-[15px] font-medium transition-all duration-300 cursor-pointer"
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>
          <Link to="/candidates/new" onClick={closeSidebar} className="flex items-center justify-center gap-2 w-full py-4 bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black rounded-2xl text-[16px] font-medium transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 duration-300">
            <Plus className="w-5 h-5" />
            Neuer Eintrag
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-white dark:bg-[#1c1c1e] rounded-none lg:rounded-l-[48px] lg:my-4 lg:mr-4 shadow-[0_0_40px_rgba(0,0,0,0.03)] border-0 lg:border lg:border-gray-200/50 dark:lg:border-gray-700/50 overflow-hidden flex flex-col relative">
        {/* Top Bar */}
        <header className="h-16 sm:h-24 flex items-center justify-between lg:justify-end px-4 sm:px-8 lg:px-14 flex-shrink-0 bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-2xl border-b border-gray-100/50 dark:border-gray-800/50 z-10 sticky top-0">
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden w-10 h-10 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] flex items-center justify-center transition-colors cursor-pointer"
          >
            <Menu className="w-6 h-6 text-black dark:text-white" />
          </button>

          <div className="flex items-center gap-3 sm:gap-5">
            <div className="text-right hidden sm:block">
              <p className="text-[14px] sm:text-[16px] font-semibold text-black dark:text-white tracking-tight">{user?.display_name || user?.username}</p>
              <p className="text-[12px] sm:text-[14px] text-gray-500 font-medium">{user?.role === 'admin' ? 'Administrator' : 'Recruiter'}</p>
            </div>
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.display_name || user?.username}`} alt="Profile" className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-100 border border-gray-200 shadow-sm" />
            <button onClick={logout} className="p-2 sm:p-2.5 text-gray-400 hover:text-[#ff3b30] hover:bg-red-50 rounded-xl transition-all" title="Abmelden">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-[1200px] mx-auto p-4 sm:p-8 lg:p-14">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
