import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, Download, TrendingUp, Users, Briefcase, Clock, Target, Activity, UserCheck } from 'lucide-react'
import { Card, LoadingSpinner } from '../components/UI'
import { reportsApi, jobsApi } from '../api'
import { useI18n } from '../I18nContext'

const TABS = [
  { id: 'overview', labelKey: 'reports.tab_overview', icon: BarChart3 },
  { id: 'funnel', labelKey: 'reports.tab_funnel', icon: Target },
  { id: 'tth', labelKey: 'reports.tab_tth', icon: Clock },
  { id: 'sources', labelKey: 'reports.tab_sources', icon: TrendingUp },
  { id: 'timeline', labelKey: 'reports.tab_timeline', icon: Activity },
  { id: 'team', labelKey: 'reports.tab_team', icon: UserCheck },
]

export default function Reports() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [tab, setTab] = useState('overview')

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center gap-4 sm:gap-8 mb-8">
        <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('reports.title')}</h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1">{t('reports.subtitle')}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-1.5 mb-8 overflow-x-auto">
        {TABS.map(item => {
          const Icon = item.icon
          return (
            <button key={item.id} onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                tab === item.id ? 'bg-white dark:bg-[#3a3a3c] text-[#0071e3] dark:text-[#0a84ff] shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
              }`}>
              <Icon className="w-4 h-4" />{t(item.labelKey)}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewTab t={t} />}
      {tab === 'funnel' && <FunnelTab t={t} />}
      {tab === 'tth' && <TimeToHireTab t={t} />}
      {tab === 'sources' && <SourcesTab t={t} />}
      {tab === 'timeline' && <TimelineTab t={t} />}
      {tab === 'team' && <TeamTab t={t} />}
    </div>
  )
}

function OverviewTab({ t }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    reportsApi.getOverview(days).then(setData).catch(() => null).finally(() => setLoading(false))
  }, [days])

  if (loading) return <LoadingSpinner />
  if (!data) return <Card className="p-8"><p className="text-gray-500">{t('reports.error')}</p></Card>

  const kpis = [
    { label: t('reports.total_candidates'), value: data.candidates.total, sub: `+${data.candidates.new} ${t('reports.new')}`, color: '#0071e3', icon: Users },
    { label: t('reports.active_jobs'), value: data.jobs.active, sub: `${data.jobs.total} ${t('reports.total')}`, color: '#5e5ce6', icon: Briefcase },
    { label: t('reports.hires'), value: data.pipeline.recentHires, sub: `${data.pipeline.hired} ${t('reports.total')}`, color: '#34c759', icon: UserCheck },
    { label: t('reports.interviews'), value: data.interviews.count, sub: t('reports.in_period'), color: '#ff9f0a', icon: Clock },
    { label: t('reports.emails_sent'), value: data.emails.sent, sub: t('reports.in_period'), color: '#ff3b30', icon: Target },
    { label: t('reports.ai_calls'), value: data.ai.calls, sub: t('reports.in_period'), color: '#af52de', icon: Activity },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${days === d ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500 hover:text-black dark:hover:text-white'}`}>
              {d} {t('reports.days')}
            </button>
          ))}
        </div>
        <button onClick={() => reportsApi.exportCSV('candidates')} className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] rounded-xl text-[13px] font-semibold text-gray-600 dark:text-gray-400 transition-colors cursor-pointer">
          <Download className="w-4 h-4" />{t('reports.export')}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon
          return (
            <Card key={i} className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${kpi.color}15` }}>
                  <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                </div>
              </div>
              <p className="text-[28px] font-bold text-black dark:text-white tracking-tight">{kpi.value}</p>
              <p className="text-[13px] font-medium text-gray-500 mt-0.5">{kpi.label}</p>
              <p className="text-[12px] text-gray-400 mt-0.5">{kpi.sub}</p>
            </Card>
          )
        })}
      </div>

      {/* Pipeline stages */}
      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('reports.pipeline_stages')}</h3>
        <div className="space-y-3">
          {data.pipeline.stages.map((s, i) => {
            const maxCount = Math.max(...data.pipeline.stages.map(x => x.count))
            const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0
            const colors = { 'Beworben': '#0071e3', 'Screening': '#5e5ce6', 'Interview': '#ff9f0a', 'Angebot': '#34c759', 'Hired': '#30d158', 'Abgesagt': '#ff3b30' }
            return (
              <div key={i} className="flex items-center gap-4">
                <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400 w-24">{s.stage}</span>
                <div className="flex-1 h-8 bg-[#f5f5f7] dark:bg-[#1c1c1e] rounded-lg overflow-hidden">
                  <div className="h-full rounded-lg flex items-center px-3 transition-all" style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: colors[s.stage] || '#0071e3' }}>
                    <span className="text-[12px] font-bold text-white">{s.count}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function FunnelTab({ t }) {
  const [data, setData] = useState(null)
  const [jobs, setJobs] = useState([])
  const [jobId, setJobId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      reportsApi.getPipelineFunnel().catch(() => null),
      jobsApi.getAll().catch(() => ({ data: [] })),
    ]).then(([f, j]) => { setData(f); setJobs(j.data || j || []) }).finally(() => setLoading(false))
  }, [])

  const loadFunnel = (id) => {
    setJobId(id)
    setLoading(true)
    reportsApi.getPipelineFunnel(id || undefined).then(setData).catch(() => null).finally(() => setLoading(false))
  }

  if (loading) return <LoadingSpinner />
  if (!data) return <Card className="p-8"><p className="text-gray-500">{t('reports.error')}</p></Card>

  return (
    <div className="space-y-6 max-w-[800px]">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => loadFunnel('')} className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${!jobId ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500'}`}>
          {t('reports.all_jobs')}
        </button>
        {jobs.slice(0, 8).map(j => (
          <button key={j.id} onClick={() => loadFunnel(j.id)} className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${jobId == j.id ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500'}`}>
            {j.title}
          </button>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-6">{t('reports.pipeline_funnel')}</h3>
        <div className="space-y-4">
          {data.funnel?.map((step, i) => {
            const maxW = data.funnel[0]?.count || 1
            const pct = Math.max((step.count / maxW) * 100, 8)
            const funnelColors = ['#0071e3', '#5e5ce6', '#ff9f0a', '#34c759', '#30d158', '#ff3b30']
            return (
              <div key={i} className="text-center">
                <div className="h-14 mx-auto rounded-xl flex items-center justify-center transition-all relative" style={{ width: `${pct}%`, backgroundColor: funnelColors[i] || '#0071e3', minWidth: '120px' }}>
                  <span className="text-white font-bold text-[14px]">{step.stage}</span>
                  <span className="absolute right-3 text-white/80 text-[13px] font-semibold">{step.count}</span>
                </div>
                <div className="flex justify-center gap-4 mt-1">
                  <span className="text-[11px] text-gray-400">{t('reports.conversion')}: {step.conversionRate}%</span>
                  {i > 0 && <span className="text-[11px] text-gray-400">{t('reports.step_rate')}: {step.stepRate}%</span>}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="flex justify-end">
        <button onClick={() => reportsApi.exportCSV('pipeline')} className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-[13px] font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors">
          <Download className="w-4 h-4" />{t('reports.export_pipeline')}
        </button>
      </div>
    </div>
  )
}

function TimeToHireTab({ t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    reportsApi.getTimeToHire().then(setData).catch(() => null).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (!data) return <Card className="p-8"><p className="text-gray-500">{t('reports.error')}</p></Card>

  return (
    <div className="space-y-6 max-w-[1000px]">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-6 text-center">
          <p className="text-[36px] font-bold text-[#0071e3]">{data.summary.avgDays ?? '—'}</p>
          <p className="text-[14px] text-gray-500 font-medium">{t('reports.avg_days')}</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-[36px] font-bold text-[#5e5ce6]">{data.summary.medianDays ?? '—'}</p>
          <p className="text-[14px] text-gray-500 font-medium">{t('reports.median_days')}</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-[36px] font-bold text-[#34c759]">{data.summary.totalHires}</p>
          <p className="text-[14px] text-gray-500 font-medium">{t('reports.total_hires')}</p>
        </Card>
      </div>

      {data.byJob?.length > 0 && (
        <Card className="p-6">
          <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('reports.tth_by_job')}</h3>
          <div className="space-y-3">
            {data.byJob.map((j, i) => (
              <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                <span className="text-[13px] font-semibold text-black dark:text-white flex-1">{j.job_title || `Job #${j.job_id}`}</span>
                <span className="text-[13px] text-gray-500">{j.hires} {t('reports.hires')}</span>
                <span className="text-[15px] font-bold text-[#0071e3]">{j.avg_days ?? '—'} {t('reports.days_unit')}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.recentHires?.length > 0 && (
        <Card className="p-6">
          <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('reports.recent_hires')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2 font-semibold">{t('reports.candidate')}</th>
                  <th className="py-2 font-semibold">{t('reports.job')}</th>
                  <th className="py-2 font-semibold text-right">{t('reports.days_unit')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentHires.slice(0, 10).map((h, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                    <td className="py-2.5 font-medium text-black dark:text-white">{h.candidate_name}</td>
                    <td className="py-2.5 text-gray-500">{h.job_title}</td>
                    <td className="py-2.5 text-right font-bold text-[#0071e3]">{h.days_to_hire}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <button onClick={() => reportsApi.exportCSV('time-to-hire')} className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-[13px] font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors">
          <Download className="w-4 h-4" />{t('reports.export_tth')}
        </button>
      </div>
    </div>
  )
}

function SourcesTab({ t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    reportsApi.getSourceEffectiveness().then(setData).catch(() => null).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (!data || data.length === 0) return <Card className="p-8 text-center"><p className="text-gray-500">{t('reports.no_data')}</p></Card>

  return (
    <div className="space-y-6 max-w-[1000px]">
      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('reports.source_effectiveness')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-2 font-semibold">{t('reports.source')}</th>
                <th className="py-2 font-semibold text-center">{t('reports.total_candidates')}</th>
                <th className="py-2 font-semibold text-center">{t('reports.in_pipeline')}</th>
                <th className="py-2 font-semibold text-center">{t('reports.interviews')}</th>
                <th className="py-2 font-semibold text-center">{t('reports.hires')}</th>
                <th className="py-2 font-semibold text-center">{t('reports.hire_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50">
                  <td className="py-3 font-semibold text-black dark:text-white">{s.source}</td>
                  <td className="py-3 text-center text-gray-600 dark:text-gray-400">{s.total_candidates}</td>
                  <td className="py-3 text-center text-gray-600 dark:text-gray-400">{s.in_pipeline}</td>
                  <td className="py-3 text-center text-gray-600 dark:text-gray-400">{s.interviews}</td>
                  <td className="py-3 text-center font-bold text-[#34c759]">{s.hires}</td>
                  <td className="py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[12px] font-bold ${s.hireRate > 20 ? 'bg-[#34c759]/10 text-[#34c759]' : s.hireRate > 0 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                      {s.hireRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Visual bar chart */}
      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('reports.source_comparison')}</h3>
        <div className="space-y-3">
          {data.map((s, i) => {
            const max = Math.max(...data.map(x => x.total_candidates))
            return (
              <div key={i} className="flex items-center gap-4">
                <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400 w-28 truncate">{s.source}</span>
                <div className="flex-1 flex gap-1">
                  <div className="h-6 bg-[#0071e3] rounded-l" style={{ width: `${(s.in_pipeline / max) * 100}%` }} title={`Pipeline: ${s.in_pipeline}`} />
                  <div className="h-6 bg-[#ff9f0a]" style={{ width: `${(s.interviews / max) * 100}%` }} title={`Interviews: ${s.interviews}`} />
                  <div className="h-6 bg-[#34c759] rounded-r" style={{ width: `${(s.hires / max) * 100}%` }} title={`Hires: ${s.hires}`} />
                </div>
                <span className="text-[13px] font-bold text-black dark:text-white w-10 text-right">{s.total_candidates}</span>
              </div>
            )
          })}
          <div className="flex gap-4 mt-2 text-[11px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#0071e3]" /> Pipeline</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#ff9f0a]" /> Interviews</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#34c759]" /> Hires</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

function TimelineTab({ t }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    reportsApi.getActivityTimeline(days).then(setData).catch(() => null).finally(() => setLoading(false))
  }, [days])

  if (loading) return <LoadingSpinner />
  if (!data || data.length === 0) return <Card className="p-8 text-center"><p className="text-gray-500">{t('reports.no_data')}</p></Card>

  const maxVal = Math.max(...data.map(d => d.candidates + d.pipeline + d.interviews + d.emails), 1)

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex gap-2">
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${days === d ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500'}`}>
            {d} {t('reports.days')}
          </button>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-6">{t('reports.activity_timeline')}</h3>
        <div className="space-y-2">
          {data.map((d, i) => {
            const total = d.candidates + d.pipeline + d.interviews + d.emails
            const w = (total / maxVal) * 100
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-[12px] text-gray-400 w-20 font-mono">{d.date.slice(5)}</span>
                <div className="flex-1 flex gap-px h-6">
                  {d.candidates > 0 && <div className="h-full bg-[#0071e3] first:rounded-l last:rounded-r" style={{ width: `${(d.candidates / maxVal) * 100}%` }} title={`Kandidaten: ${d.candidates}`} />}
                  {d.pipeline > 0 && <div className="h-full bg-[#5e5ce6] first:rounded-l last:rounded-r" style={{ width: `${(d.pipeline / maxVal) * 100}%` }} title={`Pipeline: ${d.pipeline}`} />}
                  {d.interviews > 0 && <div className="h-full bg-[#ff9f0a] first:rounded-l last:rounded-r" style={{ width: `${(d.interviews / maxVal) * 100}%` }} title={`Interviews: ${d.interviews}`} />}
                  {d.emails > 0 && <div className="h-full bg-[#34c759] first:rounded-l last:rounded-r" style={{ width: `${(d.emails / maxVal) * 100}%` }} title={`Emails: ${d.emails}`} />}
                </div>
                <span className="text-[12px] font-bold text-gray-600 dark:text-gray-400 w-8 text-right">{total}</span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#0071e3]" />{t('reports.candidates')}</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#5e5ce6]" />Pipeline</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#ff9f0a]" />Interviews</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#34c759]" />E-Mails</span>
        </div>
      </Card>
    </div>
  )
}

function TeamTab({ t }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    reportsApi.getTeamPerformance(days).then(setData).catch(() => null).finally(() => setLoading(false))
  }, [days])

  if (loading) return <LoadingSpinner />
  if (!data || data.length === 0) return <Card className="p-8 text-center"><p className="text-gray-500">{t('reports.no_data')}</p></Card>

  return (
    <div className="space-y-6 max-w-[1000px]">
      <div className="flex gap-2">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${days === d ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500'}`}>
            {d} {t('reports.days')}
          </button>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('reports.team_performance')}</h3>
        <div className="space-y-4">
          {data.map((u, i) => (
            <div key={i} className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex items-center gap-3 mb-3">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${u.display_name}`} alt="" className="w-10 h-10 rounded-full bg-gray-200" />
                <div>
                  <p className="text-[14px] font-bold text-black dark:text-white">{u.display_name}</p>
                  <p className="text-[12px] text-gray-400">@{u.username}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-2 bg-white dark:bg-[#1c1c1e] rounded-lg">
                  <p className="text-[18px] font-bold text-[#0071e3]">{u.actions}</p>
                  <p className="text-[11px] text-gray-400">{t('reports.actions')}</p>
                </div>
                <div className="text-center p-2 bg-white dark:bg-[#1c1c1e] rounded-lg">
                  <p className="text-[18px] font-bold text-[#5e5ce6]">{u.comments}</p>
                  <p className="text-[11px] text-gray-400">{t('reports.comments')}</p>
                </div>
                <div className="text-center p-2 bg-white dark:bg-[#1c1c1e] rounded-lg">
                  <p className="text-[18px] font-bold text-[#ff9f0a]">{u.ai_calls}</p>
                  <p className="text-[11px] text-gray-400">{t('reports.ai_calls')}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
