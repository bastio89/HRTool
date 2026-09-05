import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../AuthContext'
import { useI18n } from '../I18nContext'
import { auditApi } from '../api'
import { Shield, Search, ChevronLeft, ChevronRight, Activity, User, Briefcase, Users, GitBranch, Clock, Filter, Download, Calendar } from 'lucide-react'
import { useToast } from '../components/Toast'
import { Card, Button, IconButton, EmptyState, LoadingSpinner, PageContainer } from '../components/UI'
import { localeTag } from '../utils/format'

// Tailwind classes rather than isDark ternaries – this page used to carry its
// own inline-style system, which drifted from the rest of the app on radii,
// spacing and type scale.
const ENTITY_STYLES = {
  Candidate: 'bg-[#34c759]/10 text-[#1f9d55] dark:text-[#66bb6a]',
  Job:       'bg-[#0071e3]/10 text-[#1565c0] dark:text-[#42a5f5]',
  Pipeline:  'bg-[#ff9f0a]/10 text-[#e65100] dark:text-[#ff9800]',
  User:      'bg-[#8b5cf6]/10 text-[#7b1fa2] dark:text-[#ba68c8]',
  System:    'bg-[#ff3b30]/10 text-[#c62828] dark:text-[#ef5350]',
}

const ENTITY_ICONS = {
  Candidate: Users,
  Job: Briefcase,
  Pipeline: GitBranch,
  User: User,
  System: Shield,
}

const FIELD_CLASS =
  'px-4 py-2.5 rounded-[14px] bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200/60 dark:border-gray-700/60 ' +
  'text-[14px] text-black dark:text-white cursor-pointer ' +
  'focus:outline-none focus:ring-4 focus:ring-[#0071e3]/15 focus:border-[#0071e3]/30 transition'

const TH_CLASS = 'px-4 py-3 text-left font-semibold text-[12px] uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap'
const TD_CLASS = 'px-4 py-3 text-black dark:text-white align-middle'

function StatCard({ icon: Icon, iconClass, value, label }) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-gray-200/60 dark:border-gray-700/60 p-6 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0 ${iconClass}`}>
        <Icon className="w-5.5 h-5.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[28px] font-bold leading-none text-black dark:text-white">{value}</div>
        <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1.5 truncate">{label}</div>
      </div>
    </div>
  )
}

export default function AuditLog() {
  const { isAdmin } = useAuth()
  const { t, locale } = useI18n()
  const toast = useToast()
  const [entries, setEntries] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState({ entity_type: '', action: '', search: '', date_from: '', date_to: '' })
  const [searchInput, setSearchInput] = useState('')
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await auditApi.exportCSV(filters)
      toast.success(t('audit.csv_downloaded'))
    } catch (err) {
      console.error('Export-Fehler:', err)
      toast.error(t('audit.export_error'))
    } finally {
      setExporting(false)
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: 25, ...filters }
      const [logRes, statsRes] = await Promise.all([
        auditApi.getLog(params),
        page === 1 && !filters.entity_type && !filters.action && !filters.search ? auditApi.getStats() : Promise.resolve(null)
      ])
      setEntries(logRes.data)
      setTotalPages(logRes.pagination.totalPages)
      setTotal(logRes.pagination.total)
      if (statsRes) setStats(statsRes)
    } catch (err) {
      console.error('Audit-Log Fehler:', err)
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => { loadData() }, [loadData])

  const handleSearch = (e) => {
    e.preventDefault()
    setPage(1)
    setFilters(f => ({ ...f, search: searchInput }))
  }

  const handleFilterChange = (key, value) => {
    setPage(1)
    setFilters(f => ({ ...f, [key]: value }))
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString(localeTag(locale), { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  if (!isAdmin) {
    return (
      <PageContainer width="content">
        <EmptyState icon={Shield} title={t('audit.admin_only')} />
      </PageContainer>
    )
  }

  return (
    <PageContainer width="content">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8 sm:mb-10">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight text-black dark:text-white">
            {t('audit.title')}
          </h1>
          <p className="text-[16px] sm:text-[17px] text-gray-500 dark:text-gray-400 mt-2">
            {t('audit.subtitle')}
          </p>
        </div>
        <Button onClick={handleExport} disabled={exporting}>
          <Download className="w-4 h-4" />
          {exporting ? t('audit.exporting') : t('audit.csv_export')}
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 mb-6 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          <StatCard
            icon={Activity}
            iconClass="bg-[#0071e3]/10 text-[#0071e3] dark:text-[#0a84ff]"
            value={stats.today}
            label={t('audit.today')}
          />
          <StatCard
            icon={Clock}
            iconClass="bg-[#34c759]/10 text-[#34c759]"
            value={stats.thisWeek}
            label={t('audit.this_week')}
          />
          {stats.byType?.slice(0, 3).map(row => {
            const Icon = ENTITY_ICONS[row.entity_type] || Activity
            return (
              <StatCard
                key={row.entity_type}
                icon={Icon}
                iconClass={ENTITY_STYLES[row.entity_type] || ENTITY_STYLES.System}
                value={row.count}
                label={row.entity_type}
              />
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-gray-200/60 dark:border-gray-700/60 p-5 mb-6 flex flex-wrap items-center gap-3">
        <Filter className="w-4.5 h-4.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />

        <select
          value={filters.entity_type}
          onChange={e => handleFilterChange('entity_type', e.target.value)}
          aria-label={t('audit.col_area')}
          className={FIELD_CLASS}
        >
          <option value="">{t('audit.all_areas')}</option>
          <option value="Candidate">{t('audit.type_candidates')}</option>
          <option value="Job">{t('audit.type_jobs')}</option>
          <option value="Pipeline">{t('audit.type_pipeline')}</option>
          <option value="User">{t('audit.type_user')}</option>
          <option value="System">{t('audit.type_system')}</option>
        </select>

        <select
          value={filters.action}
          onChange={e => handleFilterChange('action', e.target.value)}
          aria-label={t('audit.col_action')}
          className={FIELD_CLASS}
        >
          <option value="">{t('audit.all_actions')}</option>
          <option value="erstellt">{t('audit.action_created')}</option>
          <option value="aktualisiert">{t('audit.action_updated')}</option>
          <option value="gelöscht">{t('audit.action_deleted')}</option>
          <option value="batch-gelöscht">{t('audit.action_batch_deleted')}</option>
          <option value="batch-status">{t('audit.action_batch_status')}</option>
          <option value="pipeline-hinzugefügt">{t('audit.action_pipeline_added')}</option>
          <option value="stage-geändert">{t('audit.action_stage_changed')}</option>
          <option value="benutzer-erstellt">{t('audit.action_user_created')}</option>
          <option value="benutzer-gelöscht">{t('audit.action_user_deleted')}</option>
          <option value="passwort-geändert">{t('audit.action_password_changed')}</option>
          <option value="passwort-zurückgesetzt">{t('audit.action_password_reset')}</option>
          <option value="backup-erstellt">{t('audit.action_backup')}</option>
        </select>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          <input
            type="date"
            value={filters.date_from}
            onChange={e => handleFilterChange('date_from', e.target.value)}
            aria-label={t('audit.date_from', 'Von')}
            className={FIELD_CLASS}
          />
          <span className="text-gray-500 dark:text-gray-400 text-[13px]">–</span>
          <input
            type="date"
            value={filters.date_to}
            onChange={e => handleFilterChange('date_to', e.target.value)}
            aria-label={t('audit.date_to', 'Bis')}
            className={FIELD_CLASS}
          />
        </div>

        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('audit.search_placeholder')}
              aria-label={t('audit.search_placeholder')}
              className={`w-full pl-11 ${FIELD_CLASS} cursor-text`}
            />
          </div>
          <Button type="submit" size="sm">{t('audit.search')}</Button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-gray-200/60 dark:border-gray-700/60 overflow-hidden">
        {loading ? (
          <LoadingSpinner text={t('audit.loading')} />
        ) : entries.length === 0 ? (
          <EmptyState icon={Activity} title={t('audit.no_entries')} size="sm" />
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-gray-200/60 dark:border-gray-700/60 bg-[#f9f9fb] dark:bg-[#2c2c2e]">
                    <th className={TH_CLASS}>{t('audit.col_timestamp')}</th>
                    <th className={TH_CLASS}>{t('audit.col_user')}</th>
                    <th className={TH_CLASS}>{t('audit.col_action')}</th>
                    <th className={TH_CLASS}>{t('audit.col_area')}</th>
                    <th className={TH_CLASS}>{t('audit.col_object')}</th>
                    <th className={TH_CLASS}>{t('audit.col_details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const Icon = ENTITY_ICONS[entry.entity_type] || Activity
                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-gray-100 dark:border-[#2c2c2e] hover:bg-[#f9f9fb] dark:hover:bg-[#2c2c2e] transition-colors"
                      >
                        <td className={TD_CLASS}>
                          <span className="tabular-nums whitespace-nowrap text-[13px]">
                            {formatDate(entry.created_at)}
                          </span>
                        </td>
                        <td className={TD_CLASS}>
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                            <span className="font-medium">{entry.username || '—'}</span>
                          </div>
                        </td>
                        <td className={TD_CLASS}>
                          <span className="px-2.5 py-1 rounded-lg text-[12px] font-semibold bg-[#0071e3]/10 text-[#0071e3] dark:text-[#0a84ff] whitespace-nowrap">
                            {entry.action}
                          </span>
                        </td>
                        <td className={TD_CLASS}>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap ${ENTITY_STYLES[entry.entity_type] || ENTITY_STYLES.System}`}>
                            <Icon className="w-3 h-3" />
                            {entry.entity_type}
                          </span>
                        </td>
                        <td className={TD_CLASS}>
                          <span className="block max-w-[200px] truncate">
                            {entry.entity_label || `#${entry.entity_id || '—'}`}
                          </span>
                        </td>
                        <td className={TD_CLASS}>
                          {entry.details ? (
                            <span className="block max-w-[250px] truncate text-[12px] text-gray-500 dark:text-gray-400">
                              {typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-t border-gray-200/60 dark:border-gray-700/60 text-[13px] text-gray-500 dark:text-gray-400">
              <span>{t('audit.total_entries').replace('{count}', total)}</span>
              <div className="flex items-center gap-2">
                <IconButton
                  icon={ChevronLeft}
                  label={t('common.back')}
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                />
                <span className="font-medium text-black dark:text-white tabular-nums">
                  {page} / {totalPages}
                </span>
                <IconButton
                  icon={ChevronRight}
                  label={t('common.forward')}
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </PageContainer>
  )
}
