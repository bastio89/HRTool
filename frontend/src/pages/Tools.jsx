import { Link } from 'react-router-dom'
import { Linkedin } from 'lucide-react'
import { useI18n } from '../I18nContext'
import { usePlugins } from '../plugins/PluginContext'
import JobsChPanel from '../plugins/jobs_ch/JobsChPanel'

export default function Tools() {
  const { t } = useI18n()
  const { isEnabled } = usePlugins()

  return (
    <div className="max-w-[1200px] mx-auto fade-in">
      <div className="mb-8 sm:mb-12">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('nav.jobs_ch')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-2">
          {t('tools.jobs_ch_subtitle')}
        </p>
      </div>

      <div className="grid gap-6">
        {isEnabled('jobs_ch') && <JobsChPanel />}

        {isEnabled('linkedin') && (
          <Link
            to="/tools/linkedin"
            className="group rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
                <Linkedin className="w-6 h-6 text-[#0077b5]" />
              </div>
              <div>
                <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('nav.linkedin')}</h2>
                <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{t('tools.linkedin_desc')}</p>
              </div>
            </div>
          </Link>
        )}
      </div>
    </div>
  )
}