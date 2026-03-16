import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot, Shield, Eye, Scale, UserCheck, AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight, FileText, Info } from 'lucide-react'
import { Card, LoadingSpinner } from '../components/UI'
import { aiLogsApi } from '../api'

const TABS = [
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'logs', label: 'KI-Protokoll', icon: FileText },
  { id: 'bias', label: 'Bias-Monitor', icon: Scale },
  { id: 'info', label: 'Informationen', icon: Info },
]

export default function KITransparenz() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('compliance')

  return (
    <div className="fade-in max-w-[1200px] mx-auto">
      <div className="flex items-center gap-4 sm:gap-8 mb-8">
        <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">KI-Transparenz</h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1">EU AI Act Compliance Dashboard — Verordnung (EU) 2024/1689</p>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-1.5 mb-8 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                tab === t.id ? 'bg-white dark:bg-[#3a3a3c] text-[#0071e3] dark:text-[#0a84ff] shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
              }`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          )
        })}
      </div>

      {tab === 'compliance' && <ComplianceTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'bias' && <BiasTab />}
      {tab === 'info' && <InfoTab />}
    </div>
  )
}

function ComplianceTab() {
  const [data, setData] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      aiLogsApi.getCompliance().catch(() => null),
      aiLogsApi.getStats().catch(() => null),
    ]).then(([c, s]) => { setData(c); setStats(s) }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner text="Compliance-Prüfung läuft..." />

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
      {data?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
          <Card className="p-8 text-center">
            <div className={`text-[52px] font-bold tracking-tight ${data.summary.complianceScore >= 80 ? 'text-[#34c759]' : data.summary.complianceScore >= 50 ? 'text-[#ff9f0a]' : 'text-[#ff3b30]'}`}>
              {data.summary.complianceScore}%
            </div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">Compliance Score</p>
          </Card>
          <Card className="p-8 text-center">
            <div className="text-[52px] font-bold tracking-tight text-[#34c759]">{data.summary.passed}</div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">Bestanden</p>
          </Card>
          <Card className="p-8 text-center">
            <div className="text-[52px] font-bold tracking-tight text-[#ff9f0a]">{data.summary.warnings}</div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">Warnungen</p>
          </Card>
          <Card className="p-8 text-center">
            <div className="text-[52px] font-bold tracking-tight text-[#ff3b30]">{data.summary.failed}</div>
            <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 mt-2">Fehlgeschlagen</p>
          </Card>
        </div>
      )}

      {stats?.totals && (
        <Card className="p-8">
          <h3 className="text-[18px] font-semibold text-black dark:text-white mb-6">KI-Nutzung Übersicht</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">Gesamt-Aufrufe</p>
              <p className="text-[28px] font-bold text-black dark:text-white">{stats.totals.total}</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">Erfolgsrate</p>
              <p className="text-[28px] font-bold text-[#34c759]">{stats.totals.successRate}%</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">Hochrisiko-Aufrufe</p>
              <p className="text-[28px] font-bold text-[#ff9f0a]">{stats.totals.highRiskCount}</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <p className="text-[12px] font-medium text-gray-500 mb-1">Hochrisiko-Anteil</p>
              <p className="text-[28px] font-bold text-[#ff9f0a]">{stats.totals.highRiskPercentage}%</p>
            </div>
          </div>
          {stats.byFeature?.length > 0 && (
            <div className="space-y-3">
              {stats.byFeature.map(f => {
                const riskLevel = ['matching', 'cv-parser'].includes(f.feature) ? 'Hochrisiko' : 'Niedrig'
                const riskColor = riskLevel === 'Hochrisiko' ? '#ff3b30' : '#34c759'
                const names = { matching: 'KI-Matching', 'cv-parser': 'CV-Parser', 'job-generator': 'Stellenbeschreibung' }
                return (
                  <div key={f.feature} className="flex items-center justify-between p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                    <div className="flex items-center gap-4">
                      <Bot className="w-5 h-5 text-[#5e5ce6]" />
                      <span className="text-[15px] font-semibold text-black dark:text-white">{names[f.feature] || f.feature}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${riskColor}15`, color: riskColor }}>{riskLevel}</span>
                    </div>
                    <div className="flex items-center gap-6 text-[13px]">
                      <span className="text-gray-400">{f.total} Aufrufe</span>
                      <span className="text-[#34c759] font-semibold">{f.successful} OK</span>
                      {f.failed > 0 && <span className="text-[#ff3b30] font-semibold">{f.failed} Fehler</span>}
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
          <h3 className="text-[18px] font-semibold text-black dark:text-white mb-6">Compliance-Checkliste (EU AI Act)</h3>
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

function LogsTab() {
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ feature: '', success: '', page: 1 })
  const [expandedId, setExpandedId] = useState(null)
  const [detail, setDetail] = useState(null)

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

  const names = { matching: 'KI-Matching', 'cv-parser': 'CV-Parser', 'job-generator': 'Stellenbeschreibung' }

  const loadDetail = async (id) => {
    if (expandedId === id) { setExpandedId(null); setDetail(null); return }
    try { const d = await aiLogsApi.getById(id); setDetail(d); setExpandedId(id) } catch (_) {}
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-center gap-4 flex-wrap">
          <select value={filter.feature} onChange={e => setFilter({ ...filter, feature: e.target.value, page: 1 })}
            className="px-4 py-2.5 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-medium border-none outline-none text-black dark:text-white">
            <option value="">Alle Features</option>
            <option value="matching">KI-Matching</option>
            <option value="cv-parser">CV-Parser</option>
            <option value="job-generator">Stellenbeschreibung</option>
          </select>
          <select value={filter.success} onChange={e => setFilter({ ...filter, success: e.target.value, page: 1 })}
            className="px-4 py-2.5 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-medium border-none outline-none text-black dark:text-white">
            <option value="">Alle Status</option>
            <option value="true">Erfolgreich</option>
            <option value="false">Fehlgeschlagen</option>
          </select>
          {pagination && <span className="text-[13px] text-gray-400 ml-auto">{pagination.total} Protokolle gesamt</span>}
        </div>
      </Card>

      {loading ? <LoadingSpinner text="Lade KI-Protokolle..." /> : (
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
                        {['matching','cv-parser'].includes(log.feature) ? 'Hochrisiko' : 'Niedrig'}
                      </span>
                      {log.model && <span className="px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] text-[10px] font-bold">{log.model}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-[12px] text-gray-400">
                      <span><Clock className="w-3 h-3 inline mr-1" />{new Date(log.created_at).toLocaleString('de-DE')}</span>
                      {log.user_name && <span>von {log.user_name}</span>}
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
                          Risiko: {detail._meta.riskLevel === 'high' ? 'Hoch (Annex III)' : 'Niedrig'}
                        </span>
                      )}
                      {detail._meta?.anonymizationApplied && <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-[#0071e3]/10 text-[#0071e3]">Anonymisierung aktiv</span>}
                      {detail._meta?.aiActArticles?.map(a => (
                        <span key={a} className="px-2 py-1 rounded-full text-[10px] font-semibold bg-[#5e5ce6]/10 text-[#5e5ce6]">{a}</span>
                      ))}
                    </div>
                    <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                      <p className="text-[11px] font-bold text-gray-400 uppercase mb-1">Prompt-Hash (SHA-256)</p>
                      <code className="text-[13px] font-mono text-black dark:text-white">{detail.prompt_hash || '—'}</code>
                    </div>
                    {detail.prompt && (
                      <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                        <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">Prompt (Eingabe)</p>
                        <pre className="text-[12px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {detail.prompt.length > 2000 ? detail.prompt.slice(0, 2000) + '\n... (gekürzt)' : detail.prompt}
                        </pre>
                      </div>
                    )}
                    {detail.response && (
                      <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                        <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">Response (Ausgabe)</p>
                        <pre className="text-[12px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {detail.response.length > 2000 ? detail.response.slice(0, 2000) + '\n... (gekürzt)' : detail.response}
                        </pre>
                      </div>
                    )}
                    {detail.error_message && (
                      <div className="p-4 rounded-xl bg-[#ff3b30]/5 border border-[#ff3b30]/10">
                        <p className="text-[11px] font-bold text-[#ff3b30] uppercase mb-1">Fehler</p>
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
              <p className="text-[16px] text-gray-500">Keine KI-Protokolle vorhanden</p>
            </Card>
          )}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))} disabled={filter.page <= 1}
                className="px-4 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-default">Zurück</button>
              <span className="text-[14px] text-gray-500">Seite {pagination.page} von {pagination.totalPages}</span>
              <button onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))} disabled={filter.page >= pagination.totalPages}
                className="px-4 py-2 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-default">Weiter</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BiasTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { aiLogsApi.getBiasReport().then(setData).catch(() => {}).finally(() => setLoading(false)) }, [])

  if (loading) return <LoadingSpinner text="Bias-Analyse läuft..." />
  if (!data) return <Card className="p-16 text-center"><p className="text-gray-500">Bias-Report konnte nicht geladen werden</p></Card>

  const distColors = { '0-20': '#ff3b30', '20-40': '#ff9f0a', '40-60': '#ffcc00', '60-80': '#34c759', '80-100': '#0071e3' }
  const maxDist = Math.max(...Object.values(data.scoreAnalysis.distribution), 1)

  return (
    <div className="space-y-8">
      <Card className="p-6 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-start gap-4">
          <Scale className="w-6 h-6 text-[#5e5ce6] flex-shrink-0 mt-1" />
          <div>
            <h3 className="text-[16px] font-bold text-black dark:text-white mb-1">Bias-Monitoring (Art. 9/10 EU AI Act)</h3>
            <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
              Überwachung der KI-Ergebnisse auf potenzielle Verzerrungen. Ungleichverteilungen in Scores oder Fortschrittsraten nach Standort/Quelle können auf systematische Bias hindeuten.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-1">Score-Verteilung</h3>
          <p className="text-[12px] text-gray-400 mb-5">{data.scoreAnalysis.totalScoresAnalyzed} Scores aus {data.scoreAnalysis.matchingsAnalyzed} Matchings</p>
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
              <span className="text-gray-400">Ø Score: <strong className="text-black dark:text-white">{data.scoreAnalysis.avgScore}%</strong></span>
              <span className="text-gray-400">Std.abw.: <strong className="text-black dark:text-white">{data.scoreAnalysis.stdDeviation}%</strong></span>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-[16px] font-semibold text-black dark:text-white mb-5">Schutzmaßnahmen</h3>
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-semibold text-black dark:text-white">Anonymisierung</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${data.anonymization.rate >= 95 ? 'bg-[#34c759]/10 text-[#34c759]' : data.anonymization.rate >= 50 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
                  {data.anonymization.rate}%
                </span>
              </div>
              <p className="text-[12px] text-gray-400">{data.anonymization.anonymizedMatchings} von {data.anonymization.totalMatchings} Matchings anonymisiert</p>
              <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-600 mt-2">
                <div className="h-full rounded-full bg-[#0071e3] transition-all" style={{ width: `${data.anonymization.rate}%` }} />
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14px] font-semibold text-black dark:text-white">Menschliche Überprüfung (Art. 14)</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${data.humanReview.rate >= 80 ? 'bg-[#34c759]/10 text-[#34c759]' : data.humanReview.rate >= 30 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
                  {data.humanReview.rate}%
                </span>
              </div>
              <p className="text-[12px] text-gray-400">{data.humanReview.reviewed} von {data.humanReview.total} Matchings überprüft</p>
              <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-600 mt-2">
                <div className="h-full rounded-full bg-[#ff9f0a] transition-all" style={{ width: `${data.humanReview.rate}%` }} />
              </div>
            </div>
          </div>
        </Card>

        {data.locationAnalysis?.length > 0 && (
          <Card className="p-6">
            <h3 className="text-[16px] font-semibold text-black dark:text-white mb-1">Standort-Analyse</h3>
            <p className="text-[12px] text-gray-400 mb-5">Hired-Rate nach Standort (Min. 2 Bewerber)</p>
            <div className="space-y-3">
              {data.locationAnalysis.map(l => (
                <div key={l.location} className="flex items-center justify-between p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <span className="text-[14px] font-medium text-black dark:text-white">{l.location}</span>
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="text-gray-400">{l.total_in_matchings} Bewerber</span>
                    <span className={`font-semibold ${l.hired_rate > 0 ? 'text-[#34c759]' : 'text-gray-400'}`}>{Math.round(l.hired_rate)}% Hired</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {data.sourceBias?.length > 0 && (
          <Card className="p-6">
            <h3 className="text-[16px] font-semibold text-black dark:text-white mb-1">Quellen-Bias</h3>
            <p className="text-[12px] text-gray-400 mb-5">Fortschrittsrate nach Bewerbungsquelle</p>
            <div className="space-y-3">
              {data.sourceBias.map(s => (
                <div key={s.source} className="flex items-center justify-between p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <span className="text-[14px] font-medium text-black dark:text-white">{s.source}</span>
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="text-gray-400">{s.count}</span>
                    <span className="text-[#0071e3] font-semibold">{Math.round(s.advancement_rate)}% Fortschritt</span>
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

const infoSections = [
  { icon: Bot, color: '#5e5ce6', title: 'Welche KI-Funktionen nutzt dieses Tool?', content: [
    { label: 'KI-Matching (Hochrisiko)', text: 'Vergleicht Bewerberprofile automatisch mit Stellenanforderungen und berechnet einen Matching-Score (0–100%). Nutzt ein Large Language Model (LLM) zur Analyse von Erfahrung, Skills, Ausbildung und weiteren Kriterien.' },
    { label: 'KI-CV-Parser (Hochrisiko)', text: 'Extrahiert automatisch strukturierte Daten (Name, Skills, Erfahrung etc.) aus hochgeladenen Lebensläufen (PDF/Word). Nutzt ein LLM zur intelligenten Textanalyse.' },
    { label: 'KI-Stellenbeschreibung (Niedriges Risiko)', text: 'Generiert auf Basis von Stichpunkten und Jobtitel eine Stellenbeschreibung. Keine personenbezogenen Daten — reine Textgenerierung.' },
  ]},
  { icon: Shield, color: '#0071e3', title: 'Risikoklassifizierung nach EU AI Act', content: [
    { label: 'Hochrisiko-Einstufung (Annex III, Kat. 4)', text: 'KI-Matching und CV-Parser fallen unter Anhang III, Kategorie 4 des EU AI Acts ("Beschäftigung, Arbeitnehmerverwaltung und Zugang zur Selbständigkeit"). Diese unterliegen den Anforderungen der Art. 6–15.' },
    { label: 'Konformitätsbewertung (Art. 43)', text: 'Als Betreiber eines Hochrisiko-KI-Systems sind regelmäßige Konformitätsprüfungen, Dokumentation und Überwachung erforderlich. Dieses Dashboard unterstützt diese Pflichten durch automatische Prüfungen.' },
  ]},
  { icon: Eye, color: '#34c759', title: 'Transparenz & Nachvollziehbarkeit (Art. 12/13)', content: [
    { label: 'Vollständiges Prompt-Logging', text: 'Jeder KI-Aufruf wird mit Eingabe (Prompt), Ausgabe (Response), Modell, Dauer, Token-Anzahl und auslösendem Nutzer protokolliert. Einsehbar im Tab "KI-Protokoll".' },
    { label: 'KI-Kennzeichnung (Art. 50)', text: 'Alle KI-generierten Inhalte sind durch lila Badges und Transparenzhinweise gekennzeichnet.' },
    { label: 'Prompt-Hashing', text: 'Jeder Prompt erhält einen SHA-256 Hash zur eindeutigen Identifizierung.' },
  ]},
  { icon: UserCheck, color: '#ff9f0a', title: 'Menschliche Aufsicht (Art. 14)', content: [
    { label: 'Keine automatisierten Entscheidungen', text: 'Die KI trifft keine eigenständigen Einstellungsentscheidungen. Alle Ergebnisse sind Vorschläge.' },
    { label: 'Human-Review-Pflicht', text: 'Matching-Ergebnisse können explizit als "menschlich überprüft" markiert werden. Der Compliance-Tab zeigt die Review-Quote.' },
    { label: 'Override-Möglichkeit', text: 'Recruiter können alle KI-Vorschläge bearbeiten, verwerfen oder überstimmen.' },
  ]},
  { icon: Scale, color: '#ff3b30', title: 'Datenschutz, Fairness & Bias-Monitoring (Art. 9/10)', content: [
    { label: 'Anonymisierung', text: 'Beim KI-Matching werden Bewerbernamen durch Platzhalter ersetzt ("Kandidat 1"). Name, Geschlecht und Herkunft beeinflussen die Bewertung nicht.' },
    { label: 'Bias-Monitoring', text: 'Der Tab "Bias-Monitor" analysiert Score-Verteilungen, Hired-Raten nach Standort und Quelle.' },
    { label: 'Lokale Verarbeitung', text: 'Das LLM (Ollama) läuft lokal — keine Daten werden an externe Cloud-Dienste übertragen.' },
    { label: 'Datenminimierung', text: 'Nur jobrelevante Felder werden an die KI übermittelt. Sensible Daten werden nicht verarbeitet.' },
  ]},
]

function InfoTab() {
  return (
    <div className="space-y-8 max-w-[900px]">
      <Card className="p-8 bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 border border-[#5e5ce6]/10">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-7 h-7 text-[#5e5ce6]" />
          </div>
          <div>
            <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">Hinweis für Bewerber und Nutzer</h2>
            <p className="text-[15px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
              Dieses HR-Tool setzt KI-Systeme ein, die nach dem <span className="font-semibold text-[#5e5ce6]">EU AI Act (VO (EU) 2024/1689)</span> teilweise als Hochrisiko eingestuft sind.
            </p>
          </div>
        </div>
      </Card>
      {infoSections.map((section, idx) => {
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
        <h2 className="text-[18px] font-semibold text-black dark:text-white mb-4">Rechtsgrundlage</h2>
        <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed mb-3">
          Informationen gemäß <span className="font-semibold">Art. 13, Art. 14 und Art. 50 der Verordnung (EU) 2024/1689</span> (EU AI Act)
          sowie der Aufzeichnungspflichten nach Art. 12.
        </p>
        <p className="text-[14px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
          Betroffene haben das Recht auf Auskunft über die Funktionsweise der KI-Systeme und die verarbeiteten Daten.
        </p>
        <p className="text-[13px] text-gray-400 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
          Letzte Aktualisierung: {new Date().toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </Card>
    </div>
  )
}
