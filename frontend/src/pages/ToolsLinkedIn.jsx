import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Linkedin, Search, Square, CheckSquare, ExternalLink, Download, Loader2, Sparkles } from 'lucide-react'
import { Button } from '../components/UI'
import { useToast } from '../components/Toast'
import { linkedinApi, settingsApi } from '../api'

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean).join(', ')
  }
  if (typeof value === 'object') {
    return Object.values(value).map(toText).filter(Boolean).join(', ')
  }
  return String(value)
}

function getProfileLink(row) {
  return toText(row.linkedinUrl || row.linkedin_url || row.profileUrl || row.profile_url || row.url)
}

function getProfileName(row) {
  const firstName = toText(row.firstName || row.first_name)
  const lastName = toText(row.lastName || row.last_name)
  const explicitName = toText(row.name)
  if (explicitName) return explicitName
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  return fullName || toText(row.publicIdentifier || row.public_identifier) || 'Unbekannt'
}

function getLocation(row) {
  const raw = parseMaybeJson(row.location)
  if (raw && typeof raw === 'object') {
    return toText(raw.parsed?.text || raw.linkedinText || raw.text || raw.city || raw.country || raw.state)
  }
  return toText(raw)
}

function getHeadline(row) {
  return toText(row.headline)
}

function getCurrentCompany(row) {
  const currentPosition = parseMaybeJson(row.currentPosition || row.current_position)
  if (Array.isArray(currentPosition) && currentPosition.length > 0) {
    const first = currentPosition[0] || {}
    const company = toText(first.companyName || first.company || first.company_name)
    const title = toText(first.position || first.title)
    return [company, title].filter(Boolean).join(' · ')
  }
  if (currentPosition && typeof currentPosition === 'object') {
    return toText(currentPosition.companyName || currentPosition.company || currentPosition.position || currentPosition.title)
  }
  return toText(row.current_employer || row.currentEmployer)
}

function getSkills(row) {
  const topSkills = parseMaybeJson(row.topSkills || row.top_skills)
  if (Array.isArray(topSkills)) {
    return topSkills.map(toText).filter(Boolean).slice(0, 5).join(', ')
  }
  return toText(row.skills)
}

function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—'
  }
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' }).format(Number(value))
}

export default function ToolsLinkedIn() {
  const toast = useToast()
  const [keywords, setKeywords] = useState('treasury')
  const [location, setLocation] = useState('Zürich')
  const fixedMaxResults = '5'
  const [enrichEmails, setEnrichEmails] = useState(true)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [selectedLinks, setSelectedLinks] = useState(() => new Set())
  const [apifyToken, setApifyToken] = useState('')
  const [apifySaving, setApifySaving] = useState(false)
  const [apifyLoading, setApifyLoading] = useState(false)
  const [apifyStatus, setApifyStatus] = useState(null)

  const loadApifyStatus = async () => {
    setApifyLoading(true)
    try {
      const status = await settingsApi.getApifyStatus()
      setApifyStatus(status)
    } catch (err) {
      const message = err.message || 'Apify-Status konnte nicht geladen werden'
      setApifyStatus({ reachable: false, tokenConfigured: false, error: message })
    } finally {
      setApifyLoading(false)
    }
  }

  useEffect(() => {
    void loadApifyStatus()
  }, [])

  const selectedRows = useMemo(() => rows.filter((row) => selectedLinks.has(getProfileLink(row))), [rows, selectedLinks])
  const allSelectableSelected = rows.length > 0 && rows.every((row) => {
    const link = getProfileLink(row)
    return link && selectedLinks.has(link)
  })

  const toggleSelection = (row) => {
    const link = getProfileLink(row)
    if (!link) return
    setSelectedLinks(prev => {
      const next = new Set(prev)
      if (next.has(link)) next.delete(link)
      else next.add(link)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedLinks(new Set())
      return
    }
    setSelectedLinks(new Set(rows.map(getProfileLink).filter(Boolean)))
  }

  const runSearch = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await linkedinApi.searchProfiles({
        enrichEmails,
        keywords: keywords.trim(),
        location: location.trim(),
        maxResults: Number(fixedMaxResults) || 5,
        mode: 'public',
      })
      setRows(result.rows || [])
      setSelectedLinks(new Set())
      toast.success(`${(result.rows || []).length} Profile geladen`)
    } catch (err) {
      const message = err.message || 'LinkedIn-Suche fehlgeschlagen'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const exportSelectedAsPdf = async () => {
    const links = selectedRows.map((row) => getProfileLink(row)).filter(Boolean)
    if (!links.length) {
      toast.warning('Bitte zuerst mindestens ein Profil auswählen.')
      return
    }

    setExporting(true)
    try {
      const result = await linkedinApi.exportProfilesAsPdf(links)
      const downloadUrl = URL.createObjectURL(result.blob)
      const downloadLink = document.createElement('a')
      downloadLink.href = downloadUrl
      downloadLink.download = result.filename || 'linkedin-profiles.zip'
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      if (result.warning) {
        toast.warning(`${result.warning} PDFs exportiert und Download gestartet.`)
      } else {
        toast.success('PDFs exportiert und Download gestartet')
      }
    } catch (err) {
      const message = err.message || 'PDF-Export fehlgeschlagen'
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }

  const saveApifyToken = async () => {
    const token = apifyToken.trim()
    if (!token) {
      toast.warning('Bitte zuerst einen APIFY_TOKEN eintragen.')
      return
    }

    setApifySaving(true)
    try {
      await settingsApi.saveApifyConfig(token)
      setApifyToken('')
      await loadApifyStatus()
      toast.success('APIFY_TOKEN gespeichert')
    } catch (err) {
      const message = err.message || 'APIFY_TOKEN konnte nicht gespeichert werden'
      toast.error(message)
    } finally {
      setApifySaving(false)
    }
  }

  return (
    <div className="max-w-[1200px] mx-auto fade-in">
      <div className="mb-8 sm:mb-12">
        <Link to="/tools" className="inline-flex items-center gap-2 text-[14px] font-medium text-[#0071e3] hover:opacity-80 transition-opacity mb-4">
          <ArrowLeft className="w-4 h-4" />
          Zurück zu Tools
        </Link>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
            <Linkedin className="w-7 h-7 text-[#0077b5]" />
          </div>
          <div>
            <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">LinkedIn</h1>
            <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-2">
              Werkzeuge für LinkedIn-Profile, Apify-Importe und PDF-Export.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6">
        <section className="rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-6 sm:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
            <div>
              <h2 className="text-[18px] font-semibold text-black dark:text-white">APIFY</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">Token wird in Postgres gespeichert und für LinkedIn-Exports verwendet.</p>
            </div>
            <Button type="button" variant="secondary" size="md" onClick={() => void loadApifyStatus()} disabled={apifyLoading}>
              {apifyLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              Status aktualisieren
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">APIFY_TOKEN</span>
              <input
                type="password"
                value={apifyToken}
                onChange={(e) => setApifyToken(e.target.value)}
                placeholder="apify_api_..."
                className="w-full px-5 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-transparent focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30"
              />
            </label>
            <Button type="button" variant="dark" size="md" onClick={saveApifyToken} disabled={apifySaving}>
              {apifySaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              Speichern
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Token</div>
              <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">
                {apifyStatus?.tokenConfigured ? 'Konfiguriert' : 'Nicht konfiguriert'}
              </div>
            </div>
            <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Verbraucht</div>
              <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">{formatUsd(apifyStatus?.monthlyUsageUsd)}</div>
            </div>
            <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-4 py-3">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Verfügbar</div>
              <div className="mt-1 text-[15px] font-semibold text-black dark:text-white">{formatUsd(apifyStatus?.remainingMonthlyUsageUsd)}</div>
            </div>
          </div>

          {apifyStatus?.usageCycle?.startAt && apifyStatus?.usageCycle?.endAt && (
            <p className="mt-4 text-[13px] text-gray-500 dark:text-gray-400">
              Zeitraum: {new Date(apifyStatus.usageCycle.startAt).toLocaleDateString('de-DE')} bis {new Date(apifyStatus.usageCycle.endAt).toLocaleDateString('de-DE')}
            </p>
          )}

          {apifyStatus?.error && (
            <div className="mt-4 rounded-2xl border border-[#ff3b30]/20 bg-[#ff3b30]/10 px-5 py-4 text-[14px] text-[#b91c1c] dark:text-[#ff8a80]">
              {apifyStatus.error}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <form onSubmit={runSearch} className="space-y-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-2xl bg-[#0077b5]/10 flex items-center justify-center">
                <Search className="w-5 h-5 text-[#0077b5]" />
              </div>
              <h2 className="text-[18px] font-semibold text-black dark:text-white">Suche</h2>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Suchbegriffe</span>
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="z. B. treasury, data engineer"
                  className="w-full px-5 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-transparent focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30"
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ort</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="z. B. Zürich"
                  className="w-full px-5 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-transparent focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30"
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Max. Ergebnisse</span>
                <select
                  value={fixedMaxResults}
                  onChange={() => {}}
                  className="w-full px-5 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white border border-transparent focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 focus:border-[#0071e3]/30"
                >
                  {[5, 10, 20, 50].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <p className="text-[12px] text-gray-500 dark:text-gray-400">Fest auf 5 gesetzt. Weitere Werte sind nur zur Orientierung sichtbar.</p>
              </label>
              <label className="flex items-center gap-3 mt-8 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] px-5 py-3.5 text-[15px] text-black dark:text-white">
                <input
                  type="checkbox"
                  checked={enrichEmails}
                  onChange={(e) => setEnrichEmails(e.target.checked)}
                  className="w-4 h-4 accent-[#0071e3]"
                />
                E-Mail-Anreicherung aktivieren
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="dark" size="md" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                Profile suchen
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={toggleSelectAll} disabled={rows.length === 0}>
                {allSelectableSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                {allSelectableSelected ? 'Alle abwählen' : 'Alle auswählen'}
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={exportSelectedAsPdf} disabled={exporting || selectedRows.length === 0}>
                {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                Exportiere als PDF
              </Button>
            </div>

            {error && (
              <div className="rounded-2xl border border-[#ff3b30]/20 bg-[#ff3b30]/10 px-5 py-4 text-[14px] text-[#b91c1c] dark:text-[#ff8a80]">
                {error}
              </div>
            )}
          </form>
        </section>

        <section className="rounded-[28px] border border-gray-200/70 dark:border-gray-700 bg-white dark:bg-[#1c1c1e] p-6 sm:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <div>
              <h2 className="text-[18px] font-semibold text-black dark:text-white">Ergebnisse</h2>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">
                {rows.length} Profile gefunden{selectedRows.length > 0 ? `, ${selectedRows.length} selektiert` : ''}
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-gray-200 dark:border-gray-700 px-6 py-12 text-center text-gray-500 dark:text-gray-400">
              Noch keine Suche ausgeführt.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row, index) => {
                const link = getProfileLink(row)
                const name = getProfileName(row)
                const headline = getHeadline(row)
                const locationText = getLocation(row)
                const company = getCurrentCompany(row)
                const skills = getSkills(row)
                const checked = link ? selectedLinks.has(link) : false

                return (
                  <div key={link || `${name}-${index}`} className="rounded-[24px] border border-gray-200/70 dark:border-gray-700 bg-[#f5f5f7] dark:bg-[#2c2c2e] px-5 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <label className="pt-1 flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelection(row)}
                          disabled={!link}
                          className="w-5 h-5 accent-[#0071e3]"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-[17px] font-semibold text-black dark:text-white">{name}</h3>
                          {company && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#0071e3]/10 text-[#0071e3]">{company}</span>
                          )}
                          {locationText && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300">{locationText}</span>
                          )}
                        </div>
                        {headline && <p className="text-[14px] text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{headline}</p>}
                        {skills && <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-2">Skills: {skills}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-[#1c1c1e] text-black dark:text-white text-[14px] font-medium border border-gray-200 dark:border-gray-700 hover:border-[#0071e3]/40 hover:text-[#0071e3] transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Profil öffnen
                        </a>
                      ) : (
                        <span className="text-[13px] text-gray-400">Kein Profil-Link gefunden</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}