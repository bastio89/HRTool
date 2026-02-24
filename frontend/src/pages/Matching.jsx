import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitCompare, FileText, Users, Search, CheckSquare, Square, Loader2, Zap, Briefcase, PenLine, ChevronRight } from 'lucide-react'
import { candidatesApi, matchingApi, jobsApi } from '../api'
import { Card, Button, Textarea, Input, EmptyState, LoadingSpinner } from '../components/UI'

export default function Matching() {
  const navigate = useNavigate()
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

  useEffect(() => {
    Promise.all([
      candidatesApi.getAll(),
      jobsApi.getAll().catch(() => ({ data: [] })),
    ]).then(([candidateData, jobsData]) => {
        setCandidates(candidateData.data || [])
        setSelectedIds([])
        setJobs(jobsData.data || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSelectJob = (job) => {
    setSelectedJobId(job.id)
    setJobTitle(job.title || '')
    // Build description from job fields
    const parts = []
    if (job.description) parts.push(job.description)
    if (job.requirements) parts.push(`Anforderungen:\n${job.requirements}`)
    if (job.location) parts.push(`Standort: ${job.location}`)
    if (job.type) parts.push(`Arbeitsmodell: ${job.type}`)
    setJobDescription(parts.join('\n\n'))
  }

  const handleModeSwitch = (mode) => {
    setJobMode(mode)
    if (mode === 'manual') {
      setSelectedJobId(null)
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
      setError('Bitte füge eine Stellenbeschreibung ein.')
      return
    }
    if (selectedIds.length === 0) {
      setError('Bitte wähle mindestens einen Bewerber aus.')
      return
    }
    setError('')
    setMatching(true)

    try {
      const result = await matchingApi.run(jobDescription, jobTitle, selectedIds)
      navigate(`/matching/results/${result.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setMatching(false)
    }
  }

  const filteredCandidates = candidates.filter(c =>
    !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) || (c.skills && c.skills.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  if (loading) return <LoadingSpinner text="Bewerber werden geladen..." />

  return (
    <div className="fade-in max-w-[1200px] mx-auto">
      <div className="mb-14">
        <h1 className="text-[40px] font-semibold tracking-tight text-black">Stellen-Matching</h1>
        <p className="text-[18px] text-gray-500 mt-3">
          Füge eine Stellenbeschreibung ein und finde die passendsten Bewerber
        </p>
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
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] flex items-center justify-center">
                <FileText className="w-6 h-6 text-black" />
              </div>
              <h2 className="text-[24px] font-semibold tracking-tight text-black">Stellenbeschreibung</h2>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-3 mb-10 p-1.5 bg-[#f5f5f7] rounded-[20px] w-fit">
              <button
                type="button"
                onClick={() => handleModeSwitch('manual')}
                className={`flex items-center gap-2.5 px-6 py-3 rounded-[16px] text-[15px] font-semibold transition-all cursor-pointer ${
                  jobMode === 'manual' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'
                }`}
              >
                <PenLine className="w-4 h-4" /> Manuell eingeben
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('existing')}
                className={`flex items-center gap-2.5 px-6 py-3 rounded-[16px] text-[15px] font-semibold transition-all cursor-pointer ${
                  jobMode === 'existing' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'
                }`}
              >
                <Briefcase className="w-4 h-4" /> Aus Stellen wählen
                {jobs.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[12px] font-bold">{jobs.length}</span>
                )}
              </button>
            </div>

            {/* Job picker */}
            {jobMode === 'existing' && (
              <div className="mb-10">
                {jobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 rounded-[24px] bg-[#f5f5f7]">
                    <Briefcase className="w-10 h-10 text-gray-300 mb-4" />
                    <p className="text-[17px] font-semibold text-gray-400">Noch keine Stellen angelegt</p>
                    <button
                      type="button"
                      onClick={() => navigate('/jobs')}
                      className="mt-5 px-6 py-3 rounded-full bg-black text-white text-[15px] font-semibold cursor-pointer hover:bg-gray-800 transition-colors"
                    >
                      Stellen verwalten →
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative mb-5">
                      <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Stellen durchsuchen..."
                        value={jobSearch}
                        onChange={e => setJobSearch(e.target.value)}
                        className="w-full pl-14 pr-5 py-4 bg-[#f5f5f7] rounded-[20px] text-[15px] font-medium text-black border border-transparent
                          focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
                      />
                    </div>
                    <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                      {jobs
                        .filter(j => !jobSearch || j.title.toLowerCase().includes(jobSearch.toLowerCase()) || (j.location && j.location.toLowerCase().includes(jobSearch.toLowerCase())))
                        .map(job => (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => handleSelectJob(job)}
                            className={`w-full flex items-center gap-5 p-5 rounded-[20px] text-left transition-all cursor-pointer ${
                              selectedJobId === job.id
                                ? 'bg-[#0071e3] text-white shadow-md'
                                : 'bg-[#f5f5f7] hover:bg-[#e8e8ed] text-black'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                              selectedJobId === job.id ? 'bg-white/20' : 'bg-white'
                            }`}>
                              <Briefcase className={`w-5 h-5 ${selectedJobId === job.id ? 'text-white' : 'text-gray-500'}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[16px] font-semibold truncate">{job.title}</p>
                              <p className={`text-[13px] font-medium mt-0.5 truncate ${selectedJobId === job.id ? 'text-white/70' : 'text-gray-500'}`}>
                                {[job.location, job.type, job.status].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <ChevronRight className={`w-5 h-5 flex-shrink-0 ${selectedJobId === job.id ? 'text-white' : 'text-gray-400'}`} />
                          </button>
                        ))}
                    </div>
                    {selectedJobId && (
                      <p className="mt-4 text-[14px] font-semibold text-[#34c759] flex items-center gap-2">
                        ✓ Stelle ausgewählt – Felder unten wurden vorausgefüllt
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <Input
              label="Stellentitel"
              placeholder="z.B. Senior Frontend Developer (m/w/d)"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />

            <div className="mt-8">
              <Textarea
                label="Stellenbeschreibung"
                placeholder={`Füge hier die vollständige Stellenbeschreibung ein...\n\nBeispiel:\n- Aufgaben und Verantwortlichkeiten\n- Anforderungen und Qualifikationen\n- Gewünschte Skills\n- Standort und Arbeitsmodell`}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={18}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="p-10">
            <div className="flex items-center gap-5 mb-8">
              <div className="w-14 h-14 rounded-full bg-[#f5f5f7] flex items-center justify-center">
                <Users className="w-6 h-6 text-black" />
              </div>
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight text-black">Bewerberauswahl</h2>
                <p className="text-[15px] font-medium text-gray-500 mt-1">
                  {selectedIds.length} von {candidates.length} ausgewählt
                </p>
              </div>
            </div>

            {candidates.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Keine Bewerber"
                description="Lege zuerst Bewerber an."
                action={<Button variant="secondary" size="md" onClick={() => navigate('/candidates/new')}>Bewerber anlegen</Button>}
              />
            ) : (
              <>
                <div className="relative mb-6">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Filtern..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-14 pr-5 py-4 text-[15px] bg-[#f5f5f7] border border-transparent rounded-[20px] 
                      text-black font-medium focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
                  />
                </div>

                <button
                  onClick={toggleAll}
                  className="flex items-center gap-4 w-full px-5 py-4 rounded-[20px] hover:bg-[#f5f5f7] transition-colors text-[15px] font-semibold text-gray-700 cursor-pointer mb-4"
                >
                  {selectAll ? <CheckSquare className="w-6 h-6 text-[#0071e3]" /> : <Square className="w-6 h-6 text-gray-300" />}
                  Alle auswählen
                </button>

                <div className="space-y-2 max-h-[450px] overflow-y-auto pr-2">
                  {filteredCandidates.map(candidate => (
                    <button
                      key={candidate.id}
                      onClick={() => toggleCandidate(candidate.id)}
                      className="flex items-center gap-5 w-full px-5 py-4 rounded-[20px] hover:bg-[#f5f5f7] transition-colors text-left cursor-pointer"
                    >
                      {selectedIds.includes(candidate.id) ? <CheckSquare className="w-6 h-6 text-[#0071e3] flex-shrink-0" /> : <Square className="w-6 h-6 text-gray-300 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold text-black truncate">{candidate.name}</p>
                        {candidate.skills && (
                          <p className="text-[14px] font-medium text-gray-500 truncate mt-1">
                            {candidate.skills}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Button
            className="w-full py-5 text-[18px]"
            variant="dark"
            disabled={matching || !jobDescription.trim() || selectedIds.length === 0}
            onClick={handleMatch}
          >
            {matching ? (
              <><Loader2 className="w-6 h-6 animate-spin" /> Matching läuft...</>
            ) : (
              <><Zap className="w-6 h-6" /> Matching starten</>
            )}
          </Button>

          {matching && (
            <Card className="p-8 border-[#0071e3]/20 bg-[#0071e3]/5">
              <div className="flex items-center gap-5">
                <div className="w-4 h-4 rounded-full bg-[#0071e3] animate-pulse" />
                <div>
                  <p className="text-[16px] font-semibold text-[#0071e3]">KI analysiert...</p>
                  <p className="text-[15px] font-medium text-[#0071e3]/70 mt-1">
                    {selectedIds.length || candidates.length} Bewerber werden abgeglichen.
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
