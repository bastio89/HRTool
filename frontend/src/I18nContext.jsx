import { createContext, useContext, useState, useCallback } from 'react'
import de from './i18n/de'
import en from './i18n/en'

const translations = { de, en }
const I18nContext = createContext()

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(() => {
    const saved = localStorage.getItem('hr-locale')
    if (saved && translations[saved]) return saved
    // Auto-detect from browser
    const browserLang = navigator.language?.split('-')[0]
    return translations[browserLang] ? browserLang : 'de'
  })

  const changeLocale = useCallback((newLocale) => {
    if (translations[newLocale]) {
      setLocale(newLocale)
      localStorage.setItem('hr-locale', newLocale)
    }
  }, [])

  const t = useCallback((key, fallback) => {
    return translations[locale]?.[key] || translations.de?.[key] || fallback || key
  }, [locale])

  return (
    <I18nContext.Provider value={{ locale, changeLocale, t, availableLocales: ['de', 'en'] }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = () => useContext(I18nContext)
