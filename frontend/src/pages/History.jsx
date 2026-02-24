import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { History as HistoryIcon, Trash2, Clock, Users, ArrowRight } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, EmptyState, LoadingSpinner } from '../components/UI'

export default function History() {
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
      alert('Fehler: ' + err.message)
    }
  }

  if (loading) return <LoadingSpinner text="Historie wird geladen..." />

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      <div className="mb-14">
        <h1 className="text-[40px] font-semibold tracking-tight text-black">Matching-Historie</h1>
        <p className="text-[18px] text-gray-500 mt-3">Vergangene Matching-Durchläufe</p>
      </div>

      {results.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={HistoryIcon}
            title="Noch keine Matchings"
            description="Starte dein erstes Matching um Ergebnisse zu sehen."
            action={
              <Link to="/matching">
                <Button size="lg" variant="dark">Matching starten</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {results.map((result) => {
            const matchResults = result.results?.results || []
            const topScore = matchResults[0]?.score || 0
            const avgScore = matchResults.length > 0 ? matchResults.reduce((s, r) => s + r.score, 0) / matchResults.length : 0

            return (
              <Card key={result.id} className="p-10" hover>
                <div className="flex items-center gap-10">
                  <ScoreRing score={topScore} size={80} strokeWidth={6} />

                  <div className="flex-1 min-w-0">
                    <h3 className="text-[24px] font-semibold tracking-tight text-black">{result.job_title}</h3>
                    <div className="flex items-center gap-8 mt-3">
                      <span className="flex items-center gap-2.5 text-[15px] font-medium text-gray-500">
                        <Clock className="w-4 h-4" />
                        {new Date(result.created_at).toLocaleString('de-DE')}
                      </span>
                      <span className="flex items-center gap-2.5 text-[15px] font-medium text-gray-500">
                        <Users className="w-4 h-4" />
                        {matchResults.length} Bewerber
                      </span>
                      <span className="text-[15px] font-semibold text-[#0071e3]">
                        ∅ {(avgScore * 100).toFixed(0)}%
                      </span>
                    </div>

                    {matchResults.length > 0 && (
                      <div className="flex items-center gap-5 mt-4">
                        {matchResults.slice(0, 3).map((r, i) => (
                          <span key={i} className="text-[14px] font-medium text-gray-500">
                            {i + 1}. {r.candidateName} 
                            <span className={`ml-1.5 font-semibold ${r.score >= 0.7 ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`}>
                              ({(r.score * 100).toFixed(0)}%)
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <Button variant="ghost" size="md" className="w-12 h-12 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]" onClick={() => handleDelete(result.id)}>
                      <Trash2 className="w-5 h-5" />
                    </Button>
                    <Link to={`/matching/results/${result.id}`}>
                      <Button variant="secondary" size="md" className="rounded-full">
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
