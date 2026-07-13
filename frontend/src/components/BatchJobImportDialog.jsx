import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Upload, FileText, CheckCircle2, XCircle, Loader2, Play, Trash2, ChevronRight, Briefcase } from 'lucide-react'
import { jobsApi } from '../api'
import { Button } from './UI'
import { useI18n } from '../I18nContext'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]

const ALLOWED_EXT = /\.(pdf|doc|docx|txt|md)$/i

const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
}

function filenameToTitle(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

export default function BatchJobImportDialog({ onClose, onImported }) {
  const { t } = useI18n()
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState([])
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => {
        setFiles(prev => prev.map(f =>
          f.status === STATUS.PROCESSING && f.startedAt
            ? { ...f, elapsed: Math.floor((Date.now() - f.startedAt) / 1000) }
            : f
        ))
      }, 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [running])

  const addFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(
      f => ALLOWED_TYPES.includes(f.type) || ALLOWED_EXT.test(f.name)
    )
    if (!valid.length) return
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.file.name))
      const fresh = valid
        .filter(f => !existingNames.has(f.name))
        .map(f => ({
          id: Math.random().toString(36).slice(2),
          file: f,
          status: STATUS.PENDING,
          job: null,
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

  const removeFile = (id) => setFiles(prev => prev.filter(f => f.id !== id))

  const updateFile = (id, patch) =>
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))

  const processAll = async () => {
    setRunning(true)
    const pending = files.filter(f => f.status === STATUS.PENDING || f.status === STATUS.ERROR)

    for (const item of pending) {
      updateFile(item.id, { status: STATUS.PROCESSING, error: null, startedAt: Date.now(), elapsed: 0 })
      try {
        // Step 1: parse file for sections
        const parsed = await jobsApi.parseDescriptionFile(item.file)

        const title = parsed.title || filenameToTitle(parsed.filename || item.file.name)

        // Step 2: create job
        const created = await jobsApi.create({
          title,
          about_us:     parsed.about_us     || '',
          description:  parsed.description  || parsed.text || '',
          requirements: parsed.requirements || '',
          benefits:     parsed.benefits     || '',
          status: 'Offen',
          type: 'Vollzeit',
        })

        const elapsed = item.startedAt ? Math.floor((Date.now() - item.startedAt) / 1000) : null
        updateFile(item.id, { status: STATUS.DONE, job: { id: created.id, title: created.title || title }, elapsed })
      } catch (err) {
        const elapsed = item.startedAt ? Math.floor((Date.now() - item.startedAt) / 1000) : null
        updateFile(item.id, { status: STATUS.ERROR, error: err.message || t('batch_job_import.error_generic'), elapsed })
      }
    }

    setRunning(false)
    if (onImported) onImported()
  }

  const counts = {
    pending:    files.filter(f => f.status === STATUS.PENDING).length,
    processing: files.filter(f => f.status === STATUS.PROCESSING).length,
    done:       files.filter(f => f.status === STATUS.DONE).length,
    error:      files.filter(f => f.status === STATUS.ERROR).length,
  }

  const canRun  = !running && files.some(f => f.status === STATUS.PENDING || f.status === STATUS.ERROR)
  const allDone = files.length > 0 && files.every(f => f.status === STATUS.DONE)
  const toProcess = files.filter(f => f.status === STATUS.PENDING || f.status === STATUS.ERROR).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-[#1c1c1e] rounded-[28px] shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5e5ce6]/10 rounded-2xl flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-[#5e5ce6]" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-black dark:text-white">{t('batch_job_import.title')}</h2>
              <p className="text-[13px] text-gray-400">{t('batch_job_import.subtitle')}</p>
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
                  ? 'border-[#5e5ce6] bg-[#5e5ce6]/8 scale-[1.01]'
                  : 'border-gray-200 dark:border-gray-700 hover:border-[#5e5ce6]/50 hover:bg-[#5e5ce6]/4'
              }`}
            >
              <div className="w-14 h-14 bg-white dark:bg-[#2c2c2e] rounded-[18px] shadow-sm flex items-center justify-center border border-gray-100 dark:border-gray-700">
                <Upload className="w-6 h-6 text-[#5e5ce6]" />
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold text-black dark:text-white">{t('batch_job_import.drop_hint')}</p>
                <p className="text-[13px] text-gray-400 mt-1">{t('batch_job_import.formats')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.md"
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
                  {item.status === STATUS.DONE       && <CheckCircle2 className="w-5 h-5 text-[#34c759]" />}
                  {item.status === STATUS.ERROR      && <XCircle      className="w-5 h-5 text-[#ff3b30]" />}
                  {item.status === STATUS.PROCESSING && <Loader2      className="w-5 h-5 text-[#5e5ce6] animate-spin" />}
                  {item.status === STATUS.PENDING    && <FileText     className="w-5 h-5 text-gray-400" />}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-black dark:text-white truncate">
                    {item.status === STATUS.DONE && item.job ? item.job.title : item.file.name}
                  </p>
                  {item.status === STATUS.PROCESSING && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#5e5ce6] to-[#0071e3] rounded-full animate-pulse" style={{ width: '100%' }} />
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-medium text-[#5e5ce6] tabular-nums w-8 text-right">{item.elapsed ?? 0}s</span>
                    </div>
                  )}
                  {item.status === STATUS.DONE && (
                    <p className="text-[12px] text-[#34c759] mt-0.5">{t('batch_job_import.created')}{item.elapsed != null ? ` · ${item.elapsed}s` : ''}</p>
                  )}
                  {item.status === STATUS.ERROR && (
                    <p className="text-[12px] text-[#ff3b30] mt-0.5 truncate">{item.error}{item.elapsed != null ? ` (${item.elapsed}s)` : ''}</p>
                  )}
                  {item.status === STATUS.PENDING && (
                    <p className="text-[12px] text-gray-400 mt-0.5">
                      {(item.file.size / 1024).toFixed(0)} KB
                    </p>
                  )}
                </div>

                {/* Remove button (only when not running and not done) */}
                {!running && item.status !== STATUS.DONE && (
                  <button
                    onClick={() => removeFile(item.id)}
                    className="flex-shrink-0 w-7 h-7 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-[#ff3b30]" />
                  </button>
                )}

                {/* Link to job when done */}
                {item.status === STATUS.DONE && item.job && (
                  <a
                    href={`/jobs/${item.job.id}/edit`}
                    onClick={(e) => { e.stopPropagation(); onClose() }}
                    className="flex-shrink-0 w-7 h-7 rounded-full hover:bg-[#5e5ce6]/10 flex items-center justify-center transition-colors"
                    title={t('batch_job_import.open_job')}
                  >
                    <ChevronRight className="w-4 h-4 text-[#5e5ce6]" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {files.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-8 text-gray-400 text-[14px]">
            {t('batch_job_import.empty')}
          </div>
        )}

        {/* Footer */}
        <div className="px-8 pb-8 pt-4 border-t border-gray-100 dark:border-gray-800">
          {files.length > 0 && (
            <div className="flex items-center gap-4 text-[13px] mb-5">
              <span className="text-gray-400">{t('batch_job_import.total').replace('{n}', files.length)}</span>
              {counts.done  > 0 && <span className="text-[#34c759] font-medium">{t('batch_job_import.count_done').replace('{n}', counts.done)}</span>}
              {counts.error > 0 && <span className="text-[#ff3b30] font-medium">{t('batch_job_import.count_error').replace('{n}', counts.error)}</span>}
              {counts.pending > 0 && <span className="text-gray-400">{t('batch_job_import.count_pending').replace('{n}', counts.pending)}</span>}
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <Button variant="secondary" size="md" onClick={onClose} disabled={running}>
              {allDone ? t('batch_job_import.close') : t('batch_job_import.cancel')}
            </Button>
            <Button variant="dark" size="md" onClick={processAll} disabled={!canRun}>
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('batch_job_import.importing')}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  {t('batch_job_import.start').replace('{n}', toProcess)}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
