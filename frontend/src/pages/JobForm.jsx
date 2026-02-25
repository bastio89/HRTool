import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Sparkles, Loader2 } from 'lucide-react'
import { jobsApi } from '../api'
import { Card, Button, Input, Textarea, LoadingSpinner } from '../components/UI'

const JOB_TYPES = ['Vollzeit', 'Teilzeit', 'Freelance', 'Praktikum', 'Werkstudent']
const JOB_STATUSES = ['Offen', 'Besetzt', 'Pausiert', 'Archiviert']

const emptyJob = {
  title: '', description: '', requirements: '',
  location: '', type: 'Vollzeit', status: 'Offen', url: ''
}

export default function JobForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(emptyJob)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [aiKeywords, setAiKeywords] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (isEdit) {
      jobsApi.getById(id)
        .then(data => setForm({
          title: data.title || '',
          description: data.description || '',
          requirements: data.requirements || '',
          location: data.location || '',
          type: data.type || 'Vollzeit',
          status: data.status || 'Offen',
          url: data.url || '',
        }))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [id, isEdit])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (isEdit) {
        await jobsApi.update(id, form)
      } else {
        await jobsApi.create(form)
      }
      navigate('/jobs')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async () => {
    if (!form.title.trim() && !aiKeywords.trim()) {
      setError('Bitte zuerst einen Jobtitel oder Stichpunkte eingeben.')
      return
    }
    setError('')
    setGenerating(true)
    try {
      const result = await jobsApi.generateDescription({
        title: form.title,
        keywords: aiKeywords,
        type: form.type,
        location: form.location
      })
      setForm(f => ({
        ...f,
        description: result.description || f.description,
        requirements: result.requirements || f.requirements
      }))
      setAiModel(result.model || '')
    } catch (err) {
      setError(err.message || 'KI-Generierung fehlgeschlagen')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <LoadingSpinner text="Stelle wird geladen..." />

  return (
    <div className="fade-in max-w-[800px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <button
          onClick={() => navigate('/jobs')}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">
            {isEdit ? 'Stelle bearbeiten' : 'Neue Stelle anlegen'}
          </h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">
            {isEdit ? 'Details der Stelle aktualisieren' : 'Neue Stelle in der Stellenverwaltung anlegen'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10">
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">Allgemeine Angaben</h2>
          <div className="space-y-8">
            <Input
              label="Jobtitel *"
              placeholder="z.B. Senior Frontend Developer (m/w/d)"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
            />
            <Input
              label="Standort"
              placeholder="München / Remote / Hybrid"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            />
            <Input
              label="Link zur Stelle"
              placeholder="https://karriere.unternehmen.de/stelle/..."
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              type="url"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="flex flex-col gap-3">
                <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 ml-1">Anstellungsart</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white appearance-none cursor-pointer
                    focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                >
                  {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 ml-1">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white appearance-none cursor-pointer
                    focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                >
                  {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 sm:p-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">Details</h2>
            {aiModel && (
              <span className="text-[12px] font-medium text-gray-400 dark:text-gray-500">Modell: {aiModel}</span>
            )}
          </div>

          {/* KI-Generierung */}
          <div className="mb-8 p-5 sm:p-6 rounded-[20px] bg-gradient-to-br from-[#5e5ce6]/5 to-[#0071e3]/5 dark:from-[#5e5ce6]/10 dark:to-[#0071e3]/10 border border-[#5e5ce6]/10 dark:border-[#5e5ce6]/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-[#5e5ce6]/10 flex items-center justify-center">
                <Sparkles className="w-4.5 h-4.5 text-[#5e5ce6]" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-black dark:text-white">KI-Stellenbeschreibung</p>
                <p className="text-[13px] text-gray-500 dark:text-gray-400">Stichpunkte eingeben — KI generiert Beschreibung & Anforderungen</p>
              </div>
            </div>
            <textarea
              placeholder="z.B. React, 3+ Jahre Erfahrung, agiles Team, Remote möglich, CI/CD, Code-Reviews, Mentoring ..."
              value={aiKeywords}
              onChange={e => setAiKeywords(e.target.value)}
              rows={3}
              className="w-full px-5 py-4 bg-white/80 dark:bg-[#1c1c1e]/80 rounded-[16px] text-[15px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-[#5e5ce6]/10 border border-transparent focus:border-[#5e5ce6]/30 transition-all resize-none"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || (!form.title.trim() && !aiKeywords.trim())}
              className="mt-4 flex items-center gap-2.5 px-6 py-3 rounded-full bg-[#5e5ce6] text-white text-[15px] font-semibold hover:bg-[#4b49b6] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  KI generiert...
                </>
              ) : (
                <>
                  <Sparkles className="w-4.5 h-4.5" />
                  KI generieren
                </>
              )}
            </button>
          </div>

          <div className="space-y-8">
            <Textarea
              label="Stellenbeschreibung"
              placeholder="Was sind die Hauptaufgaben und Verantwortlichkeiten dieser Rolle?"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={8}
            />
            <Textarea
              label="Anforderungen"
              placeholder="Welche Skills, Erfahrungen und Qualifikationen werden erwartet?"
              value={form.requirements}
              onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))}
              rows={8}
            />
          </div>
        </Card>

        <div className="flex items-center justify-end gap-5 pt-6 pb-12">
          <Button variant="secondary" size="lg" type="button" onClick={() => navigate('/jobs')}>
            Abbrechen
          </Button>
          <Button variant="dark" type="submit" size="lg" disabled={saving || !form.title.trim()}>
            <Save className="w-5 h-5" />
            {saving ? 'Wird gespeichert...' : (isEdit ? 'Aktualisieren' : 'Anlegen')}
          </Button>
        </div>
      </form>
    </div>
  )
}
