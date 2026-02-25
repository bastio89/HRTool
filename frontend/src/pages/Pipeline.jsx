import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, UserPlus, MapPin, Search, GripVertical, Activity
} from 'lucide-react'
import { jobsApi, pipelineApi, candidatesApi } from '../api'
import { Button, LoadingSpinner } from '../components/UI'

const STAGES = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt']

const stageStyle = {
  Beworben:   { dot: 'bg-gray-400',        col: 'bg-gray-50',          header: 'text-gray-600' },
  Vorauswahl: { dot: 'bg-[#0071e3]',       col: 'bg-[#0071e3]/5',      header: 'text-[#0071e3]' },
  Interview:  { dot: 'bg-[#ff9f0a]',       col: 'bg-[#ff9f0a]/5',      header: 'text-[#ff9f0a]' },
  Angebot:    { dot: 'bg-[#8b5cf6]',       col: 'bg-[#8b5cf6]/5',      header: 'text-[#8b5cf6]' },
  Hired:      { dot: 'bg-[#34c759]',       col: 'bg-[#34c759]/5',      header: 'text-[#34c759]' },
  Abgesagt:   { dot: 'bg-[#ff3b30]',       col: 'bg-[#ff3b30]/5',      header: 'text-[#ff3b30]' },
}

export default function Pipeline() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [board, setBoard] = useState({})
  const [allCandidates, setAllCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [addPanelOpen, setAddPanelOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [dragEntry, setDragEntry] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadBoard = async () => {
    const [jobData, pipelineData, candidateData] = await Promise.all([
      jobsApi.getById(jobId),
      pipelineApi.getByJob(jobId),
      candidatesApi.getAll(),
    ])
    setJob(jobData)
    setBoard(pipelineData.board || {})
    setAllCandidates(candidateData.data || [])
    setLoading(false)
  }

  useEffect(() => { loadBoard() }, [jobId])

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

    // Optimistic update
    setBoard(prev => {
      const newBoard = { ...prev }
      newBoard[dragEntry.stage] = (newBoard[dragEntry.stage] || []).filter(e => e.id !== dragEntry.id)
      const updatedEntry = { ...dragEntry, stage: targetStage }
      newBoard[targetStage] = [updatedEntry, ...(newBoard[targetStage] || [])]
      return newBoard
    })

    try {
      await pipelineApi.updateStage(dragEntry.id, targetStage)
    } catch (err) {
      // Revert on error
      loadBoard()
      alert('Fehler beim Aktualisieren: ' + err.message)
    }
    setDragEntry(null)
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

  // Candidates not yet in this pipeline
  const pipelineIds = Object.values(board).flat().map(e => e.candidate_id)
  const availableCandidates = allCandidates.filter(c =>
    !pipelineIds.includes(c.id) &&
    (!addSearch || c.name.toLowerCase().includes(addSearch.toLowerCase()) ||
      (c.skills && c.skills.toLowerCase().includes(addSearch.toLowerCase())))
  )

  const totalInPipeline = Object.values(board).flat().length

  if (loading) return <LoadingSpinner text="Pipeline wird geladen..." />

  return (
    <div className="fade-in flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-8 mb-10">
        <button onClick={() => navigate('/jobs')} className="w-12 h-12 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer">
          <ArrowLeft className="w-6 h-6 text-black" />
        </button>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-gray-400 mb-1">Pipeline</p>
          <h1 className="text-[36px] font-semibold tracking-tight text-black leading-tight">
            {job?.title}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-5 py-2.5 rounded-full bg-[#f5f5f7] text-[15px] font-medium text-gray-600">
            {totalInPipeline} Bewerber{totalInPipeline !== 1 ? '' : ''}
          </div>
          <Button variant="dark" size="md" onClick={() => setAddPanelOpen(true)}>
            <UserPlus className="w-5 h-5" /> Bewerber hinzufügen
          </Button>
        </div>
      </div>

      {/* Kanban board — horizontal scroll */}
      <div className="flex gap-5 overflow-x-auto pb-6 -mx-2 px-2">
        {STAGES.map(stage => {
          const style = stageStyle[stage]
          const cards = board[stage] || []
          const isOver = dragOverStage === stage

          return (
            <div
              key={stage}
              className={`flex-shrink-0 w-[280px] rounded-[28px] p-5 flex flex-col gap-4 transition-all duration-200
                ${isOver ? 'ring-2 ring-[#0071e3] ring-offset-2 scale-[1.01]' : ''}
                ${style.col}`}
              onDragOver={e => handleDragOver(e, stage)}
              onDrop={e => handleDrop(e, stage)}
              onDragLeave={() => setDragOverStage(null)}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                  <span className={`text-[15px] font-bold uppercase tracking-wider ${style.header}`}>
                    {stage}
                  </span>
                </div>
                <span className="text-[14px] font-semibold text-gray-400 bg-white px-2.5 py-0.5 rounded-full">
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-3 min-h-[80px]">
                {cards.length === 0 && (
                  <div className={`flex items-center justify-center h-20 rounded-[20px] border-2 border-dashed text-[14px] font-medium text-gray-400 
                    ${isOver ? 'border-[#0071e3] text-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200'}`}>
                    {isOver ? 'Hier ablegen' : 'Leer'}
                  </div>
                )}
                {cards.map(entry => (
                  <KanbanCard
                    key={entry.id}
                    entry={entry}
                    onDragStart={() => handleDragStart(entry)}
                    onRemove={() => handleRemove(entry.id, stage)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Candidate Modal */}
      {addPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setAddPanelOpen(false)} />
          <div className="relative w-[520px] max-h-[80vh] bg-white rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-gray-100/80 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-10 pt-10 pb-8">
              <h2 className="text-[24px] font-semibold tracking-tight text-black">Bewerber hinzufügen</h2>
              <button
                onClick={() => setAddPanelOpen(false)}
                className="w-10 h-10 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="px-10 pb-10 flex flex-col gap-6 flex-1 overflow-auto">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Name oder Skills suchen..."
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  className="w-full pl-14 pr-5 py-4 bg-[#f5f5f7] rounded-[20px] text-[16px] text-black font-medium
                    focus:outline-none focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                  autoFocus
                />
              </div>

              {availableCandidates.length === 0 ? (
                <p className="text-[16px] font-medium text-gray-400 text-center py-12">
                  {pipelineIds.length === allCandidates.length
                    ? 'Alle Bewerber sind bereits in dieser Pipeline.'
                    : 'Keine passenden Bewerber gefunden.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {availableCandidates.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handleAddCandidate(c.id)}
                      disabled={saving}
                      className="w-full flex items-center gap-5 p-5 rounded-[20px] bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors text-left cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center font-semibold text-[16px] text-gray-600 flex-shrink-0">
                        {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[17px] font-semibold text-black truncate">{c.name}</p>
                        <p className="text-[14px] font-medium text-gray-500 truncate mt-0.5">
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
        </div>
      )}
    </div>
  )
}

function KanbanCard({ entry, onDragStart, onRemove }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] cursor-grab active:cursor-grabbing border border-gray-100/80 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-200 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-black truncate">{entry.candidate_name}</p>
            {entry.location && (
              <p className="text-[13px] font-medium text-gray-500 mt-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />{entry.location}
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
      {entry.skills && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {entry.skills.split(',').slice(0, 2).map((skill, i) => (
            <span key={i} className="px-2.5 py-1 bg-[#f5f5f7] rounded-full text-[12px] font-medium text-gray-600">
              {skill.trim()}
            </span>
          ))}
        </div>
      )}
      <Link
        to={`/candidates/${entry.candidate_id}/detail`}
        onClick={e => e.stopPropagation()}
        className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-[#0071e3] hover:opacity-70 transition-opacity"
      >
        <Activity className="w-3.5 h-3.5" /> Profil & Log
      </Link>
    </div>
  )
}
