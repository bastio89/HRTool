import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { History as HistoryIcon, Trash2, Clock, Users, ArrowRight, Search, X, SortDesc } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, EmptyState, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

export default function History() {
  const { t } = useI18n()
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('newest')

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

  // Filter and sort
  const filtered = useMemo(() => {
    let list = results
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter(r => {
        const jobMatch = r.job_title?.toLowerCase().includes(q)
        const candidateMatch = (r.results?.results || []).some(c => c.candidateName?.toLowerCase().includes(q))
        return jobMatch || candidateMatch
      })
    }
    // Sort
    list = [...list].sort((a, b) => {
      if (sort === 'newest') return new Date(b.created_at) - new Date(a.created_at)
      if (sort === 'oldest') return new Date(a.created_at) - new Date(b.created_at)
      if (sort === 'score') {
        const scoreA = (a.results?.results || [])[0]?.score || 0
        const scoreB = (b.results?.results || [])[0]?.score || 0
        return scoreB - scoreA
      }
      if (sort === 'candidates') {
        return (b.results?.results || []).length - (a.results?.results || []).length
      }
      return 0
    })
    return list
  }, [results, search, sort])

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      <div className="mb-8 sm:mb-14">
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('history.title')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('history.subtitle')}</p>
      </div>

      {results.length > 0 && (
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="w-[18px] h-[18px] text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('history.search_placeholder')}
              className="w-full pl-11 pr-10 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] text-black dark:text-white text-[14px] font-medium border-none outline-none focus:ring-2 focus:ring-[#0071e3]/30 transition-all placeholder:text-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-300/50 dark:bg-gray-600/50 flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                <X className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl p-1">
            <SortDesc className="w-4 h-4 text-gray-400 ml-2" />
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="px-3 py-2.5 bg-transparent text-[13px] font-medium text-black dark:text-white border-none outline-none cursor-pointer appearance-none pr-6"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' fill=\'%239ca3af\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M8 11L3 6h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="newest">{t('history.sort_newest')}</option>
              <option value="oldest">{t('history.sort_oldest')}</option>
              <option value="score">{t('history.sort_score')}</option>
              <option value="candidates">{t('history.sort_candidates')}</option>
            </select>
          </div>
        </div>
      )}

      {search && (
        <p className="text-[13px] text-gray-400 mb-4">
          {t('history.search_results').replace('{count}', filtered.length).replace('{total}', results.length)}
        </p>
      )}

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
      ) : filtered.length === 0 ? (
        <Card className="p-16 text-center">
          <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-[16px] font-semibold text-black dark:text-white">{t('history.no_search_results')}</p>
          <p className="text-[14px] text-gray-500 mt-1">{t('history.no_search_results_desc')}</p>
          <button onClick={() => setSearch('')} className="mt-4 px-5 py-2.5 rounded-xl bg-[#0071e3] text-white text-[14px] font-semibold hover:bg-[#005bb5] transition-colors cursor-pointer">
            {t('history.clear_search')}
          </button>
        </Card>
      ) : (
        <div className="space-y-5 sm:space-y-8">
          {filtered.map((result) => {
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
