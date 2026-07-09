import { NavLink } from 'react-router-dom'
import { FileText, UserSearch, GitCompare } from 'lucide-react'
import { useI18n } from '../I18nContext'

const TABS = [
  { to: '/matching/job', icon: FileText, labelKey: 'matching.tab_job' },
  { to: '/matching/candidate', icon: UserSearch, labelKey: 'matching.tab_candidate' },
  { to: '/matching/matrix', icon: GitCompare, labelKey: 'matching.tab_matrix' },
]

/**
 * Segmented control used at the top of every matching sub-page to switch
 * between the three matching modes while keeping a single sidebar entry.
 */
export default function MatchingTabs() {
  const { t } = useI18n()

  return (
    <div className="inline-flex flex-wrap gap-1.5 p-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px]">
      {TABS.map(({ to, icon: Icon, labelKey }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-5 py-3 rounded-[16px] text-[15px] font-semibold transition-all cursor-pointer ${
              isActive
                ? 'bg-white dark:bg-[#1c1c1e] text-black dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
            }`
          }
        >
          <Icon className="w-4 h-4" />
          {t(labelKey)}
        </NavLink>
      ))}
    </div>
  )
}
