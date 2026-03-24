import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useI18n } from '../I18nContext'
import { useAuth } from '../AuthContext'
import {
  ArrowLeft, Sparkles, Star, ChevronDown, ChevronUp, Loader2, ClipboardList,
  Trash2, MapPin, Briefcase, Calendar, Clock, Video, Phone, Building2,
  CheckCircle2, AlertCircle, FileText, Save, Users, Lightbulb, GripVertical,
  User, Award, Globe, MessageSquare
} from 'lucide-react'
import { jobsApi, candidatesApi, pipelineApi, scorecardsApi, interviewsApi, activitiesApi, candidateDetailsApi } from '../api'
import { Button, LoadingSpinner } from '../components/UI'
import { KiBadge, KiDisclaimer } from '../components/KiBadge'

const CATEGORIES = ['Fachkompetenz', 'Soft Skills', 'Motivation', 'Erfahrung']
const CATEGORY_COLORS = {
  Fachkompetenz: { bg: 'bg-[#0071e3]/10', text: 'text-[#0071e3]', border: 'border-[#0071e3]/20' },
  'Soft Skills': { bg: 'bg-[#34c759]/10', text: 'text-[#34c759]', border: 'border-[#34c759]/20' },
  Motivation:    { bg: 'bg-[#ff9f0a]/10', text: 'text-[#ff9f0a]', border: 'border-[#ff9f0a]/20' },
  Erfahrung:     { bg: 'bg-[#8b5cf6]/10', text: 'text-[#8b5cf6]', border: 'border-[#8b5cf6]/20' },
  Allgemein:     { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' },
}

export default function InterviewPrep() {
  const { jobId, entryId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { user } = useAuth()

  // Core data
  const [job, setJob] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [entry, setEntry] = useState(null)
  const [workHistory, setWorkHistory] = useState([])
  const [interviews, setInterviews] = useState([])
  const [templates, setTemplates] = useState([])
  const [previousResponses, setPreviousResponses] = useState([])

  // Interview state
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])  // [{ question, score, comment }]
  const [expandedQ, setExpandedQ] = useState(new Set())
  const [filterCategory, setFilterCategory] = useState(null)
  const [generalNotes, setGeneralNotes] = useState('')
  const [evaluatorName, setEvaluatorName] = useState('')

  // UI state
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [questionCount, setQuestionCount] = useState(8)
  const [showTemplateSelect, setShowTemplateSelect] = useState(false)

  useEffect(() => {
    loadAllData()
  }, [jobId, entryId])

  useEffect(() => {
    if (user?.display_name) {
      setEvaluatorName(user.display_name)
    }
  }, [user])

  const loadAllData = async () => {
    setLoading(true)
    try {
      // Load pipeline board to find the entry
      const boardRes = await pipelineApi.getByJob(jobId)
      const board = boardRes.board || boardRes
      let foundEntry = null
      for (const stage of Object.keys(board)) {
        const match = (board[stage] || []).find(e => String(e.id) === String(entryId))
        if (match) { foundEntry = match; break }
      }
      if (!foundEntry) {
        navigate(`/pipeline/${jobId}`, { replace: true })
        return
      }
      setEntry(foundEntry)

      // Load all data in parallel
      const [jobRes, candidateRes, templatesRes, responsesRes, interviewsRes] = await Promise.all([
        jobsApi.getById(jobId),
        candidatesApi.getById(foundEntry.candidate_id),
        scorecardsApi.getTemplates(jobId),
        scorecardsApi.getResponses({ candidate_id: foundEntry.candidate_id }),
        interviewsApi.getByPipelineEntry(entryId),
      ])

      setJob(jobRes)
      setCandidate(candidateRes)
      setTemplates(templatesRes.data || [])
      setPreviousResponses(responsesRes.data || [])
      setInterviews(interviewsRes.data || interviewsRes || [])

      // Load work history
      try {
        const wh = await candidateDetailsApi.getWorkHistory(foundEntry.candidate_id)
        setWorkHistory(wh.data || wh || [])
      } catch { setWorkHistory([]) }
    } catch (err) {
      console.error('InterviewPrep load error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Generate AI questions
  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await scorecardsApi.generateQuestions({
        job_id: parseInt(jobId),
        candidate_id: entry.candidate_id,
        question_count: questionCount,
      })
      const qs = res.questions || []
      if (qs.length > 0) {
        // Save as template
        const tmplRes = await scorecardsApi.createTemplate({
          job_id: parseInt(jobId),
          title: `${t('interview_prep.ai_template')} – ${candidate?.name || ''}`,
          questions: qs,
          ai_generated: true,
        })
        // Load fresh templates
        const freshTemplates = await scorecardsApi.getTemplates(jobId)
        setTemplates(freshTemplates.data || [])

        // Select the generated questions
        setQuestions(qs)
        setAnswers(qs.map(q => ({ question: q.text, score: 0, comment: '' })))
        setSelectedTemplate({ id: tmplRes.id, title: `${t('interview_prep.ai_template')} – ${candidate?.name || ''}`, questions: qs, ai_generated: 1 })
        // Expand all
        setExpandedQ(new Set(qs.map((_, i) => i)))
      }
    } catch (err) {
      console.error('AI generation failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  // Select an existing template
  const handleSelectTemplate = (tpl) => {
    const qs = typeof tpl.questions === 'string' ? JSON.parse(tpl.questions) : tpl.questions
    setSelectedTemplate(tpl)
    setQuestions(qs)
    setAnswers(qs.map(q => ({ question: q.text, score: 0, comment: '' })))
    setExpandedQ(new Set(qs.map((_, i) => i)))
    setShowTemplateSelect(false)
  }

  // Delete a template
  const handleDeleteTemplate = async (e, tplId) => {
    e.stopPropagation()
    try {
      await scorecardsApi.deleteTemplate(tplId)
      setTemplates(prev => prev.filter(t => t.id !== tplId))
      if (selectedTemplate?.id === tplId) {
        setSelectedTemplate(null)
        setQuestions([])
        setAnswers([])
      }
    } catch (err) {
      console.error('Delete template failed:', err)
    }
  }

  // Update answer for a question
  const updateAnswer = (idx, field, value) => {
    setAnswers(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a))
  }

  // Remove a question
  const removeQuestion = (idx) => {
    setQuestions(prev => prev.filter((_, i) => i !== idx))
    setAnswers(prev => prev.filter((_, i) => i !== idx))
  }

  // Toggle expand question
  const toggleExpand = (idx) => {
    setExpandedQ(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  // Finish interview — save all results
  const handleFinish = async () => {
    if (!evaluatorName.trim()) return
    setSaving(true)
    try {
      const ratedAnswers = answers.filter(a => a.score > 0)
      const avgScore = ratedAnswers.length > 0
        ? (ratedAnswers.reduce((sum, a) => sum + a.score, 0) / ratedAnswers.length).toFixed(1)
        : '0'

      // 1. Save scorecard response (if template selected and any answers)
      if (selectedTemplate && ratedAnswers.length > 0) {
        await scorecardsApi.createResponse({
          template_id: selectedTemplate.id,
          pipeline_entry_id: parseInt(entryId),
          candidate_id: entry.candidate_id,
          evaluator_name: evaluatorName.trim(),
          answers,
          notes: generalNotes.trim() || undefined,
        })
      }

      // 2. Save activity on candidate
      const summaryParts = []
      summaryParts.push(`Interview-Bewertung von ${evaluatorName.trim()}`)
      if (job) summaryParts.push(`Stelle: ${job.title}`)
      summaryParts.push(`Ø ${avgScore}/5 (${ratedAnswers.length}/${questions.length} Fragen bewertet)`)
      if (generalNotes.trim()) summaryParts.push(`\nFazit: ${generalNotes.trim()}`)

      await activitiesApi.create(entry.candidate_id, 'Interview', summaryParts.join('\n'))

      // 3. Save pipeline note
      const noteContent = `Interview-Bewertung: Ø ${avgScore}/5 von ${evaluatorName.trim()}${generalNotes.trim() ? `\n${generalNotes.trim()}` : ''}`
      await pipelineApi.addNote(parseInt(entryId), noteContent)

      setSaved(true)
      setTimeout(() => navigate(`/pipeline/${jobId}`), 1500)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  // Computed values
  const ratedCount = answers.filter(a => a.score > 0).length
  const avgScore = ratedCount > 0
    ? (answers.filter(a => a.score > 0).reduce((sum, a) => sum + a.score, 0) / ratedCount).toFixed(1)
    : null
  const filteredQuestions = filterCategory
    ? questions.map((q, i) => ({ ...q, idx: i })).filter(q => q.category === filterCategory)
    : questions.map((q, i) => ({ ...q, idx: i }))

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (saved) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-[#34c759] mx-auto mb-4" />
          <h2 className="text-[22px] font-bold text-black dark:text-white mb-2">{t('interview_prep.saved')}</h2>
          <p className="text-[15px] text-gray-500">{t('interview_prep.redirecting')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/pipeline/${jobId}`)} className="w-10 h-10 rounded-full bg-white dark:bg-[#1c1c1e] shadow-sm flex items-center justify-center hover:bg-gray-50 dark:hover:bg-[#2c2c2e] transition-colors cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-black dark:text-white">{t('interview_prep.title')}</h1>
            <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">{candidate?.name} · {job?.title}</p>
          </div>
        </div>
        {avgScore && (
          <div className="flex items-center gap-2 bg-white dark:bg-[#1c1c1e] px-5 py-3 rounded-2xl shadow-sm">
            <Star className="w-5 h-5 text-[#ff9f0a] fill-[#ff9f0a]" />
            <span className="text-[20px] font-bold text-[#ff9f0a]">{avgScore}</span>
            <span className="text-[14px] text-gray-400 font-medium">/ 5</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* ─── LEFT SIDEBAR ─── */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">

          {/* Candidate Profile Card */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm border border-gray-100/80 dark:border-gray-700/80 p-6">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#0071e3] to-[#5856d6] flex items-center justify-center text-white text-[18px] font-bold flex-shrink-0">
                {candidate?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-[17px] font-bold text-black dark:text-white truncate">{candidate?.name}</h3>
                {candidate?.current_position && (
                  <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 truncate">{candidate.current_position}</p>
                )}
                {candidate?.current_employer && (
                  <p className="text-[12px] text-gray-400 truncate flex items-center gap-1"><Building2 className="w-3 h-3" />{candidate.current_employer}</p>
                )}
              </div>
            </div>

            {/* Skills */}
            {candidate?.skills && (
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t('form.skills')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.skills.split(',').slice(0, 8).map((skill, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-full bg-[#0071e3]/8 text-[#0071e3] text-[11px] font-semibold">{skill.trim()}</span>
                  ))}
                  {candidate.skills.split(',').length > 8 && (
                    <span className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#2c2c2e] text-gray-500 text-[11px] font-semibold">+{candidate.skills.split(',').length - 8}</span>
                  )}
                </div>
              </div>
            )}

            {/* Experience summary */}
            {candidate?.experience && (
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t('form.experience')}</p>
                <p className="text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">{candidate.experience}</p>
              </div>
            )}

            {/* Languages */}
            {candidate?.languages && (
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t('form.languages')}</p>
                <p className="text-[13px] text-gray-600 dark:text-gray-300">{candidate.languages}</p>
              </div>
            )}

            {/* Work history compact */}
            {workHistory.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t('interview_prep.career')}</p>
                <div className="space-y-2">
                  {workHistory.slice(0, 3).map((wh, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0071e3] mt-1.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-black dark:text-white truncate">{wh.position}</p>
                        <p className="text-[11px] text-gray-400 truncate">{wh.employer} · {wh.from_date?.slice(0, 4)}{wh.is_current ? ` – ${t('interview_prep.present')}` : wh.to_date ? ` – ${wh.to_date.slice(0, 4)}` : ''}</p>
                      </div>
                    </div>
                  ))}
                  {workHistory.length > 3 && (
                    <Link to={`/candidates/${candidate?.id}/detail`} className="text-[11px] text-[#0071e3] font-semibold hover:underline">
                      +{workHistory.length - 3} {t('interview_prep.more_positions')}
                    </Link>
                  )}
                </div>
              </div>
            )}

            <Link to={`/candidates/${entry?.candidate_id}/detail`} className="mt-4 flex items-center gap-2 text-[13px] text-[#0071e3] font-semibold hover:underline">
              <User className="w-3.5 h-3.5" />{t('interview_prep.full_profile')}
            </Link>
          </div>

          {/* Job Info Card */}
          {job && (
            <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm border border-gray-100/80 dark:border-gray-700/80 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Briefcase className="w-4 h-4 text-[#ff9f0a]" />
                <h3 className="text-[15px] font-bold text-black dark:text-white">{t('interview_prep.job_info')}</h3>
              </div>
              <p className="text-[15px] font-semibold text-black dark:text-white mb-1">{job.title}</p>
              {job.location && <p className="text-[13px] text-gray-500 flex items-center gap-1 mb-3"><MapPin className="w-3 h-3" />{job.location}</p>}
              {job.requirements && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t('interview_prep.requirements')}</p>
                  <p className="text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-4">{job.requirements}</p>
                </div>
              )}
            </div>
          )}

          {/* Scheduled Interviews Card */}
          {interviews.length > 0 && (
            <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm border border-gray-100/80 dark:border-gray-700/80 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4 text-[#ff9f0a]" />
                <h3 className="text-[15px] font-bold text-black dark:text-white">{t('interview_prep.scheduled')}</h3>
              </div>
              <div className="space-y-3">
                {interviews.map(iv => {
                  const TypeIcon = iv.interview_type === 'Video' ? Video : iv.interview_type === 'Telefon' ? Phone : Building2
                  const statusColor = { geplant: 'text-[#0071e3] bg-[#0071e3]/10', bestätigt: 'text-[#34c759] bg-[#34c759]/10', abgeschlossen: 'text-gray-500 bg-gray-100', abgesagt: 'text-[#ff3b30] bg-[#ff3b30]/10' }[iv.status] || 'text-gray-500 bg-gray-100'
                  return (
                    <div key={iv.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                      <TypeIcon className="w-4 h-4 text-[#ff9f0a] flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-black dark:text-white">
                          {new Date(iv.interview_date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' })}
                          {iv.interview_time && ` · ${iv.interview_time}`}
                        </p>
                        <p className="text-[11px] text-gray-400">{iv.interview_type} · {iv.duration_minutes} min</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>{iv.status}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Previous Evaluations */}
          {previousResponses.length > 0 && (
            <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm border border-gray-100/80 dark:border-gray-700/80 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-[#8b5cf6]" />
                <h3 className="text-[15px] font-bold text-black dark:text-white">{t('interview_prep.prev_evaluations')}</h3>
              </div>
              <div className="space-y-2">
                {previousResponses.slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <div>
                      <p className="text-[13px] font-semibold text-black dark:text-white">{r.evaluator_name}</p>
                      <p className="text-[11px] text-gray-400">{new Date(r.created_at).toLocaleDateString('de-DE')}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-[#ff9f0a] fill-[#ff9f0a]" />
                      <span className="text-[14px] font-bold text-[#ff9f0a]">{r.total_score?.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── MAIN AREA ─── */}
        <div className="space-y-6">

          {/* Question Generator Section */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm border border-gray-100/80 dark:border-gray-700/80 p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#5e5ce6] to-[#bf5af2] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-[18px] font-bold text-black dark:text-white">{t('interview_prep.questions_title')}</h2>
                  <p className="text-[13px] text-gray-500">{t('interview_prep.questions_subtitle')}</p>
                </div>
              </div>
              <KiBadge />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#5e5ce6] to-[#bf5af2] text-white text-[14px] font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generating ? t('scorecard.generating') : t('interview_prep.generate')}
              </button>

              {/* Question count */}
              <div className="flex items-center gap-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full px-4 py-2">
                <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400">{t('interview_prep.count')}:</span>
                <input
                  type="number" min={3} max={15} value={questionCount}
                  onChange={e => setQuestionCount(Math.max(3, Math.min(15, parseInt(e.target.value) || 8)))}
                  className="w-12 text-center text-[14px] font-bold text-black dark:text-white bg-transparent outline-none"
                />
              </div>

              {/* Template selector */}
              <div className="relative">
                <button
                  onClick={() => setShowTemplateSelect(!showTemplateSelect)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[14px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
                >
                  <ClipboardList className="w-4 h-4" />
                  {selectedTemplate ? selectedTemplate.title : t('interview_prep.select_template')}
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {showTemplateSelect && templates.length > 0 && (
                  <div className="absolute top-full left-0 mt-2 w-80 bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 max-h-64 overflow-y-auto">
                    {templates.map(tpl => (
                      <div
                        key={tpl.id}
                        className="flex items-center gap-2 px-4 py-3 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] transition-colors first:rounded-t-2xl last:rounded-b-2xl group"
                      >
                        <button
                          onClick={() => handleSelectTemplate(tpl)}
                          className="flex-1 text-left cursor-pointer min-w-0"
                        >
                          <p className="text-[14px] font-semibold text-black dark:text-white truncate">{tpl.title}</p>
                          <p className="text-[12px] text-gray-400">{(typeof tpl.questions === 'string' ? JSON.parse(tpl.questions) : tpl.questions).length} {t('scorecard.questions')} {tpl.ai_generated ? '· KI' : ''}</p>
                        </button>
                        <button
                          onClick={(e) => handleDeleteTemplate(e, tpl.id)}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#ff3b30]/10 transition-all cursor-pointer flex-shrink-0"
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {questions.length === 0 && !generating && (
              <div className="mt-6 text-center py-10 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl">
                <Lightbulb className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-[15px] font-medium text-gray-400">{t('interview_prep.no_questions')}</p>
              </div>
            )}

            {generating && (
              <div className="mt-6 text-center py-10 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl">
                <Loader2 className="w-8 h-8 text-[#5e5ce6] animate-spin mx-auto mb-3" />
                <p className="text-[15px] font-medium text-gray-500">{t('scorecard.generating')}</p>
                <KiDisclaimer className="mt-4 mx-auto max-w-md" />
              </div>
            )}
          </div>

          {/* Category Filter */}
          {questions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setFilterCategory(null)}
                className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all cursor-pointer ${!filterCategory ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-gray-200'}`}
              >
                {t('interview_prep.all')} ({questions.length})
              </button>
              {CATEGORIES.filter(cat => questions.some(q => q.category === cat)).map(cat => {
                const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Allgemein
                const count = questions.filter(q => q.category === cat).length
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all cursor-pointer ${filterCategory === cat ? `${colors.bg} ${colors.text}` : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-gray-200'}`}
                  >
                    {cat} ({count})
                  </button>
                )
              })}

              {/* Progress */}
              <div className="ml-auto flex items-center gap-2 text-[13px] font-medium text-gray-500">
                <CheckCircle2 className="w-4 h-4 text-[#34c759]" />
                {t('interview_prep.rated').replace('{done}', ratedCount).replace('{total}', questions.length)}
              </div>
            </div>
          )}

          {/* Questions List */}
          {filteredQuestions.length > 0 && (
            <div className="space-y-3">
              {filteredQuestions.map((q, displayIdx) => {
                const idx = q.idx
                const answer = answers[idx]
                const isExpanded = expandedQ.has(idx)
                const colors = CATEGORY_COLORS[q.category] || CATEGORY_COLORS.Allgemein

                return (
                  <div
                    key={idx}
                    className={`bg-white dark:bg-[#1c1c1e] rounded-[16px] shadow-sm border transition-all ${answer?.score > 0 ? 'border-[#34c759]/30' : 'border-gray-100/80 dark:border-gray-700/80'}`}
                  >
                    {/* Question header */}
                    <div
                      onClick={() => toggleExpand(idx)}
                      className="flex items-start gap-3 p-5 cursor-pointer"
                    >
                      <span className="text-[14px] font-bold text-gray-300 mt-0.5 flex-shrink-0 w-6 text-right">{displayIdx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[15px] font-semibold text-black dark:text-white leading-snug">{q.text}</p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${colors.bg} ${colors.text}`}>{q.category}</span>
                            {answer?.score > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Star className="w-3.5 h-3.5 text-[#ff9f0a] fill-[#ff9f0a]" />
                                <span className="text-[13px] font-bold text-[#ff9f0a]">{answer.score}</span>
                              </span>
                            )}
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-5 pb-5 pt-0 ml-9">
                        {/* Hint */}
                        {q.hint && (
                          <div className="flex items-start gap-2 mb-4 p-3 rounded-xl bg-[#ff9f0a]/5 border border-[#ff9f0a]/10">
                            <Lightbulb className="w-4 h-4 text-[#ff9f0a] mt-0.5 flex-shrink-0" />
                            <p className="text-[13px] text-[#ff9f0a] font-medium leading-snug">{q.hint}</p>
                          </div>
                        )}

                        {/* Star rating */}
                        <div className="flex items-center gap-1.5 mb-4">
                          {[1, 2, 3, 4, 5].map(score => (
                            <button
                              key={score}
                              onClick={() => updateAnswer(idx, 'score', answer?.score === score ? 0 : score)}
                              className="p-1 cursor-pointer transition-transform hover:scale-110"
                              title={t(`rating.${score}`)}
                            >
                              <Star className={`w-7 h-7 transition-colors ${(answer?.score || 0) >= score ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-200 dark:text-gray-600'}`} />
                            </button>
                          ))}
                          {answer?.score > 0 && (
                            <span className="ml-2 text-[13px] font-semibold text-gray-500">{t(`rating.${answer.score}`)}</span>
                          )}
                        </div>

                        {/* Comment textarea */}
                        <textarea
                          value={answer?.comment || ''}
                          onChange={e => updateAnswer(idx, 'comment', e.target.value)}
                          placeholder={t('interview_prep.note_placeholder')}
                          rows={3}
                          className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-[14px] font-medium text-black dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 border border-transparent focus:border-[#0071e3]/30 transition-all placeholder:text-gray-400"
                        />

                        {/* Remove question */}
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={() => removeQuestion(idx)}
                            className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-[#ff3b30] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />{t('interview_prep.remove_question')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* General Notes & Finish Section */}
          {questions.length > 0 && (
            <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm border border-gray-100/80 dark:border-gray-700/80 p-6">
              <h2 className="text-[18px] font-bold text-black dark:text-white mb-5 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#0071e3]" />
                {t('interview_prep.summary')}
              </h2>

              {/* Evaluator Name */}
              <div className="mb-4">
                <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2 block">{t('interview_prep.interviewer')}</label>
                <input
                  value={evaluatorName}
                  onChange={e => setEvaluatorName(e.target.value)}
                  placeholder={t('interview_prep.interviewer_placeholder')}
                  className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-[15px] font-medium text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 border border-transparent focus:border-[#0071e3]/30 transition-all"
                />
              </div>

              {/* General Notes */}
              <div className="mb-6">
                <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2 block">{t('interview_prep.general_notes')}</label>
                <textarea
                  value={generalNotes}
                  onChange={e => setGeneralNotes(e.target.value)}
                  placeholder={t('interview_prep.general_notes_placeholder')}
                  rows={5}
                  className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-[14px] font-medium text-black dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 border border-transparent focus:border-[#0071e3]/30 transition-all placeholder:text-gray-400"
                />
              </div>

              {/* Score Summary */}
              {avgScore && (
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-[#ff9f0a]/5 to-[#ff9f0a]/10 mb-6">
                  <div className="flex items-center gap-2">
                    <Star className="w-6 h-6 text-[#ff9f0a] fill-[#ff9f0a]" />
                    <span className="text-[24px] font-bold text-[#ff9f0a]">{avgScore}</span>
                    <span className="text-[15px] text-gray-500 font-medium">/ 5</span>
                  </div>
                  <div className="h-8 w-px bg-gray-200 dark:bg-gray-700" />
                  <span className="text-[14px] font-medium text-gray-600 dark:text-gray-400">
                    {t('interview_prep.rated').replace('{done}', ratedCount).replace('{total}', questions.length)}
                  </span>
                </div>
              )}

              {/* Finish Button */}
              <button
                onClick={handleFinish}
                disabled={saving || !evaluatorName.trim() || ratedCount === 0}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-[#34c759] text-white text-[16px] font-bold hover:bg-[#2db84e] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[#34c759]/20"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {saving ? t('common.saving') : t('interview_prep.finish')}
              </button>
              {!evaluatorName.trim() && ratedCount > 0 && (
                <p className="text-[12px] text-[#ff3b30] font-medium mt-2 text-center">{t('interview_prep.name_required')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
