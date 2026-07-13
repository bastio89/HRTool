import { useState, useRef, useCallback } from 'react'
import { X, Upload, FileText, CheckCircle2, XCircle, Loader2, Play, Trash2, ChevronRight, Users } from 'lucide-react'
import { cvParserApi, candidatesApi, uploadsApi } from '../api'
import { Button } from './UI'
import { useI18n } from '../I18nContext'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]

const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
  SKIPPED: 'skipped',
}

export default function BatchCVImportDialog({ onClose, onImported }) {
  const { t } = useI18n()
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState([]) // { file, id, status, progress, candidate, error }
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const fileInputRef = useRef(null)
  const abortRef = useRef(false)

  const addFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(f => ALLOWED_TYPES.includes(f.type))
    if (!valid.length) return
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.file.name))
      const fresh = valid.filter(f => !existingNames.has(f.name)).map(f => ({
        id: Math.random().toString(36).slice(2),
        file: f,
        status: STATUS.PENDING,
        progress: 0,
        candidate: null,
        error: null,
      }))
      return [...prev, ...fresh]
    })
  }, [])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)

  const handleFileSelect = (e) => {
    addFiles(e.target.files)
    e.target.value = ''
  }

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const updateFile = (id, patch) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  const processAll = async () => {
    setRunning(true)
    setDone(false)
    abortRef.current = false

    const pending = files.filter(f => f.status === STATUS.PENDING || f.status === STATUS.ERROR)

    for (const item of pending) {
      if (abortRef.current) break

      updateFile(item.id, { status: STATUS.PROCESSING, progress: 0, error: null })

      try {
        // Step 1: Parse CV
        const result = await cvParserApi.parse(item.file, (evt) => {
          updateFile(item.id, { progress: Math.round(evt.progress * 0.8) }) // 0-80% for parsing
        })

        if (result.error) throw new Error(result.error)

        const c = result.candidate || result

        // Build candidate object from parsed data
        const candidateData = {
          name: c.name || item.file.name.replace(/\.[^/.]+$/, ''),
          email: c.email || '',
          phone: c.phone || '',
          location: c.location || '',
          experience: c.experience || '',
          skills: c.skills || '',
          education: c.education || '',
          languages: c.languages || '',
          certificates: c.certificates || '',
          drivers_license: c.drivers_license || '',
          desired_salary: c.desired_salary || '',
          availability: c.availability || '',
          mobility: c.mobility || '',
          tags: c.tags || '',
          notes: c.notes || '',
          linkedin_url: c.linkedin_url || '',
          xing_url: c.xing_url || '',
          github_url: c.github_url || '',
          portfolio_url: c.portfolio_url || '',
          nationality: c.nationality || '',
          current_employer: c.current_employer || '',
          current_position: c.current_position || '',
          notice_period: c.notice_period || '',
          gender: c.gender || '',
          salary_min: c.salary_min || '',
          salary_max: c.salary_max || '',
          salary_currency: c.salary_currency || 'EUR',
          salary_interval: c.salary_interval || 'yearly',
          status: 'Aktiv',
          source: 'CV-Import',
        }

        updateFile(item.id, { progress: 85 })

        // Step 2: Create candidate
        const created = await candidatesApi.create(candidateData)
        updateFile(item.id, { progress: 92 })

        // Step 3: Upload the original file
        try {
          await uploadsApi.upload(created.id, item.file)
        } catch (_) {
          // non-critical, continue
        }

        updateFile(item.id, { status: STATUS.DONE, progress: 100, candidate: { id: created.id, name: candidateData.name } })
      } catch (err) {
        updateFile(item.id, { status: STATUS.ERROR, progress: 0, error: err.message || t('batch_import.error_generic') })
      }
    }

    setRunning(false)
    setDone(true)
    const successCount = files.filter(f => f.status === STATUS.DONE).length +
      pending.filter(f => {
        // count newly done items (we can't access state here; caller handles it)
        return false
      }).length
    if (onImported) onImported()
  }

  const counts = {
    pending: files.filter(f => f.status === STATUS.PENDING).length,
    processing: files.filter(f => f.status === STATUS.PROCESSING).length,
    done: files.filter(f => f.status === STATUS.DONE).length,
    error: files.filter(f => f.status === STATUS.ERROR).length,
  }

  const canRun = !running && files.some(f => f.status === STATUS.PENDING || f.status === STATUS.ERROR)
  const allDone = files.length > 0 && files.every(f => f.status === STATUS.DONE || f.status === STATUS.SKIPPED)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-[#1c1c1e] rounded-[28px] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#0071e3]/10 rounded-2xl flex items-center justify-center">
              <Users className="w-5 h-5 text-[#0071e3]" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-black dark:text-white">{t('batch_import.title')}</h2>
              <p className="text-[13px] text-gray-400">{t('batch_import.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-gray-200 dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 text-black dark:text-white" />
          </button>
        </div>

        {/* Drop zone */}
        {!running && (
          <div className="px-8 pt-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center py-10 gap-3 rounded-[20px] border-2 border-dashed cursor-pointer transition-all ${
                isDragging
                  ? 'border-[#0071e3] bg-[#0071e3]/8 scale-[1.01]'
                  : 'border-gray-200 dark:border-gray-700 hover:border-[#0071e3]/50 hover:bg-[#0071e3]/4'
              }`}
            >
              <div className="w-14 h-14 bg-white dark:bg-[#2c2c2e] rounded-[18px] shadow-sm flex items-center justify-center border border-gray-100 dark:border-gray-700">
                <Upload className="w-6 h-6 text-[#0071e3]" />
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold text-black dark:text-white">{t('batch_import.drop_hint')}</p>
                <p className="text-[13px] text-gray-400 mt-1">{t('batch_import.formats')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="flex-1 overflow-y-auto px-8 py-4 space-y-2 min-h-0">
            {files.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 rounded-[14px] bg-[#f5f5f7] dark:bg-[#2c2c2e]"
              >
                {/* Status icon */}
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                  {item.status === STATUS.DONE && <CheckCircle2 className="w-5 h-5 text-[#34c759]" />}
                  {item.status === STATUS.ERROR && <XCircle className="w-5 h-5 text-[#ff3b30]" />}
                  {item.status === STATUS.PROCESSING && (
                    <Loader2 className="w-5 h-5 text-[#0071e3] animate-spin" />
                  )}
                  {item.status === STATUS.PENDING && (
                    <FileText className="w-5 h-5 text-gray-400" />
                  )}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-black dark:text-white truncate">
                    {item.status === STATUS.DONE && item.candidate
                      ? item.candidate.name
                      : item.file.name}
                  </p>
                  {item.status === STATUS.PROCESSING && (
                    <div className="mt-1.5 w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#0071e3] to-[#5856d6] rounded-full transition-all duration-500"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                  {item.status === STATUS.DONE && (
                    <p className="text-[12px] text-[#34c759] mt-0.5">{t('batch_import.created')}</p>
                  )}
                  {item.status === STATUS.ERROR && (
                    <p className="text-[12px] text-[#ff3b30] mt-0.5 truncate">{item.error}</p>
                  )}
                  {item.status === STATUS.PENDING && (
                    <p className="text-[12px] text-gray-400 mt-0.5">
                      {(item.file.size / 1024).toFixed(0)} KB
                    </p>
                  )}
                </div>

                {/* Remove button (only when not running) */}
                {!running && item.status !== STATUS.DONE && (
                  <button
                    onClick={() => removeFile(item.id)}
                    className="flex-shrink-0 w-7 h-7 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-[#ff3b30]" />
                  </button>
                )}

                {/* Link to candidate when done */}
                {item.status === STATUS.DONE && item.candidate && (
                  <a
                    href={`/candidates/${item.candidate.id}`}
                    onClick={(e) => { e.stopPropagation(); onClose() }}
                    className="flex-shrink-0 w-7 h-7 rounded-full hover:bg-[#0071e3]/10 flex items-center justify-center transition-colors"
                    title={t('batch_import.open_profile')}
                  >
                    <ChevronRight className="w-4 h-4 text-[#0071e3]" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {files.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-8 text-gray-400 text-[14px]">
            {t('batch_import.empty')}
          </div>
        )}

        {/* Footer */}
        <div className="px-8 pb-8 pt-4 border-t border-gray-100 dark:border-gray-800">
          {/* Stats row */}
          {files.length > 0 && (
            <div className="flex items-center gap-4 text-[13px] mb-5">
              <span className="text-gray-400">{t('batch_import.total').replace('{n}', files.length)}</span>
              {counts.done > 0 && <span className="text-[#34c759] font-medium">{t('batch_import.count_done').replace('{n}', counts.done)}</span>}
              {counts.error > 0 && <span className="text-[#ff3b30] font-medium">{t('batch_import.count_error').replace('{n}', counts.error)}</span>}
              {counts.pending > 0 && <span className="text-gray-400">{t('batch_import.count_pending').replace('{n}', counts.pending)}</span>}
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <Button variant="secondary" size="md" onClick={onClose} disabled={running}>
              {allDone ? t('batch_import.close') : t('batch_import.cancel')}
            </Button>
            <Button
              variant="dark"
              size="md"
              onClick={processAll}
              disabled={!canRun}
            >
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('batch_import.importing')}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  {t('batch_import.start').replace('{n}', files.filter(f => f.status === STATUS.PENDING || f.status === STATUS.ERROR).length)}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
