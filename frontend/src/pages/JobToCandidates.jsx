import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Users, Loader2, Zap, Briefcase, PenLine } from 'lucide-react'
import { candidatesApi, matchingApi, jobsApi, pipelineApi } from '../api'
import { Card, Button, Textarea, Input, LoadingSpinner } from '../components/UI'
import MatchingWeights from '../components/MatchingWeights'
import MatchingProgress from '../components/MatchingProgress'
import CandidatePicker from '../components/CandidatePicker'
import JobPicker from '../components/JobPicker'
import { useI18n } from '../I18nContext'

export default function JobToCandidates() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [jobMode, setJobMode] = useState('manual') // 'manual' | 'existing'
  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [selectAll, setSelectAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [jobs, setJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [jobSearch, setJobSearch] = useState('')
  const [pipelineCandidateIds, setPipelineCandidateIds] = useState([])
  const [pipelineLoading, setPipelineLoading] = useState(false)
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
        setSelectedIds([])
        setJobs(jobsData.data || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSelectJob = async (job) => {
    setSelectedJobId(job.id)
    setJobTitle(job.title || '')
    const parts = []
    if (job.description) parts.push(job.description)
    if (job.requirements) parts.push(`Anforderungen:\n${job.requirements}`)
    if (job.location) parts.push(`Standort: ${job.location}`)
    if (job.type) parts.push(`Arbeitsmodell: ${job.type}`)
    setJobDescription(parts.join('\n\n'))

    setPipelineLoading(true)
    try {
      const pipelineData = await pipelineApi.getByJob(job.id)
      const board = pipelineData.board || {}
      const candidateIdsFromPipeline = Object.values(board)
        .flat()
        .map(entry => entry.candidate_id)
        .filter(Boolean)
      const uniqueIds = [...new Set(candidateIdsFromPipeline)]
      setPipelineCandidateIds(uniqueIds)
      setSelectedIds(uniqueIds)
      setSelectAll(false)
    } catch (_) {
      setPipelineCandidateIds([])
    } finally {
      setPipelineLoading(false)
    }
  }

  const handleModeSwitch = (mode) => {
    setJobMode(mode)
    if (mode === 'manual') {
      setSelectedJobId(null)
      setPipelineCandidateIds([])
    }
  }

  const toggleCandidate = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setSelectAll(false)
  }

  const toggleAll = () => {
    if (selectAll) {
      setSelectedIds([])
      setSelectAll(false)
    } else {
      setSelectedIds(candidates.map(c => c.id))
      setSelectAll(true)
    }
  }

  const handleMatch = async () => {
    if (!jobDescription.trim()) {
      setError(t('matching.enter_desc'))
      return
    }
    if (selectedIds.length === 0) {
      setError(t('matching.select_candidates'))
      return
    }
    setError('')
    setMatching(true)
    try {
      const result = await matchingApi.run(jobDescription, jobTitle, selectedIds, weights, selectedJobId || null)
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
        <h1 className="text-[24px] sm:text-[32px] font-semibold tracking-tight text-black dark:text-white">{t('matching.mode_job_title')}</h1>
        <p className="text-[15px] sm:text-[17px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">{t('matching.mode_job_desc')}</p>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          <Card className="p-12 h-full">
            <div className="flex items-center gap-5 mb-10">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <FileText className="w-6 h-6 text-black dark:text-white" />
              </div>
              <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('matching.description')}</h2>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-3 mb-10 p-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] w-fit">
              <button
                type="button"
                onClick={() => handleModeSwitch('manual')}
                className={`flex items-center gap-2.5 px-6 py-3 rounded-[16px] text-[15px] font-semibold transition-all cursor-pointer ${
                  jobMode === 'manual' ? 'bg-white dark:bg-[#1c1c1e] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
                }`}
              >
                <PenLine className="w-4 h-4" /> {t('matching.manual_input')}
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('existing')}
                className={`flex items-center gap-2.5 px-6 py-3 rounded-[16px] text-[15px] font-semibold transition-all cursor-pointer ${
                  jobMode === 'existing' ? 'bg-white dark:bg-[#1c1c1e] text-black dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white'
                }`}
              >
                <Briefcase className="w-4 h-4" /> {t('matching.from_jobs')}
                {jobs.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[12px] font-bold">{jobs.length}</span>
                )}
              </button>
            </div>

            {/* Job picker */}
            {jobMode === 'existing' && (
              <div className="mb-10">
                <JobPicker
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  onSelect={handleSelectJob}
                  search={jobSearch}
                  onSearch={setJobSearch}
                />
                {selectedJobId && (
                  <p className="mt-4 text-[14px] font-semibold text-[#34c759] flex items-center gap-2">
                    {t('matching.job_selected')}
                    {pipelineCandidateIds.length > 0 && (
                      <span className="ml-2 text-[#0071e3]">
                        {t('matching.pipeline_preselected').replace('{count}', pipelineCandidateIds.length)}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}

            <Input
              label={t('matching.job_title')}
              placeholder="z.B. Senior Frontend Developer (m/w/d)"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />

            <div className="mt-8">
              <Textarea
                label={t('matching.description')}
                placeholder={`Füge hier die vollständige Stellenbeschreibung ein...\n\nBeispiel:\n- Aufgaben und Verantwortlichkeiten\n- Anforderungen und Qualifikationen\n- Gewünschte Skills\n- Standort und Arbeitsmodell`}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={18}
              />
            </div>

            <div className="mt-8">
              <MatchingWeights weights={weights} onChange={setWeights} />
            </div>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="p-10">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center">
                <Users className="w-6 h-6 text-black dark:text-white" />
              </div>
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('matching.candidate_selection')}</h2>
                <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-1">
                  {t('matching.selected_of').replace('{selected}', selectedIds.length).replace('{total}', candidates.length)}
                </p>
              </div>
            </div>

            <CandidatePicker
              candidates={candidates}
              selectedIds={selectedIds}
              onToggle={toggleCandidate}
              onToggleAll={toggleAll}
              selectAll={selectAll}
              searchTerm={searchTerm}
              onSearch={setSearchTerm}
              pipelineIds={pipelineCandidateIds}
              pipelineLoading={pipelineLoading}
              onCreate={() => navigate('/candidates/new')}
            />
          </Card>

          <Button
            className="w-full py-5 text-[18px]"
            variant="dark"
            disabled={matching || !jobDescription.trim() || selectedIds.length === 0}
            onClick={handleMatch}
          >
            {matching ? (
              <><Loader2 className="w-6 h-6 animate-spin" /> {t('matching.running')}</>
            ) : (
              <><Zap className="w-6 h-6" /> {t('matching.start')}</>
            )}
          </Button>

          <MatchingProgress running={matching} totalPairs={selectedIds.length} color="#0071e3" />
        </div>
      </div>
    </div>
  )
}
