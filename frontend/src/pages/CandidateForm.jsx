import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, AlertTriangle, Upload, FileText, Sparkles, X, Paperclip } from 'lucide-react'
import { candidatesApi, cvParserApi, uploadsApi } from '../api'
import { Card, Button, Input, Textarea, LoadingSpinner } from '../components/UI'
import { KiDisclaimer, KiBadge } from '../components/KiBadge'
import { useToast } from '../components/Toast'

const emptyCandidate = {
  name: '', email: '', phone: '', location: '',
  experience: '', skills: '', education: '',
  desired_salary: '', availability: '', languages: '',
  certificates: '', drivers_license: '', mobility: '', notes: '',
  status: 'Aktiv', tags: '', source: ''
}

const SOURCE_OPTIONS = ['LinkedIn', 'Xing', 'Indeed', 'Stepstone', 'Empfehlung', 'Karriereseite', 'Messe', 'Initiativ', 'Sonstige']

export default function CandidateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(emptyCandidate)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicates, setDuplicates] = useState([])
  const dupTimer = useRef(null)
  const [parsing, setParsing] = useState(false)
  const [parseSuccess, setParseSuccess] = useState('')
  const [attachedFiles, setAttachedFiles] = useState([])
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (isEdit) {
      candidatesApi.getById(id)
        .then(data => setForm({
          name: data.name || '', email: data.email || '', phone: data.phone || '', location: data.location || '',
          experience: data.experience || '', skills: data.skills || '', education: data.education || '',
          desired_salary: data.desired_salary || '', availability: data.availability || '', languages: data.languages || '',
          certificates: data.certificates || '', drivers_license: data.drivers_license || '', mobility: data.mobility || '', notes: data.notes || '',          status: data.status || 'Aktiv', tags: data.tags || '', source: data.source || '',        }))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [id, isEdit])

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  // AI CV parsing
  const handleCVUpload = async (file) => {
    if (!file) return
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowed.includes(file.type)) {
      setError('Nur PDF und Word-Dateien werden unterstützt')
      return
    }
    setParsing(true)
    setError('')
    setParseSuccess('')
    try {
      const result = await cvParserApi.parse(file)
      if (result.error) {
        setError(result.error)
        return
      }
      const c = result.candidate || result
      // Only fill fields that have actual content from CV
      setForm(prev => {
        const updated = { ...prev }
        const fields = ['name', 'email', 'phone', 'location', 'experience', 'skills', 'education', 'languages', 'certificates', 'drivers_license', 'desired_salary', 'availability']
        for (const f of fields) {
          if (c[f] && c[f].trim()) updated[f] = c[f].trim()
        }
        return updated
      })
      setParseSuccess(`"${file.name}" wurde analysiert – Felder wurden automatisch befüllt`)
      // Also attach the file for upload after save
      setAttachedFiles(prev => [...prev, file])
    } catch (err) {
      setError(err.message || 'CV-Analyse fehlgeschlagen')
    } finally {
      setParsing(false)
    }
  }

  const handleFileDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) handleCVUpload(file)
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) handleCVUpload(file)
    e.target.value = ''
  }

  const removeAttachedFile = (idx) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx))
  }

  // Debounced duplicate check
  useEffect(() => {
    if (dupTimer.current) clearTimeout(dupTimer.current)
    if (!form.name.trim() && !form.email.trim()) { setDuplicates([]); return }
    dupTimer.current = setTimeout(async () => {
      try {
        const res = await candidatesApi.checkDuplicate(form.name, form.email, isEdit ? id : undefined)
        setDuplicates(res.duplicates || [])
      } catch { setDuplicates([]) }
    }, 500)
    return () => clearTimeout(dupTimer.current)
  }, [form.name, form.email, id, isEdit])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      let candidateId = id
      if (isEdit) {
        await candidatesApi.update(id, form)
      } else {
        const created = await candidatesApi.create(form)
        candidateId = created.id
      }
      // Upload attached files
      for (const file of attachedFiles) {
        try {
          await uploadsApi.upload(candidateId, file)
        } catch (uploadErr) {
          console.warn('File upload failed:', uploadErr)
        }
      }
      toast.success(isEdit ? 'Bewerber aktualisiert' : 'Bewerber angelegt')
      navigate('/candidates')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner text="Bewerber wird geladen..." />

  return (
    <div className="fade-in max-w-[800px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <button onClick={() => navigate('/candidates')} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">
            {isEdit ? 'Bewerber bearbeiten' : 'Neuer Bewerber'}
          </h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">
            {isEdit ? 'Daten des Bewerbers aktualisieren' : 'Neuen Bewerber in der Kartei anlegen'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">
          {error}
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="p-6 rounded-[20px] bg-[#ff9f0a]/10 border border-[#ff9f0a]/20 mb-10">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-[#ff9f0a]" />
            <span className="text-[16px] font-semibold text-[#ff9f0a]">Mögliche Duplikate gefunden</span>
          </div>
          <div className="space-y-2">
            {duplicates.map(d => (
              <div key={d.id} className="flex items-center justify-between bg-white/6 dark:bg-[#1c1c1e]/60 dark:bg-[#1c1c1e]/60 rounded-[14px] px-5 py-3">
                <div>
                  <span className="text-[15px] font-semibold text-black dark:text-white">{d.name}</span>
                  {d.email && <span className="text-[14px] text-gray-500 dark:text-gray-400 ml-3">{d.email}</span>}
                  {d.location && <span className="text-[14px] text-gray-400 ml-3">{d.location}</span>}
                </div>
                <span className="text-[12px] font-semibold text-[#ff9f0a] bg-[#ff9f0a]/10 px-3 py-1 rounded-full">
                  {d.matchType === 'email' ? 'Gleiche E-Mail' : 'Gleicher Name'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-[#ff9f0a]/80 mt-3">Du kannst trotzdem fortfahren, falls es sich nicht um ein Duplikat handelt.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* AI CV Upload Zone */}
        {!isEdit && (
          <Card className="p-12 border-2 border-dashed border-[#0071e3]/20 bg-gradient-to-br from-blue-50/50 to-purple-50/30 relative overflow-hidden">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-[#0071e3]/10 rounded-2xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#0071e3]" />
              </div>
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-black dark:text-white">KI-Bewerbungsanalyse</h2>
                <p className="text-[14px] text-gray-500 dark:text-gray-400">Lade einen Lebenslauf hoch — die KI füllt die Felder automatisch aus</p>
              </div>
            </div>

            {parsing ? (
              <div className="flex flex-col items-center py-10 gap-4">
                <div className="w-12 h-12 border-[3px] border-[#0071e3]/20 border-t-[#0071e3] rounded-full animate-spin" />
                <p className="text-[16px] font-medium text-[#0071e3]">KI analysiert den Lebenslauf...</p>
                <p className="text-[14px] text-gray-400">Das kann je nach Dateigröße 10–30 Sekunden dauern</p>
              </div>
            ) : (
              <div
                onDrop={handleFileDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center py-10 gap-4 cursor-pointer rounded-[20px] border-2 border-dashed border-gray-300 hover:border-[#0071e3]/40 hover:bg-[#0071e3]/5 transition-all"
              >
                <div className="w-16 h-16 bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm flex items-center justify-center border border-gray-200 dark:border-gray-700">
                  <Upload className="w-7 h-7 text-[#0071e3]" />
                </div>
                <div className="text-center">
                  <p className="text-[16px] font-semibold text-black dark:text-white">PDF oder Word-Datei hierhin ziehen</p>
                  <p className="text-[14px] text-gray-400 mt-1">oder klicken zum Auswählen</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {parseSuccess && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 bg-[#34c759]/10 text-[#34c759] text-[14px] font-medium px-5 py-3.5 rounded-2xl border border-green-100">
                  <Sparkles className="w-4 h-4 flex-shrink-0" />
                  {parseSuccess}
                  <KiBadge label="KI-extrahiert" className="ml-auto" />
                </div>
                <KiDisclaimer feature="cv-parser" />
              </div>
            )}

            {/* Attached files list */}
            {attachedFiles.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Angehängte Dateien</p>
                {attachedFiles.map((f, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white dark:bg-[#1c1c1e] rounded-2xl px-5 py-3 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-[#0071e3]" />
                      <span className="text-[14px] font-medium text-black dark:text-white">{f.name}</span>
                      <span className="text-[12px] text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button type="button" onClick={() => removeAttachedFile(idx)} className="p-1 text-gray-400 hover:text-[#ff3b30] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">Persönliche Daten</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label="Name *" placeholder="Max Mustermann" value={form.name} onChange={handleChange('name')} required />
            <Input label="E-Mail" type="email" placeholder="max@example.com" value={form.email} onChange={handleChange('email')} />
            <Input label="Telefon" placeholder="+49 171 1234567" value={form.phone} onChange={handleChange('phone')} />
            <Input label="Wohnort" placeholder="Berlin" value={form.location} onChange={handleChange('location')} />
          </div>
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">Berufliches Profil</h2>
          <div className="space-y-8">
            <Textarea 
              label="Berufserfahrung" 
              placeholder="5 Jahre Software-Entwicklung bei Firma XY, davon 2 Jahre als Teamlead..."
              value={form.experience} 
              onChange={handleChange('experience')}
              rows={4}
            />
            <Input 
              label="Skills / Kompetenzen" 
              placeholder="JavaScript, React, Node.js, Python (kommagetrennt)"
              value={form.skills} 
              onChange={handleChange('skills')} 
            />
            <Input 
              label="Ausbildung" 
              placeholder="B.Sc. Informatik, Universität Berlin"
              value={form.education} 
              onChange={handleChange('education')} 
            />
            <Input 
              label="Zertifikate" 
              placeholder="AWS Solutions Architect, PMP, Scrum Master"
              value={form.certificates} 
              onChange={handleChange('certificates')} 
            />
          </div>
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">Erweiterte Informationen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label="Sprachen" placeholder="Deutsch (C2), Englisch (C1)" value={form.languages} onChange={handleChange('languages')} />
            <Input label="Führerschein" placeholder="B, BE" value={form.drivers_license} onChange={handleChange('drivers_license')} />
            <Input label="Mobilität" placeholder="Bundesweit, Remote bevorzugt" value={form.mobility} onChange={handleChange('mobility')} />
            <Input label="Gehaltsvorstellung" placeholder="55.000 - 65.000 € p.a." value={form.desired_salary} onChange={handleChange('desired_salary')} />
            <Input label="Verfügbarkeit" placeholder="Ab sofort / 3 Monate Kündigungsfrist" value={form.availability} onChange={handleChange('availability')} />
          </div>
        </Card>

        <Card className="p-12">
          <Textarea 
            label="Notizen" 
            placeholder="Interne Notizen zum Bewerber..."
            value={form.notes} 
            onChange={handleChange('notes')}
            rows={3}
          />
        </Card>

        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">Weitere Einstellungen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">Status</label>
              <select
                value={form.status}
                onChange={handleChange('status')}
                className="w-full px-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white appearance-none cursor-pointer
                  focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
              >
                <option value="Aktiv">Aktiv</option>
                <option value="Passiv">Passiv</option>
                <option value="In Prozess">In Prozess</option>
                <option value="Blacklist">Blacklist</option>
              </select>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">Quelle</label>
              <select
                value={form.source}
                onChange={handleChange('source')}
                className="w-full px-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white appearance-none cursor-pointer
                  focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
              >
                <option value="">– Bitte wählen –</option>
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Input
              label="Tags"
              placeholder="Top-Kandidat, Remote, Senior (kommagetrennt)"
              value={form.tags}
              onChange={handleChange('tags')}
            />
          </div>
        </Card>

        <div className="flex items-center justify-end gap-5 pt-6 pb-12">
          <Button variant="secondary" size="lg" type="button" onClick={() => navigate('/candidates')}>
            Abbrechen
          </Button>
          <Button variant="dark" type="submit" size="lg" disabled={saving || !form.name.trim()}>
            <Save className="w-5 h-5" />
            {saving ? 'Wird gespeichert...' : (isEdit ? 'Aktualisieren' : 'Anlegen')}
          </Button>
        </div>
      </form>
    </div>
  )
}
