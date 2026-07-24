import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserSearch, Briefcase, Loader2, Zap } from 'lucide-react'
import { candidatesApi, matchingApi, jobsApi } from '../api'
import { Card, Button, LoadingSpinner } from '../components/UI'
import MatchingWeights from '../components/MatchingWeights'
import CandidatePicker from '../components/CandidatePicker'
import { useI18n } from '../I18nContext'

export default function CandidateToJobs() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [candidates, setCandidates] = useState([])
  const [jobs, setJobs] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
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

  const toggleCandidate = (id) => {
    setSelectedId(prev => (prev === id ? null : id))
  }

  const handleMatch = async () => {
    if (!selectedId) {
      setError(t('matching.select_one_candidate'))
      return
    }
    if (jobs.length === 0) {
      setError(t('matching.no_jobs_for_matrix'))
      return
    }
    setError('')
    setMatching(true)
    try {
      const result = await matchingApi.runMatrix({
        mode: 'candidate_to_jobs',
        candidateIds: [selectedId],
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

  const selectedCandidate = candidates.find(c => c.id === selectedId)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[24px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">{t('matching.mode_candidate_title')}</h1>
        <p className="text-[15px] sm:text-[17px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">{t('matching.mode_candidate_desc')}</p>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          <Card className="p-12 h-full">
            <div className="flex items-center gap-5 mb-6">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <UserSearch className="w-6 h-6 text-black dark:text-white" />
              </div>
              <div>
                <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('matching.candidate_selection_single')}</h2>
                <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('matching.candidate_single_hint')}</p>
              </div>
            </div>

            <CandidatePicker
              candidates={candidates}
              selectedIds={selectedId ? [selectedId] : []}
              onToggle={toggleCandidate}
              searchTerm={searchTerm}
              onSearch={setSearchTerm}
              single
              onCreate={() => navigate('/candidates/new')}
            />

            <div className="mt-8">
              <MatchingWeights weights={weights} onChange={setWeights} />
            </div>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="p-10">
            <div className="flex items-center gap-5 mb-6">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <Briefcase className="w-6 h-6 text-black dark:text-white" />
              </div>
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('matching.jobs_in_pool').replace('{count}', jobs.length)}</h2>
              </div>
            </div>
            {selectedCandidate ? (
              <div className="px-5 py-4 rounded-[20px] bg-[#0071e3]/5 ring-1 ring-[#0071e3]/20">
                <p className="text-[16px] font-semibold text-black dark:text-white">{selectedCandidate.name}</p>
                {selectedCandidate.skills && (
                  <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 truncate mt-1">{selectedCandidate.skills}</p>
                )}
              </div>
            ) : (
              <p className="text-[15px] font-medium text-gray-400">{t('matching.candidate_single_hint')}</p>
            )}
          </Card>

          <Button
            className="w-full py-5 text-[18px]"
            variant="dark"
            disabled={matching || !selectedId || jobs.length === 0}
            onClick={handleMatch}
          >
            {matching ? (
              <><Loader2 className="w-6 h-6 animate-spin" /> {t('matching.running')}</>
            ) : (
              <><Zap className="w-6 h-6" /> {t('matching.match_against_all_jobs')}</>
            )}
          </Button>

          {matching && (
            <Card className="p-8 border-[#0071e3]/20 bg-[#0071e3]/5">
              <div className="flex items-center gap-5">
                <div className="w-4 h-4 rounded-full bg-[#0071e3] animate-pulse" />
                <div>
                  <p className="text-[16px] font-semibold text-[#0071e3]">{t('matching.analyzing')}</p>
                  <p className="text-[15px] font-medium text-[#0071e3]/70 mt-1">
                    {t('matching.jobs_in_pool').replace('{count}', jobs.length)}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
