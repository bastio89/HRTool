import { Search, Briefcase, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../I18nContext'

/**
 * Reusable job selection list for the matching pages.
 *
 * Props:
 * - jobs: array of { id, title, location, type, status }
 * - selectedJobId: number | null
 * - onSelect(job): select a job
 * - search, onSearch: controlled search input
 */
export default function JobPicker({ jobs, selectedJobId, onSelect, search, onSearch }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 rounded-[24px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
        <Briefcase className="w-10 h-10 text-gray-300 mb-4" />
        <p className="text-[17px] font-semibold text-gray-400">{t('matching.no_jobs')}</p>
        <button
          type="button"
          onClick={() => navigate('/jobs')}
          className="mt-5 px-6 py-3 rounded-full bg-black text-white text-[15px] font-semibold cursor-pointer hover:bg-gray-800 transition-colors"
        >
          {t('matching.manage_jobs')}
        </button>
      </div>
    )
  }

  const filtered = jobs.filter(j =>
    !search ||
    j.title.toLowerCase().includes(search.toLowerCase()) ||
    (j.location && j.location.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <>
      <div className="relative mb-5">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder={t('matching.search_jobs')}
          value={search}
          onChange={e => onSearch(e.target.value)}
          className="w-full pl-14 pr-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[15px] font-medium text-black dark:text-white border border-transparent
            focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
        />
      </div>
      <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
        {filtered.map(job => (
          <button
            key={job.id}
            type="button"
            onClick={() => onSelect(job)}
            className={`w-full flex items-center gap-5 p-5 rounded-[20px] text-left transition-all cursor-pointer ${
              selectedJobId === job.id
                ? 'bg-[#0071e3] text-white shadow-md'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] text-black dark:text-white'
            }`}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              selectedJobId === job.id ? 'bg-white/20' : 'bg-white dark:bg-[#1c1c1e]'
            }`}>
              <Briefcase className={`w-5 h-5 ${selectedJobId === job.id ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold truncate">{job.title}</p>
              <p className={`text-[13px] font-medium mt-0.5 truncate ${selectedJobId === job.id ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}>
                {[job.location, job.type, job.status].filter(Boolean).join(' · ')}
              </p>
            </div>
            <ChevronRight className={`w-5 h-5 flex-shrink-0 ${selectedJobId === job.id ? 'text-white' : 'text-gray-400'}`} />
          </button>
        ))}
      </div>
    </>
  )
}
