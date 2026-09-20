import { useEffect, useMemo, useState } from 'react'
import { Check, Code2, PencilLine, RefreshCw, Search, WandSparkles } from 'lucide-react'
import { promptsApi } from '../api'
import { Button, Card, EmptyState, Input, LoadingSpinner, PageContainer, Textarea } from '../components/UI'
import { useToast } from '../components/Toast'
import { useI18n } from '../I18nContext'

function extractPlaceholders(template) {
  const matches = [...String(template || '').matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)]
  return [...new Set(matches.map((match) => match[1]))]
}

function renderTemplate(template, values) {
  const map = values && typeof values === 'object' ? values : {}
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = map[key]
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value)
  })
}

function safeJsonParse(text) {
  if (!String(text || '').trim()) return { value: {}, error: '' }
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { value: parsed, error: '' }
    }
    return { value: {}, error: 'JSON muss ein Objekt sein.' }
  } catch (error) {
    return { value: {}, error: error.message }
  }
}

export default function Prompts() {
  const toast = useToast()
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [prompts, setPrompts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [template, setTemplate] = useState('')
  const [description, setDescription] = useState('')
  const [modelParametersText, setModelParametersText] = useState('{}')
  const [testValuesText, setTestValuesText] = useState(JSON.stringify({ username: 'Max Mustermann', company: 'HRTool AG', location: 'Zürich' }, null, 2))
  const [preview, setPreview] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [formError, setFormError] = useState('')

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => Number(prompt.id) === Number(selectedId)) || null,
    [prompts, selectedId],
  )

  const filteredPrompts = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return prompts
    return prompts.filter((prompt) => [prompt.key, prompt.description, prompt.template].some((value) => String(value || '').toLowerCase().includes(needle)))
  }, [prompts, search])

  const loadPrompts = async () => {
    const data = await promptsApi.getAll()
    setPrompts(data || [])
    if (!selectedId && data?.length) {
      setSelectedId(data[0].id)
    }
  }

  useEffect(() => {
    loadPrompts()
      .catch((error) => {
        setFormError(error.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedPrompt) return
    setTemplate(selectedPrompt.template || '')
    setDescription(selectedPrompt.description || '')
    setModelParametersText(JSON.stringify(selectedPrompt.model_parameters || {}, null, 2))
    setPreview('')
    setPreviewError('')
    setFormError('')
  }, [selectedPrompt?.id])

  const placeholderKeys = useMemo(() => extractPlaceholders(template), [template])

  const handleSelect = (prompt) => {
    setSelectedId(prompt.id)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setFormError('')
    try {
      await loadPrompts()
    } catch (error) {
      setFormError(error.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handlePreview = () => {
    const { value, error } = safeJsonParse(testValuesText)
    if (error) {
      setPreview('')
      setPreviewError(error)
      return
    }
    setPreview(renderTemplate(template, value))
    setPreviewError('')
  }

  const handleSave = async () => {
    if (!selectedPrompt) return
    const { value, error } = safeJsonParse(modelParametersText)
    if (error) {
      setFormError(error)
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const updated = await promptsApi.update(selectedPrompt.id, {
        template,
        description: description.trim() || null,
        model_parameters: value,
      })

      setPrompts((current) => current.map((prompt) => (prompt.id === updated.id ? updated : prompt)))
      setSelectedId(updated.id)
      toast.success(t('prompts.saved'))
    } catch (error) {
      setFormError(error.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner text={t('common.loading')} />

  return (
    <PageContainer width="wide" className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('prompts.title')}</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('prompts.subtitle')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {t('prompts.refresh')}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 className="text-[19px] font-semibold text-black dark:text-white">{t('prompts.overview')}</h2>
          </div>
          <Input label={t('prompts.search')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('prompts.search_placeholder')} />

          <div className="overflow-hidden rounded-[24px] border border-gray-100/80 dark:border-gray-700/60">
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white dark:bg-[#1c1c1e] border-b border-gray-100/80 dark:border-gray-700/60">
                  <tr className="text-[12px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3">{t('prompts.key')}</th>
                    <th className="px-4 py-3">{t('prompts.description')}</th>
                    <th className="px-4 py-3">{t('prompts.updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPrompts.map((prompt) => (
                    <tr
                      key={prompt.id}
                      onClick={() => handleSelect(prompt)}
                      className={`cursor-pointer border-b border-gray-100/80 dark:border-gray-800/70 transition ${Number(selectedId) === Number(prompt.id) ? 'bg-[#0071e3]/5 dark:bg-[#0071e3]/10' : 'hover:bg-gray-50 dark:hover:bg-[#2c2c2e]'}`}
                    >
                      <td className="px-4 py-4 align-top">
                        <div className="font-semibold text-black dark:text-white">{prompt.key}</div>
                        <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">v{prompt.version}</div>
                      </td>
                      <td className="px-4 py-4 align-top text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed">
                        {prompt.description || <span className="text-gray-400">{t('prompts.no_description')}</span>}
                      </td>
                      <td className="px-4 py-4 align-top text-[13px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {prompt.updated_at ? new Date(prompt.updated_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                  {filteredPrompts.length === 0 && (
                    <tr>
                      <td colSpan="3" className="px-4 py-12">
                        <EmptyState size="sm" icon={Code2} title={t('prompts.empty_title')} description={t('prompts.empty_desc')} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <PencilLine className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-[19px] font-semibold text-black dark:text-white">{selectedPrompt ? selectedPrompt.key : t('prompts.editor')}</h2>
              </div>
              {selectedPrompt && <span className="text-[12px] text-gray-500 dark:text-gray-400">v{selectedPrompt.version}</span>}
            </div>

            {selectedPrompt ? (
              <>
                <Input label={t('prompts.description')} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('prompts.description_placeholder')} />
                <Textarea label={t('prompts.template')} value={template} onChange={(event) => setTemplate(event.target.value)} rows={16} className="font-mono text-[14px]" />

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
                    <WandSparkles className="w-4 h-4" />
                    {t('prompts.placeholders')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {placeholderKeys.length > 0 ? placeholderKeys.map((key) => (
                      <span key={key} className="px-3 py-1.5 rounded-full bg-[#0071e3]/10 text-[var(--apple-blue-text)] text-[13px] font-medium">{'{{'}{key}{'}}'}</span>
                    )) : <span className="text-[13px] text-gray-400">{t('prompts.no_placeholders')}</span>}
                  </div>
                </div>

                <Textarea label={t('prompts.model_parameters')} value={modelParametersText} onChange={(event) => setModelParametersText(event.target.value)} rows={8} className="font-mono text-[14px]" />

                <div className="space-y-3">
                  <Textarea label={t('prompts.test_values')} value={testValuesText} onChange={(event) => setTestValuesText(event.target.value)} rows={8} className="font-mono text-[14px]" />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" size="sm" onClick={handlePreview}>
                      <Check className="w-4 h-4" />
                      {t('prompts.render_preview')}
                    </Button>
                    <Button variant="dark" size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {t('prompts.save')}
                    </Button>
                  </div>
                </div>

                {previewError && <p className="text-[13px] text-[#ff3b30]">{previewError}</p>}
                {formError && <p className="text-[13px] text-[#ff3b30]">{formError}</p>}

                {preview && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
                      <Code2 className="w-4 h-4" />
                      {t('prompts.preview')}
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-[14px] leading-relaxed p-4 rounded-[24px] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-gray-100/80 dark:border-gray-700/60">{preview}</pre>
                  </div>
                )}
              </>
            ) : (
              <EmptyState size="sm" icon={Code2} title={t('prompts.no_selection_title')} description={t('prompts.no_selection_desc')} />
            )}
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}