import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Briefcase, MapPin, Users,
  Clock, Trash2, ChevronRight as ChevronRightIcon, ExternalLink, ChevronLeft
} from 'lucide-react'
import { jobsApi } from '../api'
import { Card, Button, EmptyState, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

const JOB_TYPES = ['Vollzeit', 'Teilzeit', 'Freelance', 'Praktikum', 'Werkstudent']
const JOB_STATUSES = ['Offen', 'Besetzt', 'Pausiert', 'Archiviert']
const PAGE_SIZE = 20

const statusColor = {
  Offen: 'bg-[#34c759]/10 text-[#34c759]',
  Besetzt: 'bg-[#0071e3]/10 text-[#0071e3]',
  Pausiert: 'bg-[#ff9f0a]/10 text-[#ff9f0a]',
  Archiviert: 'bg-gray-100 dark:bg-[#2c2c2e] text-gray-500 dark:text-gray-400',
}

export default function Jobs() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await jobsApi.getAll({ status: filterStatus, page: currentPage, limit: PAGE_SIZE })
      setJobs(data.data || [])
      setTotalCount(data.total || 0)
      setTotalPages(data.totalPages || 1)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, currentPage])

  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => { setCurrentPage(1) }, [filterStatus])

  const handleDelete = async (id) => {
    try {
      await jobsApi.delete(id)
      setDeleteConfirm(null)
      loadJobs()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-8 sm:mb-14 gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('jobs.title')}</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">
            {t('jobs.count').replace('{count}', totalCount)}{filterStatus ? ` (${filterStatus})` : ''}
          </p>
        </div>
        <Button size="md" variant="dark" onClick={() => navigate('/jobs/new')}>
          <Plus className="w-5 h-5" /> {t('jobs.new')}
        </Button>
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-2 sm:gap-3 mb-6 sm:mb-10 flex-wrap">
        {[{val:'', label: t('common.all')}, {val:'Offen', label: t('jobs.status_open')}, {val:'Besetzt', label: t('jobs.status_filled')}, {val:'Pausiert', label: t('jobs.status_paused')}, {val:'Archiviert', label: t('jobs.status_archived')}].map(s => (
          <button
            key={s.val}
            onClick={() => setFilterStatus(s.val)}
            className={`px-5 py-2.5 rounded-full text-[15px] font-medium transition-all cursor-pointer ${
              filterStatus === s.val
                ? 'bg-black text-white'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner text={t('jobs.loading')} />
      ) : jobs.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={Briefcase}
            title={t('jobs.no_jobs')}
            description={t('jobs.no_jobs_desc')}
            action={
              <Button size="lg" variant="dark" onClick={() => navigate('/jobs/new')}>
                <Plus className="w-5 h-5" /> {t('jobs.create_job')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {jobs.map(job => (
            <Card key={job.id} className="p-0 overflow-hidden" hover>
              {deleteConfirm === job.id ? (
                <div className="flex items-center justify-between px-10 py-6 bg-[#ff3b30]/5 border-t border-[#ff3b30]/20">
                  <span className="text-[16px] font-medium text-[#ff3b30]">{t('jobs.delete_confirm')}</span>
                  <div className="flex gap-4">
                    <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</Button>
                    <Button variant="danger" onClick={() => handleDelete(job.id)}>{t('common.delete')}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 p-5 sm:p-8">
                  {/* Icon */}
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[16px] sm:rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-6 h-6 sm:w-7 sm:h-7 text-gray-600 dark:text-gray-400" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                      <h3 className="text-[18px] sm:text-[22px] font-semibold tracking-tight text-black dark:text-white">{job.title}</h3>
                      <span className={`px-3 py-1 rounded-full text-[12px] sm:text-[13px] font-semibold ${statusColor[job.status] || 'bg-gray-100 dark:bg-[#2c2c2e] text-gray-500 dark:text-gray-400'}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-6 mt-2 sm:mt-3 flex-wrap">
                      {job.location && (
                        <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                          <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />{job.location}
                        </span>
                      )}
                      <span className="text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">{job.type}</span>
                      <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                        <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />{job.candidate_count || 0} {t('jobs.in_pipeline')}
                      </span>
                      <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-400">
                        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {new Date(job.created_at).toLocaleDateString('de-DE')}
                      </span>
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1.5 text-[13px] sm:text-[15px] font-medium text-[#0071e3] hover:opacity-70 transition-opacity"
                        >
                          <ExternalLink className="w-4 h-4" /> Zur Stelle
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 sm:gap-3 self-end sm:self-center">
                    <Button variant="secondary" size="sm" onClick={() => navigate(`/jobs/${job.id}/edit`)}>
                      {t('jobs.edit_btn')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={() => navigate(`/pipeline/${job.id}`)}
                    >
                      {t('jobs.pipeline')} <ChevronRightIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-10 h-10 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
                      onClick={() => setDeleteConfirm(job.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-2 text-gray-400 text-[15px]">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full text-[15px] sm:text-[17px] font-semibold transition-all cursor-pointer ${
                        p === currentPage
                          ? 'bg-black text-white'
                          : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronRightIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
