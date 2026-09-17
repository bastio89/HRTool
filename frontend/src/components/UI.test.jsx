/**
 * LoadingSpinner's default label used to be a hardcoded German string, so the
 * 23 call sites that omit `text` always rendered "Laden..." even in English.
 * The default now resolves through i18n; these pin down that change, including
 * the case where a caller passes an empty string to suppress the label.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { I18nProvider } from '../I18nContext'
import { LoadingSpinner, SkeletonList } from './UI'

const renderIn = (ui, locale = 'de') => {
  localStorage.setItem('hr-locale', locale)
  return render(<I18nProvider>{ui}</I18nProvider>)
}

describe('LoadingSpinner', () => {
  beforeEach(() => localStorage.clear())

  it('translates its default label', () => {
    expect(renderIn(<LoadingSpinner />, 'de').container.textContent).toBe('Laden...')
    expect(renderIn(<LoadingSpinner />, 'en').container.textContent).toBe('Loading...')
  })

  it('keeps an explicit label untouched', () => {
    expect(renderIn(<LoadingSpinner text="Eigener Text" />).container.textContent).toBe('Eigener Text')
  })

  it('still suppresses the label for an empty string', () => {
    expect(renderIn(<LoadingSpinner text="" />).container.textContent).toBe('')
  })
})

describe('SkeletonList', () => {
  it('renders a translated screen-reader label', () => {
    expect(renderIn(<SkeletonList rows={2} />, 'de').container.textContent).toContain('Laden')
  })
})
