import { useNavigate } from 'react-router-dom'
import { FileText, UserSearch, GitCompare, ArrowRight } from 'lucide-react'
import { Card } from '../components/UI'
import { useI18n } from '../I18nContext'

const MODES = [
  { to: '/matching/job', icon: FileText, titleKey: 'matching.mode_job_title', descKey: 'matching.mode_job_desc', color: '#0071e3' },
  { to: '/matching/candidate', icon: UserSearch, titleKey: 'matching.mode_candidate_title', descKey: 'matching.mode_candidate_desc', color: '#34c759' },
  { to: '/matching/matrix', icon: GitCompare, titleKey: 'matching.mode_matrix_title', descKey: 'matching.mode_matrix_desc', color: '#8b5cf6' },
]

/**
 * Landing page for the matching section. Shows the three matching methods as
 * full-width cards. Each leads to its own dedicated page.
 */
export default function MatchingHub() {
  const navigate = useNavigate()
  const { t } = useI18n()

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      <div className="mb-8 sm:mb-14">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('matching.hub_title')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('matching.hub_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
        {MODES.map(({ to, icon: Icon, titleKey, descKey, color }) => (
          <button key={to} type="button" onClick={() => navigate(to)} className="text-left group cursor-pointer">
            <Card className="p-8 sm:p-10 h-full flex flex-col transition-all duration-300 group-hover:shadow-lg group-hover:-translate-y-1">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-8"
                style={{ backgroundColor: `${color}1a` }}
              >
                <Icon className="w-8 h-8" style={{ color }} />
              </div>
              <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t(titleKey)}</h2>
              <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-3 leading-relaxed flex-1">{t(descKey)}</p>
              <span
                className="inline-flex items-center gap-2 mt-8 text-[15px] font-semibold transition-transform group-hover:translate-x-1"
                style={{ color }}
              >
                {t('matching.open_mode')} <ArrowRight className="w-4 h-4" />
              </span>
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}
