import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot, Shield, Eye, Scale, UserCheck, AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight, FileText, Info, CreditCard, Zap, Lock, Server, AlertOctagon, TestTubes, Lightbulb, Bell, Play, Plus, ExternalLink, Pencil, Trash2, ChevronDown, ChevronUp, ListTodo, CircleDot, CircleCheck, LayoutDashboard, Download, HelpCircle } from 'lucide-react'
import { Card, LoadingSpinner } from '../components/UI'
import { aiLogsApi, complianceApi } from '../api'
import { useI18n } from '../I18nContext'

// Two-level navigation: an entry dashboard, two thematic groups, and a help area.
// This replaces the old flat list of 8 equally-weighted tabs.
const GROUPS = [
  { id: 'overview', labelKey: 'ki.group_overview', icon: LayoutDashboard },
  {
    id: 'audit', labelKey: 'ki.group_audit', icon: Shield, subs: [
      { id: 'compliance', labelKey: 'ki.tab_compliance', icon: Shield },
      { id: 'riskreg', labelKey: 'ki.tab_risk_register', icon: AlertOctagon },
      { id: 'modelcard', labelKey: 'ki.tab_modelcard', icon: CreditCard },
      { id: 'logs', labelKey: 'ki.tab_logs', icon: FileText },
    ],
  },
  {
    id: 'fairness', labelKey: 'ki.group_fairness', icon: Scale, subs: [
      { id: 'bias', labelKey: 'ki.tab_bias', icon: Scale },
      { id: 'biastest', labelKey: 'ki.tab_bias_testset', icon: TestTubes },
    ],
  },
  { id: 'info', labelKey: 'ki.group_info', icon: Info },
]

const GROUP_DEFAULT_SUB = { audit: 'compliance', fairness: 'bias' }

// Small "Why?" tooltip to explain thresholds and metrics in plain language.
function WhyTooltip({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" onClick={() => setOpen(o => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-[#0071e3] transition-colors cursor-pointer"
        aria-label="Erklärung">
        <HelpCircle className="w-[15px] h-[15px]" />
      </button>
      {open && (
        <span className="absolute z-30 left-1/2 -translate-x-1/2 top-7 w-64 p-3 rounded-xl bg-black/90 text-white text-[12px] font-medium leading-relaxed shadow-xl text-left normal-case">
          {text}
        </span>
      )}
    </span>
  )
}

// Info toggle button (place inside header flex row)
function InfoButton({ show, onToggle, color, t }) {
  return (
    <button onClick={onToggle} className="w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 cursor-pointer"
      style={show ? { backgroundColor: color, color: '#fff', boxShadow: `0 8px 16px ${color}40` } : { color, backgroundColor: 'rgba(255,255,255,0.6)' }}
      title={t('ki.info_show')}>
      <Info className="w-[18px] h-[18px]" />
    </button>
  )
}

// Collapsible info content (place AFTER the header flex row, still inside the Card)
function InfoContent({ show, color, items, legalText }) {
  return (
    <div className={`overflow-hidden transition-all duration-300 ease-in-out ${show ? 'max-h-[800px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
      <div className="p-5 rounded-xl bg-white/70 dark:bg-black/20 border border-gray-200/50 dark:border-gray-700/50 space-y-4">
        {items.map((item, i) => (
          <div key={i}>
            <h4 className="text-[14px] font-bold mb-1.5" style={{ color }}>{item.title}</h4>
            {item.text && <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{item.text}</p>}
            {item.steps && (
              <ul className="space-y-1.5">
                {item.steps.map((s, j) => (
                  <li key={j} className="flex items-start gap-2 text-[13px] text-gray-600 dark:text-gray-400">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5" style={{ backgroundColor: `${color}15`, color }}>{j + 1}</span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            )}
            {item.bullets && (
              <ul className="space-y-1.5">
                {item.bullets.map((b, j) => (
                  <li key={j} className="flex items-start gap-2 text-[13px] text-gray-600 dark:text-gray-400">
                    <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {legalText && (
          <div className="flex items-start gap-2 p-3 rounded-lg border" style={{ backgroundColor: `${color}08`, borderColor: `${color}20` }}>
            <Scale className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
            <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">{legalText}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function KITransparenz() {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const [group, setGroup] = useState('overview')
  const [sub, setSub] = useState(null)

  const selectGroup = (g) => {
    setGroup(g)
    setSub(GROUP_DEFAULT_SUB[g] || null)
  }
  // Allow the overview dashboard to deep-link into a specific area.
  const goTo = (g, s = null) => {
    setGroup(g)
    setSub(s || GROUP_DEFAULT_SUB[g] || null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const activeGroup = GROUPS.find(g => g.id === group)

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      <div className="flex items-center gap-4 sm:gap-8 mb-8">
        <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('ki.title')}</h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1">{t('ki.subtitle')}</p>
        </div>
      </div>

      {/* Primary group navigation */}
      <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-1.5 mb-4 overflow-x-auto">
        {GROUPS.map(item => {
          const Icon = item.icon
          const active = group === item.id
          return (
            <button key={item.id} onClick={() => selectGroup(item.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                active ? 'bg-white dark:bg-[#3a3a3c] text-[#0071e3] dark:text-[#0a84ff] shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
              }`}>
              <Icon className="w-4 h-4" />{t(item.labelKey)}
            </button>
          )
        })}
      </div>

      {/* Secondary sub-navigation (only for grouped areas) */}
      {activeGroup?.subs ? (
        <div className="flex items-center gap-1.5 mb-8 overflow-x-auto px-1 py-1">
          {activeGroup.subs.map(s => {
            const Icon = s.icon
            const active = sub === s.id
            return (
              <button key={s.id} onClick={() => setSub(s.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  active ? 'bg-[#0071e3]/10 text-[#0071e3] dark:text-[#0a84ff]' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
                }`}>
                <Icon className="w-4 h-4" />{t(s.labelKey)}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="mb-8" />
      )}

      {group === 'overview' && <OverviewTab t={t} goTo={goTo} />}
      {group === 'info' && <InfoTab t={t} locale={locale} />}
      {group === 'audit' && sub === 'compliance' && <ComplianceTab t={t} />}
      {group === 'audit' && sub === 'riskreg' && <RiskRegisterTab t={t} />}
      {group === 'audit' && sub === 'modelcard' && <ModelCardTab t={t} />}
      {group === 'audit' && sub === 'logs' && <LogsTab t={t} />}
      {group === 'fairness' && sub === 'bias' && (
        <div className="space-y-8">
          <BiasTab t={t} />
          <BiasAlertsTab t={t} />
        </div>
      )}
      {group === 'fairness' && sub === 'biastest' && <BiasTestsetTab t={t} />}
    </div>
  )
}

function OverviewTab({ t, goTo }) {
  const [compliance, setCompliance] = useState(null)
  const [stats, setStats] = useState(null)
  const [actionSummary, setActionSummary] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      aiLogsApi.getCompliance().catch(() => null),
      aiLogsApi.getStats().catch(() => null),
      complianceApi.getSummary().catch(() => null),
      aiLogsApi.getBiasAlerts().catch(() => null),
    ]).then(([c, s, sum, al]) => {
      setCompliance(c); setStats(s); setActionSummary(sum); setAlerts(al)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner text={t('ki.overview_loading')} />

  const score = compliance?.summary?.complianceScore ?? 0
  const passed = compliance?.summary?.passed ?? 0
  const failed = compliance?.summary?.failed ?? 0
  const warnings = compliance?.summary?.warnings ?? 0
  const totalChecks = compliance?.checks?.length ?? 0
  const criticalAlerts = alerts?.summary?.critical ?? 0
  const warningAlerts = alerts?.summary?.warning ?? 0
  const openActions = (actionSummary?.open ?? 0) + (actionSummary?.inProgress ?? 0)
  const overdue = actionSummary?.overdue ?? 0

  // Traffic-light status: the single answer to "is my AI OK?"
  let status = 'green'
  if (failed > 0 || criticalAlerts > 0 || overdue > 0) status = 'red'
  else if (warnings > 0 || warningAlerts > 0 || score < 80) status = 'yellow'

  const statusMeta = {
    green: { color: '#34c759', title: t('ki.overview_status_green'), sub: t('ki.overview_status_green_sub'), icon: CheckCircle },
    yellow: { color: '#ff9f0a', title: t('ki.overview_status_yellow'), sub: t('ki.overview_status_yellow_sub'), icon: AlertTriangle },
    red: { color: '#ff3b30', title: t('ki.overview_status_red'), sub: t('ki.overview_status_red_sub'), icon: AlertOctagon },
  }[status]
  const StatusIcon = statusMeta.icon

  // Build the actionable to-do list from failed/warning checks + open alerts + overdue tasks.
  const todos = []
  ;(compliance?.checks || []).forEach(c => {
    if (c.status === 'failed') todos.push({ sev: 'red', text: c.title, detail: c.description, go: () => goTo('audit', 'compliance') })
    else if (c.status === 'warning') todos.push({ sev: 'yellow', text: c.title, detail: c.description, go: () => goTo('audit', 'compliance') })
  })
  ;(alerts?.alerts || []).filter(a => a.severity === 'critical' || a.severity === 'warning').forEach(a => {
    todos.push({ sev: a.severity === 'critical' ? 'red' : 'yellow', text: a.title, detail: a.message, go: () => goTo('fairness', 'bias') })
  })
  if (overdue > 0) todos.push({ sev: 'red', text: t('ki.overview_todo_overdue').replace('{count}', overdue), detail: '', go: () => goTo('audit', 'compliance') })

  const sevColor = { red: '#ff3b30', yellow: '#ff9f0a' }

  return (
    <div className="space-y-8">
      {/* Traffic-light status */}
      <Card className="p-8" style={{ backgroundColor: `${statusMeta.color}0d`, borderColor: `${statusMeta.color}33`, borderWidth: 1 }}>
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${statusMeta.color}1a` }}>
            <StatusIcon className="w-9 h-9" style={{ color: statusMeta.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight text-black dark:text-white">{statusMeta.title}</h2>
            <p className="text-[14px] sm:text-[15px] text-gray-600 dark:text-gray-400 mt-1">{statusMeta.sub}</p>
          </div>
        </div>
      </Card>

      {/* Key numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="p-6 text-center">
          <div className={`text-[40px] font-bold tracking-tight ${score >= 80 ? 'text-[#34c759]' : score >= 50 ? 'text-[#ff9f0a]' : 'text-[#ff3b30]'}`}>{score}%</div>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('ki.compliance_score')}</p>
        </Card>
        <Card className="p-6 text-center">
          <div className="text-[40px] font-bold tracking-tight text-black dark:text-white">{stats?.totals?.total ?? 0}</div>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('ki.total_calls')}</p>
        </Card>
        <Card className="p-6 text-center">
          <div className={`text-[40px] font-bold tracking-tight ${openActions > 0 ? 'text-[#ff9f0a]' : 'text-[#34c759]'}`}>{openActions}</div>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('ki.overview_open_actions')}</p>
        </Card>
        <Card className="p-6 text-center">
          <div className={`text-[40px] font-bold tracking-tight ${criticalAlerts > 0 ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{criticalAlerts}</div>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('ki.overview_critical_warnings')}</p>
        </Card>
      </div>

      {/* What to do */}
      <Card className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <ListTodo className="w-6 h-6 text-[#0071e3]" />
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.overview_todo_title')}</h3>
        </div>
        {todos.length === 0 ? (
          <div className="flex items-center gap-3 p-5 rounded-2xl bg-[#34c759]/5 border border-[#34c759]/20">
            <CheckCircle className="w-6 h-6 text-[#34c759] flex-shrink-0" />
            <p className="text-[15px] font-medium text-gray-700 dark:text-gray-300">{t('ki.overview_todo_empty')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todos.slice(0, 8).map((todo, i) => (
              <button key={i} onClick={todo.go}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors text-left cursor-pointer group">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sevColor[todo.sev] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-black dark:text-white truncate">{todo.text}</p>
                  {todo.detail && <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{todo.detail}</p>}
                </div>
                <span className="flex items-center gap-1 text-[13px] font-semibold text-[#0071e3] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t('ki.overview_review')} <ChevronRight className="w-4 h-4" />
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Area shortcuts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button onClick={() => goTo('audit')} className="text-left group cursor-pointer">
          <Card className="p-8 h-full transition-all group-hover:shadow-lg group-hover:-translate-y-0.5">
            <div className="w-14 h-14 rounded-2xl bg-[#0071e3]/10 flex items-center justify-center mb-6">
              <Shield className="w-7 h-7 text-[#0071e3]" />
            </div>
            <h3 className="text-[19px] font-semibold text-black dark:text-white">{t('ki.group_audit')}</h3>
            <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">{t('ki.overview_area_audit_desc')}</p>
            <span className="inline-flex items-center gap-1.5 mt-6 text-[14px] font-semibold text-[#0071e3] group-hover:translate-x-1 transition-transform">
              {t('ki.overview_open')} <ChevronRight className="w-4 h-4" />
            </span>
          </Card>
        </button>
        <button onClick={() => goTo('fairness')} className="text-left group cursor-pointer">
          <Card className="p-8 h-full transition-all group-hover:shadow-lg group-hover:-translate-y-0.5">
            <div className="w-14 h-14 rounded-2xl bg-[#34c759]/10 flex items-center justify-center mb-6">
              <Scale className="w-7 h-7 text-[#34c759]" />
            </div>
            <h3 className="text-[19px] font-semibold text-black dark:text-white">{t('ki.group_fairness')}</h3>
            <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">{t('ki.overview_area_fairness_desc')}</p>
            <span className="inline-flex items-center gap-1.5 mt-6 text-[14px] font-semibold text-[#34c759] group-hover:translate-x-1 transition-transform">
              {t('ki.overview_open')} <ChevronRight className="w-4 h-4" />
            </span>
          </Card>
        </button>
      </div>
    </div>
  )
}

function ComplianceTab({ t }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const [actions, setActions] = useState([])
  const [actionSummary, setActionSummary] = useState(null)
  const [showNewAction, setShowNewAction] = useState(null) // check id
  const [newActionTitle, setNewActionTitle] = useState('')
  const [newActionPriority, setNewActionPriority] = useState('medium')

  // Quick-action links for each check
  const ACTION_LINKS = {
    'logging': null,
    'transparency': null,
    'human-oversight': '/history',
    'anonymization': null,
    'risk-management': null,
    'data-governance': null,
    'local-processing': null,
    'user-tracking': null,
    'override-tracking': '/history',
    'rate-limiting': null,
    'prompt-injection': null,
  }

  useEffect(() => {
    Promise.all([
      aiLogsApi.getCompliance().catch(() => null),
      aiLogsApi.getStats().catch(() => null),
      complianceApi.getActions({ ref_type: 'compliance' }).catch(() => ({ data: [] })),
      complianceApi.getSummary().catch(() => null),
    ]).then(([c, s, a, sum]) => {
      setData(c); setStats(s); setActions(a.data || []); setActionSummary(sum)
    }).finally(() => setLoading(false))
  }, [])

  const handleCreateAction = async (checkId, checkTitle) => {
    if (!newActionTitle.trim()) return
    try {
      const action = await complianceApi.createAction({
        ref_type: 'compliance',
        ref_id: checkId,
        title: newActionTitle.trim(),
        priority: newActionPriority,
        description: `Maßnahme für: ${checkTitle}`,
      })
      setActions(prev => [action, ...prev])
      setNewActionTitle('')
      setShowNewAction(null)
      setNewActionPriority('medium')
      // Refresh summary
      complianceApi.getSummary().then(setActionSummary).catch(() => {})
    } catch (err) { console.error(err) }
  }

  const handleToggleAction = async (action) => {
    const newStatus = action.status === 'done' ? 'open' : action.status === 'open' ? 'in_progress' : 'done'
    try {
      const updated = await complianceApi.updateAction(action.id, { status: newStatus })
      setActions(prev => prev.map(a => a.id === action.id ? updated : a))
      complianceApi.getSummary().then(setActionSummary).catch(() => {})
    } catch (err) { console.error(err) }
  }

  const handleDeleteAction = async (id) => {
    try {
      await complianceApi.deleteAction(id)
      setActions(prev => prev.filter(a => a.id !== id))
      complianceApi.getSummary().then(setActionSummary).catch(() => {})
    } catch (err) { console.error(err) }
  }

  // Export the compliance checklist as CSV — the primary audit artifact.
  const handleExportCsv = () => {
    if (!data?.checks) return
    const statusLabel = { passed: t('ki.passed'), failed: t('ki.failed'), warning: t('ki.warnings'), 'not-applicable': t('ki.not_applicable') }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['ID', t('ki.export_col_article'), t('ki.export_col_check'), t('ki.export_col_status'), t('ki.export_col_detail')]
    const rows = data.checks.map(c => [c.id, c.article, c.title, statusLabel[c.status] || c.status, c.details || c.description || ''].map(esc).join(','))
    const meta = [
      esc(t('ki.export_meta_score')) + ',' + esc(`${data.summary?.complianceScore ?? 0}%`),
      esc(t('ki.export_meta_date')) + ',' + esc(new Date().toLocaleString('de-DE')),
    ]
    const csv = '\uFEFF' + meta.join('\n') + '\n\n' + header.map(esc).join(',') + '\n' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ki-compliance_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <LoadingSpinner text={t('ki.compliance_loading')} />

  const statusIcons = {
    passed: <CheckCircle className="w-5 h-5 text-[#34c759]" />,
    failed: <XCircle className="w-5 h-5 text-[#ff3b30]" />,
    warning: <AlertTriangle className="w-5 h-5 text-[#ff9f0a]" />,
    'not-applicable': <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600" />,
  }
  const statusColors = {
    passed: 'bg-[#34c759]/10 border-[#34c759]/20',
    failed: 'bg-[#ff3b30]/10 border-[#ff3b30]/20',
    warning: 'bg-[#ff9f0a]/10 border-[#ff9f0a]/20',
    'not-applicable': 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
  }

  return (
    <div className="space-y-8">
      <Card className="p-6 bg-gradient-to-br from-[#0071e3]/5 to-[#34c759]/5 border border-[#0071e3]/10">
        <div className="flex items-center gap-4">
          <Shield className="w-8 h-8 text-[#0071e3]" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.compliance_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.compliance_subtitle')}</p>
          </div>
          <button onClick={handleExportCsv} disabled={!data?.checks}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-bold bg-white/70 dark:bg-black/20 text-[#0071e3] hover:bg-white dark:hover:bg-black/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4" />{t('ki.export_csv')}
          </button>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#0071e3" t={t} />
        </div>
        <InfoContent show={showInfo} color="#0071e3"
          items={[
            { title: t('ki.compliance_info_what_title'), text: t('ki.compliance_info_what_text') },
            { title: t('ki.compliance_info_why_title'), text: t('ki.compliance_info_why_text') },
            { title: t('ki.compliance_info_checks_title'), bullets: [t('ki.compliance_info_check1'), t('ki.compliance_info_check2'), t('ki.compliance_info_check3'), t('ki.compliance_info_check4')] },
          ]}
          legalText={t('ki.compliance_info_legal')}
        />
      </Card>

      {data?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
          <Card className="p-8 text-center">
            <div className={`text-[52px] font-bold tracking-tight ${data.summary.complianceScore >= 80 ? 'text-[#34c759]' : data.summary.complianceScore >= 50 ? 'text-[#ff9f0a]' : 'text-[#ff3b30]'}`}>
              {data.summary.complianceScore}%
            </div>
            <div className="flex items-center justify-center gap-1 mt-2">
              <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400">{t('ki.compliance_score')}</p>
              <WhyTooltip text={t('ki.compliance_score_why')} />
            </div>
            <p className="text-[12px] text-gray-400 mt-1">{data.summary.passed}/{data.checks?.length || 0} {t('ki.checks_passed_short')}</p>
          </Card>
          <Card className="p-8 text-center">
            <div className="text-[52px] font-bold tracking-tight text-[#34c759]">{data.summary.passed}</div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">{t('ki.passed')}</p>
          </Card>
          <Card className="p-8 text-center">
            <div className="text-[52px] font-bold tracking-tight text-[#ff9f0a]">{data.summary.warnings}</div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">{t('ki.warnings')}</p>
          </Card>
          <Card className="p-8 text-center">
            <div className="text-[52px] font-bold tracking-tight text-[#ff3b30]">{data.summary.failed}</div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">{t('ki.failed')}</p>
          </Card>
        </div>
      )}

      {stats?.totals && (
        <Card className="p-8">
          <h3 className="text-[18px] font-semibold text-black dark:text-white mb-6">{t('ki.usage_overview')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">{t('ki.total_calls')}</p>
              <p className="text-[28px] font-bold text-black dark:text-white">{stats.totals.total}</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">{t('ki.success_rate')}</p>
              <p className="text-[28px] font-bold text-[#34c759]">{stats.totals.successRate}%</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">{t('ki.high_risk_calls')}</p>
              <p className="text-[28px] font-bold text-[#ff9f0a]">{stats.totals.highRiskCount}</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">{t('ki.high_risk_share')}</p>
              <p className="text-[28px] font-bold text-[#ff9f0a]">{stats.totals.highRiskPercentage}%</p>
            </div>
          </div>
          {stats.byFeature?.length > 0 && (
            <div className="space-y-3">
              {stats.byFeature.map(f => {
                const riskLevel = ['matching', 'cv-parser'].includes(f.feature) ? t('ki.high_risk') : t('ki.low_risk')
                const riskColor = ['matching', 'cv-parser'].includes(f.feature) ? '#ff3b30' : '#34c759'
                const names = { matching: t('ki.feature_matching'), 'cv-parser': t('ki.feature_cv_parser'), 'job-generator': t('ki.feature_job_gen'), 'email-template': t('ki.feature_email_tpl'), 'interview-questions': t('ki.feature_interview_q') }
                return (
                  <div key={f.feature} className="flex items-center justify-between p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                    <div className="flex items-center gap-4">
                      <Bot className="w-5 h-5 text-[#5e5ce6]" />
                      <span className="text-[15px] font-semibold text-black dark:text-white">{names[f.feature] || f.feature}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${riskColor}15`, color: riskColor }}>{riskLevel}</span>
                    </div>
                    <div className="flex items-center gap-6 text-[13px]">
                      <span className="text-gray-400">{f.total} {t('ki.calls')}</span>
                      <span className="text-[#34c759] font-semibold">{f.successful} OK</span>
                      {f.failed > 0 && <span className="text-[#ff3b30] font-semibold">{f.failed} {t('ki.errors')}</span>}
                      {f.avg_duration_ms && <span className="text-gray-400">{(f.avg_duration_ms / 1000).toFixed(1)}s Ø</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* Action Summary */}
      {actionSummary && (actionSummary.open > 0 || actionSummary.inProgress > 0) && (
        <Card className="p-5 border border-[#ff9f0a]/20 bg-[#ff9f0a]/5">
          <div className="flex items-center gap-4">
            <ListTodo className="w-6 h-6 text-[#ff9f0a]" />
            <div className="flex-1">
              <p className="text-[14px] font-bold text-black dark:text-white">{t('ki.actions_pending')}</p>
              <p className="text-[12px] text-gray-500 mt-0.5">
                {actionSummary.open} {t('ki.action_open')} · {actionSummary.inProgress} {t('ki.action_in_progress')} · {actionSummary.done} {t('ki.action_done')}
                {actionSummary.overdue > 0 && <span className="text-[#ff3b30] font-bold"> · {actionSummary.overdue} {t('ki.action_overdue')}</span>}
              </p>
            </div>
          </div>
        </Card>
      )}

      {data?.checks && (
        <Card className="p-8">
          <h3 className="text-[18px] font-semibold text-black dark:text-white mb-6">{t('ki.compliance_checklist')}</h3>
          <div className="space-y-3">
            {data.checks.map(c => {
              const checkActions = actions.filter(a => a.ref_id === c.id)
              const link = ACTION_LINKS[c.id]
              return (
                <div key={c.id} className={`rounded-2xl border ${statusColors[c.status]} overflow-hidden`}>
                  <div className="flex items-start gap-4 p-5">
                    <div className="mt-0.5 flex-shrink-0">{statusIcons[c.status]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[15px] font-bold text-black dark:text-white">{c.title}</span>
                        <span className="px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] text-[11px] font-bold">{c.article}</span>
                      </div>
                      <p className="text-[13px] text-gray-600 dark:text-gray-400">{c.description}</p>
                      <p className="text-[12px] text-gray-400 mt-1">{c.details}</p>

                      {/* Quick actions row */}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        {(c.status === 'failed' || c.status === 'warning') && link && (
                          <button onClick={() => navigate(link)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-[#0071e3] text-white hover:bg-[#005bb5] transition-colors cursor-pointer">
                            <ExternalLink className="w-3 h-3" />{t('ki.action_fix_now')}
                          </button>
                        )}
                        <button onClick={() => setShowNewAction(showNewAction === c.id ? null : c.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-300 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer">
                          <Plus className="w-3 h-3" />{t('ki.action_create')}
                        </button>
                        {checkActions.length > 0 && (
                          <span className="text-[11px] font-medium text-gray-400">
                            {checkActions.filter(a => a.status === 'done').length}/{checkActions.length} {t('ki.action_tasks_done')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* New action form */}
                  {showNewAction === c.id && (
                    <div className="px-5 pb-4 pt-2 border-t border-gray-200/50 dark:border-gray-700/50 bg-white/50 dark:bg-black/10">
                      <div className="flex items-center gap-2">
                        <input type="text" value={newActionTitle} onChange={e => setNewActionTitle(e.target.value)}
                          placeholder={t('ki.action_title_placeholder')}
                          className="flex-1 px-3 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[13px] font-medium text-black dark:text-white border border-transparent focus:outline-none focus:border-[#0071e3]/30 focus:ring-2 focus:ring-[#0071e3]/10"
                          onKeyDown={e => e.key === 'Enter' && handleCreateAction(c.id, c.title)}
                          autoFocus />
                        <select value={newActionPriority} onChange={e => setNewActionPriority(e.target.value)}
                          className="px-3 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[12px] font-bold border-none outline-none text-black dark:text-white">
                          <option value="critical">{t('ki.priority_critical')}</option>
                          <option value="high">{t('ki.priority_high')}</option>
                          <option value="medium">{t('ki.priority_medium')}</option>
                          <option value="low">{t('ki.priority_low')}</option>
                        </select>
                        <button onClick={() => handleCreateAction(c.id, c.title)}
                          disabled={!newActionTitle.trim()}
                          className="px-4 py-2 rounded-xl bg-[#0071e3] text-white text-[12px] font-bold hover:bg-[#005bb5] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                          {t('ki.action_add')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Existing actions for this check */}
                  {checkActions.length > 0 && (
                    <div className="px-5 pb-4 border-t border-gray-200/50 dark:border-gray-700/50">
                      <div className="space-y-1.5 mt-3">
                        {checkActions.map(action => (
                          <div key={action.id} className="flex items-center gap-3 group">
                            <button onClick={() => handleToggleAction(action)} className="flex-shrink-0 cursor-pointer" title={t('ki.action_toggle_status')}>
                              {action.status === 'done'
                                ? <CircleCheck className="w-4 h-4 text-[#34c759]" />
                                : action.status === 'in_progress'
                                ? <CircleDot className="w-4 h-4 text-[#0071e3]" />
                                : <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                              }
                            </button>
                            <span className={`flex-1 text-[12px] font-medium ${action.status === 'done' ? 'line-through text-gray-400' : 'text-black dark:text-white'}`}>
                              {action.title}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                              action.priority === 'critical' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' :
                              action.priority === 'high' ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' :
                              action.priority === 'low' ? 'bg-gray-100 dark:bg-gray-800 text-gray-400' :
                              'bg-[#0071e3]/10 text-[#0071e3]'
                            }`}>{action.priority}</span>
                            <button onClick={() => handleDeleteAction(action.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-gray-400 hover:text-[#ff3b30]">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function LogsTab({ t }) {
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ feature: '', success: '', page: 1 })
  const [expandedId, setExpandedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showInfo, setShowInfo] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page: filter.page, limit: 15 }
      if (filter.feature) params.feature = filter.feature
      if (filter.success) params.success = filter.success
      const data = await aiLogsApi.getAll(params)
      setLogs(data.data || [])
      setPagination(data.pagination)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  const names = { matching: t('ki.feature_matching'), 'cv-parser': t('ki.feature_cv_parser'), 'job-generator': t('ki.feature_job_gen'), 'email-template': t('ki.feature_email_tpl'), 'interview-questions': t('ki.feature_interview_q') }

  const loadDetail = async (id) => {
    if (expandedId === id) { setExpandedId(null); setDetail(null); return }
    try { const d = await aiLogsApi.getById(id); setDetail(d); setExpandedId(id) } catch (_) {}
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-center gap-4">
          <FileText className="w-8 h-8 text-[#5e5ce6]" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.logs_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.logs_subtitle')}</p>
          </div>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t} />
        </div>
        <InfoContent show={showInfo} color="#5e5ce6"
          items={[
            { title: t('ki.logs_info_what_title'), text: t('ki.logs_info_what_text') },
            { title: t('ki.logs_info_why_title'), text: t('ki.logs_info_why_text') },
            { title: t('ki.logs_info_content_title'), bullets: [t('ki.logs_info_content1'), t('ki.logs_info_content2'), t('ki.logs_info_content3'), t('ki.logs_info_content4')] },
          ]}
          legalText={t('ki.logs_info_legal')}
        />
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-4 flex-wrap">
          <select value={filter.feature} onChange={e => setFilter({ ...filter, feature: e.target.value, page: 1 })}
            className="px-4 py-2.5 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-medium border-none outline-none text-black dark:text-white">
            <option value="">{t('ki.all_features')}</option>
            <option value="matching">{t('ki.feature_matching')}</option>
            <option value="cv-parser">{t('ki.feature_cv_parser')}</option>
            <option value="job-generator">{t('ki.feature_job_gen')}</option>
            <option value="email-template">{t('ki.feature_email_tpl')}</option>
            <option value="interview-questions">{t('ki.feature_interview_q')}</option>
          </select>
          <select value={filter.success} onChange={e => setFilter({ ...filter, success: e.target.value, page: 1 })}
            className="px-4 py-2.5 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-medium border-none outline-none text-black dark:text-white">
            <option value="">{t('ki.all_status')}</option>
            <option value="true">{t('ki.successful')}</option>
            <option value="false">{t('ki.failed')}</option>
          </select>
          {pagination && <span className="text-[13px] text-gray-400 ml-auto">{t('ki.logs_total').replace('{count}', pagination.total)}</span>}
        </div>
      </Card>

      {loading ? <LoadingSpinner text={t('ki.loading_logs')} /> : (
        <>
          <div className="space-y-3">
            {logs.map(log => (
              <Card key={log.id} className="overflow-hidden p-0">
                <div className="flex items-center gap-4 p-5 cursor-pointer hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors" onClick={() => loadDetail(log.id)}>
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${log.success ? 'bg-[#34c759]' : 'bg-[#ff3b30]'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-[15px] font-semibold text-black dark:text-white">{names[log.feature] || log.feature}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${['matching','cv-parser'].includes(log.feature) ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 'bg-[#34c759]/10 text-[#34c759]'}`}>
                        {['matching','cv-parser'].includes(log.feature) ? t('ki.high_risk') : t('ki.low_risk')}
                      </span>
                      {log.model && <span className="px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] text-[10px] font-bold">{log.model}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-[12px] text-gray-400">
                      <span><Clock className="w-3 h-3 inline mr-1" />{new Date(log.created_at).toLocaleString('de-DE')}</span>
                      {log.user_name && <span>{t('ki.by_user').replace('{name}', log.user_name)}</span>}
                      {log.duration_ms && <span>{(log.duration_ms / 1000).toFixed(1)}s</span>}
                      {log.input_tokens && <span>{log.input_tokens} in / {log.output_tokens} out</span>}
                      {log.error_message && <span className="text-[#ff3b30]">{log.error_message.slice(0, 60)}</span>}
                    </div>
                  </div>
                  <ChevronRight className={`w-5 h-5 text-gray-300 transition-transform ${expandedId === log.id ? 'rotate-90' : ''}`} />
                </div>
                {expandedId === log.id && detail && (
                  <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-800 space-y-4">
                    <div className="flex flex-wrap gap-2 pt-4">
                      {detail._meta?.riskLevel && (
                        <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${detail._meta.riskLevel === 'high' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 'bg-[#34c759]/10 text-[#34c759]'}`}>
                          {t('ki.risk')}: {detail._meta.riskLevel === 'high' ? t('ki.risk_high_annex') : t('ki.low_risk')}
                        </span>
                      )}
                      {detail._meta?.anonymizationApplied && <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-[#0071e3]/10 text-[#0071e3]">{t('ki.anonymization_active')}</span>}
                      {detail._meta?.aiActArticles?.map(a => (
                        <span key={a} className="px-2 py-1 rounded-full text-[10px] font-semibold bg-[#5e5ce6]/10 text-[#5e5ce6]">{a}</span>
                      ))}
                    </div>
                    <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                      <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">{t('ki.prompt_hash')}</p>
                      <code className="text-[13px] font-mono text-black dark:text-white">{detail.prompt_hash || '—'}</code>
                    </div>
                    {detail.prompt && (
                      <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                        <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">{t('ki.prompt_input')}</p>
                        <pre className="text-[12px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {detail.prompt.length > 2000 ? detail.prompt.slice(0, 2000) + '\n' + t('ki.truncated') : detail.prompt}
                        </pre>
                      </div>
                    )}
                    {detail.response && (
                      <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                        <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">{t('ki.response_output')}</p>
                        <pre className="text-[12px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {detail.response.length > 2000 ? detail.response.slice(0, 2000) + '\n' + t('ki.truncated') : detail.response}
                        </pre>
                      </div>
                    )}
                    {detail.error_message && (
                      <div className="p-4 rounded-xl bg-[#ff3b30]/5 border border-[#ff3b30]/10">
                        <p className="text-[11px] font-bold text-[#ff3b30] uppercase mb-1">{t('ki.error_label')}</p>
                        <p className="text-[13px] text-[#ff3b30]">{detail.error_message}</p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
          {logs.length === 0 && (
            <Card className="p-16 text-center">
              <Bot className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-[16px] text-gray-500">{t('ki.no_logs')}</p>
            </Card>
          )}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))} disabled={filter.page <= 1}
                className="px-4 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-default">{t('ki.page_prev')}</button>
              <span className="text-[14px] text-gray-500">{t('ki.page_of').replace('{page}', pagination.page).replace('{total}', pagination.totalPages)}</span>
              <button onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))} disabled={filter.page >= pagination.totalPages}
                className="px-4 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-default">{t('ki.page_next')}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BiasTab({ t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => { aiLogsApi.getBiasReport().then(setData).catch(() => {}).finally(() => setLoading(false)) }, [])

  if (loading) return <LoadingSpinner text={t('ki.bias_loading')} />
  if (!data) return <Card className="p-16 text-center"><p className="text-gray-500">{t('ki.bias_error')}</p></Card>

  const distColors = { '0-20': '#ff3b30', '20-40': '#ff9f0a', '40-60': '#ffcc00', '60-80': '#34c759', '80-100': '#0071e3' }
  const maxDist = Math.max(...Object.values(data.scoreAnalysis.distribution), 1)

  return (
    <div className="space-y-8">
      <Card className="p-6 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-center gap-4">
          <Scale className="w-8 h-8 text-[#5e5ce6] flex-shrink-0" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.bias_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.bias_desc')}</p>
          </div>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t} />
        </div>
        <InfoContent show={showInfo} color="#5e5ce6"
          items={[
            { title: t('ki.bias_info_what_title'), text: t('ki.bias_info_what_text') },
            { title: t('ki.bias_info_why_title'), text: t('ki.bias_info_why_text') },
            { title: t('ki.bias_info_measures_title'), bullets: [t('ki.bias_info_measure1'), t('ki.bias_info_measure2'), t('ki.bias_info_measure3'), t('ki.bias_info_measure4')] },
          ]}
          legalText={t('ki.bias_info_legal')}
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-1">{t('ki.score_distribution')}</h3>
          <p className="text-[12px] text-gray-400 mb-5">{t('ki.scores_from').replace('{scores}', data.scoreAnalysis.totalScoresAnalyzed).replace('{matchings}', data.scoreAnalysis.matchingsAnalyzed)}</p>
          <div className="space-y-3">
            {Object.entries(data.scoreAnalysis.distribution).map(([range, count]) => (
              <div key={range}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-medium text-black dark:text-white">{range}%</span>
                  <span className="text-[13px] font-semibold" style={{ color: distColors[range] }}>{count}</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-600">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((count / maxDist) * 100, 2)}%`, backgroundColor: distColors[range] }} />
                </div>
              </div>
            ))}
          </div>
          {data.scoreAnalysis.avgScore != null && (
            <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-[13px]">
              <span className="text-gray-400">{t('ki.avg_score')}: <strong className="text-black dark:text-white">{data.scoreAnalysis.avgScore}%</strong></span>
              <span className="text-gray-400">{t('ki.std_dev')}: <strong className="text-black dark:text-white">{data.scoreAnalysis.stdDeviation}%</strong></span>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-5">{t('ki.protection_measures')}</h3>
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-semibold text-black dark:text-white">{t('ki.anonymization')}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${data.anonymization.rate >= 95 ? 'bg-[#34c759]/10 text-[#34c759]' : data.anonymization.rate >= 50 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
                  {data.anonymization.rate}%
                </span>
              </div>
              <p className="text-[12px] text-gray-400">{t('ki.anon_of').replace('{done}', data.anonymization.anonymizedMatchings).replace('{total}', data.anonymization.totalMatchings)}</p>
              <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-600 mt-2">
                <div className="h-full rounded-full bg-[#0071e3] transition-all" style={{ width: `${data.anonymization.rate}%` }} />
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-semibold text-black dark:text-white">{t('ki.human_review')}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${data.humanReview.rate >= 80 ? 'bg-[#34c759]/10 text-[#34c759]' : data.humanReview.rate >= 30 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
                  {data.humanReview.rate}%
                </span>
              </div>
              <p className="text-[12px] text-gray-400">{t('ki.review_of').replace('{done}', data.humanReview.reviewed).replace('{total}', data.humanReview.total)}</p>
              <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-600 mt-2">
                <div className="h-full rounded-full bg-[#ff9f0a] transition-all" style={{ width: `${data.humanReview.rate}%` }} />
              </div>
            </div>
          </div>
        </Card>

        {data.locationAnalysis?.length > 0 && (
          <Card className="p-6">
            <h3 className="text-[16px] font-semibold text-black dark:text-white mb-1">{t('ki.location_analysis')}</h3>
            <p className="text-[12px] text-gray-400 mb-5">{t('ki.location_desc')}</p>
            <div className="space-y-3">
              {data.locationAnalysis.map(l => (
                <div key={l.location} className="flex items-center justify-between p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <span className="text-[14px] font-medium text-black dark:text-white">{l.location}</span>
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="text-gray-400">{l.total_in_matchings} {t('ki.applicants')}</span>
                    <span className={`font-semibold ${l.hired_rate > 0 ? 'text-[#34c759]' : 'text-gray-400'}`}>{Math.round(l.hired_rate)}% Hired</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {data.sourceBias?.length > 0 && (
          <Card className="p-6">
            <h3 className="text-[16px] font-semibold text-black dark:text-white mb-1">{t('ki.source_bias')}</h3>
            <p className="text-[12px] text-gray-400 mb-5">{t('ki.source_desc')}</p>
            <div className="space-y-3">
              {data.sourceBias.map(s => (
                <div key={s.source} className="flex items-center justify-between p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <span className="text-[14px] font-medium text-black dark:text-white">{s.source}</span>
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="text-gray-400">{s.count}</span>
                    <span className="text-[#0071e3] font-semibold">{Math.round(s.advancement_rate)}% {t('ki.advancement')}</span>
                    <span className={`font-semibold ${s.hired_rate > 0 ? 'text-[#34c759]' : 'text-gray-400'}`}>{Math.round(s.hired_rate)}% Hired</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function ModelCardTab({ t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => { aiLogsApi.getModelCard().then(setData).catch(() => {}).finally(() => setLoading(false)) }, [])

  if (loading) return <LoadingSpinner text={t('ki.mc_loading')} />
  if (!data) return <Card className="p-16 text-center"><p className="text-gray-500">{t('ki.mc_error')}</p></Card>

  const riskColors = { high: '#ff3b30', low: '#34c759' }
  const riskLabels = { high: t('ki.high_risk'), low: t('ki.low_risk') }

  return (
    <div className="space-y-8 max-w-[1000px]">
      <Card className="p-8 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-7 h-7 text-[#5e5ce6]" />
          </div>
          <div className="flex-1">
            <h2 className="text-[20px] font-semibold text-black dark:text-white mb-1">{t('ki.mc_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.mc_subtitle')}</p>
          </div>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t} />
        </div>
        <InfoContent show={showInfo} color="#5e5ce6"
          items={[
            { title: t('ki.mc_info_what_title'), text: t('ki.mc_info_what_text') },
            { title: t('ki.mc_info_why_title'), text: t('ki.mc_info_why_text') },
            { title: t('ki.mc_info_content_title'), bullets: [t('ki.mc_info_content1'), t('ki.mc_info_content2'), t('ki.mc_info_content3'), t('ki.mc_info_content4'), t('ki.mc_info_content5')] },
          ]}
          legalText={t('ki.mc_info_legal')}
        />
      </Card>

      {/* Model Identity */}
      <Card className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center"><Server className="w-6 h-6 text-[#5e5ce6]" /></div>
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.mc_model_identity')}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            [t('ki.mc_model_name'), data.model.name],
            [t('ki.mc_provider'), data.model.provider],
            [t('ki.mc_type'), data.model.type],
            [t('ki.mc_architecture'), data.model.architecture],
            [t('ki.mc_deployment'), data.model.deployment],
            [t('ki.mc_endpoint'), data.model.endpoint],
          ].map(([label, val]) => (
            <div key={label} className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">{label}</p>
              <p className="text-[15px] font-semibold text-black dark:text-white">{val}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Intended Use */}
      <Card className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#0071e3]/10 flex items-center justify-center"><Bot className="w-6 h-6 text-[#0071e3]" /></div>
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.mc_intended_use')}</h3>
        </div>
        <div className="space-y-3 mb-6">
          {data.intendedUse.primaryUses.map(u => (
            <div key={u.feature} className="flex items-center justify-between p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-[14px] font-bold text-black dark:text-white">{u.feature}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${riskColors[u.riskLevel]}15`, color: riskColors[u.riskLevel] }}>{riskLabels[u.riskLevel]}</span>
                </div>
                <p className="text-[12px] text-gray-500">{u.description}</p>
                <p className="text-[11px] text-[#5e5ce6] font-semibold mt-1">{u.aiActCategory}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 rounded-2xl bg-[#ff3b30]/5 border border-[#ff3b30]/10">
          <p className="text-[12px] font-bold text-[#ff3b30] uppercase mb-2">{t('ki.mc_out_of_scope')}</p>
          <ul className="space-y-1">
            {data.intendedUse.outOfScope.map((item, i) => (
              <li key={i} className="text-[13px] text-gray-600 dark:text-gray-400 flex items-center gap-2">
                <XCircle className="w-3.5 h-3.5 text-[#ff3b30] flex-shrink-0" />{item}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Data & Privacy */}
      <Card className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#34c759]/10 flex items-center justify-center"><Lock className="w-6 h-6 text-[#34c759]" /></div>
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.mc_data_privacy')}</h3>
        </div>
        <div className="space-y-4">
          {[
            [t('ki.mc_input_data'), data.dataHandling.inputDataTypes.join(', ')],
            [t('ki.mc_anonymization'), data.dataHandling.anonymization],
            [t('ki.mc_data_min'), data.dataHandling.dataMinimization],
            [t('ki.mc_retention'), data.dataHandling.dataRetention],
            [t('ki.mc_third_party'), data.dataHandling.thirdPartySharing],
          ].map(([label, val]) => (
            <div key={label} className="pl-4 border-l-2 border-gray-100 dark:border-gray-700">
              <h4 className="text-[14px] font-bold text-black dark:text-white mb-1">{label}</h4>
              <p className="text-[13px] text-gray-600 dark:text-gray-400">{val}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Performance */}
      {data.performance?.modelStats?.length > 0 && (
        <Card className="p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 flex items-center justify-center"><Zap className="w-6 h-6 text-[#ff9f0a]" /></div>
            <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.mc_performance')}</h3>
          </div>
          <div className="space-y-3 mb-6">
            {data.performance.modelStats.map(m => (
              <div key={m.model} className="flex items-center justify-between p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                <span className="text-[14px] font-bold text-black dark:text-white">{m.model}</span>
                <div className="flex items-center gap-4 text-[12px]">
                  <span className="text-gray-400">{m.total_calls} {t('ki.calls')}</span>
                  <span className="text-[#34c759] font-semibold">{m.successful} OK</span>
                  {m.avg_duration_ms && <span className="text-gray-400">{(m.avg_duration_ms / 1000).toFixed(1)}s Ø</span>}
                </div>
              </div>
            ))}
          </div>
          {data.performance.knownLimitations?.length > 0 && (
            <div className="p-4 rounded-2xl bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
              <p className="text-[12px] font-bold text-[#ff9f0a] uppercase mb-2">{t('ki.mc_limitations')}</p>
              <ul className="space-y-1">
                {data.performance.knownLimitations.map((item, i) => (
                  <li key={i} className="text-[13px] text-gray-600 dark:text-gray-400 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#ff9f0a] flex-shrink-0 mt-0.5" />{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Safeguards */}
      <Card className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#0071e3]/10 flex items-center justify-center"><Shield className="w-6 h-6 text-[#0071e3]" /></div>
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.mc_safeguards')}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            [t('ki.mc_sg_human'), data.safeguards.humanOversight, '#34c759', UserCheck],
            [t('ki.mc_sg_bias'), data.safeguards.biasMonitoring, '#ff9f0a', Scale],
            [t('ki.mc_sg_override'), data.safeguards.overrideLogging, '#5e5ce6', Eye],
            [t('ki.mc_sg_rate'), data.safeguards.rateLimiting, '#0071e3', Zap],
            [t('ki.mc_sg_error'), data.safeguards.errorHandling, '#ff3b30', AlertTriangle],
            [t('ki.mc_sg_transparency'), data.safeguards.transparency, '#ff9f0a', Eye],
          ].map(([label, val, color, Icon]) => (
            <div key={label} className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4" style={{ color }} />
                <p className="text-[13px] font-bold text-black dark:text-white">{label}</p>
              </div>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">{val}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Regulatory */}
      <Card className="p-8 mb-16">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#ff3b30]/10 flex items-center justify-center"><Scale className="w-6 h-6 text-[#ff3b30]" /></div>
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('ki.mc_regulatory')}</h3>
        </div>
        <p className="text-[15px] font-semibold text-[#5e5ce6] mb-4">{data.regulatoryInfo.regulation}</p>
        <div className="space-y-2 mb-4">
          {data.regulatoryInfo.applicableArticles.map((a, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <CheckCircle className="w-4 h-4 text-[#34c759] flex-shrink-0" />
              <span className="text-[13px] text-gray-700 dark:text-gray-300">{a}</span>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-gray-400 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
          {t('ki.mc_last_review')}: {data.regulatoryInfo.lastReview}
        </p>
      </Card>
    </div>
  )
}

function getInfoSections(t) {
  return [
    { icon: Bot, color: '#5e5ce6', title: t('ki.info_s1_title'), content: [
      { label: t('ki.info_s1_l1'), text: t('ki.info_s1_t1') },
      { label: t('ki.info_s1_l2'), text: t('ki.info_s1_t2') },
      { label: t('ki.info_s1_l3'), text: t('ki.info_s1_t3') },
    ]},
    { icon: Shield, color: '#0071e3', title: t('ki.info_s2_title'), content: [
      { label: t('ki.info_s2_l1'), text: t('ki.info_s2_t1') },
      { label: t('ki.info_s2_l2'), text: t('ki.info_s2_t2') },
    ]},
    { icon: Eye, color: '#34c759', title: t('ki.info_s3_title'), content: [
      { label: t('ki.info_s3_l1'), text: t('ki.info_s3_t1') },
      { label: t('ki.info_s3_l2'), text: t('ki.info_s3_t2') },
      { label: t('ki.info_s3_l3'), text: t('ki.info_s3_t3') },
    ]},
    { icon: UserCheck, color: '#ff9f0a', title: t('ki.info_s4_title'), content: [
      { label: t('ki.info_s4_l1'), text: t('ki.info_s4_t1') },
      { label: t('ki.info_s4_l2'), text: t('ki.info_s4_t2') },
      { label: t('ki.info_s4_l3'), text: t('ki.info_s4_t3') },
    ]},
    { icon: Scale, color: '#ff3b30', title: t('ki.info_s5_title'), content: [
      { label: t('ki.info_s5_l1'), text: t('ki.info_s5_t1') },
      { label: t('ki.info_s5_l2'), text: t('ki.info_s5_t2') },
      { label: t('ki.info_s5_l3'), text: t('ki.info_s5_t3') },
      { label: t('ki.info_s5_l4'), text: t('ki.info_s5_t4') },
    ]},
  ]
}

// ═══════════════════════════════════════
// Risk Register Tab
// ═══════════════════════════════════════
function RiskRegisterTab({ t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const [overrides, setOverrides] = useState({})
  const [actions, setActions] = useState([])
  const [editingRisk, setEditingRisk] = useState(null) // risk.id
  const [overrideStatus, setOverrideStatus] = useState('')
  const [overrideNotes, setOverrideNotes] = useState('')
  const [showNewTask, setShowNewTask] = useState(null) // risk.id
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState('high')
  const [expandedRisk, setExpandedRisk] = useState(null) // risk.id

  useEffect(() => {
    Promise.all([
      aiLogsApi.getRiskRegister(),
      complianceApi.getRiskOverrides().catch(() => ({ data: [] })),
      complianceApi.getActions({ ref_type: 'risk' }).catch(() => ({ data: [] })),
    ]).then(([d, o, a]) => {
      setData(d)
      // Build overrides map
      const map = {}
      for (const ov of (o.data || [])) { map[ov.risk_id] = ov }
      setOverrides(map)
      setActions(a.data || [])
    }).catch(() => null).finally(() => setLoading(false))
  }, [])

  const handleSaveOverride = async (riskId) => {
    try {
      const result = await complianceApi.setRiskOverride(riskId, overrideStatus || null, overrideNotes)
      if (overrideStatus) {
        setOverrides(prev => ({ ...prev, [riskId]: result }))
      } else {
        setOverrides(prev => { const copy = { ...prev }; delete copy[riskId]; return copy })
      }
      setEditingRisk(null)
      setOverrideStatus('')
      setOverrideNotes('')
    } catch (err) { console.error(err) }
  }

  const handleCreateTask = async (riskId, riskTitle) => {
    if (!newTaskTitle.trim()) return
    try {
      const action = await complianceApi.createAction({
        ref_type: 'risk',
        ref_id: riskId,
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        description: `Maßnahme für Risiko: ${riskTitle}`,
      })
      setActions(prev => [action, ...prev])
      setNewTaskTitle('')
      setShowNewTask(null)
    } catch (err) { console.error(err) }
  }

  const handleToggleTask = async (action) => {
    const newStatus = action.status === 'done' ? 'open' : action.status === 'open' ? 'in_progress' : 'done'
    try {
      const updated = await complianceApi.updateAction(action.id, { status: newStatus })
      setActions(prev => prev.map(a => a.id === action.id ? updated : a))
    } catch (err) { console.error(err) }
  }

  const handleDeleteTask = async (id) => {
    try {
      await complianceApi.deleteAction(id)
      setActions(prev => prev.filter(a => a.id !== id))
    } catch (err) { console.error(err) }
  }

  if (loading) return <LoadingSpinner text={t('ki.risk_loading')} />
  if (!data) return <Card className="p-8"><p className="text-gray-500">{t('ki.risk_error')}</p></Card>

  const levelColors = { high: '#ff3b30', medium: '#ff9f0a', low: '#34c759' }
  const statusLabels = { mitigated: t('ki.risk_mitigated'), active: t('ki.risk_active'), 'partially-mitigated': t('ki.risk_partial') }
  const statusColors = { mitigated: 'bg-[#34c759]/10 text-[#34c759]', active: 'bg-[#ff3b30]/10 text-[#ff3b30]', 'partially-mitigated': 'bg-[#ff9f0a]/10 text-[#ff9f0a]' }

  // Apply overrides to risks
  const risksWithOverrides = data.risks.map(risk => {
    const ov = overrides[risk.id]
    if (ov?.manual_status) {
      return { ...risk, status: ov.manual_status, _overridden: true, _overrideNotes: ov.notes, _overrideBy: ov.updated_by }
    }
    return risk
  })

  // Recalculate summary with overrides
  const active = risksWithOverrides.filter(r => r.status === 'active').length
  const mitigated = risksWithOverrides.filter(r => r.status === 'mitigated').length
  const partial = risksWithOverrides.filter(r => r.status === 'partially-mitigated').length

  return (
    <div className="space-y-6 max-w-[1200px]">
      <Card className="p-6 bg-gradient-to-br from-[#ff3b30]/5 to-[#ff9f0a]/5 border border-[#ff3b30]/10">
        <div className="flex items-center gap-4 mb-4">
          <AlertOctagon className="w-8 h-8 text-[#ff3b30]" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.risk_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.risk_subtitle')}</p>
          </div>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#ff3b30" t={t} />
        </div>
        <InfoContent show={showInfo} color="#ff3b30"
          items={[
            { title: t('ki.risk_info_what_title'), text: t('ki.risk_info_what_text') },
            { title: t('ki.risk_info_why_title'), text: t('ki.risk_info_why_text') },
            { title: t('ki.risk_info_levels_title'), bullets: [t('ki.risk_info_level1'), t('ki.risk_info_level2'), t('ki.risk_info_level3')] },
          ]}
          legalText={t('ki.risk_info_legal')}
        />
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#ff3b30]">{active}</p>
            <p className="text-[13px] text-gray-500">{t('ki.risk_active')}</p>
          </div>
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#ff9f0a]">{partial}</p>
            <p className="text-[13px] text-gray-500">{t('ki.risk_partial')}</p>
          </div>
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#34c759]">{mitigated}</p>
            <p className="text-[13px] text-gray-500">{t('ki.risk_mitigated')}</p>
          </div>
        </div>
      </Card>

      {risksWithOverrides.map(risk => {
        const riskActions = actions.filter(a => a.ref_id === risk.id)
        const isExpanded = expandedRisk === risk.id
        return (
          <Card key={risk.id} className="p-6 overflow-hidden">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${levelColors[risk.riskLevel]}15` }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: levelColors[risk.riskLevel] }} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-mono font-bold text-gray-400">{risk.id}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: `${levelColors[risk.riskLevel]}15`, color: levelColors[risk.riskLevel] }}>
                      {risk.riskLevel.toUpperCase()}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] font-semibold">{risk.aiActArticle}</span>
                    {risk._overridden && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#af52de]/10 text-[#af52de] font-bold">{t('ki.risk_manual_override')}</span>
                    )}
                  </div>
                  <h3 className="text-[16px] font-bold text-black dark:text-white">{risk.title}</h3>
                  <p className="text-[13px] text-gray-500 mt-1">{risk.description}</p>
                  {risk._overridden && risk._overrideNotes && (
                    <p className="text-[12px] text-[#af52de] mt-1 italic">💬 {risk._overrideNotes} — {risk._overrideBy}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`px-3 py-1 rounded-full text-[12px] font-bold ${statusColors[risk.status]}`}>
                  {statusLabels[risk.status]}
                </span>
                <button onClick={() => { setEditingRisk(editingRisk === risk.id ? null : risk.id); setOverrideStatus(risk.status); setOverrideNotes(risk._overrideNotes || '') }}
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
                  title={t('ki.risk_change_status')}>
                  <Pencil className="w-3.5 h-3.5 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Status override editor */}
            {editingRisk === risk.id && (
              <div className="mb-4 p-4 rounded-xl bg-[#af52de]/5 border border-[#af52de]/20">
                <p className="text-[12px] font-bold text-[#af52de] uppercase mb-3">{t('ki.risk_override_title')}</p>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {['active', 'partially-mitigated', 'mitigated'].map(s => (
                    <button key={s} onClick={() => setOverrideStatus(s)}
                      className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition-all cursor-pointer ${
                        overrideStatus === s ? statusColors[s] + ' ring-2 ring-offset-1 ring-current' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-500'
                      }`}>
                      {statusLabels[s]}
                    </button>
                  ))}
                  {risk._overridden && (
                    <button onClick={() => setOverrideStatus('')}
                      className="px-3 py-1.5 rounded-full text-[12px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer">
                      ↩ {t('ki.risk_reset_auto')}
                    </button>
                  )}
                </div>
                <textarea value={overrideNotes} onChange={e => setOverrideNotes(e.target.value)}
                  placeholder={t('ki.risk_override_notes_placeholder')}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#1c1c1e] text-[13px] font-medium text-black dark:text-white border border-[#af52de]/20 focus:outline-none focus:border-[#af52de] focus:ring-2 focus:ring-[#af52de]/10 resize-none mb-3" />
                <div className="flex items-center gap-2">
                  <button onClick={() => handleSaveOverride(risk.id)}
                    className="px-4 py-2 rounded-xl bg-[#af52de] text-white text-[12px] font-bold hover:bg-[#9b3bc9] transition-colors cursor-pointer">
                    {t('ki.risk_save_override')}
                  </button>
                  <button onClick={() => setEditingRisk(null)}
                    className="px-4 py-2 rounded-xl text-[12px] font-bold text-gray-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer">
                    {t('ki.action_cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Mitigations */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <p className="text-[13px] font-bold text-gray-700 dark:text-gray-300 mb-2">{t('ki.risk_mitigations')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {risk.mitigations.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 text-[13px] text-gray-600 dark:text-gray-400">
                    <CheckCircle className="w-4 h-4 text-[#34c759] mt-0.5 flex-shrink-0" />
                    {m}
                  </div>
                ))}
              </div>
            </div>

            {/* Tasks section - collapsible */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setExpandedRisk(isExpanded ? null : risk.id)}
                  className="flex items-center gap-2 text-[13px] font-bold text-gray-700 dark:text-gray-300 cursor-pointer hover:text-black dark:hover:text-white transition-colors">
                  <ListTodo className="w-4 h-4" />
                  {t('ki.risk_action_tasks')}
                  {riskActions.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold">
                      {riskActions.filter(a => a.status === 'done').length}/{riskActions.length}
                    </span>
                  )}
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                <button onClick={() => { setShowNewTask(showNewTask === risk.id ? null : risk.id); setExpandedRisk(risk.id) }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-300 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer">
                  <Plus className="w-3 h-3" />{t('ki.action_create')}
                </button>
              </div>

              {isExpanded && (
                <>
                  {/* New task form */}
                  {showNewTask === risk.id && (
                    <div className="flex items-center gap-2 mb-3">
                      <input type="text" value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
                        placeholder={t('ki.action_title_placeholder')}
                        className="flex-1 px-3 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[13px] font-medium text-black dark:text-white border border-transparent focus:outline-none focus:border-[#0071e3]/30 focus:ring-2 focus:ring-[#0071e3]/10"
                        onKeyDown={e => e.key === 'Enter' && handleCreateTask(risk.id, risk.title)}
                        autoFocus />
                      <select value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[12px] font-bold border-none outline-none text-black dark:text-white">
                        <option value="critical">{t('ki.priority_critical')}</option>
                        <option value="high">{t('ki.priority_high')}</option>
                        <option value="medium">{t('ki.priority_medium')}</option>
                        <option value="low">{t('ki.priority_low')}</option>
                      </select>
                      <button onClick={() => handleCreateTask(risk.id, risk.title)}
                        disabled={!newTaskTitle.trim()}
                        className="px-4 py-2 rounded-xl bg-[#0071e3] text-white text-[12px] font-bold hover:bg-[#005bb5] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        {t('ki.action_add')}
                      </button>
                    </div>
                  )}

                  {/* Task list */}
                  {riskActions.length > 0 ? (
                    <div className="space-y-1.5">
                      {riskActions.map(action => (
                        <div key={action.id} className="flex items-center gap-3 group p-1.5 rounded-lg hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors">
                          <button onClick={() => handleToggleTask(action)} className="flex-shrink-0 cursor-pointer" title={t('ki.action_toggle_status')}>
                            {action.status === 'done'
                              ? <CircleCheck className="w-4 h-4 text-[#34c759]" />
                              : action.status === 'in_progress'
                              ? <CircleDot className="w-4 h-4 text-[#0071e3]" />
                              : <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                            }
                          </button>
                          <span className={`flex-1 text-[12px] font-medium ${action.status === 'done' ? 'line-through text-gray-400' : 'text-black dark:text-white'}`}>
                            {action.title}
                          </span>
                          {action.created_by && (
                            <span className="text-[10px] text-gray-400 hidden sm:block">{action.created_by}</span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            action.priority === 'critical' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' :
                            action.priority === 'high' ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' :
                            action.priority === 'low' ? 'bg-gray-100 dark:bg-gray-800 text-gray-400' :
                            'bg-[#0071e3]/10 text-[#0071e3]'
                          }`}>{action.priority}</span>
                          <button onClick={() => handleDeleteTask(action.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-gray-400 hover:text-[#ff3b30]">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-gray-400 italic">{t('ki.risk_no_tasks')}</p>
                  )}
                </>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════
// Bias Testset Tab
// ═══════════════════════════════════════
function BiasTestsetTab({ t }) {
  const [profiles, setProfiles] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [jobDesc, setJobDesc] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    aiLogsApi.getBiasTestset().then(setProfiles).catch(() => null).finally(() => setLoading(false))
  }, [])

  const runTest = async () => {
    if (!jobDesc.trim()) return
    setRunning(true)
    try {
      const res = await aiLogsApi.runBiasTest({ jobDescription: jobDesc, jobTitle: jobTitle })
      setResults(res)
    } catch (e) {
      setResults({ error: e.message })
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <LoadingSpinner text={t('ki.biastest_loading')} />

  return (
    <div className="space-y-6 max-w-[1200px]">
      <Card className="p-6 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-center gap-4 mb-4">
          <TestTubes className="w-8 h-8 text-[#5e5ce6]" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.biastest_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.biastest_subtitle')}</p>
          </div>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t} />
        </div>

        <InfoContent show={showInfo} color="#5e5ce6"
          items={[
            { title: t('ki.biastest_info_what_title'), text: t('ki.biastest_info_what_text') },
            { title: t('ki.biastest_info_why_title'), text: t('ki.biastest_info_why_text') },
            { title: t('ki.biastest_info_how_title'), steps: [t('ki.biastest_info_step1'), t('ki.biastest_info_step2'), t('ki.biastest_info_step3'), t('ki.biastest_info_step4')] },
          ]}
          legalText={t('ki.biastest_info_legal')}
        />

        {profiles && (
          <div className="flex flex-wrap gap-2 mt-3">
            {profiles.diversityDimensions?.map((d, i) => (
              <span key={i} className="text-[12px] px-3 py-1 rounded-full bg-white/50 dark:bg-black/20 text-gray-600 dark:text-gray-400 font-medium">{d}</span>
            ))}
          </div>
        )}
      </Card>

      {/* Test runner */}
      <Card className="p-6">
        <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('ki.biastest_run')}</h3>
        <div className="space-y-3">
          <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder={t('ki.biastest_job_title')}
            className="w-full px-4 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-gray-200 dark:border-gray-700 text-[14px] outline-none focus:ring-2 focus:ring-[#5e5ce6]/30" />
          <textarea value={jobDesc} onChange={e => setJobDesc(e.target.value)} rows={4} placeholder={t('ki.biastest_job_desc')}
            className="w-full px-4 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-gray-200 dark:border-gray-700 text-[14px] outline-none focus:ring-2 focus:ring-[#5e5ce6]/30 resize-none" />
          <button onClick={runTest} disabled={running || !jobDesc.trim()}
            className="flex items-center gap-2 px-6 py-3 bg-[#5e5ce6] hover:bg-[#4d4bc5] text-white rounded-xl font-semibold text-[14px] disabled:opacity-50 transition-colors cursor-pointer">
            {running ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t('ki.biastest_running')}</> : <><Play className="w-4 h-4" />{t('ki.biastest_start')}</>}
          </button>
        </div>
      </Card>

      {/* Profiles overview */}
      {profiles && !results && (
        <Card className="p-6">
          <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('ki.biastest_profiles')} ({profiles.totalProfiles})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {profiles.profiles?.map(p => (
              <div key={p.id} className="p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200/50 dark:border-gray-700/50">
                <p className="text-[13px] font-bold text-black dark:text-white">{p.name}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{p.location} · {p.experience}</p>
                <p className="text-[11px] text-gray-400 mt-1">{p.skills}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Results */}
      {results && !results.error && (
        <>
          <Card className="p-6">
            <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('ki.biastest_results')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
                <p className="text-[24px] font-bold text-[#0071e3]">{Math.round(results.analysis.avgScore * 100)}%</p>
                <p className="text-[12px] text-gray-500">⌀ Score</p>
              </div>
              <div className="text-center p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
                <p className="text-[24px] font-bold text-[#5e5ce6]">{Math.round(results.analysis.stdDeviation * 100)}%</p>
                <p className="text-[12px] text-gray-500">σ {t('ki.biastest_deviation')}</p>
              </div>
              <div className="text-center p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
                <p className="text-[24px] font-bold text-black dark:text-white">{results.analysis.scoredProfiles}/{results.analysis.totalProfiles}</p>
                <p className="text-[12px] text-gray-500">{t('ki.biastest_scored')}</p>
              </div>
              <div className="text-center p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
                <p className="text-[24px] font-bold text-gray-600">{Math.round(results.duration / 1000)}s</p>
                <p className="text-[12px] text-gray-500">{t('ki.biastest_duration')}</p>
              </div>
            </div>

            {/* Scored profiles sorted by score */}
            <div className="space-y-2">
              {results.results?.filter(r => r.score !== null).sort((a, b) => b.score - a.score).map((r, i) => {
                const pct = Math.round(r.score * 100)
                const barColor = pct >= 70 ? '#34c759' : pct >= 40 ? '#ff9f0a' : '#ff3b30'
                return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                    <span className="text-[13px] font-bold text-black dark:text-white w-24 flex-shrink-0">{r.name}</span>
                    <div className="flex-1 h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="text-[13px] font-bold w-12 text-right" style={{ color: barColor }}>{pct}%</span>
                    <span className="text-[11px] text-gray-500 w-24 truncate hidden sm:block">{r.location}</span>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Bias alerts from test */}
          {results.biasAlerts?.length > 0 && (
            <Card className="p-6 border border-[#ff9f0a]/20">
              <h3 className="text-[16px] font-bold text-[#ff9f0a] mb-3">{t('ki.biastest_bias_alerts')}</h3>
              <div className="space-y-3">
                {results.biasAlerts.map((a, i) => (
                  <div key={i} className="p-3 rounded-xl bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
                    <p className="text-[13px] font-bold text-black dark:text-white">{a.message}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Location bias analysis */}
          {results.analysis.locationBias?.length > 0 && (
            <Card className="p-6">
              <h3 className="text-[16px] font-bold text-black dark:text-white mb-4">{t('ki.biastest_location_analysis')}</h3>
              <div className="space-y-2">
                {results.analysis.locationBias.map((l, i) => (
                  <div key={i} className="flex items-center gap-3 text-[13px]">
                    <span className="w-28 text-gray-600 dark:text-gray-400">{l.location}</span>
                    <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0071e3] rounded-full" style={{ width: `${Math.round(l.avgScore * 100)}%` }} />
                    </div>
                    <span className="font-bold text-black dark:text-white w-12 text-right">{Math.round(l.avgScore * 100)}%</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {results?.error && (
        <Card className="p-6 border border-[#ff3b30]/20">
          <p className="text-[14px] text-[#ff3b30] font-medium">{results.error}</p>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════
// Bias Alerts Tab
// ═══════════════════════════════════════
function BiasAlertsTab({ t }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    aiLogsApi.getBiasAlerts().then(setData).catch(() => null).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner text={t('ki.alerts_loading')} />
  if (!data) return <Card className="p-8"><p className="text-gray-500">{t('ki.alerts_error')}</p></Card>

  const severityColors = {
    critical: { bg: 'bg-[#ff3b30]/10', border: 'border-[#ff3b30]/20', text: 'text-[#ff3b30]', icon: '#ff3b30' },
    warning: { bg: 'bg-[#ff9f0a]/10', border: 'border-[#ff9f0a]/20', text: 'text-[#ff9f0a]', icon: '#ff9f0a' },
    info: { bg: 'bg-[#0071e3]/10', border: 'border-[#0071e3]/20', text: 'text-[#0071e3]', icon: '#0071e3' },
  }

  return (
    <div className="space-y-6 max-w-[1000px]">
      <Card className="p-6 bg-gradient-to-br from-[#ff9f0a]/5 to-[#ff3b30]/5 border border-[#ff9f0a]/10">
        <div className="flex items-center gap-4 mb-4">
          <Bell className="w-8 h-8 text-[#ff9f0a]" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.alerts_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.alerts_subtitle')}</p>
          </div>
          <InfoButton show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#ff9f0a" t={t} />
        </div>
        <InfoContent show={showInfo} color="#ff9f0a"
          items={[
            { title: t('ki.alerts_info_what_title'), text: t('ki.alerts_info_what_text') },
            { title: t('ki.alerts_info_why_title'), text: t('ki.alerts_info_why_text') },
            { title: t('ki.alerts_info_types_title'), bullets: [t('ki.alerts_info_type1'), t('ki.alerts_info_type2'), t('ki.alerts_info_type3')] },
          ]}
          legalText={t('ki.alerts_info_legal')}
        />
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#ff3b30]">{data.summary.critical}</p>
            <p className="text-[13px] text-gray-500">{t('ki.alerts_critical')}</p>
          </div>
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#ff9f0a]">{data.summary.warnings}</p>
            <p className="text-[13px] text-gray-500">{t('ki.alerts_warnings')}</p>
          </div>
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#0071e3]">{data.summary.info}</p>
            <p className="text-[13px] text-gray-500">{t('ki.alerts_info')}</p>
          </div>
        </div>
      </Card>

      {data.alerts.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle className="w-12 h-12 text-[#34c759] mx-auto mb-3" />
          <p className="text-[16px] font-semibold text-black dark:text-white">{t('ki.alerts_none')}</p>
          <p className="text-[14px] text-gray-500 mt-1">{t('ki.alerts_none_desc')}</p>
        </Card>
      ) : (
        data.alerts.map((alert, i) => {
          const colors = severityColors[alert.severity] || severityColors.info
          return (
            <Card key={i} className={`p-6 border ${colors.border}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.bg}`}>
                  <AlertTriangle className="w-5 h-5" style={{ color: colors.icon }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold uppercase ${colors.bg} ${colors.text}`}>{alert.severity}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">{alert.type}</span>
                  </div>
                  <h3 className="text-[15px] font-bold text-black dark:text-white mt-1">{alert.title}</h3>
                  <p className="text-[13px] text-gray-600 dark:text-gray-400 mt-1">{alert.message}</p>
                  {alert.recommendation && (
                    <div className="mt-3 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                      <p className="text-[12px] font-bold text-gray-500 mb-1">{t('ki.alerts_recommendation')}</p>
                      <p className="text-[13px] text-gray-700 dark:text-gray-300">{alert.recommendation}</p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}

function InfoTab({ t, locale }) {
  const sections = getInfoSections(t)
  return (
    <div className="space-y-8 max-w-[900px]">
      <Card className="p-8 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-7 h-7 text-[#5e5ce6]" />
          </div>
          <div>
            <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">{t('ki.info_notice_title')}</h2>
            <p className="text-[15px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('ki.info_notice_text') }} />
          </div>
        </div>
      </Card>
      {sections.map((section, idx) => {
        const Icon = section.icon
        return (
          <Card key={idx} className="p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${section.color}15` }}>
                <Icon className="w-6 h-6" style={{ color: section.color }} />
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight text-black dark:text-white">{section.title}</h2>
            </div>
            <div className="space-y-6">
              {section.content.map((item, i) => (
                <div key={i} className="pl-4 border-l-2 border-gray-100 dark:border-gray-700">
                  <h3 className="text-[15px] font-bold text-black dark:text-white mb-1">{item.label}</h3>
                  <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </Card>
        )
      })}
      <Card className="p-8 mb-16">
        <h2 className="text-[18px] font-semibold text-black dark:text-white mb-4">{t('ki.legal_title')}</h2>
        <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
          {t('ki.legal_text1')}
        </p>
        <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
          {t('ki.legal_text2')}
        </p>
        <p className="text-[13px] text-gray-400 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
          {t('ki.last_update')}: {new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </Card>
    </div>
  )
}
