import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import Plugins from './Plugins'
import { I18nProvider } from '../I18nContext'
import { pluginsApi } from '../api'

const refreshPluginsMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../plugins/PluginContext', () => ({
  usePlugins: () => ({
    getPlugin: (pluginId) => ({ id: pluginId, enabled: true }),
    refreshPlugins: refreshPluginsMock,
  }),
}))

vi.mock('../api', () => ({
  pluginsApi: {
    getAll: vi.fn().mockResolvedValue({ plugins: [{ id: 'linkedin', enabled: true }, { id: 'jobs_ch', enabled: true }] }),
    setPluginEnabled: vi.fn().mockResolvedValue({}),
    getPlugin: vi.fn().mockResolvedValue({ id: 'linkedin', enabled: true }),
  },
}))

describe('Plugins', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
    vi.clearAllMocks()
    refreshPluginsMock.mockResolvedValue(undefined)
  })

  test('can toggle the jobs.ch plugin', async () => {
    render(
      <I18nProvider>
        <Plugins />
      </I18nProvider>
    )

    const jobsCard = await screen.findByText(/Jobs\.ch Plugin/i)
    const card = jobsCard.closest('div[class*="bg-white"]')
    const disableButton = within(card).getByRole('button', { name: /Deaktivieren/i })
    fireEvent.click(disableButton)

    await waitFor(() => {
      expect(pluginsApi.setPluginEnabled).toHaveBeenCalledWith('jobs_ch', false)
      expect(refreshPluginsMock).toHaveBeenCalled()
    })
  })
})
