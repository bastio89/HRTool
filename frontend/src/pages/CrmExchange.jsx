import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Download, FileArchive, Play, Square, Trash2, Upload } from 'lucide-react'
import { crmApi } from '../api'
import { Button, Card, Input, PageContainer } from '../components/UI'
import { useToast } from '../components/Toast'
import { useI18n } from '../I18nContext'

// Administration -> CRM-Austausch: Kandidaten aus dem CRM-ZIP importieren
// und die Rueckgabe-CSV mit den Matching-Ergebnissen erzeugen.
// Ablauf und Format: README, Abschnitt "CRM-Schnittstelle".

const VISIBLE_ROWS = 200

const STATUS_TONE = {
  new: 'bg-[#0071e3]/10 text-[var(--apple-blue-text)]',
  update: 'bg-[#8e8e93]/15 text-gray-600 dark:text-gray-300',
  created: 'bg-[#34c759]/15 text-[#248a3d] dark:text-[#30d158]',
  linked: 'bg-[#34c759]/15 text-[#248a3d] dark:text-[#30d158]',
  updated: 'bg-[#34c759]/15 text-[#248a3d] dark:text-[#30d158]',
  unchanged: 'bg-[#8e8e93]/15 text-gray-600 dark:text-gray-300',
  running: 'bg-[#ff9500]/10 text-[#a35b00] dark:text-[#ffb340]',
  error: 'bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff6961]',
}

const formatSize = bytes => (bytes === null || bytes === undefined ? '—' : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function Section({ icon: Icon, title, description, children }) {
  return (
    <Card className="p-6 sm:p-8 space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[var(--apple-blue-text)]" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-[20px] font-semibold text-black dark:text-white">{title}</h2>
          <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

function StatusBadge({ status, label }) {
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${STATUS_TONE[status] || STATUS_TONE.update}`}>{label}</span>
}

function ImportSection({ t, toast }) {
  const [file, setFile] = useState(null)
  const [inspection, setInspection] = useState(null)
  const [results, setResults] = useState({})
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [error, setError] = useState('')
  const stopRequested = useRef(false)
  const inputRef = useRef(null)

  const importable = inspection ? inspection.rows.filter(row => !row.error) : []
  const done = importable.filter(row => results[row.uuid] && results[row.uuid].status !== 'running')
  const failed = done.filter(row => results[row.uuid].status === 'error')

  const reset = () => {
    setInspection(null)
    setResults({})
    setFile(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const check = async () => {
    if (!file) return
    setChecking(true)
    setError('')
    setResults({})
    try {
      setInspection(await crmApi.inspectArchive(file))
    } catch (err) {
      setInspection(null)
      setError(err.message)
    } finally {
      setChecking(false)
    }
  }

  // Kandidat fuer Kandidat, damit der Fortschritt sichtbar ist und ein
  // Fehler nur den einen Kandidaten betrifft. Bereits erledigte werden bei
  // einem zweiten Lauf uebersprungen (ausser fehlgeschlagene).
  const runImport = async () => {
    stopRequested.current = false
    setRunning(true)
    for (const row of importable) {
      if (stopRequested.current) break
      const previous = results[row.uuid]
      if (previous && previous.status !== 'error') continue
      setResults(current => ({ ...current, [row.uuid]: { status: 'running' } }))
      try {
        const result = await crmApi.importCandidate(inspection.token, row.uuid)
        setResults(current => ({ ...current, [row.uuid]: result }))
      } catch (err) {
        setResults(current => ({ ...current, [row.uuid]: { status: 'error', error: err.message } }))
      }
    }
    setRunning(false)
    toast.success(t('crm.import_finished'))
  }

  const discard = async () => {
    try {
      if (inspection?.token) await crmApi.discardImport(inspection.token)
    } catch (_) { /* bereits abgelaufen */ }
    reset()
  }

  // Beim Verlassen der Seite wird ein laufender Import angehalten.
  useEffect(() => () => { stopRequested.current = true }, [])

  const statusOf = (row) => {
    if (row.error) return { status: 'error', label: t('crm.status_invalid'), detail: row.error }
    const result = results[row.uuid]
    if (!result) return { status: row.action, label: t(`crm.action_${row.action}`), detail: row.action === 'update' ? t('crm.existing').replace('{name}', row.existingName || '') : null }
    if (result.status === 'error') return { status: 'error', label: t('crm.status_failed'), detail: result.error }
    return { status: result.status, label: t(`crm.status_${result.status}`), detail: result.warning || null, candidateId: result.candidate?.id }
  }

  const rows = inspection ? inspection.rows.filter(row => !onlyProblems || row.error || results[row.uuid]?.status === 'error') : []

  return (
    <Section icon={Upload} title={t('crm.import_title')} description={t('crm.import_description')}>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <label className="flex-1 flex items-center gap-3 px-4 py-3 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:border-[#0071e3]">
          <FileArchive className="w-5 h-5 text-gray-400" aria-hidden="true" />
          <span className="text-[14px] text-gray-600 dark:text-gray-300 truncate">{file ? file.name : t('crm.choose_zip')}</span>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-label={t('crm.choose_zip')}
            disabled={checking || running}
            onChange={e => { setFile(e.target.files?.[0] || null); setInspection(null); setResults({}); setError('') }}
          />
        </label>
        <Button onClick={check} disabled={!file || checking || running}>{checking ? t('crm.checking') : t('crm.check')}</Button>
      </div>

      {error && <p className="text-[14px] text-[#ff3b30]" role="alert">{error}</p>}

      {inspection && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-[13px]" aria-label={t('crm.summary')}>
            <StatusBadge status="update" label={t('crm.count_total').replace('{count}', inspection.summary.total)} />
            <StatusBadge status="new" label={t('crm.count_new').replace('{count}', inspection.summary.new)} />
            <StatusBadge status="update" label={t('crm.count_update').replace('{count}', inspection.summary.update)} />
            {inspection.summary.errors > 0 && <StatusBadge status="error" label={t('crm.count_errors').replace('{count}', inspection.summary.errors)} />}
          </div>

          {importable.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 items-center">
                {!running && (
                  <Button onClick={runImport} disabled={done.length === importable.length && failed.length === 0}>
                    <Play className="w-4 h-4" aria-hidden="true" />
                    {failed.length
                      ? t('crm.retry_failed').replace('{count}', failed.length)
                      : done.length === importable.length ? t('crm.import_done') : t('crm.start_import').replace('{count}', importable.length - done.length)}
                  </Button>
                )}
                {running && (
                  <Button variant="secondary" onClick={() => { stopRequested.current = true }}>
                    <Square className="w-4 h-4" aria-hidden="true" />{t('crm.stop')}
                  </Button>
                )}
                <Button variant="secondary" onClick={discard} disabled={running}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />{t('crm.discard')}
                </Button>
              </div>
              {(running || done.length > 0) && (
                <div>
                  <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={importable.length} aria-valuenow={done.length}>
                    <div className="h-full bg-[#0071e3] transition-all" style={{ width: `${(done.length / importable.length) * 100}%` }} />
                  </div>
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                    {t('crm.progress').replace('{done}', done.length).replace('{total}', importable.length).replace('{failed}', failed.length)}
                  </p>
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-[14px] text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
            {t('crm.only_problems')}
          </label>

          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-4 font-medium">{t('crm.col_line')}</th>
                  <th className="py-2 pr-4 font-medium">{t('crm.col_name')}</th>
                  <th className="py-2 pr-4 font-medium">{t('crm.col_labels')}</th>
                  <th className="py-2 pr-4 font-medium">{t('crm.col_cv')}</th>
                  <th className="py-2 font-medium">{t('crm.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, VISIBLE_ROWS).map(row => {
                  const state = statusOf(row)
                  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || '—'
                  return (
                    <tr key={`${row.line}-${row.uuid}`} className="border-t border-gray-100 dark:border-gray-800 align-top">
                      <td className="py-2 pr-4 text-gray-500">{row.line}</td>
                      <td className="py-2 pr-4">
                        {state.candidateId || row.existingId
                          ? <Link to={`/candidates/${state.candidateId || row.existingId}`} className="font-semibold text-[var(--apple-blue-text)] hover:underline">{name}</Link>
                          : <span className="font-semibold text-black dark:text-white">{name}</span>}
                        <div className="text-[12px] text-gray-400 font-mono">{row.uuid || '—'}</div>
                      </td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-gray-300">{row.labels.join(', ') || '—'}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-gray-300">{row.cvPath ? `${row.cvPath.split('/').pop()} (${formatSize(row.cvSize)})` : '—'}</td>
                      <td className="py-2">
                        <StatusBadge status={state.status} label={state.label} />
                        {state.detail && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-1 max-w-md">{state.detail}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > VISIBLE_ROWS && <p className="text-[13px] text-gray-500 mt-2">{t('crm.rows_limited').replace('{shown}', VISIBLE_ROWS).replace('{total}', rows.length)}</p>}
          </div>
        </div>
      )}
    </Section>
  )
}

// Erklaert, warum Paarungen aus dem Verlauf nicht in der Rueckgabe stehen.
function ReturnDiagnostics({ preview, t }) {
  const d = preview.diagnostics
  if (!d) return null
  const fill = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, value), t(key))
  const notes = []
  if (d.totalPairs === 0) notes.push(fill('crm.diag_no_pairs', { method: preview.methodLabel }))
  if (d.crmCandidates === 0) notes.push(t('crm.diag_no_crm_candidates'))
  if (d.notCrmPairs > 0) notes.push(fill('crm.diag_not_crm', { pairs: d.notCrmPairs, candidates: d.notCrmCandidates }))
  if (d.crmCandidates > 0 && d.crmCandidatesUnmatched > 0) notes.push(fill('crm.diag_unmatched', { count: d.crmCandidatesUnmatched, total: d.crmCandidates, method: preview.methodLabel }))
  if (d.belowThreshold > 0) notes.push(fill('crm.diag_below_threshold', { count: d.belowThreshold, threshold: preview.threshold }))
  if (preview.excludedCount > 0) notes.push(fill('crm.diag_job_problems', { count: preview.excludedCount }))
  if (!notes.length) return null
  return (
    <div className="rounded-2xl bg-[#ff9500]/10 p-4 space-y-2" role="status">
      <p className="text-[14px] font-semibold text-[#a35b00] dark:text-[#ffb340]">{t('crm.diag_title')}</p>
      <ul className="text-[14px] text-gray-700 dark:text-gray-300 list-disc ml-5 space-y-1">
        {notes.map(note => <li key={note}>{note}</li>)}
      </ul>
    </div>
  )
}

function ReturnSection({ t, toast }) {
  const [method, setMethod] = useState('ai')
  const [scoreAbove, setScoreAbove] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setPreview(await crmApi.previewReturn(method, scoreAbove))
    } catch (err) {
      setPreview(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const download = async (part) => {
    setDownloading(part)
    try {
      const { filename } = await crmApi.downloadReturn(method, scoreAbove, part)
      toast.success(t('crm.downloaded').replace('{filename}', filename))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDownloading(null)
    }
  }

  // Direkt exportieren: eine Datei wird sofort heruntergeladen; bei mehreren
  // Teilen oder ohne gueltige Zeile bleibt die Vorschau mit den Gruenden stehen.
  const exportCsv = async () => {
    setLoading(true)
    setError('')
    let result = null
    try {
      result = await crmApi.previewReturn(method, scoreAbove)
      setPreview(result)
    } catch (err) {
      setPreview(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
    if (!result) return
    if (result.parts.length === 1) await download(1)
    else if (result.parts.length === 0) setError(t('crm.export_impossible'))
  }

  return (
    <Section icon={Download} title={t('crm.return_title')} description={t('crm.return_description')}>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div className="flex flex-col gap-3">
          <label htmlFor="crm-return-method" className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 ml-1">{t('crm.method')}</label>
          <select
            id="crm-return-method"
            value={method}
            onChange={e => { setMethod(e.target.value); setPreview(null) }}
            className="w-full px-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white appearance-none cursor-pointer focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition"
          >
            <option value="ai">{t('crm.method_ai')}</option>
            <option value="vector">{t('crm.method_vector')}</option>
          </select>
        </div>
        <Input
          id="crm-return-threshold"
          label={t('crm.threshold')}
          type="number"
          min="0"
          max="100"
          step="0.5"
          placeholder={t('crm.threshold_placeholder')}
          value={scoreAbove}
          onChange={e => { setScoreAbove(e.target.value); setPreview(null) }}
        />
        <Button variant="secondary" onClick={load} disabled={loading || downloading !== null}>{loading ? t('crm.loading_preview') : t('crm.preview')}</Button>
        <Button onClick={exportCsv} disabled={loading || downloading !== null}>
          <Download className="w-4 h-4" aria-hidden="true" />{t('crm.export')}
        </Button>
      </div>

      {error && <p className="text-[14px] text-[#ff3b30]" role="alert">{error}</p>}

      {preview && (
        <div className="space-y-5">
          <p className="text-[15px] text-black dark:text-white">
            {t('crm.preview_summary').replace('{rows}', preview.rowCount).replace('{candidates}', preview.candidateCount).replace('{method}', preview.methodLabel)}
          </p>

          <ReturnDiagnostics preview={preview} t={t} />

          {/* Eine Datei laedt "CSV exportieren" direkt. Nur wenn die Rueckgabe
              auf mehrere Dateien verteilt ist, braucht es je Teil einen Knopf. */}
          {preview.parts.length > 1 && (
            <div className="space-y-2">
              <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('crm.parts_hint').replace('{count}', preview.parts.length)}</p>
              <div className="flex flex-wrap gap-3">
                {preview.parts.map(part => (
                  <Button key={part.part} variant="secondary" onClick={() => download(part.part)} disabled={downloading !== null}>
                    <Download className="w-4 h-4" aria-hidden="true" />
                    {t('crm.download_part').replace('{part}', part.part).replace('{count}', preview.parts.length).replace('{rows}', part.rows)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {preview.parts.length > 0 && <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('crm.upload_hint')}</p>}

          {preview.excludedCount > 0 && (
            <div className="space-y-3">
              <h3 className="text-[16px] font-semibold text-black dark:text-white">{t('crm.excluded_title').replace('{count}', preview.excludedCount)}</h3>
              <ul className="text-[14px] text-gray-600 dark:text-gray-300 list-disc ml-5">
                {Object.entries(preview.excludedReasons).map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}
              </ul>
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="py-2 pr-4 font-medium">{t('crm.col_candidate')}</th>
                      <th className="py-2 pr-4 font-medium">{t('crm.col_job')}</th>
                      <th className="py-2 pr-4 font-medium">{t('crm.col_score')}</th>
                      <th className="py-2 font-medium">{t('crm.col_reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.excluded.map(entry => (
                      <tr key={`${entry.candidateId}-${entry.jobId}`} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2 pr-4"><Link to={`/candidates/${entry.candidateId}`} className="text-[var(--apple-blue-text)] hover:underline">{entry.candidateName}</Link></td>
                        <td className="py-2 pr-4"><Link to={`/jobs/${entry.jobId}/edit`} className="text-[var(--apple-blue-text)] hover:underline">{entry.jobTitle}</Link></td>
                        <td className="py-2 pr-4">{Math.round(entry.score * 10) / 10} %</td>
                        <td className="py-2">{entry.reasons.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.excludedCount > preview.excluded.length && <p className="text-[13px] text-gray-500 mt-2">{t('crm.rows_limited').replace('{shown}', preview.excluded.length).replace('{total}', preview.excludedCount)}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

export default function CrmExchange() {
  const { t } = useI18n()
  const toast = useToast()
  return (
    <PageContainer width="wide" className="space-y-8">
      <div className="flex items-start gap-4">
        <ArrowLeftRight className="w-8 h-8 text-[var(--apple-blue-text)] mt-2 hidden sm:block" aria-hidden="true" />
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('crm.title')}</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('crm.subtitle')}</p>
        </div>
      </div>
      <ImportSection t={t} toast={toast} />
      <ReturnSection t={t} toast={toast} />
    </PageContainer>
  )
}
