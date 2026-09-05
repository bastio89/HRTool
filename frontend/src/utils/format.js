/**
 * Locale-aware formatting helpers.
 *
 * Dates and numbers were formatted with a hardcoded 'de-DE' in ~40 places, so
 * switching the app to English still produced German date and number formats.
 * These read the active locale instead.
 */

const TAGS = { de: 'de-DE', en: 'en-US' }

export function localeTag(locale) {
  return TAGS[locale] || TAGS.de
}

export function formatDate(value, locale, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(localeTag(locale), options)
}

export function formatDateTime(value, locale, options = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(localeTag(locale), options)
}

export function formatCompactNumber(value, locale) {
  return new Intl.NumberFormat(localeTag(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
}
