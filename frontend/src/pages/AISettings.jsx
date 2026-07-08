import { useState, useEffect } from 'react'
import { Bot, Server, Check, Loader2, AlertTriangle, RefreshCw, Wifi, WifiOff, Info, ChevronDown } from 'lucide-react'
import { settingsApi } from '../api'
import { Card, Button, Input, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

// Common presets to help users who switch away from Ollama's default host.
const HOST_PRESETS = [
  { label: 'Ollama', url: 'http://localhost:11434' },
  { label: 'LM Studio', url: 'http://localhost:1234' },
  { label: 'Jan / llama.cpp', url: 'http://localhost:1337' },
  { label: 'Text Generation WebUI', url: 'http://localhost:5000' },
]

export default function AISettings() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [source, setSource] = useState({ baseUrl: 'default', model: 'default' })

  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [manualModel, setManualModel] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { loadConfig() }, [])

  const loadConfig = async () => {
    try {
      const cfg = await settingsApi.getAiConfig()
      setBaseUrl(cfg.baseUrl || '')
      setModel(cfg.model || '')
      setSource(cfg.source || { baseUrl: 'default', model: 'default' })
      // Load available models for the current host
      await loadModels(cfg.baseUrl, cfg.model)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadModels = async (url, currentModel) => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const res = await settingsApi.getAiModels(url)
      const names = (res.models || []).map((m) => m.name)
      setModels(names)
      // If the currently configured model isn't in the list, switch to manual entry
      const active = currentModel ?? model
      if (active && names.length > 0 && !names.includes(active)) {
        setManualModel(true)
      } else if (names.length === 0) {
        setManualModel(true)
      }
    } catch (err) {
      setModels([])
      setManualModel(true)
      setModelsError(err.message)
    } finally {
      setModelsLoading(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const res = await settingsApi.testAiConnection(baseUrl)
      setTestResult(res)
      if (res.reachable) {
        // Refresh model list from the tested host
        await loadModels(baseUrl, model)
      }
    } catch (err) {
      setTestResult({ reachable: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await settingsApi.saveAiConfig({ baseUrl: baseUrl.trim(), model: model.trim() })
      setBaseUrl(res.baseUrl)
      setModel(res.model)
      setSource({ baseUrl: 'settings', model: 'settings' })
      setSuccessMsg(t('ai_settings.saved'))
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const applyPreset = (url) => {
    setBaseUrl(url)
    setTestResult(null)
  }

  const sourceLabel = (src) => {
    if (src === 'settings') return t('ai_settings.source_settings')
    if (src === 'env') return t('ai_settings.source_env')
    return t('ai_settings.source_default')
  }

  if (loading) return <LoadingSpinner text={t('ai_settings.loading')} />

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-[#8B5CF6]/10 flex items-center justify-center flex-shrink-0">
          <Bot className="w-7 h-7 text-[#8B5CF6]" />
        </div>
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">
            {t('ai_settings.title')}
          </h1>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">
            {t('ai_settings.subtitle')}
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-[#0071e3]/5 border border-[#0071e3]/10">
        <Info className="w-5 h-5 text-[#0071e3] flex-shrink-0 mt-0.5" />
        <p className="text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed">
          {t('ai_settings.info')}
        </p>
      </div>

      {/* Host / Base URL */}
      <Card className="space-y-6">
        <div className="flex items-center gap-3">
          <Server className="w-5 h-5 text-gray-400" />
          <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('ai_settings.host_title')}</h2>
        </div>

        <div className="space-y-3">
          <Input
            label={t('ai_settings.host_label')}
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null) }}
            placeholder="http://localhost:11434"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <p className="text-[13px] text-gray-400 ml-2">
            {t('ai_settings.current_source')}: <span className="font-medium">{sourceLabel(source.baseUrl)}</span>
          </p>
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-gray-500 ml-2">{t('ai_settings.presets')}</p>
          <div className="flex flex-wrap gap-2">
            {HOST_PRESETS.map((p) => (
              <button
                key={p.url}
                onClick={() => applyPreset(p.url)}
                className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all duration-200 cursor-pointer border ${
                  baseUrl === p.url
                    ? 'bg-[#0071e3] text-white border-[#0071e3]'
                    : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-300 border-transparent hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
                }`}
              >
                {p.label}
                <span className="opacity-50 ml-1.5 hidden sm:inline">{p.url.replace('http://', '')}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Test connection */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing || !baseUrl.trim()}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {t('ai_settings.test')}
          </Button>
          {testResult && (
            <div className={`flex items-center gap-2 text-[14px] font-medium ${testResult.reachable ? 'text-[#34C759]' : 'text-[#ff3b30]'}`}>
              {testResult.reachable ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {testResult.reachable
                ? `${t('ai_settings.test_ok')} — ${testResult.modelCount ?? 0} ${t('ai_settings.models_word')} (${testResult.latencyMs ?? '?'} ms)`
                : `${t('ai_settings.test_fail')}: ${testResult.error || ''}`}
            </div>
          )}
        </div>
      </Card>

      {/* Model selection */}
      <Card className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-gray-400" />
            <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('ai_settings.model_title')}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => loadModels(baseUrl, model)} disabled={modelsLoading}>
            {modelsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('ai_settings.reload_models')}
          </Button>
        </div>

        {!manualModel && models.length > 0 ? (
          <div className="space-y-3">
            <label className="block text-[15px] font-medium text-gray-600 dark:text-gray-400 ml-2">
              {t('ai_settings.model_label')}
            </label>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full appearance-none px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[20px]
                  text-black dark:text-white text-[16px] focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c]
                  focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all duration-300 cursor-pointer pr-12"
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <ChevronDown className="w-5 h-5 text-gray-400 absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button
              onClick={() => setManualModel(true)}
              className="text-[13px] text-[#0071e3] hover:underline ml-2 cursor-pointer"
            >
              {t('ai_settings.enter_manually')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              label={t('ai_settings.model_label')}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama3.2"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {models.length > 0 && (
              <button
                onClick={() => setManualModel(false)}
                className="text-[13px] text-[#0071e3] hover:underline ml-2 cursor-pointer"
              >
                {t('ai_settings.choose_from_list')}
              </button>
            )}
            {modelsError && (
              <p className="flex items-center gap-2 text-[13px] text-[#ff9500] ml-2">
                <AlertTriangle className="w-4 h-4" />
                {t('ai_settings.models_unavailable')}
              </p>
            )}
          </div>
        )}
        <p className="text-[13px] text-gray-400 ml-2">
          {t('ai_settings.current_source')}: <span className="font-medium">{sourceLabel(source.model)}</span>
        </p>
      </Card>

      {/* Save bar */}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="dark" onClick={handleSave} disabled={saving || !baseUrl.trim() || !model.trim()}>
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
          {t('ai_settings.save')}
        </Button>
        {successMsg && (
          <span className="flex items-center gap-2 text-[15px] font-medium text-[#34C759]">
            <Check className="w-4 h-4" /> {successMsg}
          </span>
        )}
        {error && (
          <span className="flex items-center gap-2 text-[15px] font-medium text-[#ff3b30]">
            <AlertTriangle className="w-4 h-4" /> {error}
          </span>
        )}
      </div>
    </div>
  )
}
