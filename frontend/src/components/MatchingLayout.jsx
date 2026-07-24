import { Outlet, Link } from 'react-router-dom'
import { LayoutGrid } from 'lucide-react'
import MatchingTabs from './MatchingTabs'
import { useI18n } from '../I18nContext'

/**
 * Wraps the three matching sub-pages (job / candidate / matrix) with a shared
 * segmented tab bar so users can switch modes without leaving the section.
 * A single sidebar entry ("Matching") leads here.
 */
export default function MatchingLayout() {
  const { t } = useI18n()

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <MatchingTabs />
        <Link
          to="/matching"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[14px] font-semibold text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors self-start sm:self-auto"
        >
          <LayoutGrid className="w-4 h-4" />
          {t('matching.back_to_overview')}
        </Link>
      </div>
      <Outlet />
    </div>
  )
}
