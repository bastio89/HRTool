import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, Loader2, Linkedin } from 'lucide-react'
import { jobsApi } from '../api'
import { Button } from '../components/UI'
import { useToast } from '../components/Toast'
import { useI18n } from '../I18nContext'

export default function Tools() {
  const { t } = useI18n()
  const toast = useToast()
  const [linksText, setLinksText] = useState('')
  const [exporting, setExporting] = useState(false)

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

  return (
    <div className="max-w-[1200px] mx-auto fade-in">
      <div className="mb-8 sm:mb-12">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('nav.jobs_ch')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-2">
          {t('tools.jobs_ch_subtitle')}
        </p>
      </div>

      <div className="grid gap-6">
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
              <Button type="button" variant="dark" size="md" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {t('tools.export_pdf')}
              </Button>
            </div>
          </div>
        </section>

        <Link
          to="/tools/linkedin"
          className="group rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
              <Linkedin className="w-6 h-6 text-[#0077b5]" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('nav.linkedin')}</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">{t('tools.linkedin_desc')}</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}