import { useState, useRef } from 'react'
import { Upload, FileText, X, AlertCircle, CheckCircle, ArrowRight, ArrowLeft, ChevronDown, AlertTriangle } from 'lucide-react'
import { candidatesApi } from '../api'
import { useI18n } from '../I18nContext'

const CANDIDATE_FIELDS = [
  { key: 'name', labelKey: 'form.name', required: true },
  { key: 'email', labelKey: 'form.email' },
  { key: 'phone', labelKey: 'form.phone' },
  { key: 'location', labelKey: 'form.location' },
  { key: 'experience', labelKey: 'form.experience' },
  { key: 'skills', labelKey: 'form.skills' },
  { key: 'education', labelKey: 'form.education' },
  { key: 'desired_salary', labelKey: 'form.salary' },
  { key: 'availability', labelKey: 'form.availability' },
  { key: 'languages', labelKey: 'form.languages' },
  { key: 'certificates', labelKey: 'form.certificates' },
  { key: 'drivers_license', labelKey: 'form.drivers_license' },
  { key: 'mobility', labelKey: 'form.mobility' },
  { key: 'notes', labelKey: 'form.notes' },
  { key: 'status', labelKey: 'form.status' },
  { key: 'tags', labelKey: 'form.tags' },
  { key: 'source', labelKey: 'form.source' },
]

// Smart auto-mapping: map CSV header to candidate field
function autoMap(header) {
  const h = header.toLowerCase().trim()
  const mappings = {
    'name': 'name', 'vorname': 'name', 'nachname': 'name', 'full name': 'name', 'fullname': 'name', 'bewerber': 'name',
    'email': 'email', 'e-mail': 'email', 'mail': 'email', 'e_mail': 'email',
    'telefon': 'phone', 'phone': 'phone', 'tel': 'phone', 'handy': 'phone', 'mobil': 'phone', 'mobile': 'phone',
    'standort': 'location', 'location': 'location', 'ort': 'location', 'stadt': 'location', 'city': 'location', 'plz': 'location',
    'erfahrung': 'experience', 'experience': 'experience', 'berufserfahrung': 'experience',
    'skills': 'skills', 'fähigkeiten': 'skills', 'kenntnisse': 'skills', 'kompetenzen': 'skills',
    'ausbildung': 'education', 'education': 'education', 'studium': 'education', 'abschluss': 'education',
    'gehalt': 'desired_salary', 'salary': 'desired_salary', 'gehaltswunsch': 'desired_salary', 'desired_salary': 'desired_salary',
    'verfügbarkeit': 'availability', 'availability': 'availability', 'verfuegbarkeit': 'availability', 'startdatum': 'availability',
    'sprachen': 'languages', 'languages': 'languages', 'language': 'languages',
    'zertifikate': 'certificates', 'certificates': 'certificates', 'zertifikat': 'certificates',
    'führerschein': 'drivers_license', 'fuehrerschein': 'drivers_license', 'drivers_license': 'drivers_license',
    'mobilität': 'mobility', 'mobility': 'mobility',
    'notizen': 'notes', 'notes': 'notes', 'bemerkungen': 'notes', 'kommentar': 'notes',
    'status': 'status',
    'tags': 'tags', 'label': 'tags', 'kategorie': 'tags',
    'quelle': 'source', 'source': 'source', 'kanal': 'source', 'herkunft': 'source',
  }
  return mappings[h] || null
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV_MIN_LINES')

  // Parse with proper quote handling
  function parseLine(line) {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i])
    if (values.every(v => !v)) continue // skip empty rows
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })
    rows.push(row)
  }

  return { headers, rows }
}

export default function CSVImportDialog({ open, onClose, onImported }) {
  const { t } = useI18n()
  const [step, setStep] = useState(1) // 1: upload, 2: mapping, 3: preview, 4: result
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({}) // csvHeader -> candidateField
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef()

  const reset = () => {
    setStep(1)
    setCsvHeaders([])
    setCsvRows([])
    setMapping({})
    setSkipDuplicates(true)
    setImporting(false)
    setResult(null)
    setError('')
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const { headers, rows } = parseCSV(ev.target.result)
        setCsvHeaders(headers)
        setCsvRows(rows)

        // Auto-map
        const autoMapping = {}
        headers.forEach(h => {
          const mapped = autoMap(h)
          if (mapped) autoMapping[h] = mapped
        })
        setMapping(autoMapping)
        setStep(2)
      } catch (err) {
        setError(err.message === 'CSV_MIN_LINES' ? t('csv.min_lines') : err.message)
      }
    }
    reader.readAsText(file)
  }

  const mappedRows = () => {
    return csvRows.map(row => {
      const candidate = {}
      Object.entries(mapping).forEach(([csvCol, field]) => {
        if (field && row[csvCol]) {
          if (candidate[field]) {
            // Merge multiple CSV columns into one field (e.g. Vorname + Nachname → Name)
            candidate[field] += ' ' + row[csvCol]
          } else {
            candidate[field] = row[csvCol]
          }
        }
      })
      return candidate
    }).filter(c => c.name && c.name.trim())
  }

  const handleImport = async () => {
    setImporting(true)
    setError('')
    try {
      const rows = mappedRows()
      if (rows.length === 0) {
        setError(t('csv.no_valid_rows'))
        setImporting(false)
        return
      }
      const res = await candidatesApi.importCSV(rows, skipDuplicates)
      setResult(res)
      setStep(4)
      if (res.imported > 0) onImported?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const hasNameMapping = Object.values(mapping).includes('name')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[85vh] bg-white dark:bg-[#1c1c1e] rounded-[24px] shadow-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div>
            <h3 className="text-[22px] font-semibold text-black dark:text-white">{t('csv.import_title')}</h3>
            <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">
              {step === 1 && t('csv.step_upload')}
              {step === 2 && t('csv.step_mapping')}
              {step === 3 && t('csv.step_preview')}
              {step === 4 && t('csv.step_result')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicators */}
            <div className="flex items-center gap-1.5 mr-4">
              {[1,2,3,4].map(s => (
                <div key={s} className={`w-2 h-2 rounded-full transition-all ${s === step ? 'w-6 bg-[#0071e3]' : s < step ? 'bg-[#34c759]' : 'bg-gray-300 dark:bg-gray-600'}`} />
              ))}
            </div>
            <button onClick={() => { reset(); onClose(); }} className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {error && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#ff3b30]/10 border border-[#ff3b30]/20 mb-6">
              <AlertCircle className="w-5 h-5 text-[#ff3b30] flex-shrink-0" />
              <span className="text-[14px] text-[#ff3b30]">{error}</span>
            </div>
          )}

          {/* Step 1: Upload */}
          {step === 1 && (
            <div
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-16 text-center cursor-pointer hover:border-[#0071e3] hover:bg-[#0071e3]/5 transition-all"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-[18px] font-semibold text-black dark:text-white mb-2">{t('csv.upload_title')}</p>
              <p className="text-[14px] text-gray-500 dark:text-gray-400">{t('csv.upload_hint')}</p>
              <p className="text-[13px] text-gray-400 mt-3">{t('csv.upload_supported')}</p>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
            </div>
          )}

          {/* Step 2: Mapping */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mb-4">
                {t('csv.mapping_hint')} <span className="font-semibold text-black dark:text-white">{t('csv.rows_detected').replace('{count}', csvRows.length)}</span>
              </p>
              {csvHeaders.map(header => (
                <div key={header} className="flex items-center gap-4 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <div className="flex-1 min-w-0">
                    <span className="text-[14px] font-medium text-black dark:text-white truncate block">{header}</span>
                    <span className="text-[12px] text-gray-400 truncate block">{csvRows[0]?.[header] || '—'}</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="relative flex-1">
                    <select
                      value={mapping[header] || ''}
                      onChange={e => setMapping(m => ({ ...m, [header]: e.target.value || undefined }))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1c1c1e] text-[14px] text-black dark:text-white outline-none appearance-none cursor-pointer"
                    >
                      <option value="">{t('csv.no_import')}</option>
                      {CANDIDATE_FIELDS.map(f => (
                        <option key={f.key} value={f.key}>
                          {t(f.labelKey)}{f.required ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              ))}

              {!hasNameMapping && (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#ff9500]/10 border border-[#ff9500]/20 mt-4">
                  <AlertTriangle className="w-5 h-5 text-[#ff9500] flex-shrink-0" />
                  <span className="text-[14px] text-[#ff9500]">{t('csv.name_required')}</span>
                </div>
              )}

              <label className="flex items-center gap-3 mt-4 cursor-pointer">
                <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)}
                  className="w-5 h-5 rounded-md accent-[#0071e3]" />
                <span className="text-[14px] text-gray-600 dark:text-gray-300">{t('csv.skip_duplicates')}</span>
              </label>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && (
            <div>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mb-6">
                {t('csv.preview_first')} <span className="font-semibold text-black dark:text-white">{t('csv.valid_rows').replace('{count}', mappedRows().length)}</span>
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-[#f5f5f7] dark:bg-[#2c2c2e] border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-left font-semibold text-gray-500 dark:text-gray-400">#</th>
                      {CANDIDATE_FIELDS.filter(f => Object.values(mapping).includes(f.key)).map(f => (
                        <th key={f.key} className="px-4 py-3 text-left font-semibold text-gray-500 dark:text-gray-400">{t(f.labelKey)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows().slice(0, 5).map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="px-4 py-3 text-gray-400">{idx + 1}</td>
                        {CANDIDATE_FIELDS.filter(f => Object.values(mapping).includes(f.key)).map(f => (
                          <td key={f.key} className="px-4 py-3 text-black dark:text-white max-w-[200px] truncate">{row[f.key] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mappedRows().length > 5 && (
                <p className="text-[13px] text-gray-400 mt-3 text-center">{t('csv.more_rows').replace('{count}', mappedRows().length - 5)}</p>
              )}
            </div>
          )}

          {/* Step 4: Result */}
          {step === 4 && result && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-center">
                  <div className="text-[32px] font-bold text-black dark:text-white">{result.total}</div>
                  <div className="text-[13px] text-gray-500 mt-1">{t('csv.result_total')}</div>
                </div>
                <div className="p-5 rounded-2xl bg-[#34c759]/10 text-center">
                  <div className="text-[32px] font-bold text-[#34c759]">{result.imported}</div>
                  <div className="text-[13px] text-[#34c759] mt-1">{t('csv.result_imported')}</div>
                </div>
                <div className="p-5 rounded-2xl bg-[#ff9500]/10 text-center">
                  <div className="text-[32px] font-bold text-[#ff9500]">{result.skipped}</div>
                  <div className="text-[13px] text-[#ff9500] mt-1">{t('csv.result_duplicates')}</div>
                </div>
                <div className="p-5 rounded-2xl bg-[#ff3b30]/10 text-center">
                  <div className="text-[32px] font-bold text-[#ff3b30]">{result.errors}</div>
                  <div className="text-[13px] text-[#ff3b30] mt-1">{t('csv.result_errors')}</div>
                </div>
              </div>

              {result.imported > 0 && (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#34c759]/10">
                  <CheckCircle className="w-5 h-5 text-[#34c759]" />
                  <span className="text-[15px] font-medium text-[#34c759]">{t('csv.import_success').replace('{count}', result.imported)}</span>
                </div>
              )}

              {result.duplicates?.length > 0 && (
                <div>
                  <p className="text-[14px] font-semibold text-gray-600 dark:text-gray-300 mb-2">{t('csv.skipped_title')}</p>
                  <div className="space-y-1 max-h-[150px] overflow-y-auto">
                    {result.duplicates.map((d, i) => (
                      <div key={i} className="text-[13px] text-gray-500 dark:text-gray-400">
                        {t('csv.row_label')} {d.row}: <span className="text-black dark:text-white">{d.name}</span> ({t('csv.exists_as')} „{d.existingName}")
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.errorDetails?.length > 0 && (
                <div>
                  <p className="text-[14px] font-semibold text-[#ff3b30] mb-2">{t('csv.error_rows_title')}</p>
                  <div className="space-y-1 max-h-[150px] overflow-y-auto">
                    {result.errorDetails.map((e, i) => (
                      <div key={i} className="text-[13px] text-gray-500">
                        {t('csv.row_label')} {e.row}: {e.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div>
            {step > 1 && step < 4 && (
              <button onClick={() => setStep(s => s - 1)} className="flex items-center gap-2 text-[14px] font-medium text-gray-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> {t('common.back')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step === 4 ? (
              <button onClick={() => { reset(); onClose(); }} className="px-6 py-2.5 rounded-full bg-[#0071e3] text-white text-[14px] font-medium hover:bg-[#0077ed] transition-colors cursor-pointer">
                {t('common.close')}
              </button>
            ) : step === 3 ? (
              <button onClick={handleImport} disabled={importing}
                className="px-6 py-2.5 rounded-full bg-[#34c759] text-white text-[14px] font-medium hover:bg-[#30d158] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-2"
              >
                {importing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('csv.importing')}
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    {t('csv.import_count').replace('{count}', mappedRows().length)}
                  </>
                )}
              </button>
            ) : step === 2 ? (
              <button onClick={() => setStep(3)} disabled={!hasNameMapping}
                className="px-6 py-2.5 rounded-full bg-[#0071e3] text-white text-[14px] font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-2"
              >
                {t('csv.step_preview')} <ArrowRight className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
