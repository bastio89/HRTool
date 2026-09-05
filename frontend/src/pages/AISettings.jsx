import { useState, useEffect, useId } from 'react'
import { Bot, Server, Check, Loader2, AlertTriangle, RefreshCw, Wifi, WifiOff, Info, ChevronDown, Cpu } from 'lucide-react'
import { settingsApi } from '../api'
import { Card, Button, Input, LoadingSpinner, PageContainer } from '../components/UI'
import { useI18n } from '../I18nContext'

// Common presets to help users who switch away from Ollama's default host.
const HOST_PRESETS = [
  { label: 'Ollama', url: 'http://localhost:11434' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', provider: 'openai' },
  { label: 'LM Studio', url: 'http://localhost:1234' },
  { label: 'Jan / llama.cpp', url: 'http://localhost:1337' },
  { label: 'Text Generation WebUI', url: 'http://localhost:5000' },
]

const EMBEDDING_MODEL_PRESETS = [
  'bge-m3',
  'nomic-embed-text',
  'openai/text-embedding-3-small',
  'qwen3-embedding:4b',
]

const PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Auto-Erkennung', desc: 'Erkennt Ollama oder OpenAI-kompatible API automatisch' },
  { value: 'ollama', label: 'Ollama', desc: 'Ollama-API (/api/generate)' },
  { value: 'openai', label: 'OpenAI-kompatibel', desc: 'LM Studio, Jan, Text Generation WebUI u.a. (/v1/chat/completions)' },
]

const REASONING_LEVELS = [
  { value: 'none', label: 'Aus', desc: 'Schnellste Antwort ohne Reasoning' },
  { value: 'low', label: 'Niedrig', desc: 'Kurze Denkphase' },
  { value: 'medium', label: 'Mittel', desc: 'Ausgewogen zwischen Qualität und Geschwindigkeit' },
  { value: 'high', label: 'Hoch', desc: 'Mehr Denkzeit für komplexe Aufgaben' },
]

export default function AISettings() {
  const fieldIdPrefix = useId()
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [provider, setProvider] = useState('auto')
  const [reasoningLevel, setReasoningLevel] = useState('none')
  const [loggingEnabled, setLoggingEnabled] = useState(false)
  const [source, setSource] = useState({ baseUrl: 'default', model: 'default', embeddingModel: 'default' })

  const [models, setModels] = useState([])
  const [embeddingModels, setEmbeddingModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [embeddingModelsLoading, setEmbeddingModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [embeddingModelsError, setEmbeddingModelsError] = useState('')
  const [manualModel, setManualModel] = useState(false)
  const [manualEmbeddingModel, setManualEmbeddingModel] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmTestResult, setLlmTestResult] = useState(null)
  const [embeddingTesting, setEmbeddingTesting] = useState(false)
  const [embeddingTestResult, setEmbeddingTestResult] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { loadConfig() }, [])

  const loadConfig = async () => {
    try {
      const cfg = await settingsApi.getAiConfig()
      setBaseUrl(cfg.baseUrl || '')
      setModel(cfg.model || '')
      setEmbeddingModel(cfg.embeddingModel || '')
      setProvider(cfg.provider || 'auto')
      setReasoningLevel(cfg.reasoningLevel || 'none')
      setApiKeyConfigured(Boolean(cfg.apiKeyConfigured))
      setLoggingEnabled(Boolean(cfg.loggingEnabled))
      setSource(cfg.source || { baseUrl: 'default', model: 'default', embeddingModel: 'default' })
      // Load available models for the current host
      await Promise.all([
        loadModels(cfg.baseUrl, cfg.model, cfg.provider),
        loadEmbeddingModels(cfg.baseUrl, cfg.embeddingModel, cfg.provider),
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sortModelNames = (names) => [...names].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  const loadModels = async (url, currentModel, requestedProvider = provider) => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const res = await settingsApi.getAiModels(url, apiKey, requestedProvider)
      const names = sortModelNames((res.models || []).map((m) => m.name).filter(Boolean))
      setModels(names)
      const active = currentModel ?? model
      if (names.length > 0) {
        if (active && names.includes(active)) {
          setManualModel(false)
          setModel(active)
        } else {
          // Keep a custom model value even if the host does not advertise it.
          setManualModel(true)
          if (active) setModel(active)
        }
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

  const loadEmbeddingModels = async (url, currentEmbeddingModel, requestedProvider = provider) => {
    setEmbeddingModelsLoading(true)
    setEmbeddingModelsError('')
    try {
      const res = await settingsApi.getAiEmbeddingModels(url, apiKey, requestedProvider)
      const names = sortModelNames([
        ...new Set([
          ...EMBEDDING_MODEL_PRESETS,
          ...(res.models || []).map((m) => m.name).filter(Boolean),
        ]),
      ])
      setEmbeddingModels(names)
      const activeEmbedding = currentEmbeddingModel ?? embeddingModel
      if (names.length > 0) {
        if (activeEmbedding && names.includes(activeEmbedding)) {
          setManualEmbeddingModel(false)
          setEmbeddingModel(activeEmbedding)
        } else {
          // Keep a custom embedding model value even if the host does not advertise it.
          setManualEmbeddingModel(true)
          if (activeEmbedding) setEmbeddingModel(activeEmbedding)
        }
      } else {
        setManualEmbeddingModel(true)
      }
    } catch (err) {
      setEmbeddingModels([])
      setManualEmbeddingModel(true)
      setEmbeddingModelsError(err.message)
    } finally {
      setEmbeddingModelsLoading(false)
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
        await Promise.all([
          loadModels(baseUrl, model, provider),
          loadEmbeddingModels(baseUrl, embeddingModel, provider),
        ])
      }
    } catch (err) {
      setTestResult({ reachable: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleEmbeddingTest = async () => {
    setEmbeddingTesting(true)
    setEmbeddingTestResult(null)
    setError('')
    try {
      const res = await settingsApi.testEmbeddingModel(baseUrl, apiKey, provider, embeddingModel, 'Kubernetes')
      setEmbeddingTestResult(res)
      if (res.reachable) {
        await loadEmbeddingModels(baseUrl, embeddingModel, provider)
      }
    } catch (err) {
      setEmbeddingTestResult({ reachable: false, error: err.message })
    } finally {
      setEmbeddingTesting(false)
    }
  }

  const handleLlmTest = async () => {
    setLlmTesting(true)
    setLlmTestResult(null)
    setError('')
    try {
      const res = await settingsApi.testLlmModel(baseUrl, apiKey, provider, model, reasoningLevel)
      setLlmTestResult(res)
    } catch (err) {
      setLlmTestResult({ reachable: false, error: err.message })
    } finally {
      setLlmTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccessMsg('')
    try {
      if (!embeddingModel.trim()) {
        throw new Error(t('ai_settings.embedding_model_required'))
      }
      const res = await settingsApi.saveAiConfig({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        embeddingModel: embeddingModel.trim(),
        provider,
        reasoningLevel,
        loggingEnabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setBaseUrl(res.baseUrl)
      setModel(res.model)
      setEmbeddingModel(res.embeddingModel || embeddingModel)
      setProvider(res.provider || 'auto')
      setReasoningLevel(res.reasoningLevel || reasoningLevel)
      setApiKey('')
      setApiKeyConfigured(Boolean(res.apiKeyConfigured))
      setLoggingEnabled(Boolean(res.loggingEnabled))
      setSource({ baseUrl: 'settings', model: 'settings', embeddingModel: 'settings' })
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
    setEmbeddingTestResult(null)
    setLlmTestResult(null)
    loadModels(url, model, presetProvider || provider)
    loadEmbeddingModels(url, embeddingModel, presetProvider || provider)
  }

  const selectProvider = (value) => {
    setProvider(value)
    setTestResult(null)
    setEmbeddingTestResult(null)
    setLlmTestResult(null)
    loadModels(baseUrl, model, value)
    loadEmbeddingModels(baseUrl, embeddingModel, value)
  }

  const embeddingStatus = embeddingTesting
    ? { tone: 'checking', label: 'Test läuft' }
    : embeddingTestResult?.reachable
      ? { tone: 'success', label: `OK${embeddingTestResult?.dims ? ` · ${embeddingTestResult.dims} Dim.` : ''}` }
      : embeddingTestResult
        ? { tone: 'error', label: embeddingTestResult.error || 'Fehler' }
        : { tone: 'idle', label: 'Nicht getestet' }

  const llmStatus = llmTesting
    ? { tone: 'checking', label: 'Test läuft' }
    : llmTestResult?.reachable
      ? { tone: 'success', label: `OK${llmTestResult?.latencyMs ? ` · ${llmTestResult.latencyMs} ms` : ''}` }
      : llmTestResult
        ? { tone: 'error', label: llmTestResult.error || 'Fehler' }
        : { tone: 'idle', label: 'Nicht getestet' }

  const embeddingStatusClasses = {
    checking: 'bg-[#f5f5f7] text-gray-500 border-gray-200 dark:bg-[#2c2c2e] dark:text-gray-300 dark:border-gray-700',
    success: 'bg-[#34c759]/10 text-[#1f9d55] border-[#34c759]/20 dark:text-[#7dffaf] dark:border-[#34c759]/25',
    error: 'bg-[#ff3b30]/10 text-[#d92d20] border-[#ff3b30]/20 dark:text-[#ff8a80] dark:border-[#ff3b30]/25',
    idle: 'bg-[#f5f5f7] text-gray-500 border-gray-200 dark:bg-[#2c2c2e] dark:text-gray-400 dark:border-gray-700',
  }

  const llmStatusClasses = embeddingStatusClasses

  const sourceLabel = (src) => {
    if (src === 'settings') return t('ai_settings.source_settings')
    if (src === 'env') return t('ai_settings.source_env')
    return t('ai_settings.source_default')
  }

  if (loading) return <LoadingSpinner text={t('ai_settings.loading')} />

  return (
    <PageContainer width="narrow" className="space-y-8">
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
          <Cpu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
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
          <Server className="w-5 h-5 text-gray-500 dark:text-gray-400" />
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
          <p className="text-[13px] text-gray-500 dark:text-gray-400 ml-2">
            {t('ai_settings.current_source')}: <span className="font-medium">{sourceLabel(source.baseUrl)}</span>
          </p>
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 ml-2">{t('ai_settings.presets')}</p>
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
          <Server className="w-5 h-5 text-gray-500 dark:text-gray-400" />
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
        <p className="text-[13px] text-gray-500 dark:text-gray-400 ml-2">
          Der Key wird nur serverseitig gespeichert und nicht wieder angezeigt. Für Ollama kann dieses Feld leer bleiben.
        </p>
      </Card>

      {/* Model selection */}
      <Card className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('ai_settings.model_title')}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => loadModels(baseUrl, model, provider)} disabled={modelsLoading}>
            {modelsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('ai_settings.reload_models')}
          </Button>
        </div>

        {!manualModel && models.length > 0 ? (
          <div className="space-y-3">
            <label htmlFor={`${fieldIdPrefix}-model`} className="block text-[15px] font-medium text-gray-600 dark:text-gray-400 ml-2">
              {t('ai_settings.model_label')}
            </label>
            <div className="relative">
              <select
                id={`${fieldIdPrefix}-model`}
                aria-label={t('ai_settings.model_label')}
                value={model}
                onChange={(e) => { setModel(e.target.value); setLlmTestResult(null) }}
                className="w-full appearance-none px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[20px]
                  text-black dark:text-white text-[16px] focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c]
                  focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all duration-300 cursor-pointer pr-12"
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400 absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none" />
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
              onChange={(e) => { setModel(e.target.value); setLlmTestResult(null) }}
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
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleLlmTest} disabled={llmTesting || !baseUrl.trim() || !model.trim()}>
            {llmTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            LLM testen
          </Button>
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-semibold ${llmStatusClasses[llmStatus.tone]}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${llmStatus.tone === 'success' ? 'bg-[#34c759]' : llmStatus.tone === 'error' ? 'bg-[#ff3b30]' : llmStatus.tone === 'checking' ? 'bg-[#8e8e93] animate-pulse' : 'bg-[#8e8e93]'}`} />
            {llmStatus.label}
          </span>
        </div>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 ml-2">
          {t('ai_settings.current_source')}: <span className="font-medium">{sourceLabel(source.model)}</span>
        </p>
      </Card>

      {/* Reasoning level */}
      <Card className="space-y-5">
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <div>
            <h2 className="text-[19px] font-semibold text-black dark:text-white">Reasoning-Level</h2>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">Steuert, wie viel Denkzeit das LLM für Antworten verwendet.</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-2">
          {REASONING_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => { setReasoningLevel(level.value); setLlmTestResult(null) }}
              className={`text-left px-3 py-3 rounded-2xl border transition-all duration-200 cursor-pointer ${
                reasoningLevel === level.value
                  ? 'bg-[#0071e3]/10 border-[#0071e3]/40 text-[#0071e3]'
                  : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-transparent text-gray-600 dark:text-gray-300 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
              }`}
            >
              <div className="font-semibold text-[14px]">{level.label}</div>
              <div className="text-[11px] opacity-70 mt-1 leading-snug">{level.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Embedding model */}
      <Card className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Cpu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('ai_settings.embedding_model_title')}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => loadEmbeddingModels(baseUrl, embeddingModel, provider)} disabled={embeddingModelsLoading}>
            {embeddingModelsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('ai_settings.reload_models')}
          </Button>
        </div>

        {!manualEmbeddingModel && embeddingModels.length > 0 ? (
          <div className="space-y-3">
            <label htmlFor={`${fieldIdPrefix}-embedding-model`} className="block text-[15px] font-medium text-gray-600 dark:text-gray-400 ml-2">
              {t('ai_settings.embedding_model_label')}
            </label>
            <div className="relative">
              <select
                id={`${fieldIdPrefix}-embedding-model`}
                aria-label={t('ai_settings.embedding_model_label')}
                value={embeddingModel}
                onChange={(e) => { setEmbeddingModel(e.target.value); setEmbeddingTestResult(null) }}
                className="w-full appearance-none px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[20px]
                  text-black dark:text-white text-[16px] focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c]
                  focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all duration-300 cursor-pointer pr-12"
              >
                {embeddingModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400 absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button
              onClick={() => setManualEmbeddingModel(true)}
              className="text-[13px] text-[#0071e3] hover:underline ml-2 cursor-pointer"
            >
              {t('ai_settings.enter_manually')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              label={t('ai_settings.embedding_model_label')}
              value={embeddingModel}
              onChange={(e) => { setEmbeddingModel(e.target.value); setEmbeddingTestResult(null) }}
              placeholder="openai/text-embedding-3-small"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {embeddingModels.length > 0 && (
              <button
                onClick={() => setManualEmbeddingModel(false)}
                className="text-[13px] text-[#0071e3] hover:underline ml-2 cursor-pointer"
              >
                {t('ai_settings.choose_from_list')}
              </button>
            )}
            {embeddingModelsError && (
              <p className="flex items-center gap-2 text-[13px] text-[#ff9500] ml-2">
                <AlertTriangle className="w-4 h-4" />
                {t('ai_settings.models_unavailable')}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleEmbeddingTest} disabled={embeddingTesting || !baseUrl.trim() || !embeddingModel.trim()}>
            {embeddingTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Testen
          </Button>
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-semibold ${embeddingStatusClasses[embeddingStatus.tone]}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${embeddingStatus.tone === 'success' ? 'bg-[#34c759]' : embeddingStatus.tone === 'error' ? 'bg-[#ff3b30]' : embeddingStatus.tone === 'checking' ? 'bg-[#8e8e93] animate-pulse' : 'bg-[#8e8e93]'}`} />
            {embeddingStatus.label}
          </span>
        </div>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 ml-2">
          {t('ai_settings.current_source')}: <span className="font-medium">{sourceLabel(source.embeddingModel)}</span>
        </p>
      </Card>

      {/* Save bar */}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="dark" onClick={handleSave} disabled={saving || !baseUrl.trim() || !model.trim() || !embeddingModel.trim()}>
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
    </PageContainer>
  )
}
