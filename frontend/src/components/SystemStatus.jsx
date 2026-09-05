import { createContext, useContext, useState, useEffect, useCallback, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw, ChevronRight, Activity } from 'lucide-react'
import { healthApi, settingsApi } from '../api'
import { useI18n } from '../I18nContext'
import { localeTag } from '../utils/format'

/**
 * One source of truth for "is everything up?".
 *
 * Replaces two independent header pills that each polled on their own timer:
 * together they fired four requests a minute (two /health calls plus the AI
 * config and connection test) and still showed only two of the four services
 * the health endpoint already reports. This polls once and shares the result.
 */

const SystemStatusContext = createContext(null)

const POLL_MS = 60000

/** ok > degraded > down, worst wins when rolling up to a single state. */
const RANK = { ok: 0, degraded: 1, down: 2, unknown: 3 }

function normalise(raw) {
  if (raw === 'ok' || raw === true) return 'ok'
  if (raw === 'degraded') return 'degraded'
  if (raw === undefined || raw === null) return 'unknown'
  return 'down'
}

export function SystemStatusProvider({ children }) {
  const [state, setState] = useState({
    checking: true,
    lastCheck: null,
    services: {},
    usage: { calls: 0, total_tokens: 0 },
  })
  // The AI endpoint config barely changes; fetching it on every poll was one of
  // the four requests a minute for no gain.
  const aiConfigRef = useRef(null)
  const mountedRef = useRef(true)

  const check = useCallback(async () => {
    setState(prev => ({ ...prev, checking: true }))

    const health = await healthApi.check().catch(() => null)

    let ai = 'unknown'
    try {
      if (!aiConfigRef.current) aiConfigRef.current = await settingsApi.getAiConfig()
      const cfg = aiConfigRef.current
      const res = await settingsApi.testAiConnection(cfg.baseUrl, undefined, cfg.provider)
      ai = res?.reachable ? 'ok' : 'down'
    } catch {
      ai = 'down'
    }

    if (!mountedRef.current) return
    setState({
      checking: false,
      lastCheck: new Date(),
      services: {
        backend: normalise(health?.services?.backend),
        database: normalise(health?.services?.database),
        ai,
        graphrag: normalise(health?.services?.graphrag),
        n8n: normalise(health?.services?.n8n),
      },
      usage: {
        calls: Number(health?.aiUsage?.calls) || 0,
        total_tokens: Number(health?.aiUsage?.total_tokens) || 0,
      },
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    check()
    const id = setInterval(check, POLL_MS)
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [check])

  const values = Object.values(state.services)
  const overall = state.checking && !state.lastCheck
    ? 'checking'
    : values.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok')
  const downCount = values.filter(s => s === 'down' || s === 'degraded').length

  return (
    <SystemStatusContext.Provider value={{ ...state, overall, downCount, refresh: check }}>
      {children}
    </SystemStatusContext.Provider>
  )
}

export const useSystemStatus = () => useContext(SystemStatusContext) || {
  checking: false, lastCheck: null, services: {}, usage: { calls: 0, total_tokens: 0 },
  overall: 'unknown', downCount: 0, refresh: () => {},
}

const TONE = {
  ok:       { dot: 'bg-[#34c759]', text: 'text-[#1f9d55] dark:text-[#7dffaf]', icon: CheckCircle2 },
  degraded: { dot: 'bg-[#ff9f0a]', text: 'text-[#a86a00] dark:text-[#ffc46b]', icon: AlertTriangle },
  down:     { dot: 'bg-[#ff3b30]', text: 'text-[#b91c1c] dark:text-[#ff8a80]', icon: XCircle },
  unknown:  { dot: 'bg-gray-400',  text: 'text-gray-500 dark:text-gray-400',   icon: AlertTriangle },
  checking: { dot: 'bg-gray-400',  text: 'text-gray-500 dark:text-gray-400',   icon: Loader2 },
}

const SERVICES = [
  { key: 'ai',       labelKey: 'system.service_ai',       to: '/admin/ai' },
  { key: 'graphrag', labelKey: 'system.service_graphrag', to: '/admin/ai' },
  { key: 'backend',  labelKey: 'system.service_backend',  to: null },
  { key: 'database', labelKey: 'system.service_database', to: null },
  { key: 'n8n',      labelKey: 'system.service_n8n',      to: null },
]

function relativeTime(date, t, locale) {
  if (!date) return t('system.never_checked')
  const secs = Math.round((Date.now() - date.getTime()) / 1000)
  if (secs < 10) return t('system.just_now')
  if (secs < 60) return t('system.seconds_ago').replace('{n}', secs)
  const mins = Math.round(secs / 60)
  if (mins < 60) return t('system.minutes_ago').replace('{n}', mins)
  return date.toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit' })
}

/**
 * Header control: one quiet chip that rolls the whole system up to a single
 * state, and opens the per-service detail on demand. Healthy is deliberately
 * understated - a permanently loud green badge trains people to ignore the
 * spot, which is exactly where the red one will appear.
 */
export default function SystemStatusChip() {
  const { t, locale } = useI18n()
  const { overall, downCount, services, lastCheck, checking, usage, refresh } = useSystemStatus()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); wrapRef.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const tone = TONE[overall] || TONE.unknown
  const healthy = overall === 'ok'
  const label = overall === 'checking' ? t('system.checking')
    : healthy ? t('system.all_ok')
    : t('system.n_down').replace('{n}', downCount)

  const formatNumber = (v) => new Intl.NumberFormat(localeTag(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0)

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t('system.title')}: ${label}`}
        className={`flex items-center gap-2 px-3 py-2 rounded-full border text-[12px] font-semibold cursor-pointer
          transition-colors duration-200
          ${healthy || overall === 'checking'
            // Healthy state stays as quiet as the rest of the toolbar.
            ? 'bg-transparent border-gray-200/80 dark:border-gray-700/80 text-gray-500 dark:text-gray-400 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
            : 'bg-[#ff3b30]/10 border-[#ff3b30]/25 ' + tone.text}`}
      >
        {overall === 'checking'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tone.dot}`} />}
        <span className="hidden lg:inline">{label}</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={t('system.title')}
          className="absolute right-0 top-full mt-2 w-[290px] layer-popover
            bg-white dark:bg-[#1c1c1e] rounded-[18px] shadow-[var(--shadow-overlay)]
            border border-gray-200/60 dark:border-gray-700/60 overflow-hidden animate-modal-in"
        >
          <div className="px-4 pt-3.5 pb-2.5 border-b border-gray-100 dark:border-gray-800">
            <p className="text-[13px] font-semibold text-black dark:text-white">{t('system.title')}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {t('system.last_check')}: {relativeTime(lastCheck, t, locale)}
            </p>
          </div>

          <ul className="py-1.5">
            {SERVICES.map(({ key, labelKey, to }) => {
              const s = services[key] || 'unknown'
              const st = TONE[s]
              const row = (
                <>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} aria-hidden="true" />
                  <span className="text-[13px] font-medium text-black dark:text-white flex-1">{t(labelKey)}</span>
                  <span className={`text-[11px] font-semibold ${st.text}`}>{t(`system.state_${s}`)}</span>
                  {to && <ChevronRight className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />}
                </>
              )
              return (
                <li key={key}>
                  {to ? (
                    <Link
                      to={to}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2.5 px-4 py-2">{row}</div>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Usage stays available, but out of the toolbar and with its period
              spelled out - the number is cumulative, not "today". */}
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {t('system.usage_total').replace('{calls}', formatNumber(usage.calls)).replace('{tokens}', formatNumber(usage.total_tokens))}
            </span>
          </div>

          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={refresh}
              disabled={checking}
              className="flex items-center gap-2 text-[12px] font-semibold text-[#0071e3] dark:text-[#0a84ff]
                hover:opacity-70 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? t('system.checking') : t('system.recheck')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
