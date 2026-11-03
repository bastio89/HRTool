import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Download, Eye, FileOutput, Globe, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { exportsApi } from '../api'
import { useAuth } from '../AuthContext'
import { Button, Card, EmptyState, Input, LoadingSpinner, PageContainer } from '../components/UI'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useI18n } from '../I18nContext'

const STATUS_OPTIONS = ['Aktiv', 'Passiv', 'In Prozess', 'Blacklist']
const CANDIDATES = 'candidates'

const EMPTY_FILTERS = { status: [], source: '', tags: '', created_from: '', created_to: '', updated_since: '', ids: '' }

// Bewerber haben eine eigene Filtermaske; fuer alle anderen Entitaeten
// (KI-/3D-Matching) wird sie aus den Filterdefinitionen des Schemas gebaut.
const isCandidates = (entity) => !entity || entity.key === CANDIDATES

function emptyFilters(entity) {
  if (isCandidates(entity)) return { ...EMPTY_FILTERS }
  return Object.fromEntries((entity.filters || []).map(def => [def.key, def.type === 'list' && def.options ? [] : '']))
}

function emptyDraft(entity) {
  return {
    id: null,
    name: '',
    description: '',
    entity: entity?.key || CANDIDATES,
    format: entity?.defaultFormat || 'csv',
    format_options: {},
    fields: (entity?.defaultFields || []).map(key => ({ key, as: key })),
    filters: emptyFilters(entity),
    external_enabled: false,
  }
}

const listText = (value) => (Array.isArray(value) ? value.join(', ') : String(value || ''))
const splitList = (value) => String(value || '').split(',').map(item => item.trim()).filter(Boolean)

function draftFromProfile(profile, entity) {
  const filters = profile.filters || {}
  if (!isCandidates(entity)) {
    const draftFilters = emptyFilters(entity)
    for (const def of entity.filters || []) {
      const value = filters[def.key]
      if (value === undefined || value === null) continue
      if (def.type === 'list') draftFilters[def.key] = def.options ? [].concat(value) : listText(value)
      else draftFilters[def.key] = String(value)
    }
    return { ...profile, filters: draftFilters }
  }
  return {
    ...profile,
    filters: {
      ...EMPTY_FILTERS,
      ...filters,
      status: Array.isArray(filters.status) ? filters.status : filters.status ? [filters.status] : [],
      source: listText(filters.source),
      tags: listText(filters.tags),
      ids: listText(filters.ids),
    },
  }
}

// Leere Eingaben fallen weg; Komma-Listen werden zu Arrays.
function filtersForApi(entity, filters) {
  if (!isCandidates(entity)) return schemaFiltersForApi(entity, filters)
  const out = {}
  const list = splitList
  if (filters.status?.length) out.status = filters.status
  if (list(filters.source).length) out.source = list(filters.source)
  if (list(filters.tags).length) out.tags = list(filters.tags)
  if (list(filters.ids).length) out.ids = list(filters.ids).map(Number).filter(Number.isFinite)
  for (const key of ['created_from', 'created_to', 'updated_since']) {
    if (filters[key]) out[key] = filters[key]
  }
  return out
}

function schemaFiltersForApi(entity, filters) {
  const out = {}
  for (const def of entity.filters || []) {
    const value = filters[def.key]
    if (def.type === 'list') {
      const items = Array.isArray(value) ? value : splitList(value)
      if (items.length) out[def.key] = items.map(item => (/^\d+$/.test(item) ? Number(item) : item))
    } else if (def.type === 'number') {
      if (value === '' || value === undefined || value === null) continue
      // Ungueltige Eingaben unveraendert senden: das Backend lehnt sie mit
      // einer Meldung ab, statt stillschweigend alles zu exportieren.
      const number = Number(String(value).replace(',', '.'))
      out[def.key] = Number.isFinite(number) ? number : String(value)
    } else if (value) {
      out[def.key] = value
    }
  }
  return out
}

function previewCell(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const selectClass = 'w-full px-5 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[16px] text-black dark:text-white text-[15px] focus:outline-none focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10'
const labelClass = 'block text-[13px] font-medium text-gray-500 dark:text-gray-400 ml-1 mb-1.5'

// Filter fuer die N:N-Matching-Abzuege, aus dem Schema gebaut. Der
// Schwellwert ("nur Matchingwert groesser als X %") steht als Hauptfilter oben.
function MatchingFilters({ entity, filters, onChange, t }) {
  const definitions = entity.filters || []
  const primary = definitions.filter(def => def.primary)
  const others = definitions.filter(def => !def.primary)
  const label = (def) => t(`export.mfilter_${def.key}`, def.label)

  return (
    <Card className="space-y-5 !p-5 sm:!p-8">
      <h2 className="text-[17px] font-semibold text-black dark:text-white">{t('export.filters_matching')}</h2>

      {primary.map(def => (
        <div key={def.key} className="rounded-[18px] bg-[#0071e3]/5 border border-[#0071e3]/15 p-4 sm:p-5">
          <label className="block text-[15px] font-semibold text-black dark:text-white mb-2" htmlFor={`export-filter-${def.key}`}>{label(def)}</label>
          <div className="flex items-center gap-3">
            <input
              id={`export-filter-${def.key}`}
              type="number"
              inputMode="decimal"
              min={def.min}
              max={def.max}
              step="any"
              placeholder={t('export.score_above_placeholder')}
              className={`${selectClass} max-w-[180px] text-[17px] font-semibold`}
              value={filters[def.key] ?? ''}
              onChange={e => onChange(def.key, e.target.value)}
            />
            {def.unit && <span className="text-[17px] font-semibold text-gray-500 dark:text-gray-400">{def.unit}</span>}
          </div>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-2">{t('export.score_above_hint')}</p>
        </div>
      ))}

      {others.filter(def => def.type === 'list' && def.options).map(def => (
        <div key={def.key}>
          <span className={labelClass}>{label(def)}</span>
          <div className="flex flex-wrap gap-2">
            {def.options.map(option => {
              const selected = filters[def.key] || []
              const active = selected.includes(option)
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange(def.key, active ? selected.filter(item => item !== option) : [...selected, option])}
                  className={`px-4 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition ${active ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300'}`}
                >
                  {option}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-3">
        {others.filter(def => !(def.type === 'list' && def.options)).map(def => (
          <div key={def.key}>
            <label className={labelClass} htmlFor={`export-filter-${def.key}`}>{label(def)}</label>
            <input
              id={`export-filter-${def.key}`}
              type={def.type === 'date' || def.type === 'datetime' ? 'date' : def.type === 'number' ? 'number' : 'text'}
              className={selectClass}
              value={filters[def.key] ?? ''}
              onChange={e => onChange(def.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function DataExport() {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [schema, setSchema] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [draft, setDraft] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [fieldSearch, setFieldSearch] = useState('')

  const entity = useMemo(
    () => schema?.entities.find(item => item.key === draft?.entity) || schema?.entities[0] || null,
    [schema, draft?.entity],
  )
  const format = useMemo(() => schema?.formats.find(item => item.key === draft?.format) || null, [schema, draft?.format])
  const fieldLabels = useMemo(() => new Map((entity?.fields || []).map(field => [field.key, field])), [entity])

  const groupedFields = useMemo(() => {
    const needle = fieldSearch.trim().toLowerCase()
    const groups = new Map()
    for (const field of entity?.fields || []) {
      if (needle && !`${field.label} ${field.key}`.toLowerCase().includes(needle)) continue
      if (!groups.has(field.group)) groups.set(field.group, [])
      groups.get(field.group).push(field)
    }
    return [...groups.entries()]
  }, [entity, fieldSearch])

  useEffect(() => {
    Promise.all([exportsApi.getSchema(), exportsApi.getProfiles()])
      .then(([schemaData, profileData]) => {
        setSchema(schemaData)
        setProfiles(profileData || [])
        // ?entity=matching_vector oeffnet direkt den gewuenschten Abzug
        // (z. B. aus der Matrix-Matching-Seite).
        const requested = schemaData.entities.find(item => item.key === searchParams.get('entity'))
        const base = emptyDraft(requested || schemaData.entities[0])
        // Aus der Bewerberliste uebergebene Auswahl vorbelegen.
        const ids = searchParams.get('ids')
        if (ids && base.entity === CANDIDATES) base.filters.ids = ids
        setDraft(base)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const update = (patch) => {
    setDraft(current => ({ ...current, ...patch }))
    setPreview(null)
  }
  const updateFilter = (key, value) => update({ filters: { ...draft.filters, [key]: value } })
  const entityByKey = (key) => schema?.entities.find(item => item.key === key) || null
  const openProfile = (profile) => setDraft(draftFromProfile(profile, entityByKey(profile.entity)))

  // Ein Wechsel der Datenquelle beginnt einen neuen Entwurf: Felder und
  // Filter unterscheiden sich je Quelle.
  const selectEntity = (key) => {
    if (key === draft.entity) return
    setDraft(emptyDraft(entityByKey(key)))
    setPreview(null)
    setFieldSearch('')
    setError('')
  }
  const updateFormatOption = (key, value) => update({ format_options: { ...draft.format_options, [key]: value } })

  const toggleField = (key) => {
    const exists = draft.fields.some(field => field.key === key)
    update({ fields: exists ? draft.fields.filter(field => field.key !== key) : [...draft.fields, { key, as: key }] })
  }
  const renameField = (index, as) => update({ fields: draft.fields.map((field, i) => (i === index ? { ...field, as } : field)) })
  const moveField = (index, delta) => {
    const target = index + delta
    if (target < 0 || target >= draft.fields.length) return
    const fields = [...draft.fields]
    ;[fields[index], fields[target]] = [fields[target], fields[index]]
    update({ fields })
  }

  const spec = () => ({
    entity: draft.entity,
    format: draft.format,
    format_options: draft.format_options,
    fields: draft.fields.map(field => ({ key: field.key, as: field.as.trim() || field.key })),
    filters: filtersForApi(entity, draft.filters),
  })

  const run = async (label, action) => {
    setBusy(label)
    setError('')
    try {
      return await action()
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const handlePreview = () => run('preview', async () => setPreview(await exportsApi.preview(spec())))

  const handleDownload = () => run('download', async () => {
    const result = await exportsApi.run(spec())
    toast.success(t('export.downloaded').replace('{count}', result.count))
  })

  const handleSave = () => run('save', async () => {
    const payload = { ...spec(), name: draft.name, description: draft.description, external_enabled: draft.external_enabled }
    const saved = draft.id ? await exportsApi.updateProfile(draft.id, payload) : await exportsApi.createProfile(payload)
    setProfiles(await exportsApi.getProfiles())
    openProfile(saved)
    toast.success(t('export.saved'))
  })

  const handleDelete = async () => {
    const ok = await confirm({ title: t('export.delete_title'), message: t('export.delete_confirm').replace('{name}', draft.name), confirmLabel: t('export.delete'), tone: 'danger' })
    if (!ok) return
    await run('delete', async () => {
      await exportsApi.deleteProfile(draft.id)
      setProfiles(await exportsApi.getProfiles())
      setDraft(emptyDraft(entity))
      toast.success(t('export.deleted'))
    })
  }

  if (loading) return <LoadingSpinner text={t('common.loading')} />
  if (!schema || !draft) {
    return (
      <PageContainer>
        <EmptyState icon={FileOutput} title={t('export.title')} description={error || t('export.load_error')} />
      </PageContainer>
    )
  }

  const externalUrl = draft.id ? `${window.location.origin}/api/exports/external/profiles/${draft.id}` : ''

  return (
    <PageContainer width="wide" className="space-y-6">
      <div>
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('export.title')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('export.subtitle')}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="space-y-3 !p-5 h-fit">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold text-black dark:text-white">{t('export.profiles')}</h2>
            <Button size="sm" variant="secondary" onClick={() => { setDraft(emptyDraft(entity)); setPreview(null) }}>
              <Plus className="w-4 h-4" /> {t('export.new')}
            </Button>
          </div>
          {profiles.length === 0 && <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('export.no_profiles')}</p>}
          <div className="space-y-1">
            {profiles.map(profile => (
              <button
                key={profile.id}
                onClick={() => { openProfile(profile); setPreview(null); setError('') }}
                className={`w-full text-left px-4 py-3 rounded-[14px] transition cursor-pointer ${draft.id === profile.id ? 'bg-[#0071e3]/10 text-[var(--apple-blue-text)]' : 'hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-black dark:text-white'}`}
              >
                <div className="font-medium text-[15px] flex items-center gap-2">
                  {profile.name}
                  {profile.external_enabled && <Globe className="w-3.5 h-3.5 text-[#34c759]" aria-label={t('export.external')} />}
                </div>
                <div className="text-[12px] text-gray-500 dark:text-gray-400">
                  {t(`export.entity_${profile.entity}`, entityByKey(profile.entity)?.label || profile.entity)} · {profile.format.toUpperCase()} · {profile.fields.length} {t('export.fields_count')}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-6 min-w-0">
          <Card className="space-y-5 !p-5 sm:!p-8">
            <div>
              <span className={labelClass} id="export-source-label">{t('export.source')}</span>
              <div role="radiogroup" aria-labelledby="export-source-label" className="inline-flex flex-wrap gap-1.5 p-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[18px]">
                {schema.entities.map(item => {
                  const active = item.key === draft.entity
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => selectEntity(item.key)}
                      className={`px-4 py-2 rounded-[14px] text-[14px] font-semibold transition cursor-pointer ${active ? 'bg-white dark:bg-[#1c1c1e] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'}`}
                    >
                      {t(`export.entity_${item.key}`, item.label)}
                    </button>
                  )
                })}
              </div>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-2 ml-1">{t(`export.entity_desc_${entity?.key}`, entity?.description || '')}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input label={t('export.name')} value={draft.name} onChange={e => update({ name: e.target.value })} placeholder={t('export.name_placeholder')} disabled={!isAdmin} />
              <Input label={t('export.description')} value={draft.description} onChange={e => update({ description: e.target.value })} disabled={!isAdmin} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="export-format">{t('export.format')}</label>
                <select id="export-format" className={selectClass} value={draft.format} onChange={e => update({ format: e.target.value, format_options: {} })}>
                  {schema.formats.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </div>
              {(format?.options || []).map(option => {
                const value = draft.format_options[option.key] ?? option.default
                const id = `export-opt-${option.key}`
                if (option.type === 'boolean') {
                  return (
                    <label key={option.key} className="flex items-center gap-3 text-[14px] text-gray-700 dark:text-gray-300 md:pt-7 cursor-pointer">
                      <input type="checkbox" checked={Boolean(value)} onChange={e => updateFormatOption(option.key, e.target.checked)} className="w-4 h-4 accent-[#0071e3]" />
                      {option.label}
                    </label>
                  )
                }
                return (
                  <div key={option.key}>
                    <label className={labelClass} htmlFor={id}>{option.label}</label>
                    {option.type === 'enum' ? (
                      <select id={id} className={selectClass} value={value} onChange={e => updateFormatOption(option.key, e.target.value)}>
                        {option.values.map(v => <option key={v} value={v}>{t(`export.delimiter_${v}`, v)}</option>)}
                      </select>
                    ) : (
                      <input id={id} className={selectClass} value={value} onChange={e => updateFormatOption(option.key, e.target.value)} />
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="space-y-4 !p-5 sm:!p-8">
              <h2 className="text-[17px] font-semibold text-black dark:text-white">{t('export.available_fields')}</h2>
              <input className={selectClass} placeholder={t('export.field_search')} value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} aria-label={t('export.field_search')} />
              <div className="max-h-[460px] overflow-auto space-y-4 pr-1">
                {groupedFields.map(([group, fields]) => (
                  <div key={group}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">{group}</div>
                    {fields.map(field => (
                      <label key={field.key} className="flex items-center gap-3 py-1.5 text-[14px] text-gray-800 dark:text-gray-200 cursor-pointer">
                        <input type="checkbox" checked={draft.fields.some(f => f.key === field.key)} onChange={() => toggleField(field.key)} className="w-4 h-4 accent-[#0071e3]" />
                        <span>{field.label}</span>
                        <code className="ml-auto text-[11px] text-gray-400">{field.key}</code>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </Card>

            <Card className="space-y-4 !p-5 sm:!p-8">
              <div>
                <h2 className="text-[17px] font-semibold text-black dark:text-white">{t('export.mapping')}</h2>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{t('export.mapping_hint')}</p>
              </div>
              {draft.fields.length === 0 && <p className="text-[14px] text-gray-500">{t('export.no_fields')}</p>}
              <div className="max-h-[460px] overflow-auto space-y-3 pr-1">
                {draft.fields.map((field, index) => (
                  <div key={field.key}>
                    <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate mb-1 ml-1" title={field.key}>
                      {fieldLabels.get(field.key)?.label || field.key}
                    </div>
                    <div className="flex items-center gap-1">
                    <input
                      className="flex-1 min-w-0 px-3 py-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[10px] text-[13px] font-mono text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                      value={field.as}
                      onChange={e => renameField(index, e.target.value)}
                      aria-label={`${t('export.target_name')}: ${fieldLabels.get(field.key)?.label || field.key}`}
                    />
                    <button onClick={() => moveField(index, -1)} className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white cursor-pointer" aria-label={t('export.move_up')}><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => moveField(index, 1)} className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white cursor-pointer" aria-label={t('export.move_down')}><ArrowDown className="w-4 h-4" /></button>
                    <button onClick={() => toggleField(field.key)} className="p-1.5 text-gray-400 hover:text-[#ff3b30] cursor-pointer" aria-label={t('export.remove_field')}><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {!isCandidates(entity) ? (
            <MatchingFilters entity={entity} filters={draft.filters} onChange={updateFilter} t={t} />
          ) : (
          <Card className="space-y-4 !p-5 sm:!p-8">
            <h2 className="text-[17px] font-semibold text-black dark:text-white">{t('export.filters')}</h2>
            <div>
              <span className={labelClass}>{t('export.filter_status')}</span>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map(status => {
                  const active = draft.filters.status.includes(status)
                  return (
                    <button
                      key={status}
                      onClick={() => updateFilter('status', active ? draft.filters.status.filter(s => s !== status) : [...draft.filters.status, status])}
                      className={`px-4 py-1.5 rounded-full text-[13px] font-medium cursor-pointer transition ${active ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300'}`}
                    >
                      {status}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['source', 'text', t('export.filter_source')],
                ['tags', 'text', t('export.filter_tags')],
                ['ids', 'text', t('export.filter_ids')],
                ['created_from', 'date', t('export.filter_created_from')],
                ['created_to', 'date', t('export.filter_created_to')],
                ['updated_since', 'date', t('export.filter_updated_since')],
              ].map(([key, type, label]) => (
                <div key={key}>
                  <label className={labelClass} htmlFor={`export-filter-${key}`}>{label}</label>
                  <input id={`export-filter-${key}`} type={type} className={selectClass} value={draft.filters[key] || ''} onChange={e => updateFilter(key, e.target.value)} />
                </div>
              ))}
            </div>
          </Card>
          )}

          {isAdmin && (
            <Card className="space-y-3 !p-5 sm:!p-8">
              <label className="flex items-center gap-3 text-[15px] font-medium text-black dark:text-white cursor-pointer">
                <input type="checkbox" checked={draft.external_enabled} onChange={e => update({ external_enabled: e.target.checked })} className="w-4 h-4 accent-[#0071e3]" />
                {t('export.external_toggle')}
              </label>
              <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('export.external_hint')}</p>
              {draft.external_enabled && draft.id && (
                <pre className="text-[12px] whitespace-pre-wrap break-all p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white">
{`curl -H "X-API-Key: <EXTERNAL_API_KEY>" \\
  "${externalUrl}?limit=500&offset=0&updated_since=2026-01-01T00:00:00Z"`}
                </pre>
              )}
              {draft.external_enabled && !draft.id && <p className="text-[13px] text-[#ff9500]">{t('export.external_save_first')}</p>}
            </Card>
          )}

          {error && <p className="text-[14px] text-[#ff3b30]" role="alert">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" onClick={handlePreview} disabled={!!busy || draft.fields.length === 0}>
              {busy === 'preview' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} {t('export.preview')}
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={!!busy || draft.fields.length === 0}>
              {busy === 'download' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t('export.download')}
            </Button>
            {isAdmin && (
              <Button variant="dark" size="sm" onClick={handleSave} disabled={!!busy || !draft.name.trim() || draft.fields.length === 0}>
                <Save className="w-4 h-4" /> {draft.id ? t('export.save') : t('export.save_as_profile')}
              </Button>
            )}
            {isAdmin && draft.id && (
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={!!busy}>
                <Trash2 className="w-4 h-4" /> {t('export.delete')}
              </Button>
            )}
          </div>

          {preview && (
            <Card className="space-y-3 !p-5 sm:!p-8">
              <h2 className="text-[17px] font-semibold text-black dark:text-white">
                {t('export.preview_title').replace('{shown}', preview.records.length).replace('{total}', preview.total)}
              </h2>
              <div className="overflow-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                      {draft.fields.map(field => <th key={field.key} className="px-3 py-2 font-mono whitespace-nowrap">{field.as || field.key}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.records.map((record, index) => (
                      <tr key={index} className="border-b border-gray-50 dark:border-gray-800 text-black dark:text-white">
                        {draft.fields.map(field => {
                          const path = (field.as || field.key).split('.')
                          const value = path.reduce((node, part) => (node == null ? node : node[part]), record)
                          return <td key={field.key} className="px-3 py-2 max-w-[260px] truncate" title={previewCell(value)}>{previewCell(value)}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
