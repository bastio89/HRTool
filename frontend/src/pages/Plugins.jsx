import { useState } from 'react'
import { Loader2, ToggleLeft, ToggleRight } from 'lucide-react'
import { pluginsApi } from '../api'
import { usePlugins } from '../plugins/PluginContext'
import { Card, Button, PageContainer } from '../components/UI'
import { useI18n } from '../I18nContext'

const PLUGIN_CONFIGS = [
  {
    id: 'linkedin',
    titleKey: 'plugin.linkedin_title',
    descKey: 'plugin.linkedin_desc',
    enableKey: 'plugin.linkedin_enable',
    disableKey: 'plugin.linkedin_disable',
    route: '/api/plugins/linkedin/*',
  },
  {
    id: 'jobs_ch',
    titleKey: 'plugin.jobs_ch_title',
    descKey: 'plugin.jobs_ch_desc',
    enableKey: 'plugin.jobs_ch_enable',
    disableKey: 'plugin.jobs_ch_disable',
    route: '/api/plugins/jobs_ch/*',
  },
]

export default function Plugins() {
  const { t } = useI18n()
  const { getPlugin, refreshPlugins } = usePlugins()
  const [savingPluginId, setSavingPluginId] = useState('')

  const handleToggle = async (pluginId, enabled) => {
    setSavingPluginId(pluginId)
    try {
      await pluginsApi.setPluginEnabled(pluginId, !enabled)
      await refreshPlugins()
    } finally {
      setSavingPluginId('')
    }
  }

  return (
    <PageContainer width="narrow" className="space-y-8">
      <div>
        <h1 className="text-[26px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">
          {t('plugins.title')}
        </h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">
          {t('plugins.subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        {PLUGIN_CONFIGS.map((pluginConfig) => {
          const plugin = getPlugin(pluginConfig.id)
          const enabled = Boolean(plugin?.enabled)

          return (
            <Card key={pluginConfig.id} className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-[19px] font-semibold text-black dark:text-white">{t(pluginConfig.titleKey)}</h2>
                  <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{t(pluginConfig.descKey)}</p>
                </div>
                <Button
                  variant={enabled ? 'secondary' : 'dark'}
                  size="md"
                  onClick={() => handleToggle(pluginConfig.id, enabled)}
                  disabled={savingPluginId === pluginConfig.id}
                >
                  {savingPluginId === pluginConfig.id ? <Loader2 className="w-5 h-5 animate-spin" /> : enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                  {enabled ? t(pluginConfig.disableKey) : t(pluginConfig.enableKey)}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('plugin.status')}</div>
                  <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">{enabled ? t('plugin.enabled') : t('plugin.disabled')}</div>
                </div>
                <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('plugin.route')}</div>
                  <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">{pluginConfig.route}</div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </PageContainer>
  )
}
