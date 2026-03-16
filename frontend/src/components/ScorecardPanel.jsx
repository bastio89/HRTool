import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Save, Star, ChevronDown, ChevronUp, Loader2, ClipboardList, Plus, Trash2, BarChart3, Users } from 'lucide-react'
import { scorecardsApi } from '../api'
import { KiBadge, KiDisclaimer } from './KiBadge'
import { useI18n } from '../I18nContext'

const CATEGORY_KEYS = {
  'Fachkompetenz': 'scorecard.cat_technical',
  'Soft Skills': 'scorecard.cat_soft_skills',
  'Motivation': 'scorecard.cat_motivation',
  'Erfahrung': 'scorecard.cat_experience',
  'Allgemein': 'scorecard.cat_general',
}
const CATEGORIES = Object.keys(CATEGORY_KEYS)

export default function ScorecardPanel({ open, onClose, entry, jobId, onSaved }) {
  const { t } = useI18n()
  const [tab, setTab] = useState('evaluate') // evaluate | templates | compare
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [responses, setResponses] = useState([])
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [evaluatorName, setEvaluatorName] = useState('')
  const [answers, setAnswers] = useState([])
  const [evalNotes, setEvalNotes] = useState('')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [newQuestions, setNewQuestions] = useState([{ text: '', category: 'Fachkompetenz', hint: '' }])

  useEffect(() => {
    if (open && entry) {
      loadData()
    }
  }, [open, entry])

  const loadData = async () => {
    setLoading(true)
    try {
      const [tmplRes, respRes] = await Promise.all([
        scorecardsApi.getTemplates(jobId),
        scorecardsApi.getResponses({ candidate_id: entry.candidate_id }),
      ])
      setTemplates(tmplRes.data || [])
      setResponses(respRes.data || [])
      // Load comparison
      try {
        const comp = await scorecardsApi.compareResponses(entry.candidate_id)
        setComparison(comp)
      } catch { setComparison(null) }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const selectTemplate = (template) => {
    setSelectedTemplate(template)
    setAnswers(template.questions.map(q => ({ question: q.text, score: 0, comment: '' })))
  }

  const updateAnswer = (idx, field, value) => {
    setAnswers(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a))
  }

  const handleSubmit = async () => {
    if (!selectedTemplate || !evaluatorName.trim()) return
    setSaving(true)
    try {
      await scorecardsApi.createResponse({
        template_id: selectedTemplate.id,
        pipeline_entry_id: entry.id,
        candidate_id: entry.candidate_id,
        evaluator_name: evaluatorName.trim(),
        answers,
        notes: evalNotes.trim() || undefined,
      })
      await loadData()
      setSelectedTemplate(null)
      setAnswers([])
      setEvalNotes('')
      onSaved?.()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleGenerateQuestions = async () => {
    setGenerating(true)
    try {
      const res = await scorecardsApi.generateQuestions({
        job_id: jobId,
        candidate_id: entry.candidate_id,
        question_count: 8,
      })
      const questions = res.questions || []
      if (questions.length > 0) {
        // Create a template from generated questions
        const tmplRes = await scorecardsApi.createTemplate({
          job_id: jobId,
          title: t('scorecard.ai_questions_for').replace('{name}', entry.candidate_name),
          questions,
          ai_generated: true,
        })
        await loadData()
        // Auto-select the new template
        const newTemplate = { id: tmplRes.id, title: t('scorecard.ai_questions_for').replace('{name}', entry.candidate_name), questions, ai_generated: 1 }
        selectTemplate(newTemplate)
      }
    } catch (err) {
      console.error('AI generation failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || newQuestions.filter(q => q.text.trim()).length === 0) return
    setSaving(true)
    try {
      await scorecardsApi.createTemplate({
        job_id: jobId,
        title: newTemplateName.trim(),
        questions: newQuestions.filter(q => q.text.trim()),
      })
      await loadData()
      setShowNewTemplate(false)
      setNewTemplateName('')
      setNewQuestions([{ text: '', category: 'Fachkompetenz', hint: '' }])
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const avgScore = answers.filter(a => a.score > 0).length > 0
    ? (answers.filter(a => a.score > 0).reduce((s, a) => s + a.score, 0) / answers.filter(a => a.score > 0).length).toFixed(1)
    : null

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[640px] max-h-[85vh] bg-white dark:bg-[#1c1c1e] rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-gray-100/80 dark:border-gray-700/80 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-10 pt-10 pb-6 flex-shrink-0">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">
              {t('scorecard.title')}
            </h2>
            <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">{entry.candidate_name}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center cursor-pointer transition-colors">
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 px-10 pb-5 flex-shrink-0">
          {[
            { key: 'evaluate', label: t('scorecard.evaluate'), icon: Star },
            { key: 'templates', label: t('scorecard.templates'), icon: ClipboardList },
            { key: 'compare', label: t('scorecard.compare'), icon: BarChart3 },
          ].map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-semibold transition-all cursor-pointer ${
                tab === tb.key
                  ? 'bg-black dark:bg-white text-white dark:text-black'
                  : 'text-gray-500 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
              }`}
            >
              <tb.icon className="w-3.5 h-3.5" />
              {tb.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-10 pb-10">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[#0071e3]" />
            </div>
          ) : tab === 'evaluate' ? (
            <div className="space-y-5">
              {/* KI Generate Button */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleGenerateQuestions}
                  disabled={generating}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-[#5e5ce6] to-[#0071e3] text-white text-[14px] font-semibold hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {generating ? t('scorecard.generating') : t('scorecard.generate_ai')}
                </button>
                <KiBadge label="Ollama" />
              </div>
              {generating && <KiDisclaimer feature="interview-questions" />}

              {/* Template Selection */}
              {!selectedTemplate ? (
                <div>
                  <p className="text-[12px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{t('scorecard.select_template')}</p>
                  {templates.length === 0 ? (
                    <div className="text-center py-8">
                      <ClipboardList className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                      <p className="text-[15px] text-gray-500">{t('scorecard.no_templates')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {templates.map(tpl => (
                        <button
                          key={tpl.id}
                          onClick={() => selectTemplate(tpl)}
                          className="w-full text-left p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[15px] font-semibold text-black dark:text-white">{tpl.title}</p>
                              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                                {tpl.questions.length} {t('scorecard.questions')}
                                {tpl.ai_generated ? ` · ${t('scorecard.ai_generated')}` : ''}
                                {tpl.job_title ? ` · ${tpl.job_title}` : ''}
                              </p>
                            </div>
                            {tpl.ai_generated === 1 && <KiBadge />}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Evaluator & Back */}
                  <div className="flex items-center gap-4">
                    <button onClick={() => setSelectedTemplate(null)} className="text-[14px] font-semibold text-[#0071e3] hover:opacity-70 cursor-pointer">← {t('common.back')}</button>
                    <span className="text-[15px] font-semibold text-black dark:text-white">{selectedTemplate.title}</span>
                    {selectedTemplate.ai_generated === 1 && <KiBadge />}
                  </div>
                  
                  <input
                    type="text"
                    placeholder={t('scorecard.evaluator')}
                    value={evaluatorName}
                    onChange={e => setEvaluatorName(e.target.value)}
                    className="w-full px-5 py-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] text-[15px] font-medium text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                  />

                  {/* Questions & Ratings */}
                  {selectedTemplate.questions.map((q, idx) => (
                    <div key={idx} className="p-5 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                      <div className="mb-3">
                        <p className="text-[15px] font-semibold text-black dark:text-white">{idx + 1}. {q.text}</p>
                        {q.category && (
                          <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#0071e3]/10 text-[#0071e3]">{t(CATEGORY_KEYS[q.category]) || q.category}</span>
                        )}
                        {q.hint && <p className="text-[13px] text-gray-500 mt-2 italic">💡 {q.hint}</p>}
                      </div>
                      {/* Star rating */}
                      <div className="flex items-center gap-2 mb-3">
                        {[1, 2, 3, 4, 5].map(s => (
                          <button
                            key={s}
                            onClick={() => updateAnswer(idx, 'score', s)}
                            className="cursor-pointer transition-transform hover:scale-110"
                          >
                            <Star className={`w-6 h-6 ${answers[idx]?.score >= s ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-300 dark:text-gray-600'}`} />
                          </button>
                        ))}
                        {answers[idx]?.score > 0 && (
                          <span className="text-[13px] font-semibold text-[#ff9f0a] ml-2">
                            {t(`rating.${answers[idx].score}`)}
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder={t('scorecard.comment')}
                        value={answers[idx]?.comment || ''}
                        onChange={e => updateAnswer(idx, 'comment', e.target.value)}
                        className="w-full px-4 py-2.5 bg-white dark:bg-[#1c1c1e] rounded-xl text-[14px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none border border-gray-200 dark:border-gray-700 focus:border-[#0071e3]/30 transition-all"
                      />
                    </div>
                  ))}

                  {/* Notes */}
                  <textarea
                    placeholder={t('scorecard.general_notes')}
                    value={evalNotes}
                    onChange={e => setEvalNotes(e.target.value)}
                    rows={3}
                    className="w-full px-5 py-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] text-[15px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all resize-none"
                  />

                  {/* Summary & Submit */}
                  <div className="flex items-center justify-between p-4 rounded-[16px] bg-[#0071e3]/5 border border-[#0071e3]/10">
                    <div>
                      <p className="text-[14px] font-semibold text-[#0071e3]">
                        Ø {t('scorecard.avg_rating')}: {avgScore || '—'} / 5
                      </p>
                      <p className="text-[12px] text-gray-500">
                        {answers.filter(a => a.score > 0).length} {t('common.of')} {answers.length} {t('scorecard.questions')}
                      </p>
                    </div>
                    <button
                      onClick={handleSubmit}
                      disabled={saving || !evaluatorName.trim() || answers.filter(a => a.score > 0).length === 0}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#0071e3] text-white text-[14px] font-semibold hover:bg-[#0077ed] disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {t('scorecard.save')}
                    </button>
                  </div>
                </div>
              )}

              {/* Previous Responses */}
              {responses.length > 0 && (
                <div className="mt-6">
                  <p className="text-[12px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{t('scorecard.previous')} ({responses.length})</p>
                  <div className="space-y-2">
                    {responses.map(r => (
                      <div key={r.id} className="p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[14px] font-semibold text-black dark:text-white">{r.evaluator_name}</p>
                            <p className="text-[12px] text-gray-500">{r.template_title} · {new Date(r.created_at).toLocaleDateString('de-DE')}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-[#ff9f0a] fill-[#ff9f0a]" />
                            <span className="text-[16px] font-bold text-[#ff9f0a]">{r.total_score?.toFixed(1) || '—'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'templates' ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold text-black dark:text-white">{t('scorecard.templates')}</p>
                <button
                  onClick={() => setShowNewTemplate(!showNewTemplate)}
                  className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-black dark:bg-white text-white dark:text-black text-[13px] font-semibold hover:opacity-80 transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> {t('scorecard.new_template')}
                </button>
              </div>

              {showNewTemplate && (
                <div className="p-5 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] space-y-4">
                  <input
                    type="text"
                    placeholder={t('scorecard.template_name')}
                    value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    className="w-full px-4 py-3 bg-white dark:bg-[#1c1c1e] rounded-xl text-[15px] font-medium text-black dark:text-white placeholder:text-gray-400 focus:outline-none border border-gray-200 dark:border-gray-700 focus:border-[#0071e3]/30 transition-all"
                  />
                  {newQuestions.map((q, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <span className="text-[14px] font-bold text-gray-400 mt-3">{idx + 1}.</span>
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          placeholder={t('scorecard.question_label')}
                          value={q.text}
                          onChange={e => setNewQuestions(prev => prev.map((x, i) => i === idx ? { ...x, text: e.target.value } : x))}
                          className="w-full px-4 py-2.5 bg-white dark:bg-[#1c1c1e] rounded-xl text-[14px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none border border-gray-200 dark:border-gray-700 focus:border-[#0071e3]/30 transition-all"
                        />
                        <div className="flex gap-2">
                          <select
                            value={q.category}
                            onChange={e => setNewQuestions(prev => prev.map((x, i) => i === idx ? { ...x, category: e.target.value } : x))}
                            className="px-3 py-2 bg-white dark:bg-[#1c1c1e] rounded-xl text-[13px] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 focus:outline-none appearance-none cursor-pointer"
                          >
                            {CATEGORIES.map(c => (
                              <option key={c} value={c}>{t(CATEGORY_KEYS[c]) || c}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder={t('scorecard.hint_optional')}
                            value={q.hint}
                            onChange={e => setNewQuestions(prev => prev.map((x, i) => i === idx ? { ...x, hint: e.target.value } : x))}
                            className="flex-1 px-3 py-2 bg-white dark:bg-[#1c1c1e] rounded-xl text-[13px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none border border-gray-200 dark:border-gray-700 transition-all"
                          />
                        </div>
                      </div>
                      {newQuestions.length > 1 && (
                        <button onClick={() => setNewQuestions(prev => prev.filter((_, i) => i !== idx))} className="mt-3 text-gray-400 hover:text-[#ff3b30] cursor-pointer transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => setNewQuestions(prev => [...prev, { text: '', category: 'Fachkompetenz', hint: '' }])}
                      className="text-[13px] font-semibold text-[#0071e3] hover:opacity-70 cursor-pointer"
                    >
                      + {t('scorecard.add_question')}
                    </button>
                    <div className="flex-1" />
                    <button onClick={() => setShowNewTemplate(false)} className="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer transition-all">{t('common.cancel')}</button>
                    <button
                      onClick={handleCreateTemplate}
                      disabled={saving || !newTemplateName.trim()}
                      className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#0071e3] text-white text-[13px] font-semibold hover:bg-[#0077ed] disabled:opacity-50 cursor-pointer transition-all"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              )}

              {templates.length === 0 && !showNewTemplate && (
                <div className="text-center py-8">
                  <ClipboardList className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-[15px] text-gray-500">{t('scorecard.no_templates')}</p>
                </div>
              )}

              {templates.map(tpl => (
                <div key={tpl.id} className="p-5 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <p className="text-[15px] font-semibold text-black dark:text-white">{tpl.title}</p>
                      {tpl.ai_generated === 1 && <KiBadge />}
                    </div>
                    <button
                      onClick={async () => { await scorecardsApi.deleteTemplate(tpl.id); loadData() }}
                      className="text-gray-400 hover:text-[#ff3b30] cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {tpl.questions.map((q, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-[12px] font-bold text-gray-400 mt-0.5">{i + 1}.</span>
                        <div>
                          <p className="text-[14px] text-black dark:text-white">{q.text}</p>
                          <span className="text-[11px] text-gray-400">{t(CATEGORY_KEYS[q.category]) || q.category}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'compare' ? (
            <div className="space-y-5">
              {!comparison || comparison.evaluatorCount === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-[15px] text-gray-500">{t('scorecard.no_evaluations')}</p>
                </div>
              ) : (
                <>
                  {/* Overall */}
                  <div className="p-5 rounded-[16px] bg-[#0071e3]/5 border border-[#0071e3]/10">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[14px] font-semibold text-[#0071e3]">{t('scorecard.overall_avg')}</p>
                        <p className="text-[12px] text-gray-500">{comparison.evaluatorCount} {t('scorecard.previous')}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="w-6 h-6 text-[#ff9f0a] fill-[#ff9f0a]" />
                        <span className="text-[28px] font-bold text-[#ff9f0a]">{comparison.overallAverage?.toFixed(1) || '—'}</span>
                        <span className="text-[14px] text-gray-400"> / 5</span>
                      </div>
                    </div>
                  </div>

                  {/* Per-question averages */}
                  {comparison.averages?.length > 0 && (
                    <div>
                      <p className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-3">{t('scorecard.per_question')}</p>
                      <div className="space-y-2">
                        {comparison.averages.map((a, i) => (
                          <div key={i} className="flex items-center justify-between p-3 rounded-[12px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                            <p className="text-[13px] font-medium text-black dark:text-white flex-1 mr-4">{a.question}</p>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="w-20 h-2 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#ff9f0a] transition-all"
                                  style={{ width: `${(a.avgScore / 5) * 100}%` }}
                                />
                              </div>
                              <span className="text-[13px] font-bold text-[#ff9f0a] w-8 text-right">{a.avgScore?.toFixed(1)}</span>
                              <span className="text-[11px] text-gray-400">({a.evaluations}x)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Individual evaluators */}
                  <div>
                    <p className="text-[12px] font-bold text-gray-400 uppercase tracking-wider mb-3">{t('scorecard.individual')}</p>
                    <div className="space-y-2">
                      {comparison.responses?.map(r => (
                        <div key={r.id} className="p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-[14px] font-semibold text-black dark:text-white">{r.evaluator_name}</p>
                              <p className="text-[12px] text-gray-500">{new Date(r.created_at).toLocaleDateString('de-DE')}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Star className="w-4 h-4 text-[#ff9f0a] fill-[#ff9f0a]" />
                              <span className="text-[16px] font-bold text-[#ff9f0a]">{r.total_score?.toFixed(1)}</span>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {r.answers.map((a, i) => (
                              <div key={i} className="flex items-center justify-between text-[13px]">
                                <span className="text-gray-600 dark:text-gray-400 truncate flex-1">{a.question}</span>
                                <div className="flex items-center gap-1 ml-3">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <Star key={s} className={`w-3 h-3 ${a.score >= s ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-300 dark:text-gray-600'}`} />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                          {r.notes && <p className="text-[13px] text-gray-500 mt-2 italic">{r.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
