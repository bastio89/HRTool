import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { History as HistoryIcon, Trash2, Clock, Users, ArrowRight } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, EmptyState, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

export default function History() {
  const { t } = useI18n()
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    matchingApi.getHistory()
      .then(data => setResults(data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id) => {
    try {
      await matchingApi.deleteResult(id)
      setResults(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      alert(t('history.error') + ': ' + err.message)
    }
  }

  if (loading) return <LoadingSpinner text={t('history.loading')} />

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      <div className="mb-8 sm:mb-14">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('history.title')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('history.subtitle')}</p>
      </div>

      {results.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={HistoryIcon}
            title={t('history.no_matchings')}
            description={t('history.no_matchings_desc')}
            action={
              <Link to="/matching">
                <Button size="lg" variant="dark">{t('history.start_matching')}</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5 sm:space-y-8">
          {results.map((result) => {
            const matchResults = result.results?.results || []
            const topScore = matchResults[0]?.score || 0
            const avgScore = matchResults.length > 0 ? matchResults.reduce((s, r) => s + r.score, 0) / matchResults.length : 0

            return (
              <Card key={result.id} className="p-5 sm:p-10" hover>
                <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-10">
                  <div className="flex items-center gap-5 sm:gap-0">
                    <ScoreRing score={topScore} size={64} strokeWidth={5} />
                    <h3 className="text-[18px] font-semibold tracking-tight text-black dark:text-white sm:hidden ml-2">{result.job_title}</h3>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-[20px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white hidden sm:block">{result.job_title}</h3>
                    <div className="flex items-center gap-4 sm:gap-8 mt-1 sm:mt-3 flex-wrap">
                      <span className="flex items-center gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {new Date(result.created_at).toLocaleString('de-DE')}
                      </span>
                      <span className="flex items-center gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                        <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {t('history.candidates_count').replace('{count}', matchResults.length)}
                      </span>
                      <span className="text-[13px] sm:text-[15px] font-semibold text-[#0071e3]">
                        ∅ {(avgScore * 100).toFixed(0)}%
                      </span>
                    </div>

                    {matchResults.length > 0 && (
                      <div className="flex items-center gap-3 sm:gap-5 mt-3 sm:mt-4 flex-wrap">
                        {matchResults.slice(0, 3).map((r, i) => (
                          <span key={i} className="text-[12px] sm:text-[14px] font-medium text-gray-500 dark:text-gray-400">
                            {i + 1}. {r.candidateName} 
                            <span className={`ml-1 sm:ml-1.5 font-semibold ${r.score >= 0.7 ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`}>
                              ({(r.score * 100).toFixed(0)}%)
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 self-end sm:self-center">
                    <Button variant="ghost" size="sm" className="w-10 h-10 sm:w-12 sm:h-12 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]" onClick={() => handleDelete(result.id)}>
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </Button>
                    <Link to={`/matching/results/${result.id}`}>
                      <Button variant="secondary" size="sm" className="rounded-full">
                        Details <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
