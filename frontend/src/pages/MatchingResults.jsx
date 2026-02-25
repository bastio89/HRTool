import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ThumbsUp, ThumbsDown, User, Clock, ChevronDown, ChevronUp, Trophy, Target, BarChart3, Quote } from 'lucide-react'
import { matchingApi } from '../api'
import { Card, Button, ScoreRing, ScoreBadge, LoadingSpinner } from '../components/UI'

export default function MatchingResults() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    matchingApi.getResult(id)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <LoadingSpinner text="Ergebnisse werden geladen..." />
  if (error) return (
    <div className="text-center py-32">
      <p className="text-[#ff3b30] font-medium mb-8 text-[18px]">{error}</p>
      <Button variant="secondary" size="lg" onClick={() => navigate('/history')}>Zurück zur Historie</Button>
    </div>
  )

  const results = data?.results?.results || []
  const matchedAt = data?.results?.matchedAt || data?.created_at
  const bestScore = results[0]?.score || 0
  const avgScore = results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0
  const topCount = results.filter(r => r.score >= 0.8).length

  return (
    <div className="fade-in max-w-[1200px] mx-auto">
      <div className="flex items-center gap-8 mb-14">
        <button onClick={() => navigate(-1)} className="w-12 h-12 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-black" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[40px] font-semibold tracking-tight text-black">Matching-Ergebnisse</h1>
          <div className="flex items-center gap-6 mt-3">
            <span className="text-[18px] font-medium text-gray-500">{data?.job_title}</span>
            {matchedAt && (
              <span className="flex items-center gap-2 text-[15px] font-medium text-gray-400">
                <Clock className="w-4 h-4" />
                {new Date(matchedAt).toLocaleString('de-DE')}
              </span>
            )}
          </div>
        </div>
        <Link to="/matching">
          <Button size="lg" variant="dark">Neues Matching</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-black">{results.length}</p>
              <p className="text-[16px] font-medium text-gray-500 mt-4">Geprüft</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#f5f5f7] flex items-center justify-center">
              <User className="w-6 h-6 text-gray-600" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#34c759]">
                {bestScore ? (bestScore * 100).toFixed(0) + '%' : '-'}
              </p>
              <p className="text-[16px] font-medium text-gray-500 mt-4">Best Match</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-[#34c759]" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#0071e3]">
                {results.length > 0 ? (avgScore * 100).toFixed(0) + '%' : '-'}
              </p>
              <p className="text-[16px] font-medium text-gray-500 mt-4">Durchschnitt</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-[#0071e3]" />
            </div>
          </div>
        </Card>
        <Card className="p-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[48px] leading-none font-semibold tracking-tight text-[#ff9f0a]">{topCount}</p>
              <p className="text-[16px] font-medium text-gray-500 mt-4">Top (≥80%)</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#ff9f0a]/10 flex items-center justify-center">
              <Target className="w-6 h-6 text-[#ff9f0a]" />
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-[28px] font-semibold tracking-tight text-black mb-8">Ranking</h2>
        <div className="space-y-6">
          {results.map((result, idx) => (
            <Card key={result.candidateId || idx} className="overflow-hidden p-0" hover>
              <div
                className="flex items-center gap-10 p-10 cursor-pointer"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 text-[20px] font-semibold
                  ${idx === 0 ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 
                    idx === 1 ? 'bg-gray-100 text-gray-600' : 
                    idx === 2 ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 
                    'bg-[#f5f5f7] text-gray-400'}`
                }>
                  {idx + 1}
                </div>

                <ScoreRing score={result.score} size={88} strokeWidth={6} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-5">
                    <h3 className="text-[26px] font-semibold tracking-tight text-black">{result.candidateName}</h3>
                    <ScoreBadge score={result.score} />
                  </div>
                  <p className="text-[16px] font-medium text-gray-500 mt-3 leading-relaxed">
                    {result.summary}
                  </p>
                </div>

                <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center hover:bg-[#f5f5f7] transition-colors">
                  <ChevronDown className={`w-7 h-7 text-gray-400 transition-transform duration-500 ${expandedIdx === idx ? 'rotate-180' : ''}`} />
                </div>
              </div>

              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedIdx === idx ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-10 pb-10 border-t border-gray-100/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-10">
                    {result.strengths?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center">
                            <ThumbsUp className="w-6 h-6 text-[#34c759]" />
                          </div>
                          <h4 className="text-[14px] font-semibold text-[#34c759] uppercase tracking-widest">Stärken</h4>
                        </div>
                        <ul className="space-y-5">
                          {result.strengths.map((s, i) => {
                            const text = typeof s === 'object' ? s.text : s
                            const ref = typeof s === 'object' ? s.reference : ''
                            return (
                              <li key={i} className="text-[16px] font-medium text-gray-700 leading-relaxed">
                                <div className="flex items-start gap-4">
                                  <span className="w-2 h-2 rounded-full bg-[#34c759] mt-2.5 flex-shrink-0" />
                                  {text}
                                </div>
                                {ref && (
                                  <div className="ml-6 mt-2 flex items-start gap-2.5 px-4 py-2.5 bg-[#34c759]/5 rounded-[14px] border border-[#34c759]/10">
                                    <Quote className="w-3.5 h-3.5 text-[#34c759] mt-0.5 flex-shrink-0" />
                                    <span className="text-[13px] font-medium text-[#34c759]/80 italic">{ref}</span>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    {result.weaknesses?.length > 0 && (
                      <div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 rounded-full bg-[#ff3b30]/10 flex items-center justify-center">
                            <ThumbsDown className="w-6 h-6 text-[#ff3b30]" />
                          </div>
                          <h4 className="text-[14px] font-semibold text-[#ff3b30] uppercase tracking-widest">Schwächen</h4>
                        </div>
                        <ul className="space-y-5">
                          {result.weaknesses.map((w, i) => {
                            const text = typeof w === 'object' ? w.text : w
                            const ref = typeof w === 'object' ? w.reference : ''
                            return (
                              <li key={i} className="text-[16px] font-medium text-gray-700 leading-relaxed">
                                <div className="flex items-start gap-4">
                                  <span className="w-2 h-2 rounded-full bg-[#ff3b30] mt-2.5 flex-shrink-0" />
                                  {text}
                                </div>
                                {ref && (
                                  <div className="ml-6 mt-2 flex items-start gap-2.5 px-4 py-2.5 bg-[#ff3b30]/5 rounded-[14px] border border-[#ff3b30]/10">
                                    <Quote className="w-3.5 h-3.5 text-[#ff3b30] mt-0.5 flex-shrink-0" />
                                    <span className="text-[13px] font-medium text-[#ff3b30]/80 italic">{ref}</span>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {results.length === 0 && (
        <Card className="p-20 text-center mt-10">
          <p className="text-[20px] font-medium text-gray-500">Keine Ergebnisse verfügbar.</p>
        </Card>
      )}
    </div>
  )
}
