import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, test, vi } from 'vitest'
import MatchingProgress from './MatchingProgress'
import { I18nProvider } from '../I18nContext'

beforeEach(() => {
  localStorage.setItem('hr-locale', 'de')
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('schätzt die Restzeit anhand des echten Matrix-Fortschritts', () => {
  render(
    <I18nProvider>
      <MatchingProgress
        running
        totalPairs={10}
        showPairCounts
        progress={{
          targetCount: 10,
          counters: {
            targetCount: 10,
            processedCount: 2,
            computedCount: 2,
            cachedCount: 0,
            sharedCount: 0,
            pendingCount: 8,
            progressPercent: 20,
          },
        }}
      />
    </I18nProvider>,
  )

  act(() => vi.advanceTimersByTime(2000))

  expect(screen.getByText('~8s')).toBeInTheDocument()
  expect(screen.getByText('Voraussichtlich noch')).toBeInTheDocument()
})
