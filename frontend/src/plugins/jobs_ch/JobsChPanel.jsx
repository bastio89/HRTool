import { useMemo, useState } from 'react'
import { Database, Download, FileText, Loader2 } from 'lucide-react'
import { jobsApi } from '../../api'
import { Button } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useI18n } from '../../I18nContext'

export default function JobsChPanel() {
  const { t } = useI18n()
  const toast = useToast()
  const [linksText, setLinksText] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const links = useMemo(
    () => linksText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    [linksText],
  )

  const handleExport = async () => {
    if (links.length === 0) {
      toast.warning(t('tools.warn_no_links'))
      return
    }

    setExporting(true)
    try {
      const result = await jobsApi.exportJobsChPdfs(links)
      const downloadUrl = URL.createObjectURL(result.blob)
      const downloadLink = document.createElement('a')
      downloadLink.href = downloadUrl
      downloadLink.download = result.filename || 'jobs-ch-pdfs.zip'
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      const exported = t('tools.export_success').replace('{count}', links.length)
      if (result.warning) {
        toast.warning(`${exported}. ${result.warning}`)
      } else {
        toast.success(exported)
      }
    } catch (err) {
      toast.error(err.message || t('tools.export_failed'))
    } finally {
      setExporting(false)
    }
  }

  const handleImportToDb = async () => {
    if (links.length === 0) {
      toast.warning(t('tools.warn_no_links'))
      return
    }

    setImporting(true)
    try {
      const result = await jobsApi.importJobsChDescriptions(links)
      setImportResult(result)
      const imported = t('tools.jobs_ch_import_success').replace('{count}', result.imported || 0)
      if (result.warning) {
        toast.warning(`${imported}. ${result.warning}`)
      } else {
        toast.success(imported)
      }
    } catch (err) {
      setImportResult(null)
      toast.error(err.message || t('tools.jobs_ch_import_failed'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-6 sm:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
          <FileText className="w-5 h-5 text-[#0077b5]" />
        </div>
        <div>
          <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('tools.jobs_ch_export_title')}</h2>
          <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{t('tools.jobs_ch_export_desc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <label className="space-y-2 block">
          <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('tools.jobs_ch_links_label')}</span>
          <textarea
            value={linksText}
            onChange={(event) => setLinksText(event.target.value)}
            placeholder={"https://www.jobs.ch/de/stellenangebote/detail/.../\nhttps://www.jobs.ch/de/stellenangebote/detail/.../"}
            rows={10}
            className="w-full px-5 py-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-transparent focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30 resize-y font-mono text-[13px] leading-6"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-gray-500 dark:text-gray-400">
            {links.length === 0
              ? t('tools.no_links')
              : links.length === 1
                ? t('tools.links_detected_one')
                : t('tools.links_detected').replace('{count}', links.length)}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" size="md" onClick={handleImportToDb} disabled={importing}>
              {importing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
              {t('tools.jobs_ch_import_button')}
            </Button>
            <Button type="button" variant="dark" size="md" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              {t('tools.export_pdf')}
            </Button>
          </div>
        </div>

        {importResult?.items?.length > 0 && (
          <div className="space-y-3 rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-[#f8f8fa] dark:bg-[#222225] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-[14px] sm:text-[15px] font-semibold text-black dark:text-white">
                {t('tools.jobs_ch_import_feedback_title')}
              </h3>
              <p className="text-[12px] sm:text-[13px] text-gray-500 dark:text-gray-400">
                {t('tools.jobs_ch_import_feedback_subtitle').replace('{count}', importResult.items.length)}
              </p>
            </div>
            <div className="space-y-2">
              {importResult.items.map((item, index) => (
                <div
                  key={`${item.link}-${index}`}
                  className="flex flex-col gap-2 rounded-xl bg-white dark:bg-[#1c1c1e] px-4 py-3 border border-gray-200/70 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-black dark:text-white break-all">
                        {item.title || item.link}
                      </p>
                      <p className="text-[12px] text-gray-500 dark:text-gray-400 break-all">{item.link}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <span className="inline-flex items-center rounded-full bg-[#e8f4ff] px-2.5 py-1 text-[11px] font-semibold text-[#0071e3] dark:bg-[#0f2740] dark:text-[#8cc8ff]">
                        {t('tools.jobs_ch_status_read')}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          item.imported
                            ? 'bg-[#34c759]/10 text-[#1f8f43] dark:bg-[#1f6f3f]/20 dark:text-[#7ee29a]'
                            : 'bg-[#ff3b30]/10 text-[#b42318] dark:bg-[#5c1d19]/20 dark:text-[#ff8a80]'
                        }`}
                      >
                        {item.imported ? t('tools.jobs_ch_status_imported') : t('tools.jobs_ch_status_failed')}
                      </span>
                    </div>
                  </div>
                  {item.error && (
                    <p className="text-[12px] text-[#b42318] dark:text-[#ff8a80]">
                      {item.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
