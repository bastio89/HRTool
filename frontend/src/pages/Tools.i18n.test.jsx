/**
 * Guards the i18n coverage of the Tools pages.
 *
 * Both pages shipped with every string hardcoded in German; switching the app
 * to English left them untranslated. These render them under the English
 * locale and assert that none of the former German literals come back.
 */
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../I18nContext'
import { ToastProvider } from '../components/Toast'
import Tools from './Tools'
import ToolsLinkedIn from './ToolsLinkedIn'

const memoryStorage = (() => {
  let store = {}
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value)
    },
    removeItem: (key) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
})

vi.mock('../plugins/PluginContext', () => ({
  usePlugins: () => ({
    isEnabled: (pluginId) => pluginId === 'jobs_ch' || pluginId === 'linkedin',
  }),
}))

vi.mock('../api', () => ({
  jobsApi: {},
  linkedinApi: { searchProfiles: vi.fn(), exportProfilesAsPdf: vi.fn() },
  settingsApi: {
    getApifyStatus: vi.fn().mockResolvedValue({
      tokenConfigured: true,
      reachable: true,
      monthlyUsageUsd: 12.5,
      remainingMonthlyUsageUsd: 37.5,
      usageCycle: { startAt: '2026-09-01T00:00:00Z', endAt: '2026-09-30T00:00:00Z' },
    }),
  },
}))

const GERMAN_LITERALS = /Suchbegriffe|Verfügbar|Verbraucht|Werkzeuge|Noch keine|Exportiere|Ein Link pro Zeile|Zurück zu Tools|Profile suchen|Alle auswählen|Kein Profil-Link/

const renderIn = (locale, ui) => {
  localStorage.setItem('hr-locale', locale)
  return render(
    <MemoryRouter><I18nProvider><ToastProvider>{ui}</ToastProvider></I18nProvider></MemoryRouter>
  )
}

describe('Tools pages i18n', () => {
  beforeEach(() => localStorage.clear())

  it('renders Tools in English without German leftovers', () => {
    const { container } = renderIn('en', <Tools />)
    expect(container.textContent).toMatch(/One link per line/)
    expect(container.textContent).not.toMatch(GERMAN_LITERALS)
  })

  it('renders ToolsLinkedIn in English, including locale-aware money and dates', async () => {
    const { container } = renderIn('en', <ToolsLinkedIn />)
    await waitFor(() => expect(container.textContent).toMatch(/Configured/))
    expect(container.textContent).toMatch(/Search profiles/)
    expect(container.textContent).toMatch(/\$12\.50/)
    expect(container.textContent).toMatch(/9\/1\/2026/)   // en-US date, not 01.09.2026
    expect(container.textContent).not.toMatch(GERMAN_LITERALS)
  })

  it('still renders German for the German locale', () => {
    const { container } = renderIn('de', <Tools />)
    expect(container.textContent).toMatch(/Ein Link pro Zeile/)
  })
})
