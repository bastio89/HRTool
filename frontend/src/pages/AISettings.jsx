import { useState, useEffect } from 'react'
import { Bot, Server, Check, Loader2, AlertTriangle, RefreshCw, Wifi, WifiOff, Info, ChevronDown, Cpu } from 'lucide-react'
import { settingsApi } from '../api'
import { Card, Button, Input, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

// Common presets to help users who switch away from Ollama's default host.
const HOST_PRESETS = [
  { label: 'Ollama', url: 'http://localhost:11434' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', provider: 'openai' },
  { label: 'LM Studio', url: 'http://localhost:1234' },
  { label: 'Jan / llama.cpp', url: 'http://localhost:1337' },
  { label: 'Text Generation WebUI', url: 'http://localhost:5000' },
]

const PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Auto-Erkennung', desc: 'Erkennt Ollama oder OpenAI-kompatible API automatisch' },
  { value: 'ollama', label: 'Ollama', desc: 'Ollama-API (/api/generate)' },
  { value: 'openai', label: 'OpenAI-kompatibel', desc: 'LM Studio, Jan, Text Generation WebUI u.a. (/v1/chat/completions)' },
]

export default function AISettings() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [provider, setProvider] = useState('auto')
  const [loggingEnabled, setLoggingEnabled] = useState(false)
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
      setProvider(cfg.provider || 'auto')
      setApiKeyConfigured(Boolean(cfg.apiKeyConfigured))
      setLoggingEnabled(Boolean(cfg.loggingEnabled))
      setSource(cfg.source || { baseUrl: 'default', model: 'default' })
      // Load available models for the current host
      await loadModels(cfg.baseUrl, cfg.model, cfg.provider)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadModels = async (url, currentModel, requestedProvider = provider) => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const res = await settingsApi.getAiModels(url, apiKey, requestedProvider)
      const names = (res.models || []).map((m) => m.name)
      setModels(names)
      // Always show the provider's list when it contains models. If the saved
      // model is no longer available, select the first current model.
      const active = currentModel ?? model
      if (names.length > 0) {
        setManualModel(false)
        if (!active || !names.includes(active)) setModel(names[0])
      } else {
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
      const res = await settingsApi.testAiConnection(baseUrl, apiKey, provider)
      setTestResult(res)
      if (res.reachable) {
        // Refresh model list from the tested host
        await loadModels(baseUrl, model, provider)
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
      const res = await settingsApi.saveAiConfig({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        provider,
        loggingEnabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setBaseUrl(res.baseUrl)
      setModel(res.model)
      setProvider(res.provider || 'auto')
      setApiKey('')
      setApiKeyConfigured(Boolean(res.apiKeyConfigured))
      setLoggingEnabled(Boolean(res.loggingEnabled))
      setSource({ baseUrl: 'settings', model: 'settings' })
      setSuccessMsg(t('ai_settings.saved'))
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const applyPreset = (url, presetProvider) => {
    setBaseUrl(url)
    if (presetProvider) setProvider(presetProvider)
    setTestResult(null)
    loadModels(url, model, presetProvider || provider)
  }

  const selectProvider = (value) => {
    setProvider(value)
    setTestResult(null)
    loadModels(baseUrl, model, value)
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

        {/* Provider / API dialect */}
      <Card className="space-y-5">
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-gray-400" />
          <h2 className="text-[19px] font-semibold text-black dark:text-white">API-Dialekt</h2>
        </div>
        <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Wähle den API-Dialekt deines KI-Servers. <strong>Auto</strong> erkennt automatisch, ob Ollama oder eine OpenAI-kompatible API (LM Studio, Jan, etc.) verwendet wird.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {PROVIDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => selectProvider(opt.value)}
              className={`text-left px-4 py-3 rounded-2xl border transition-all duration-200 cursor-pointer ${
                provider === opt.value
                  ? 'bg-[#0071e3]/10 border-[#0071e3]/40 text-[#0071e3]'
                  : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-transparent text-gray-600 dark:text-gray-300 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
              }`}
            >
              <div className="font-semibold text-[14px]">{opt.label}</div>
              <div className="text-[12px] opacity-70 mt-0.5 leading-snug">{opt.desc}</div>
            </button>
          ))}
        </div>
      </Card>

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
                onClick={() => applyPreset(p.url, p.provider)}
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

      {/* API key */}
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <Server className="w-5 h-5 text-gray-400" />
          <h2 className="text-[19px] font-semibold text-black dark:text-white">API-Key</h2>
        </div>
        <Input
          label="OpenRouter API-Key"
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setTestResult(null) }}
          placeholder={apiKeyConfigured ? 'Gespeicherter Key vorhanden (leer lassen)' : 'sk-or-v1-...'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="new-password"
        />
        <p className="text-[13px] text-gray-400 ml-2">
          Der Key wird nur serverseitig gespeichert und nicht wieder angezeigt. Für Ollama kann dieses Feld leer bleiben.
        </p>
      </Card>

      {/* Model selection */}
      <Card className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-gray-400" />
            <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('ai_settings.model_title')}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => loadModels(baseUrl, model, provider)} disabled={modelsLoading}>
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

      {/* LLM logging */}
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <Check className="w-5 h-5 text-gray-400" />
          <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('ai_settings.logging_title')}</h2>
        </div>
        <label className="flex items-start gap-3 rounded-2xl border border-gray-200/80 dark:border-white/10 bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-4 cursor-pointer">
          <input
            type="checkbox"
            checked={loggingEnabled}
            onChange={(e) => setLoggingEnabled(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-gray-300 text-[#0071e3] focus:ring-[#0071e3]"
          />
          <div className="space-y-1">
            <div className="text-[15px] font-medium text-black dark:text-white">{t('ai_settings.logging_label')}</div>
            <p className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
              {t('ai_settings.logging_desc')}
            </p>
          </div>
        </label>
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
