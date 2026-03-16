import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../I18nContext'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, UserPlus, MapPin, Search, GripVertical, Activity, MessageSquare, Send, GitCompare, Calendar, Clock, Video, Phone, Star, ChevronLeft, ChevronRight, ArrowRight, ClipboardList
} from 'lucide-react'
import { jobsApi, pipelineApi, candidatesApi, matchingApi, interviewsApi, ratingsApi } from '../api'
import InterviewScheduler from '../components/InterviewScheduler'
import ScorecardPanel from '../components/ScorecardPanel'
import { Button, LoadingSpinner } from '../components/UI'

const STAGES = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt']

const stageStyle = {
  Beworben:   { dot: 'bg-gray-400',        col: 'bg-gray-50',          header: 'text-gray-600 dark:text-gray-400' },
  Vorauswahl: { dot: 'bg-[#0071e3]',       col: 'bg-[#0071e3]/5',      header: 'text-[#0071e3]' },
  Interview:  { dot: 'bg-[#ff9f0a]',       col: 'bg-[#ff9f0a]/5',      header: 'text-[#ff9f0a]' },
  Angebot:    { dot: 'bg-[#8b5cf6]',       col: 'bg-[#8b5cf6]/5',      header: 'text-[#8b5cf6]' },
  Hired:      { dot: 'bg-[#34c759]',       col: 'bg-[#34c759]/5',      header: 'text-[#34c759]' },
  Abgesagt:   { dot: 'bg-[#ff3b30]',       col: 'bg-[#ff3b30]/5',      header: 'text-[#ff3b30]' },
}

export default function Pipeline() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [job, setJob] = useState(null)
  const [board, setBoard] = useState({})
  const [allCandidates, setAllCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [addPanelOpen, setAddPanelOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [dragEntry, setDragEntry] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [stageChangeModal, setStageChangeModal] = useState(null) // { entry, targetStage }
  const [stageNote, setStageNote] = useState('')
  const [notesModal, setNotesModal] = useState(null) // { entryId, candidateName }
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [matchingRunning, setMatchingRunning] = useState(false)
  const [interviewModal, setInterviewModal] = useState(null) // { entry }
  const [scorecardModal, setScorecardModal] = useState(null) // { entry }
  const [entryInterviews, setEntryInterviews] = useState({}) // { [entryId]: interview[] }
  const [candidateRatings, setCandidateRatings] = useState({}) // { [candidateId]: { average, count } }
  const [activeStage, setActiveStage] = useState(0) // Mobile: index into STAGES
  const touchRef = useRef(null)

  const loadBoard = async () => {
    const [jobData, pipelineData, candidateData] = await Promise.all([
      jobsApi.getById(jobId),
      pipelineApi.getByJob(jobId),
      candidatesApi.getAll(),
    ])
    setJob(jobData)
    setBoard(pipelineData.board || {})
    setAllCandidates(candidateData.data || [])
    // Load ratings for all pipeline candidates
    const allEntries = Object.values(pipelineData.board || {}).flat()
    const candidateIds = [...new Set(allEntries.map(e => e.candidate_id))]
    if (candidateIds.length > 0) {
      try {
        const rRes = await ratingsApi.getBatchAverages(candidateIds)
        setCandidateRatings(rRes.data || {})
      } catch (_) {}
    }
    setLoading(false)
  }

  const loadInterviews = async (board) => {
    const allEntries = Object.values(board).flat()
    const results = {}
    await Promise.all(allEntries.map(async (e) => {
      try {
        const res = await interviewsApi.getByPipelineEntry(e.id)
        if (res.data?.length > 0) results[e.id] = res.data
      } catch {}
    }))
    setEntryInterviews(results)
  }

  useEffect(() => { loadBoard() }, [jobId])
  useEffect(() => {
    if (Object.keys(board).length > 0) loadInterviews(board)
  }, [board])

  // Drag & Drop handlers
  const handleDragStart = (entry) => setDragEntry(entry)
  const handleDragOver = (e, stage) => {
    e.preventDefault()
    setDragOverStage(stage)
  }
  const handleDrop = async (e, targetStage) => {
    e.preventDefault()
    setDragOverStage(null)
    if (!dragEntry || dragEntry.stage === targetStage) { setDragEntry(null); return }

    // Open note modal for stage change
    setStageChangeModal({ entry: dragEntry, targetStage })
    setStageNote('')
    setDragEntry(null)
  }

  const confirmStageChange = async () => {
    if (!stageChangeModal) return
    const { entry, targetStage } = stageChangeModal
    const noteText = stageNote.trim()

    // Optimistic update
    setBoard(prev => {
      const newBoard = { ...prev }
      newBoard[entry.stage] = (newBoard[entry.stage] || []).filter(e => e.id !== entry.id)
      const updatedEntry = { ...entry, stage: targetStage }
      newBoard[targetStage] = [updatedEntry, ...(newBoard[targetStage] || [])]
      return newBoard
    })

    setStageChangeModal(null)
    setStageNote('')

    try {
      await pipelineApi.updateStage(entry.id, targetStage, noteText || undefined)
    } catch (err) {
      loadBoard()
      alert(t('pipeline.update_error') + ': ' + err.message)
    }
  }

  const openNotes = async (entryId, candidateName) => {
    setNotesModal({ entryId, candidateName })
    setLoadingNotes(true)
    setNewNote('')
    try {
      const data = await pipelineApi.getNotes(entryId)
      setNotes(data.data || [])
    } catch (err) {
      setNotes([])
    } finally {
      setLoadingNotes(false)
    }
  }

  const submitNote = async () => {
    if (!newNote.trim() || !notesModal) return
    try {
      await pipelineApi.addNote(notesModal.entryId, newNote.trim())
      setNewNote('')
      const data = await pipelineApi.getNotes(notesModal.entryId)
      setNotes(data.data || [])
    } catch (err) {
      alert(err.message)
    }
  }

  const handleAddCandidate = async (candidateId) => {
    setSaving(true)
    try {
      await pipelineApi.addCandidate(jobId, candidateId, 'Beworben')
      await loadBoard()
      setAddPanelOpen(false)
      setAddSearch('')
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (entryId, stage) => {
    try {
      await pipelineApi.removeEntry(entryId)
      setBoard(prev => ({
        ...prev,
        [stage]: prev[stage].filter(e => e.id !== entryId)
      }))
    } catch (err) {
      alert(err.message)
    }
  }

  const startMatchingFromPipeline = async () => {
    if (!job?.description || totalInPipeline === 0) return
    setMatchingRunning(true)
    try {
      const candidateIds = Object.values(board).flat().map(e => e.candidate_id)
      const result = await matchingApi.run(job.description, job.title, candidateIds)
      navigate(`/matching/results/${result.id}`)
    } catch (err) {
      alert(t('pipeline.matching_failed') + ': ' + err.message)
    } finally {
      setMatchingRunning(false)
    }
  }

  // Candidates not yet in this pipeline
  const pipelineIds = Object.values(board).flat().map(e => e.candidate_id)
  const availableCandidates = allCandidates.filter(c =>
    !pipelineIds.includes(c.id) &&
    (!addSearch || c.name.toLowerCase().includes(addSearch.toLowerCase()) ||
      (c.skills && c.skills.toLowerCase().includes(addSearch.toLowerCase())))
  )

  const totalInPipeline = Object.values(board).flat().length

  // Mobile swipe
  const handleTouchStart = (e) => { touchRef.current = e.touches[0].clientX }
  const handleTouchEnd = (e) => {
    if (touchRef.current === null) return
    const diff = touchRef.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 60) {
      setActiveStage(prev => diff > 0 ? Math.min(prev + 1, STAGES.length - 1) : Math.max(prev - 1, 0))
    }
    touchRef.current = null
  }

  // Mobile stage move (no drag & drop on touch)
  const handleMobileMove = async (entry, targetStage) => {
    setBoard(prev => {
      const newBoard = { ...prev }
      newBoard[entry.stage] = (newBoard[entry.stage] || []).filter(e => e.id !== entry.id)
      const updatedEntry = { ...entry, stage: targetStage }
      newBoard[targetStage] = [updatedEntry, ...(newBoard[targetStage] || [])]
      return newBoard
    })
    try {
      await pipelineApi.updateStage(entry.id, targetStage)
    } catch (err) {
      loadBoard()
      alert(t('common.error') + ': ' + err.message)
    }
  }

  if (loading) return <LoadingSpinner text={t('pipeline.loading')} />

  return (
    <div className="fade-in flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-4 sm:mb-6">
        <div className="flex items-center gap-4 sm:gap-8 flex-1 min-w-0">
          <button onClick={() => navigate('/jobs')} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] sm:text-[15px] font-medium text-gray-400 mb-0.5 sm:mb-1">{t('pipeline.title')}</p>
            <h1 className="text-[24px] sm:text-[36px] font-semibold tracking-tight text-black dark:text-white leading-tight truncate">
              {job?.title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap ml-14 sm:ml-0">
          <div className="px-5 py-2.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[15px] font-medium text-gray-600 dark:text-gray-400">
            {totalInPipeline} {t('pipeline.candidates')}
          </div>
          {totalInPipeline > 0 && job?.description && (
            <Button variant="secondary" size="md" onClick={startMatchingFromPipeline} disabled={matchingRunning}>
              <GitCompare className="w-5 h-5" /> {matchingRunning ? t('pipeline.matching_running') : t('pipeline.matching')}
            </Button>
          )}
          <Button variant="dark" size="md" onClick={() => setAddPanelOpen(true)}>
            <UserPlus className="w-5 h-5" /> {t('pipeline.add')}
          </Button>
        </div>
      </div>

      {/* Mobile Stage Tabs — visible only on small screens */}
      <div className="md:hidden mb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory scrollbar-none">
          {STAGES.map((stage, idx) => {
            const style = stageStyle[stage]
            const count = (board[stage] || []).length
            return (
              <button
                key={stage}
                onClick={() => setActiveStage(idx)}
                className={`snap-center flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-bold uppercase tracking-wider transition-all cursor-pointer
                  ${idx === activeStage
                    ? `${style.col} ${style.header} ring-2 ring-current`
                    : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-400'}`}
              >
                <span className={`w-2 h-2 rounded-full ${idx === activeStage ? style.dot : 'bg-gray-300 dark:bg-gray-600'}`} />
                {stage}
                <span className={`ml-0.5 text-[12px] px-1.5 py-0.5 rounded-full ${idx === activeStage ? 'bg-white/50 dark:bg-black/20' : 'bg-gray-200 dark:bg-gray-700'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Mobile Kanban — single column with swipe */}
      <div
        className="md:hidden flex-1 min-h-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {(() => {
          const stage = STAGES[activeStage]
          const style = stageStyle[stage]
          const cards = board[stage] || []
          const prevStage = activeStage > 0 ? STAGES[activeStage - 1] : null
          const nextStage = activeStage < STAGES.length - 1 ? STAGES[activeStage + 1] : null
          return (
            <div className={`rounded-[24px] p-4 ${style.col} min-h-[200px]`}>
              <div className="flex items-center justify-between mb-4 px-1">
                <button
                  onClick={() => setActiveStage(Math.max(0, activeStage - 1))}
                  disabled={!prevStage}
                  className="w-8 h-8 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center disabled:opacity-20 cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${style.dot}`} />
                  <span className={`text-[17px] font-bold ${style.header}`}>{stage}</span>
                  <span className="text-[15px] font-semibold text-gray-400 bg-white dark:bg-[#1c1c1e] px-2.5 py-0.5 rounded-full ml-1">
                    {cards.length}
                  </span>
                </div>
                <button
                  onClick={() => setActiveStage(Math.min(STAGES.length - 1, activeStage + 1))}
                  disabled={!nextStage}
                  className="w-8 h-8 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center disabled:opacity-20 cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              {/* Stage dots indicator */}
              <div className="flex items-center justify-center gap-1.5 mb-4">
                {STAGES.map((_, i) => (
                  <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === activeStage ? 'bg-gray-600 dark:bg-gray-300 w-4' : 'bg-gray-300 dark:bg-gray-600'}`} />
                ))}
              </div>
              <div className="flex flex-col gap-3">
                {cards.length === 0 && (
                  <div className="flex items-center justify-center h-24 rounded-[20px] border-2 border-dashed border-gray-200 dark:border-gray-700 text-[14px] font-medium text-gray-400">
                    {t('pipeline.no_candidates')}
                  </div>
                )}
                {cards.map(entry => (
                  <MobileKanbanCard
                    key={entry.id}
                    entry={entry}
                    t={t}
                    interviews={entryInterviews[entry.id] || []}
                    rating={candidateRatings[entry.candidate_id]}
                    prevStage={prevStage}
                    nextStage={nextStage}
                    onMove={(targetStage) => handleMobileMove(entry, targetStage)}
                    onRemove={() => handleRemove(entry.id, stage)}
                    onOpenNotes={() => openNotes(entry.id, entry.candidate_name)}
                    onOpenInterview={() => setInterviewModal({ entry })}
                  />
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      {/* Desktop Kanban board — horizontal scroll (hidden on mobile) */}
      <div className="hidden md:flex gap-3 flex-1 min-h-0 pb-2">
        {STAGES.map(stage => {
          const style = stageStyle[stage]
          const cards = board[stage] || []
          const isOver = dragOverStage === stage

          return (
            <div
              key={stage}
              className={`flex-1 min-w-0 rounded-[24px] p-4 flex flex-col gap-3 transition-all duration-200
                ${isOver ? 'ring-2 ring-[#0071e3] ring-offset-2 scale-[1.01]' : ''}
                ${style.col}`}
              onDragOver={e => handleDragOver(e, stage)}
              onDrop={e => handleDrop(e, stage)}
              onDragLeave={() => setDragOverStage(null)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                  <span className={`text-[13px] font-bold uppercase tracking-wider ${style.header}`}>
                    {stage}
                  </span>
                </div>
                <span className="text-[13px] font-semibold text-gray-400 bg-white dark:bg-[#1c1c1e] px-2 py-0.5 rounded-full">
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto min-h-[60px] scrollbar-thin">
                {cards.length === 0 && (
                  <div className={`flex items-center justify-center h-16 rounded-[16px] border-2 border-dashed text-[13px] font-medium text-gray-400 
                    ${isOver ? 'border-[#0071e3] text-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-gray-700'}`}>
                    {isOver ? t('pipeline.drop_here') : t('pipeline.empty')}
                  </div>
                )}
                {cards.map(entry => (
                  <KanbanCard
                    key={entry.id}
                    entry={entry}
                    t={t}
                    interviews={entryInterviews[entry.id] || []}
                    rating={candidateRatings[entry.candidate_id]}
                    onDragStart={() => handleDragStart(entry)}
                    onRemove={() => handleRemove(entry.id, stage)}
                    onOpenNotes={() => openNotes(entry.id, entry.candidate_name)}
                    onOpenInterview={() => setInterviewModal({ entry })}
                    onOpenScorecard={() => setScorecardModal({ entry })}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Candidate Modal — rendered via Portal to escape overflow-hidden */}
      {addPanelOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="fixed inset-0 bg-black/30" onClick={() => setAddPanelOpen(false)} />
          <div className="relative z-10 w-[520px] max-h-[80vh] bg-white dark:bg-[#1c1c1e] rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-gray-100/8 dark:border-gray-700/80 dark:border-gray-700/80 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-10 pt-10 pb-8 flex-shrink-0">
              <h2 className="text-[24px] font-semibold tracking-tight text-black dark:text-white">{t('pipeline.add')}</h2>
              <button
                onClick={() => setAddPanelOpen(false)}
                className="w-10 h-10 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            <div className="px-10 pb-10 flex flex-col gap-6 flex-1 overflow-auto">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder={t('pipeline.search')}
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  className="w-full pl-14 pr-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] text-black dark:text-white font-medium
                    focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                  autoFocus
                />
              </div>

              {availableCandidates.length === 0 ? (
                <p className="text-[16px] font-medium text-gray-400 text-center py-12">
                  {pipelineIds.length === allCandidates.length
                    ? t('pipeline.already_in')
                    : t('pipeline.no_match')}
                </p>
              ) : (
                <div className="space-y-3">
                  {availableCandidates.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handleAddCandidate(c.id)}
                      disabled={saving}
                      className="w-full flex items-center gap-5 p-5 rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors text-left cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center font-semibold text-[16px] text-gray-600 dark:text-gray-400 flex-shrink-0">
                        {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[17px] font-semibold text-black dark:text-white truncate">{c.name}</p>
                        <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 truncate mt-0.5">
                          {c.location && <span className="mr-3">{c.location}</span>}
                          {c.skills?.split(',').slice(0, 2).join(', ')}
                        </p>
                      </div>
                      <div className="ml-auto">
                        <Plus className="w-5 h-5 text-gray-400" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Stage Change Note Modal */}
      {stageChangeModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="fixed inset-0 bg-black/30" onClick={() => { setStageChangeModal(null); loadBoard() }} />
          <div className="relative z-10 w-[480px] bg-white dark:bg-[#1c1c1e] rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-gray-100/8 dark:border-gray-700/80 dark:border-gray-700/80 p-10">
            <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-2">{t('pipeline.stage_change')}</h2>
            <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-6">
              <span className="font-semibold text-black dark:text-white">{stageChangeModal.entry.candidate_name}</span>
              {' '}{t('pipeline.stage_from')} <span className="font-semibold">{stageChangeModal.entry.stage}</span>
              {' '}{t('pipeline.stage_to')} <span className="font-semibold">{stageChangeModal.targetStage}</span>
            </p>
            <textarea
              value={stageNote}
              onChange={e => setStageNote(e.target.value)}
              placeholder={t('pipeline.note_optional')}
              rows={3}
              className="w-full px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] text-black dark:text-white font-medium resize-none
                focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
              autoFocus
            />
            <div className="flex items-center justify-end gap-4 mt-6">
              <Button variant="secondary" onClick={() => { setStageChangeModal(null); loadBoard() }}>{t('common.cancel')}</Button>
              <Button variant="dark" onClick={confirmStageChange}>
                {t('pipeline.confirm')}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Notes Modal */}
      {notesModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div className="fixed inset-0 bg-black/30" onClick={() => setNotesModal(null)} />
          <div className="relative z-10 w-[520px] max-h-[80vh] bg-white dark:bg-[#1c1c1e] rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-gray-100/8 dark:border-gray-700/80 dark:border-gray-700/80 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-10 pt-10 pb-6 flex-shrink-0">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('pipeline.notes')}</h2>
                <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">{notesModal.candidateName}</p>
              </div>
              <button onClick={() => setNotesModal(null)} className="w-10 h-10 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center cursor-pointer transition-colors">
                <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            <div className="px-10 pb-4 flex-1 overflow-auto">
              {loadingNotes ? (
                <p className="text-gray-400 text-center py-8">{t('common.loading')}</p>
              ) : notes.length === 0 ? (
                <p className="text-gray-400 text-center py-8 text-[15px]">{t('pipeline.notes_empty')}</p>
              ) : (
                <div className="space-y-4">
                  {notes.map(n => (
                    <div key={n.id} className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] p-5">
                      <p className="text-[15px] text-black dark:text-white font-medium leading-relaxed">{n.content}</p>
                      <div className="flex items-center gap-3 mt-3">
                        {n.old_stage !== n.new_stage && (
                          <span className="text-[12px] font-semibold text-[#0071e3] bg-[#0071e3]/10 px-2.5 py-1 rounded-full">
                            {n.old_stage} → {n.new_stage}
                          </span>
                        )}
                        <span className="text-[12px] text-gray-400 font-medium">
                          {new Date(n.created_at).toLocaleString('de-DE')}
                        </span>
                        {n.author === 'System' && (
                          <span className="text-[11px] text-gray-400 bg-gray-100 dark:bg-[#2c2c2e] px-2 py-0.5 rounded-full">Auto</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-10 pb-8 pt-4 flex-shrink-0 border-t border-gray-100 dark:border-gray-700">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitNote()}
                  placeholder={t('pipeline.notes_write')}
                  className="flex-1 px-5 py-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] text-[15px] text-black dark:text-white font-medium
                    focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                />
                <button
                  onClick={submitNote}
                  disabled={!newNote.trim()}
                  className="w-12 h-12 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Interview Scheduler Modal */}
      {interviewModal && (
        <InterviewScheduler
          open={!!interviewModal}
          onClose={() => setInterviewModal(null)}
          entry={interviewModal.entry}
          onSaved={() => loadInterviews(board)}
        />
      )}

      {/* Scorecard Panel Modal */}
      {scorecardModal && (
        <ScorecardPanel
          open={!!scorecardModal}
          onClose={() => setScorecardModal(null)}
          entry={scorecardModal.entry}
          jobId={parseInt(jobId)}
          onSaved={() => {}}
        />
      )}
    </div>
  )
}

function KanbanCard({ entry, t, interviews, rating, onDragStart, onRemove, onOpenNotes, onOpenInterview, onOpenScorecard }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="bg-white dark:bg-[#1c1c1e] rounded-[16px] p-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] cursor-grab active:cursor-grabbing border border-gray-100/8 dark:border-gray-700/80 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-200 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold text-black dark:text-white truncate">{entry.candidate_name}</p>
              {rating && (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  <Star className="w-3.5 h-3.5 text-[#ff9f0a] fill-[#ff9f0a]" />
                  <span className="text-[13px] font-bold text-[#ff9f0a]">{rating.average}</span>
                </span>
              )}
            </div>
            {entry.location && (
              <p className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" />{entry.location}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="w-7 h-7 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5 text-[#ff3b30]" />
        </button>
      </div>
      {(entry.skills || entry.tags) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {entry.skills && entry.skills.split(',').slice(0, 2).map((skill, i) => (
            <span key={`s${i}`} className="px-2 py-0.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full text-[11px] font-medium text-gray-600 dark:text-gray-400">
              {skill.trim()}
            </span>
          ))}
          {entry.tags && entry.tags.split(',').slice(0, 2).map((tag, i) => (
            <span key={`t${i}`} className="px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[11px] font-semibold text-[#5e5ce6]">
              {tag.trim()}
            </span>
          ))}
        </div>
      )}
      {/* Interview info */}
      {interviews.length > 0 && (() => {
        const next = interviews.find(iv => iv.status === 'geplant' || iv.status === 'bestätigt') || interviews[0]
        const typeIcon = next.interview_type === 'Video' ? Video : next.interview_type === 'Telefon' ? Phone : MapPin
        const TypeIcon = typeIcon
        return (
          <div className="mt-2 p-2 rounded-[10px] bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-[#ff9f0a]" />
              <span className="text-[11px] font-semibold text-[#ff9f0a]">
                {new Date(next.interview_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                {next.interview_time && ` · ${next.interview_time}`}
              </span>
              <TypeIcon className="w-3 h-3 text-[#ff9f0a] ml-auto" />
            </div>
          </div>
        )
      })()}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <Link
          to={`/candidates/${entry.candidate_id}/detail`}
          onClick={e => e.stopPropagation()}
          className="text-[#0071e3] hover:opacity-70 transition-opacity cursor-pointer"
          title={t('pipeline.profile_log')}
        >
          <Activity className="w-3.5 h-3.5" />
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenNotes() }}
          className="text-gray-400 hover:text-[#0071e3] transition-colors cursor-pointer"
          title={t('pipeline.notes')}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenInterview() }}
          className="text-gray-400 hover:text-[#ff9f0a] transition-colors cursor-pointer relative"
          title={t('pipeline.interview')}
        >
          <Calendar className="w-3.5 h-3.5" />
          {interviews.length > 0 && (
            <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#ff9f0a] text-white text-[8px] font-bold flex items-center justify-center">{interviews.length}</span>
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenScorecard() }}
          className="text-gray-400 hover:text-[#5e5ce6] transition-colors cursor-pointer"
          title={t('pipeline.scorecard')}
        >
          <ClipboardList className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function MobileKanbanCard({ entry, t, interviews, rating, prevStage, nextStage, onMove, onRemove, onOpenNotes, onOpenInterview }) {
  const stageColor = (stage) => ({
    Beworben: '#9ca3af', Vorauswahl: '#0071e3', Interview: '#ff9f0a',
    Angebot: '#8b5cf6', Hired: '#34c759', Abgesagt: '#ff3b30'
  }[stage] || '#9ca3af')
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[17px] font-semibold text-black dark:text-white truncate">{entry.candidate_name}</p>
            {rating && (
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <Star className="w-3.5 h-3.5 text-[#ff9f0a] fill-[#ff9f0a]" />
                <span className="text-[13px] font-bold text-[#ff9f0a]">{rating.average}</span>
              </span>
            )}
          </div>
          {entry.location && (
            <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />{entry.location}
            </p>
          )}
        </div>
        <button
          onClick={onRemove}
          className="w-8 h-8 rounded-full bg-[#ff3b30]/10 flex items-center justify-center cursor-pointer flex-shrink-0"
        >
          <X className="w-4 h-4 text-[#ff3b30]" />
        </button>
      </div>
      {entry.skills && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {entry.skills.split(',').slice(0, 3).map((skill, i) => (
            <span key={i} className="px-2.5 py-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full text-[12px] font-medium text-gray-600 dark:text-gray-400">
              {skill.trim()}
            </span>
          ))}
        </div>
      )}
      {interviews.length > 0 && (() => {
        const next = interviews.find(iv => iv.status === 'geplant' || iv.status === 'bestätigt') || interviews[0]
        return (
          <div className="mb-3 p-2.5 rounded-[12px] bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3 text-[#ff9f0a]" />
              <span className="text-[12px] font-semibold text-[#ff9f0a]">
                {new Date(next.interview_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                {next.interview_time && ` · ${next.interview_time}`}
              </span>
            </div>
          </div>
        )
      })()}
      {/* Mobile move buttons */}
      <div className="flex items-center gap-2 mb-3">
        {prevStage && (
          <button
            onClick={() => onMove(prevStage)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[14px] bg-[#f5f5f7] dark:bg-[#2c2c2e] active:scale-95 transition-transform cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: stageColor(prevStage) }} />
            <span className="text-[12px] font-bold text-gray-600 dark:text-gray-400">{prevStage}</span>
          </button>
        )}
        {nextStage && (
          <button
            onClick={() => onMove(nextStage)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[14px] bg-[#f5f5f7] dark:bg-[#2c2c2e] active:scale-95 transition-transform cursor-pointer"
          >
            <span className="text-[12px] font-bold text-gray-600 dark:text-gray-400">{nextStage}</span>
            <ChevronRight className="w-4 h-4" style={{ color: stageColor(nextStage) }} />
          </button>
        )}
      </div>
      {/* Action row */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-700/50">
        <Link
          to={`/candidates/${entry.candidate_id}/detail`}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0071e3]"
        >
          <Activity className="w-3.5 h-3.5" /> {t('pipeline.profile')}
        </Link>
        <button
          onClick={onOpenNotes}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-500 dark:text-gray-400 cursor-pointer"
        >
          <MessageSquare className="w-3.5 h-3.5" /> {t('pipeline.notes')}
        </button>
        <button
          onClick={onOpenInterview}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-500 dark:text-gray-400 cursor-pointer"
        >
          <Calendar className="w-3.5 h-3.5" /> {t('pipeline.interview')}
          {interviews.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-[#ff9f0a]/10 text-[#ff9f0a] text-[10px] font-bold flex items-center justify-center">{interviews.length}</span>
          )}
        </button>
      </div>
    </div>
  )
}
