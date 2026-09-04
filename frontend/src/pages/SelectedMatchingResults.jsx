import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, CheckCircle, Download, FileText, Target, User, UserCheck, XCircle } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreBadge, ScoreRing, LoadingSpinner, PageContainer } from '../components/UI'
import { useI18n } from '../I18nContext'

const STORAGE_KEY = 'hrtool:matching:selected-batch'

export default function SelectedMatchingResults() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      setLoading(false)
      return
    }

    const loadSelectedMatching = async () => {
      try {
        const parsed = JSON.parse(raw)
        const fromStatePairs = location.state?.pairs
        const pairs = fromStatePairs || parsed.pairs || []

        if (!Array.isArray(pairs) || pairs.length === 0) {
          setPayload(null)
          setLoading(false)
          return
        }

        setLoading(true)
        setError('')
        const groups = new Map()
        for (const pair of pairs) {
          const jobKey = String(pair.sourceJobId || pair.jobId || pair.sourceJobTitle || pair.jobTitle || 'job')
          if (!groups.has(jobKey)) {
            groups.set(jobKey, {
              jobId: pair.sourceJobId || pair.jobId || null,
              jobTitle: pair.sourceJobTitle || pair.jobTitle,
              candidateIds: [],
              candidateNames: [],
            })
          }
          const group = groups.get(jobKey)
          group.candidateIds.push(pair.candidateId)
          if (pair.candidateName) {
            group.candidateNames.push(pair.candidateName)
          }
        }

        const responses = await Promise.all(
          [...groups.values()].map((group) => matchingApi.run(
            group.jobDescription || '',
            group.jobTitle || 'Unbenannte Stelle',
            group.candidateIds,
            null,
            group.jobId || null,
            group.candidateNames,
          ))
        )

        const rows = responses.flatMap((response) => {
          const matrixRows = response?.results?.results || []
          return matrixRows.map((row) => ({
            ...row,
            score: typeof row.score === 'number' && row.score <= 1 ? row.score * 100 : row.score,
          }))
        }).sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0))

        const failures = []
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...parsed,
          pairs,
          response: { results: rows, failures, selectedCount: pairs.length },
        }))
        setPayload({ results: rows, failures, selectedCount: pairs.length })
      } catch (err) {
        setPayload(null)
        setError(err.message || 'KI-Matching konnte nicht gestartet werden.')
      } finally {
        setLoading(false)
      }
    }

    loadSelectedMatching()
  }, [location.state])

  const results = payload?.results || []
  const failures = payload?.failures || []
  const total = payload?.selectedCount ?? (results.length + failures.length)
  const avgScore = results.length > 0 ? results.reduce((sum, row) => sum + (Number(row.score) || 0), 0) / results.length : 0
  const bestScore = results[0]?.score || 0

  const exportCSV = () => {
    const escape = (v) => {
      if (v == null) return ''
      const text = String(v).replace(/"/g, '""')
      return text.includes(',') || text.includes('"') || text.includes('\n') ? `"${text}"` : text
    }

    const headers = ['Bewerber', 'Stelle', 'Score', 'Zusammenfassung', 'Stärken', 'Schwächen']
    const rows = results.map((row) => [
      row.candidateName,
      row.jobTitle,
      row.score,
      row.summary,
      (row.strengths || []).join('; '),
      (row.weaknesses || []).join('; '),
    ].map(escape).join(','))

    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `selected_matching_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const metrics = useMemo(() => ([
    { label: 'Ausgewählt', value: total, color: '#0071e3', icon: User },
    { label: 'Treffer', value: results.length, color: '#34c759', icon: CheckCircle },
    { label: 'Fehler', value: failures.length, color: '#ff3b30', icon: XCircle },
    { label: 'Bester Match', value: bestScore ? `${bestScore}%` : '-', color: '#ff9f0a', icon: Target },
  ]), [bestScore, failures.length, results.length, total])

  if (loading) return <LoadingSpinner text="KI-Matching wird geladen..." />

  if (!payload) {
    return (
      <PageContainer width="content">
        <Card className="p-10 text-center">
          {error ? (
            <>
              <p className="text-[18px] font-medium text-[#ff3b30] mb-6">
                {error}
              </p>
              <Button variant="dark" size="md" onClick={() => navigate(-1)}>
                <ArrowLeft className="w-5 h-5" />
                Zurück
              </Button>
            </>
          ) : (
            <>
          <p className="text-[18px] font-medium text-gray-500 dark:text-gray-400 mb-6">
            Keine Batch-Ergebnisse gefunden.
          </p>
          <Button variant="dark" size="md" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
            Zurück
          </Button>
            </>
          )}
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="content">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
          <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">KI-Matching selektierte</h1>
            <div className="flex items-center gap-3 sm:gap-6 mt-1 sm:mt-3 flex-wrap">
              <span className="text-[14px] sm:text-[18px] font-medium text-gray-500 dark:text-gray-400">
                {results.length} Treffer, {failures.length} Fehler
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 ml-14 sm:ml-0">
          <Button size="md" variant="secondary" onClick={exportCSV} disabled={results.length === 0}>
            <Download className="w-5 h-5" />
            <span className="hidden sm:inline">CSV Export</span>
          </Button>
          <Link to="/matching"><Button size="md" variant="dark">Neue Auswahl</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
        {metrics.map(({ label, value, color, icon: Icon }) => (
          <Card key={label} className="p-10">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[48px] leading-none font-semibold tracking-tight" style={{ color }}>{value}</p>
                <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mt-4">{label}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <Icon className="w-6 h-6" style={{ color }} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-8 sm:p-10 mb-12">
        <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white mb-6">Ergebnisliste</h2>
        {results.length === 0 && failures.length === 0 ? (
          <p className="text-[15px] text-gray-500 dark:text-gray-400">Keine Ergebnisse vorhanden.</p>
        ) : (
          <div className="space-y-4">
            {results.map((result, index) => (
              <div key={result.id || `${result.jobId}-${result.candidateId}-${index}`} className="p-5 rounded-[18px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <p className="text-[16px] font-semibold text-black dark:text-white">{result.candidateName}</p>
                    <p className="text-[13px] text-gray-500 mt-1">{result.jobTitle}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <ScoreRing score={(Number(result.score) || 0) / 100} size={72} strokeWidth={5} />
                    <ScoreBadge score={(Number(result.score) || 0) / 100} />
                  </div>
                </div>
                <p className="mt-3 text-[14px] text-gray-600 dark:text-gray-300 leading-relaxed">{result.summary}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-[13px]">
                  {result.strengths?.length > 0 && (
                    <div className="rounded-[14px] bg-[#34c759]/5 border border-[#34c759]/10 p-4">
                      <p className="font-semibold text-[#34c759] mb-2">Stärken</p>
                      <ul className="list-disc space-y-1.5 pl-5 text-gray-600 dark:text-gray-300">
                        {result.strengths.map((item, itemIndex) => (
                          <li key={`${result.id || index}-strength-${itemIndex}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.weaknesses?.length > 0 && (
                    <div className="rounded-[14px] bg-[#ff3b30]/5 border border-[#ff3b30]/10 p-4">
                      <p className="font-semibold text-[#ff3b30] mb-2">Schwächen</p>
                      <ul className="list-disc space-y-1.5 pl-5 text-gray-600 dark:text-gray-300">
                        {result.weaknesses.map((item, itemIndex) => (
                          <li key={`${result.id || index}-weakness-${itemIndex}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {failures.length > 0 && (
              <div className="pt-4">
                <h3 className="text-[18px] font-semibold tracking-tight text-black dark:text-white mb-4">Fehler</h3>
                <div className="space-y-3">
                  {failures.map((item, index) => (
                    <div key={`${item.jobId || 'job'}-${item.candidateId || 'candidate'}-${index}`} className="p-5 rounded-[18px] bg-[#ff3b30]/5 border border-[#ff3b30]/10 text-[14px] text-[#ff3b30]">
                      <p className="font-semibold">{item.candidateName} · {item.jobTitle}</p>
                      <p className="mt-2">{item.error}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
