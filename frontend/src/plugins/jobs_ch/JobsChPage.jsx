import JobsChPanel from './JobsChPanel'
import { useI18n } from '../../I18nContext'

export default function JobsChPage() {
  const { t } = useI18n()

  return (
    <div className="max-w-[1200px] mx-auto fade-in">
      <div className="mb-8 sm:mb-12">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('nav.jobs_ch')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-2">
          {t('tools.jobs_ch_subtitle')}
        </p>
      </div>
      <JobsChPanel />
    </div>
  )
}
