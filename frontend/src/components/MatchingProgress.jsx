import { useState, useEffect, useRef } from 'react'
import { Zap, Clock, CheckCircle2, Hourglass, BarChart3 } from 'lucide-react'
import { useI18n } from '../I18nContext'

/**
 * MatchingProgress – zeigt Laufzeit, Fortschritt und optional Live-Zähler.
 *
 * Props:
 *  - running:   boolean – ist das Matching gerade aktiv?
 *  - totalPairs: number  – Anzahl zu berechnender Paare (Jobs × Bewerber)
 *  - progress:  object  – Live-Status eines Matching-Laufs
 *  - showPairCounts: boolean – Live-Zähler für Matrix-Paarungen anzeigen
 */
export default function MatchingProgress({
  running,
  totalPairs = 1,
  color = '#8b5cf6',
  progress: runProgress,
  showPairCounts = false,
}) {
  const { t } = useI18n()
  const [elapsed, setElapsed] = useState(0)        // Sekunden seit Start
  const [history, setHistory] = useState([])        // frühere Laufzeiten (s)
  const startRef = useRef(null)
  const timerRef = useRef(null)

  // Vergangene Laufzeiten aus localStorage laden
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('matching_history') || '[]')
      setHistory(stored.slice(-10))
    } catch (_) {}
  }, [])

  useEffect(() => {
    if (running) {
      setElapsed(0)
      startRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }, 500)
    } else {
      clearInterval(timerRef.current)
      if (startRef.current) {
        const duration = Math.floor((Date.now() - startRef.current) / 1000)
        if (duration > 2) {
          setHistory(prev => {
            const next = [...prev, duration].slice(-10)
            try { localStorage.setItem('matching_history', JSON.stringify(next)) } catch (_) {}
            return next
          })
        }
        startRef.current = null
      }
    }
    return () => clearInterval(timerRef.current)
  }, [running])

  if (!running && history.length === 0) return null

  // Statistiken berechnen
  const avgTime = history.length > 0
    ? Math.round(history.reduce((s, v) => s + v, 0) / history.length)
    : null

  const counters = runProgress?.counters
  const backendTotal = Number(counters?.targetCount ?? runProgress?.targetCount)
  const displayTotal = Number.isFinite(backendTotal) && backendTotal > 0 ? backendTotal : totalPairs
  const processedCount = Number(counters?.processedCount) || 0
  const cachedCount = Number(counters?.cachedCount) || 0
  const sharedCount = Number(counters?.sharedCount) || 0
  const computedCount = Number(counters?.computedCount) || 0
  const pendingCount = counters && backendTotal > 0
    ? Number(counters.pendingCount) || 0
    : Math.max(displayTotal - processedCount, 0)

  // Fortschritt schätzen: basierend auf Durchschnittszeit falls vorhanden
  // Sonst lineare Animation über 120s (cap bei 95%)
  const estimatedTotal = avgTime ? avgTime * 1.1 : 120
  const rawProgress = running ? Math.min((elapsed / estimatedTotal) * 100, 95) : 100
  const actualProgress = typeof counters?.progressPercent === 'number' && Number.isFinite(counters.progressPercent)
    ? counters.progressPercent
    : displayTotal > 0 ? (processedCount / displayTotal) * 100 : 0
  const progress = showPairCounts
    ? Math.round(Math.min(100, Math.max(0, running ? actualProgress : 100)))
    : Math.round(rawProgress)

  const etaSecs = showPairCounts
    ? pendingCount === 0
      ? 0
      : computedCount > 0 && elapsed > 0
        ? Math.ceil((pendingCount * elapsed) / computedCount)
        : null
    : running && avgTime
      ? Math.max(0, Math.round(avgTime * 1.1 - elapsed))
      : null

  const fmt = (s) => {
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  }
  const stats = showPairCounts
    ? [
      { icon: BarChart3, value: displayTotal, label: t('matching_progress.total_pairs') },
      { icon: CheckCircle2, value: cachedCount, label: t('matching_progress.cached_pairs') },
      { icon: CheckCircle2, value: sharedCount, label: t('matching_progress.shared_pairs') },
      { icon: Zap, value: computedCount, label: t('matching_progress.computed_pairs') },
      { icon: Hourglass, value: pendingCount, label: t('matching_progress.open_pairs') },
      { icon: Clock, value: fmt(elapsed), label: t('matching_progress.elapsed') },
      {
        icon: Hourglass,
        value: running
          ? etaSecs === null ? t('matching_progress.estimating') : `~${fmt(etaSecs)}`
          : fmt(elapsed),
        label: running ? t('matching_progress.estimated_remaining') : t('matching_progress.total_duration'),
      },
    ]
    : [
      { icon: BarChart3, value: totalPairs, label: t('matching_progress.total_pairs') },
      { icon: Clock, value: fmt(elapsed), label: t('matching_progress.elapsed') },
      {
        icon: Hourglass,
        value: running ? (etaSecs !== null ? `~${fmt(etaSecs)}` : '–') : fmt(elapsed),
        label: running ? 'Noch ca.' : 'Dauer gesamt',
      },
      {
        icon: CheckCircle2,
        value: avgTime !== null ? fmt(avgTime) : '–',
        label: `Ø letzte ${history.length} Runs`,
      },
    ]

  return (
    <div
      className="rounded-[20px] p-6 border"
      style={{ background: `${color}08`, borderColor: `${color}25` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${color}15` }}>
            {running
              ? <Zap className="w-4 h-4 animate-pulse" style={{ color }} />
              : <CheckCircle2 className="w-4 h-4" style={{ color: '#34c759' }} />
            }
          </div>
          <span className="text-[15px] font-semibold text-black dark:text-white">
            {showPairCounts
              ? running ? t('matching_progress.matrix_running') : t('matching_progress.matrix_finished')
              : running ? 'KI-Matching läuft…' : 'Matching abgeschlossen'}
          </span>
        </div>
        {running && (
          <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
            {showPairCounts ? `${progress}% · ` : ''}{fmt(elapsed)}
          </span>
        )}
      </div>

      {/* Fortschrittsbalken */}
      <div
        className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-5"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full transition duration-1000"
          style={{
            width: `${progress}%`,
            background: running
              ? `linear-gradient(90deg, ${color}, ${color}aa)`
              : '#34c759',
          }}
        />
      </div>

      {/* Statistik-Kacheln */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(({ icon: Icon, value, label }) => (
          <div key={label} className="rounded-[14px] p-3 bg-white/60 dark:bg-black/20 text-center">
            <div className="flex items-center justify-center mb-1">
              <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </div>
            <p className="text-[18px] font-bold text-black dark:text-white leading-none tabular-nums">{value}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
