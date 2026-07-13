import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitCompare, Briefcase, Users, Loader2, Zap, AlertTriangle } from 'lucide-react'
import { candidatesApi, matchingApi, jobsApi } from '../api'
import { Card, Button, LoadingSpinner } from '../components/UI'
import MatchingWeights from '../components/MatchingWeights'
import MatchingProgress from '../components/MatchingProgress'
import { useI18n } from '../I18nContext'

export default function MatrixMatching() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [candidates, setCandidates] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [error, setError] = useState('')
  const [weights, setWeights] = useState({
    skills: 0, experience: 0, education: 0, location: 0, languages: 0,
    salary: 0, availability: 0, certificates: 0, cultural_fit: 0, mobility: 0
  })

  useEffect(() => {
    Promise.all([
      candidatesApi.getAll({ fields: 'matching' }),
      jobsApi.getAll({}).catch(() => ({ data: [] })),
    ]).then(([candidateData, jobsData]) => {
        setCandidates(candidateData.data || [])
        setJobs(jobsData.data || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const pairCount = jobs.length * candidates.length
  const isLarge = pairCount > 100

  const handleMatch = async () => {
    if (jobs.length === 0) {
      setError(t('matching.no_jobs_for_matrix'))
      return
    }
    if (candidates.length === 0) {
      setError(t('matching.select_candidates'))
      return
    }
    setError('')
    setMatching(true)
    try {
      const result = await matchingApi.runMatrix({
        mode: 'all_jobs_all_candidates',
        weights,
      })
      navigate(`/matching/results/${result.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setMatching(false)
    }
  }

  if (loading) return <LoadingSpinner text={t('matching.candidates_loading')} />

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[24px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">{t('matching.mode_matrix_title')}</h1>
        <p className="text-[15px] sm:text-[17px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">{t('matching.mode_matrix_desc')}</p>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-8">
          <Card className="p-12">
            <div className="flex items-center gap-5 mb-10">
              <div className="w-14 h-14 rounded-full bg-[#8b5cf6]/10 flex items-center justify-center">
                <GitCompare className="w-6 h-6 text-[#8b5cf6]" />
              </div>
              <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('matching.matrix_overview')}</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="p-8 rounded-[24px] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-center">
                <Briefcase className="w-7 h-7 text-gray-400 mx-auto mb-4" />
                <p className="text-[40px] leading-none font-semibold tracking-tight text-black dark:text-white">{jobs.length}</p>
                <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-3">Stellen</p>
              </div>
              <div className="p-8 rounded-[24px] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-center">
                <Users className="w-7 h-7 text-gray-400 mx-auto mb-4" />
                <p className="text-[40px] leading-none font-semibold tracking-tight text-black dark:text-white">{candidates.length}</p>
                <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-3">Bewerber</p>
              </div>
              <div className="p-8 rounded-[24px] bg-[#8b5cf6]/5 text-center ring-1 ring-[#8b5cf6]/20">
                <GitCompare className="w-7 h-7 text-[#8b5cf6] mx-auto mb-4" />
                <p className="text-[40px] leading-none font-semibold tracking-tight text-[#8b5cf6]">{pairCount}</p>
                <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-3">Kombinationen</p>
              </div>
            </div>

            {isLarge && (
              <div className="flex items-center gap-3 mt-8 px-5 py-4 rounded-[16px] bg-[#ff9500]/10 text-[#ff9500] text-[14px] font-medium">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {t('matching.matrix_warning')}
              </div>
            )}
          </Card>

          <Card className="p-12">
            <MatchingWeights weights={weights} onChange={setWeights} />
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="p-10">
            <p className="text-[16px] font-semibold text-black dark:text-white">
              {t('matching.matrix_summary').replace('{jobs}', jobs.length).replace('{candidates}', candidates.length)}
            </p>
          </Card>

          <Button
            className="w-full py-5 text-[18px]"
            variant="dark"
            disabled={matching || jobs.length === 0 || candidates.length === 0}
            onClick={handleMatch}
          >
            {matching ? (
              <><Loader2 className="w-6 h-6 animate-spin" /> {t('matching.matrix_running')}</>
            ) : (
              <><Zap className="w-6 h-6" /> {t('matching.matrix_start')}</>
            )}
          </Button>

          <MatchingProgress running={matching} totalPairs={pairCount} color="#8b5cf6" />
        </div>
      </div>
    </div>
  )
}
