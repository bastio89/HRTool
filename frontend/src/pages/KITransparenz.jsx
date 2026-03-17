import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot, Shield, Eye, Scale, UserCheck, AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight, FileText, Info, CreditCard, Zap, Lock, Server, AlertOctagon, TestTubes, Lightbulb, Bell, Play } from 'lucide-react'
import { Card, LoadingSpinner } from '../components/UI'
import { aiLogsApi } from '../api'
import { useI18n } from '../I18nContext'

const TABS = [
  { id: 'compliance', labelKey: 'ki.tab_compliance', icon: Shield },
  { id: 'logs', labelKey: 'ki.tab_logs', icon: FileText },
  { id: 'bias', labelKey: 'ki.tab_bias', icon: Scale },
  { id: 'riskreg', labelKey: 'ki.tab_risk_register', icon: AlertOctagon },
  { id: 'biastest', labelKey: 'ki.tab_bias_testset', icon: TestTubes },
  { id: 'alerts', labelKey: 'ki.tab_bias_alerts', icon: Bell },
  { id: 'modelcard', labelKey: 'ki.tab_modelcard', icon: CreditCard },
  { id: 'info', labelKey: 'ki.tab_info', icon: Info },
]

// Reusable info panel component
function InfoPanel({ show, onToggle, color, items, legalText, t }) {
  return (
    <>
      <button onClick={onToggle} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
        show ? `bg-[${color}] text-white shadow-lg shadow-[${color}]/25` : `bg-white/60 dark:bg-white/10 text-[${color}] hover:bg-[${color}]/10`
      }`} style={show ? { backgroundColor: color, boxShadow: `0 8px 16px ${color}40` } : { color }} title={t('ki.info_show')}>
        <Info className="w-[18px] h-[18px]" />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-in-out col-span-full ${show ? 'max-h-[800px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
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
    </>
  )
}

export default function KITransparenz() {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const [tab, setTab] = useState('compliance')

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

      {tab === 'compliance' && <ComplianceTab t={t} />}
      {tab === 'logs' && <LogsTab t={t} />}
      {tab === 'bias' && <BiasTab t={t} />}
      {tab === 'riskreg' && <RiskRegisterTab t={t} />}
      {tab === 'biastest' && <BiasTestsetTab t={t} />}
      {tab === 'alerts' && <BiasAlertsTab t={t} />}
      {tab === 'modelcard' && <ModelCardTab t={t} />}
      {tab === 'info' && <InfoTab t={t} locale={locale} />}
    </div>
  )
}

function ComplianceTab({ t }) {
  const [data, setData] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    Promise.all([
      aiLogsApi.getCompliance().catch(() => null),
      aiLogsApi.getStats().catch(() => null),
    ]).then(([c, s]) => { setData(c); setStats(s) }).finally(() => setLoading(false))
  }, [])

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
          <InfoPanel show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#0071e3" t={t}
            items={[
              { title: t('ki.compliance_info_what_title'), text: t('ki.compliance_info_what_text') },
              { title: t('ki.compliance_info_why_title'), text: t('ki.compliance_info_why_text') },
              { title: t('ki.compliance_info_checks_title'), bullets: [t('ki.compliance_info_check1'), t('ki.compliance_info_check2'), t('ki.compliance_info_check3'), t('ki.compliance_info_check4')] },
            ]}
            legalText={t('ki.compliance_info_legal')}
          />
        </div>
      </Card>

      {data?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
          <Card className="p-8 text-center">
            <div className={`text-[52px] font-bold tracking-tight ${data.summary.complianceScore >= 80 ? 'text-[#34c759]' : data.summary.complianceScore >= 50 ? 'text-[#ff9f0a]' : 'text-[#ff3b30]'}`}>
              {data.summary.complianceScore}%
            </div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">{t('ki.compliance_score')}</p>
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

      {data?.checks && (
        <Card className="p-8">
          <h3 className="text-[18px] font-semibold text-black dark:text-white mb-6">{t('ki.compliance_checklist')}</h3>
          <div className="space-y-3">
            {data.checks.map(c => (
              <div key={c.id} className={`flex items-start gap-4 p-5 rounded-2xl border ${statusColors[c.status]}`}>
                <div className="mt-0.5 flex-shrink-0">{statusIcons[c.status]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-[15px] font-bold text-black dark:text-white">{c.title}</span>
                    <span className="px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] text-[11px] font-bold">{c.article}</span>
                  </div>
                  <p className="text-[13px] text-gray-600 dark:text-gray-400">{c.description}</p>
                  <p className="text-[12px] text-gray-400 mt-1">{c.details}</p>
                </div>
              </div>
            ))}
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
          <InfoPanel show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t}
            items={[
              { title: t('ki.logs_info_what_title'), text: t('ki.logs_info_what_text') },
              { title: t('ki.logs_info_why_title'), text: t('ki.logs_info_why_text') },
              { title: t('ki.logs_info_content_title'), bullets: [t('ki.logs_info_content1'), t('ki.logs_info_content2'), t('ki.logs_info_content3'), t('ki.logs_info_content4')] },
            ]}
            legalText={t('ki.logs_info_legal')}
          />
        </div>
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
          <InfoPanel show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t}
            items={[
              { title: t('ki.bias_info_what_title'), text: t('ki.bias_info_what_text') },
              { title: t('ki.bias_info_why_title'), text: t('ki.bias_info_why_text') },
              { title: t('ki.bias_info_measures_title'), bullets: [t('ki.bias_info_measure1'), t('ki.bias_info_measure2'), t('ki.bias_info_measure3'), t('ki.bias_info_measure4')] },
            ]}
            legalText={t('ki.bias_info_legal')}
          />
        </div>
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
          <InfoPanel show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#5e5ce6" t={t}
            items={[
              { title: t('ki.mc_info_what_title'), text: t('ki.mc_info_what_text') },
              { title: t('ki.mc_info_why_title'), text: t('ki.mc_info_why_text') },
              { title: t('ki.mc_info_content_title'), bullets: [t('ki.mc_info_content1'), t('ki.mc_info_content2'), t('ki.mc_info_content3'), t('ki.mc_info_content4'), t('ki.mc_info_content5')] },
            ]}
            legalText={t('ki.mc_info_legal')}
          />
        </div>
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

  useEffect(() => {
    aiLogsApi.getRiskRegister().then(setData).catch(() => null).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner text={t('ki.risk_loading')} />
  if (!data) return <Card className="p-8"><p className="text-gray-500">{t('ki.risk_error')}</p></Card>

  const levelColors = { high: '#ff3b30', medium: '#ff9f0a', low: '#34c759' }
  const statusLabels = { mitigated: t('ki.risk_mitigated'), active: t('ki.risk_active'), 'partially-mitigated': t('ki.risk_partial') }
  const statusColors = { mitigated: 'bg-[#34c759]/10 text-[#34c759]', active: 'bg-[#ff3b30]/10 text-[#ff3b30]', 'partially-mitigated': 'bg-[#ff9f0a]/10 text-[#ff9f0a]' }

  return (
    <div className="space-y-6 max-w-[1200px]">
      <Card className="p-6 bg-gradient-to-br from-[#ff3b30]/5 to-[#ff9f0a]/5 border border-[#ff3b30]/10">
        <div className="flex items-center gap-4 mb-4">
          <AlertOctagon className="w-8 h-8 text-[#ff3b30]" />
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-black dark:text-white">{t('ki.risk_title')}</h2>
            <p className="text-[14px] text-gray-500">{t('ki.risk_subtitle')}</p>
          </div>
          <InfoPanel show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#ff3b30" t={t}
            items={[
              { title: t('ki.risk_info_what_title'), text: t('ki.risk_info_what_text') },
              { title: t('ki.risk_info_why_title'), text: t('ki.risk_info_why_text') },
              { title: t('ki.risk_info_levels_title'), bullets: [t('ki.risk_info_level1'), t('ki.risk_info_level2'), t('ki.risk_info_level3')] },
            ]}
            legalText={t('ki.risk_info_legal')}
          />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#ff3b30]">{data.summary.active}</p>
            <p className="text-[13px] text-gray-500">{t('ki.risk_active')}</p>
          </div>
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#ff9f0a]">{data.summary.partiallyMitigated}</p>
            <p className="text-[13px] text-gray-500">{t('ki.risk_partial')}</p>
          </div>
          <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded-xl">
            <p className="text-[28px] font-bold text-[#34c759]">{data.summary.mitigated}</p>
            <p className="text-[13px] text-gray-500">{t('ki.risk_mitigated')}</p>
          </div>
        </div>
      </Card>

      {data.risks.map(risk => (
        <Card key={risk.id} className="p-6">
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
                </div>
                <h3 className="text-[16px] font-bold text-black dark:text-white">{risk.title}</h3>
                <p className="text-[13px] text-gray-500 mt-1">{risk.description}</p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-[12px] font-bold flex-shrink-0 ${statusColors[risk.status]}`}>
              {statusLabels[risk.status]}
            </span>
          </div>
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
        </Card>
      ))}
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
          <button onClick={() => setShowInfo(!showInfo)} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
            showInfo ? 'bg-[#5e5ce6] text-white shadow-lg shadow-[#5e5ce6]/25' : 'bg-white/60 dark:bg-white/10 text-[#5e5ce6] hover:bg-[#5e5ce6]/10'
          }`} title={t('ki.biastest_info_toggle')}>
            <Info className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Collapsible info panel */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showInfo ? 'max-h-[800px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
          <div className="p-5 rounded-xl bg-white/70 dark:bg-black/20 border border-[#5e5ce6]/10 space-y-4">
            <div>
              <h4 className="text-[14px] font-bold text-[#5e5ce6] mb-1.5">{t('ki.biastest_info_what_title')}</h4>
              <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{t('ki.biastest_info_what_text')}</p>
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-[#5e5ce6] mb-1.5">{t('ki.biastest_info_why_title')}</h4>
              <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{t('ki.biastest_info_why_text')}</p>
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-[#5e5ce6] mb-1.5">{t('ki.biastest_info_how_title')}</h4>
              <ul className="space-y-1.5">
                {[1, 2, 3, 4].map(n => (
                  <li key={n} className="flex items-start gap-2 text-[13px] text-gray-600 dark:text-gray-400">
                    <span className="w-5 h-5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5">{n}</span>
                    <span className="leading-relaxed">{t(`ki.biastest_info_step${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#5e5ce6]/5 border border-[#5e5ce6]/10">
              <Scale className="w-4 h-4 text-[#5e5ce6] mt-0.5 flex-shrink-0" />
              <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">{t('ki.biastest_info_legal')}</p>
            </div>
          </div>
        </div>

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
          <InfoPanel show={showInfo} onToggle={() => setShowInfo(!showInfo)} color="#ff9f0a" t={t}
            items={[
              { title: t('ki.alerts_info_what_title'), text: t('ki.alerts_info_what_text') },
              { title: t('ki.alerts_info_why_title'), text: t('ki.alerts_info_why_text') },
              { title: t('ki.alerts_info_types_title'), bullets: [t('ki.alerts_info_type1'), t('ki.alerts_info_type2'), t('ki.alerts_info_type3')] },
            ]}
            legalText={t('ki.alerts_info_legal')}
          />
        </div>
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
