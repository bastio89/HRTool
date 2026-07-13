import { useState, useEffect, useRef } from 'react'
import { Zap, Clock, CheckCircle2, Hourglass, BarChart3 } from 'lucide-react'

/**
 * MatchingProgress – zeigt einen Fortschrittsbalken mit Statistiken während
 * eines laufenden KI-Matchings.
 *
 * Props:
 *  - running:   boolean – ist das Matching gerade aktiv?
 *  - totalPairs: number  – Anzahl zu berechnender Paare (Jobs × Bewerber)
 *  - color:     string  – Akzentfarbe (hex), default '#8b5cf6'
 */
export default function MatchingProgress({ running, totalPairs = 1, color = '#8b5cf6' }) {
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

  // Fortschritt schätzen: basierend auf Durchschnittszeit falls vorhanden
  // Sonst lineare Animation über 120s (cap bei 95%)
  const estimatedTotal = avgTime ? avgTime * 1.1 : 120
  const rawProgress = running ? Math.min((elapsed / estimatedTotal) * 100, 95) : 100
  const progress = Math.round(rawProgress)

  // ETA
  const etaSecs = running && avgTime
    ? Math.max(0, Math.round(avgTime * 1.1 - elapsed))
    : null

  const fmt = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`

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
            {running ? 'KI-Matching läuft…' : 'Matching abgeschlossen'}
          </span>
        </div>
        {running && (
          <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
            {fmt(elapsed)}
          </span>
        )}
      </div>

      {/* Fortschrittsbalken */}
      <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-5">
        <div
          className="h-full rounded-full transition-all duration-1000"
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
        {/* Paare */}
        <div className="rounded-[14px] p-3 bg-white/60 dark:bg-black/20 text-center">
          <div className="flex items-center justify-center mb-1">
            <BarChart3 className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-[18px] font-bold text-black dark:text-white leading-none">{totalPairs}</p>
          <p className="text-[11px] text-gray-400 mt-1">Paare gesamt</p>
        </div>

        {/* Verstrichene Zeit */}
        <div className="rounded-[14px] p-3 bg-white/60 dark:bg-black/20 text-center">
          <div className="flex items-center justify-center mb-1">
            <Clock className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-[18px] font-bold text-black dark:text-white leading-none tabular-nums">{fmt(elapsed)}</p>
          <p className="text-[11px] text-gray-400 mt-1">Verstrichene Zeit</p>
        </div>

        {/* ETA / Fertig */}
        <div className="rounded-[14px] p-3 bg-white/60 dark:bg-black/20 text-center">
          <div className="flex items-center justify-center mb-1">
            <Hourglass className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-[18px] font-bold text-black dark:text-white leading-none tabular-nums">
            {running
              ? (etaSecs !== null ? `~${fmt(etaSecs)}` : '–')
              : fmt(elapsed)
            }
          </p>
          <p className="text-[11px] text-gray-400 mt-1">{running ? 'Noch ca.' : 'Dauer gesamt'}</p>
        </div>

        {/* Durchschnitt */}
        <div className="rounded-[14px] p-3 bg-white/60 dark:bg-black/20 text-center">
          <div className="flex items-center justify-center mb-1">
            <CheckCircle2 className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-[18px] font-bold text-black dark:text-white leading-none tabular-nums">
            {avgTime !== null ? fmt(avgTime) : '–'}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">Ø letzte {history.length} Runs</p>
        </div>
      </div>
    </div>
  )
}
