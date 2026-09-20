import { useState } from 'react'
import { Check, Database, Download, FileText, Loader2, Search } from 'lucide-react'
import { jobsApi } from '../../api'
import { Button } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useI18n } from '../../I18nContext'

export default function JobsChPanel() {
  const { t } = useI18n()
  const toast = useToast()
  const [linksText, setLinksText] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedSearchLinks, setSelectedSearchLinks] = useState([])
  const [searching, setSearching] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const getManualLinks = () => linksText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const getSelectedSearchResultLinks = () => searchResults
    .filter((item) => selectedSearchLinks.includes(item.link))
    .map((item) => item.link)

  const getCombinedLinks = () => {
    const merged = [...getManualLinks(), ...getSelectedSearchResultLinks()]
    return merged.filter((link, index) => merged.indexOf(link) === index)
  }

  const toggleSearchSelection = (link) => {
    setSelectedSearchLinks((current) => (
      current.includes(link)
        ? current.filter((item) => item !== link)
        : [...current, link]
    ))
  }

  const downloadZip = async (links) => {
    const result = await jobsApi.exportJobsChPdfs(links)
    const downloadUrl = URL.createObjectURL(result.blob)
    const downloadLink = document.createElement('a')
    downloadLink.href = downloadUrl
    downloadLink.download = result.filename || 'jobs-ch-pdfs.zip'
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    return result
  }

  const handleSearch = async () => {
    const term = searchTerm.trim()
    if (!term) {
      toast.warning(t('tools.jobs_ch_search_empty'))
      return
    }

    setSearching(true)
    try {
      const result = await jobsApi.searchJobsCh(term)
      setSearchResults(result.items || [])
      setSelectedSearchLinks([])
      if ((result.items || []).length === 0) {
        toast.warning(t('tools.jobs_ch_search_empty_result'))
      } else {
        toast.success(t('tools.jobs_ch_search_success').replace('{count}', result.count || result.items.length))
      }
    } catch (err) {
      setSearchResults([])
      setSelectedSearchLinks([])
      toast.error(err.message || t('tools.jobs_ch_search_failed'))
    } finally {
      setSearching(false)
    }
  }

  const handleExport = async () => {
    const combinedLinks = getCombinedLinks()
    if (combinedLinks.length === 0) {
      toast.warning(t('tools.warn_no_links'))
      return
    }

    setExporting(true)
    try {
      const result = await downloadZip(combinedLinks)
      const exported = t('tools.export_success').replace('{count}', combinedLinks.length)
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
    const combinedLinks = getCombinedLinks()
    if (combinedLinks.length === 0) {
      toast.warning(t('tools.warn_no_links'))
      return
    }

    setImporting(true)
    try {
      const result = await jobsApi.importJobsChDescriptions(combinedLinks)
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

  const handleExportSelectedSearchResults = async () => {
    const selectedSearchResultLinks = getSelectedSearchResultLinks()
    if (selectedSearchResultLinks.length === 0) {
      toast.warning(t('tools.jobs_ch_search_select_first'))
      return
    }

    setExporting(true)
    try {
      const result = await downloadZip(selectedSearchResultLinks)
      const exported = t('tools.export_success').replace('{count}', selectedSearchResultLinks.length)
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

  const handleImportSelectedSearchResults = async () => {
    const selectedSearchResultLinks = getSelectedSearchResultLinks()
    if (selectedSearchResultLinks.length === 0) {
      toast.warning(t('tools.jobs_ch_search_select_first'))
      return
    }

    setImporting(true)
    try {
      const result = await jobsApi.importJobsChDescriptions(selectedSearchResultLinks)
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
    <section className="w-full max-w-[1100px] mx-auto rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-6 sm:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
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
        <div className="space-y-2 rounded-2xl border border-gray-200/70 dark:border-gray-700 bg-[#f8f8fa] dark:bg-[#222225] p-4 sm:p-5">
          <div className="flex items-center gap-3 flex-wrap">
            <Search className="w-5 h-5 text-[#0071e3]" />
            <div>
              <h3 className="text-[15px] font-semibold text-black dark:text-white">{t('tools.jobs_ch_search_title')}</h3>
              <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('tools.jobs_ch_search_desc')}</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSearch()
                }
              }}
              placeholder={t('tools.jobs_ch_search_placeholder')}
              className="w-full px-5 py-4 rounded-2xl bg-white dark:bg-[#1c1c1e] text-black dark:text-white border border-gray-200/70 dark:border-gray-700 focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30"
            />
            <Button type="button" variant="primary" size="md" onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              {t('tools.jobs_ch_search_button')}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[13px] text-gray-500 dark:text-gray-400">
                  {t('tools.jobs_ch_search_results').replace('{count}', searchResults.length)}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" size="sm" data-testid="jobs-ch-export-selected" onClick={handleExportSelectedSearchResults} disabled={exporting}>
                    {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    {t('tools.jobs_ch_export_selected_button')}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" data-testid="jobs-ch-import-selected" onClick={handleImportSelectedSearchResults} disabled={importing}>
                    {importing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
                    {t('tools.jobs_ch_import_selected_button')}
                  </Button>
                </div>
              </div>
              <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                {searchResults.map((item) => {
                  const checked = selectedSearchLinks.includes(item.link)
                  return (
                    <label
                      key={item.link}
                      className="flex items-start gap-3 rounded-xl bg-white dark:bg-[#1c1c1e] px-4 py-3 border border-gray-200/70 dark:border-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSearchSelection(item.link)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#0071e3] focus:ring-[#0071e3]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-black dark:text-white break-words">{item.title}</p>
                            <p className="text-[12px] text-gray-500 dark:text-gray-400 break-all">{item.link}</p>
                          </div>
                          <span className="inline-flex items-center rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:bg-[#2c2c2e] dark:text-gray-300">
                            {item.location || item.company || t('tools.jobs_ch_search_result_label')}
                          </span>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <label className="space-y-2 block">
          <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('tools.jobs_ch_links_label')}</span>
          <textarea
            value={linksText}
            onChange={(event) => setLinksText(event.target.value)}
            placeholder={"https://www.jobs.ch/de/stellenangebote/detail/.../\nhttps://www.jobs.ch/de/stellenangebote/detail/.../"}
            rows={3}
            className="w-full px-5 py-4 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-transparent focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30 resize-y font-mono text-[13px] leading-6"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-gray-500 dark:text-gray-400">
            {getCombinedLinks().length === 0
              ? t('tools.no_links')
              : getCombinedLinks().length === 1
                ? t('tools.links_detected_one')
                : t('tools.links_detected').replace('{count}', getCombinedLinks().length)}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" size="md" data-testid="jobs-ch-import" onClick={handleImportToDb} disabled={importing}>
              {importing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
              {t('tools.jobs_ch_import_button')}
            </Button>
            <Button type="button" variant="dark" size="md" data-testid="jobs-ch-export" onClick={handleExport} disabled={exporting}>
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
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f4ff] px-2.5 py-1 text-[11px] font-semibold text-[#0071e3] dark:bg-[#0f2740] dark:text-[#8cc8ff]">
                        <Check className="w-3.5 h-3.5" />
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