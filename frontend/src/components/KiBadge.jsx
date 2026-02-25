import { Bot, Info } from 'lucide-react'
import { useState } from 'react'

/**
 * KI-Badge: Visueller Hinweis, dass Inhalte KI-generiert sind.
 * EU AI Act Art. 13 – Transparenzpflicht.
 */
export function KiBadge({ label = 'KI-generiert', tooltip, className = '' }) {
  const [showTip, setShowTip] = useState(false)
  return (
    <span
      className={`relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold bg-[#5e5ce6]/10 text-[#5e5ce6] dark:bg-[#5e5ce6]/20 dark:text-[#a5a4f3] select-none ${className}`}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <Bot className="w-3.5 h-3.5" />
      {label}
      {tooltip && showTip && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl bg-black/90 dark:bg-white/90 text-[11px] font-medium text-white dark:text-black leading-relaxed shadow-xl z-50 pointer-events-none">
          {tooltip}
        </span>
      )}
    </span>
  )
}

/**
 * KI-Disclaimer-Banner: Info-Hinweis zur KI-Nutzung bei Ergebnissen.
 * EU AI Act Art. 13/14 – Transparenz & menschliche Aufsicht.
 */
export function KiDisclaimer({ feature = 'matching', className = '' }) {
  const messages = {
    matching: 'Diese Ergebnisse wurden von einer KI (LLM) erzeugt. Scores und Bewertungen dienen als Entscheidungshilfe — die finale Beurteilung muss immer durch einen Menschen erfolgen.',
    'cv-parser': 'Die Felder wurden automatisch durch KI aus dem Lebenslauf extrahiert. Bitte überprüfe alle Angaben auf Richtigkeit, bevor du speicherst.',
    'job-generator': 'Beschreibung und Anforderungen wurden von einer KI generiert. Bitte prüfe und passe den Text an, bevor du die Stelle veröffentlichst.',
  }

  return (
    <div className={`flex items-start gap-4 p-5 rounded-2xl bg-[#5e5ce6]/5 dark:bg-[#5e5ce6]/10 border border-[#5e5ce6]/10 dark:border-[#5e5ce6]/20 ${className}`}>
      <div className="w-9 h-9 rounded-full bg-[#5e5ce6]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Info className="w-4.5 h-4.5 text-[#5e5ce6]" />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-bold text-[#5e5ce6] uppercase tracking-wider">KI-Transparenzhinweis</span>
          <KiBadge label="KI-gestützt" className="text-[10px] px-2 py-0.5" />
        </div>
        <p className="text-[13px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
          {messages[feature] || messages.matching}
        </p>
      </div>
    </div>
  )
}
