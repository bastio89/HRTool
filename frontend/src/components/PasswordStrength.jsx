import { useMemo } from 'react'
import { Check, X } from 'lucide-react'
import { useI18n } from '../I18nContext'

const RULES = [
  { test: pw => pw.length >= 8, labelKey: 'password_strength.min_length' },
  { test: pw => /[A-Z]/.test(pw), labelKey: 'password_strength.uppercase' },
  { test: pw => /[a-z]/.test(pw), labelKey: 'password_strength.lowercase' },
  { test: pw => /[0-9]/.test(pw), labelKey: 'password_strength.number' },
  { test: pw => /[^A-Za-z0-9]/.test(pw), labelKey: 'password_strength.special' },
]

export default function PasswordStrength({ password = '' }) {
  const { t } = useI18n()
  const results = useMemo(() =>
    RULES.map(r => ({ ...r, pass: r.test(password) })),
    [password]
  )

  const passed = results.filter(r => r.pass).length
  const total = results.length
  const strength = password.length === 0 ? 0 : Math.round((passed / total) * 100)

  const barColor =
    strength <= 20 ? '#ff3b30' :
    strength <= 40 ? '#ff9f0a' :
    strength <= 60 ? '#ffcc00' :
    strength <= 80 ? '#34c759' :
    '#30d158'

  if (!password) return null

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${strength}%`, backgroundColor: barColor }}
          />
        </div>
        <span className="text-[12px] font-semibold" style={{ color: barColor }}>
          {strength <= 40 ? t('password_strength.weak') : strength <= 60 ? t('password_strength.medium') : strength <= 80 ? t('password_strength.good') : t('password_strength.strong')}
        </span>
      </div>

      {/* Rules checklist */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {results.map(r => (
          <span key={r.labelKey} className={`flex items-center gap-1 text-[12px] font-medium transition-colors ${r.pass ? 'text-[#34c759]' : 'text-gray-400 dark:text-gray-500'}`}>
            {r.pass ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            {t(r.labelKey)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function isPasswordValid(password) {
  return RULES.every(r => r.test(password))
}
