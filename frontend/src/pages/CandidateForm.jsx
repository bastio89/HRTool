import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, AlertTriangle, Upload, FileText, Sparkles, X, Paperclip, Tag, Plus, Trash2, Linkedin, Github, Globe, DollarSign, Shield, Calendar, Building2 } from 'lucide-react'
import { candidatesApi, cvParserApi, uploadsApi, candidateDetailsApi } from '../api'
import { Card, Button, Input, Textarea, LoadingSpinner } from '../components/UI'
import { KiDisclaimer, KiBadge } from '../components/KiBadge'
import { useToast } from '../components/Toast'
import { useI18n } from '../I18nContext'

const SUGGESTED_TAGS = ['Top-Kandidat', 'Senior', 'Junior', 'Freelancer', 'Remote', 'Sofort verfügbar', 'Führungskraft', 'Teilzeit', 'Werkstudent', 'Intern']

const emptyCandidate = {
  name: '', email: '', phone: '', location: '',
  experience: '', skills: '', education: '',
  desired_salary: '', availability: '', languages: '',
  certificates: '', drivers_license: '', mobility: '', notes: '',
  status: 'Aktiv', tags: '', source: '',
  // New fields
  linkedin_url: '', xing_url: '', github_url: '', portfolio_url: '',
  salary_min: '', salary_max: '', salary_currency: 'EUR', salary_interval: 'yearly',
  notice_period: '', available_from: '',
  gdpr_consent_date: '', gdpr_consent_type: '', gdpr_consent_expires: '',
  nationality: '', work_permit: '', work_permit_until: '',
  referrer_name: '', referrer_email: '',
  current_employer: '', current_position: '',
}

const SOURCE_OPTIONS = ['LinkedIn', 'Xing', 'Indeed', 'Stepstone', 'Empfehlung', 'Karriereseite', 'Messe', 'Initiativ', 'Sonstige']
const GDPR_TYPES = ['Schriftlich', 'E-Mail', 'Online-Formular', 'Mündlich']
const WORK_PERMIT_OPTIONS = ['EU-Bürger', 'Unbefristete Arbeitserlaubnis', 'Befristete Arbeitserlaubnis', 'Visum erforderlich', 'Blue Card', 'Keine']
const NOTICE_PERIOD_OPTIONS = ['Sofort verfügbar', '2 Wochen', '1 Monat', '2 Monate', '3 Monate', '6 Monate']
const emptyWorkEntry = { employer: '', position: '', from_date: '', to_date: '', is_current: false, description: '', location: '' }
const emptyEduEntry = { institution: '', degree: '', field_of_study: '', from_date: '', to_date: '', description: '' }

export default function CandidateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useI18n()
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
  // New state
  const [workHistory, setWorkHistory] = useState([])
  const [educationList, setEducationList] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [customValues, setCustomValues] = useState({})

  useEffect(() => {
    // Load custom field definitions
    candidateDetailsApi.getCustomFieldDefinitions().then(r => setCustomFields(r.data || [])).catch(() => {})
    if (isEdit) {
      Promise.all([
        candidatesApi.getById(id),
        candidateDetailsApi.getWorkHistory(id).catch(() => ({ data: [] })),
        candidateDetailsApi.getEducation(id).catch(() => ({ data: [] })),
        candidateDetailsApi.getCustomValues(id).catch(() => ({ data: [] })),
      ]).then(([data, whRes, eduRes, cvRes]) => {
        const fields = Object.keys(emptyCandidate)
        const formData = {}
        for (const f of fields) formData[f] = data[f] ?? emptyCandidate[f]
        setForm(formData)
        setWorkHistory(whRes.data || [])
        setEducationList(eduRes.data || [])
        const cvMap = {}
        for (const cv of (cvRes.data || [])) cvMap[cv.field_id] = cv.value || ''
        setCustomValues(cvMap)
      }).catch(err => setError(err.message)).finally(() => setLoading(false))
    }
  }, [id, isEdit])

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  // AI CV parsing
  const handleCVUpload = async (file) => {
    if (!file) return
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowed.includes(file.type)) { setError(t('form.only_pdf_word')); return }
    setParsing(true); setError(''); setParseSuccess('')
    try {
      const result = await cvParserApi.parse(file)
      if (result.error) { setError(result.error); return }
      const c = result.candidate || result
      setForm(prev => {
        const updated = { ...prev }
        const fields = ['name', 'email', 'phone', 'location', 'experience', 'skills', 'education', 'languages',
          'certificates', 'drivers_license', 'desired_salary', 'availability',
          'linkedin_url', 'xing_url', 'github_url', 'portfolio_url',
          'nationality', 'current_employer', 'current_position', 'notice_period']
        for (const f of fields) { if (c[f] && String(c[f]).trim()) updated[f] = String(c[f]).trim() }
        if (c.salary_min) updated.salary_min = c.salary_min
        if (c.salary_max) updated.salary_max = c.salary_max
        return updated
      })
      // Structured work history from AI
      if (Array.isArray(c.work_history) && c.work_history.length > 0) {
        setWorkHistory(c.work_history.map(w => ({ ...emptyWorkEntry, ...w })))
      }
      if (Array.isArray(c.education_history) && c.education_history.length > 0) {
        setEducationList(c.education_history.map(e => ({ ...emptyEduEntry, ...e })))
      }
      setParseSuccess(t('form.cv_success').replace('{file}', file.name))
      setAttachedFiles(prev => [...prev, file])
    } catch (err) { setError(err.message || t('form.cv_failed')) }
    finally { setParsing(false) }
  }

  const handleFileDrop = (e) => { e.preventDefault(); const file = e.dataTransfer?.files?.[0]; if (file) handleCVUpload(file) }
  const handleFileSelect = (e) => { const file = e.target.files?.[0]; if (file) handleCVUpload(file); e.target.value = '' }
  const removeAttachedFile = (idx) => { setAttachedFiles(prev => prev.filter((_, i) => i !== idx)) }

  // Debounced duplicate check
  useEffect(() => {
    if (dupTimer.current) clearTimeout(dupTimer.current)
    if (!form.name.trim() && !form.email.trim()) { setDuplicates([]); return }
    dupTimer.current = setTimeout(async () => {
      try { const res = await candidatesApi.checkDuplicate(form.name, form.email, isEdit ? id : undefined); setDuplicates(res.duplicates || []) }
      catch { setDuplicates([]) }
    }, 500)
    return () => clearTimeout(dupTimer.current)
  }, [form.name, form.email, id, isEdit])

  // Work history helpers
  const addWorkEntry = () => setWorkHistory(prev => [...prev, { ...emptyWorkEntry }])
  const removeWorkEntry = (idx) => setWorkHistory(prev => prev.filter((_, i) => i !== idx))
  const updateWorkEntry = (idx, field, value) => setWorkHistory(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w))

  // Education helpers
  const addEduEntry = () => setEducationList(prev => [...prev, { ...emptyEduEntry }])
  const removeEduEntry = (idx) => setEducationList(prev => prev.filter((_, i) => i !== idx))
  const updateEduEntry = (idx, field, value) => setEducationList(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e))

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setSaving(true)
    try {
      let candidateId = id
      if (isEdit) { await candidatesApi.update(id, form) }
      else { const created = await candidatesApi.create(form); candidateId = created.id }
      // Upload attached files
      for (const file of attachedFiles) { try { await uploadsApi.upload(candidateId, file) } catch (ue) { console.warn('File upload failed:', ue) } }
      // Save work history
      if (workHistory.length > 0) {
        try { await candidateDetailsApi.bulkWorkHistory(candidateId, workHistory) } catch (e) { console.warn('Work history save failed:', e) }
      }
      // Save education
      if (educationList.length > 0) {
        try { await candidateDetailsApi.bulkEducation(candidateId, educationList) } catch (e) { console.warn('Education save failed:', e) }
      }
      // Save custom values
      if (Object.keys(customValues).length > 0) {
        try { await candidateDetailsApi.saveCustomValues(candidateId, customValues) } catch (e) { console.warn('Custom values save failed:', e) }
      }
      toast.success(isEdit ? t('candidates.updated') : t('candidates.created'))
      navigate('/candidates')
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner text={t('candidates.candidate_loading')} />

  const selectClass = "w-full px-5 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white appearance-none cursor-pointer focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 sm:gap-8 mb-8 sm:mb-14">
        <button onClick={() => navigate('/candidates')} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div>
          <h1 className="text-[24px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{isEdit ? t('candidates.edit') : t('candidates.new')}</h1>
          <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2">{isEdit ? t('candidates.edit_desc') : t('candidates.create_desc')}</p>
        </div>
      </div>

      {error && <div className="p-6 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[16px] font-medium mb-10">{error}</div>}

      {duplicates.length > 0 && (
        <div className="p-6 rounded-[20px] bg-[#ff9f0a]/10 border border-[#ff9f0a]/20 mb-10">
          <div className="flex items-center gap-3 mb-3"><AlertTriangle className="w-5 h-5 text-[#ff9f0a]" /><span className="text-[16px] font-semibold text-[#ff9f0a]">{t('form.duplicates_found')}</span></div>
          <div className="space-y-2">
            {duplicates.map(d => (
              <div key={d.id} className="flex items-center justify-between bg-white/6 dark:bg-[#1c1c1e]/60 rounded-[14px] px-5 py-3">
                <div><span className="text-[15px] font-semibold text-black dark:text-white">{d.name}</span>{d.email && <span className="text-[14px] text-gray-500 dark:text-gray-400 ml-3">{d.email}</span>}{d.location && <span className="text-[14px] text-gray-400 ml-3">{d.location}</span>}</div>
                <span className="text-[12px] font-semibold text-[#ff9f0a] bg-[#ff9f0a]/10 px-3 py-1 rounded-full">{d.matchType === 'email' ? t('form.duplicate_email') : t('form.duplicate_name')}</span>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-[#ff9f0a]/80 mt-3">{t('form.duplicate_hint')}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* AI CV Upload Zone */}
        {!isEdit && (
          <Card className="p-12 border-2 border-dashed border-[#0071e3]/20 bg-gradient-to-br from-blue-50/50 to-purple-50/30 relative overflow-hidden">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-[#0071e3]/10 rounded-2xl flex items-center justify-center"><Sparkles className="w-5 h-5 text-[#0071e3]" /></div>
              <div><h2 className="text-[20px] font-semibold tracking-tight text-black dark:text-white">{t('cv.title')}</h2><p className="text-[14px] text-gray-500 dark:text-gray-400">{t('cv.desc')}</p></div>
            </div>
            {parsing ? (
              <div className="flex flex-col items-center py-10 gap-4"><div className="w-12 h-12 border-[3px] border-[#0071e3]/20 border-t-[#0071e3] rounded-full animate-spin" /><p className="text-[16px] font-medium text-[#0071e3]">{t('cv.analyzing')}</p><p className="text-[14px] text-gray-400">{t('cv.analyzing_time')}</p></div>
            ) : (
              <div onDrop={handleFileDrop} onDragOver={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center py-10 gap-4 cursor-pointer rounded-[20px] border-2 border-dashed border-gray-300 hover:border-[#0071e3]/40 hover:bg-[#0071e3]/5 transition-all">
                <div className="w-16 h-16 bg-white dark:bg-[#1c1c1e] rounded-[20px] shadow-sm flex items-center justify-center border border-gray-200 dark:border-gray-700"><Upload className="w-7 h-7 text-[#0071e3]" /></div>
                <div className="text-center"><p className="text-[16px] font-semibold text-black dark:text-white">{t('cv.drop_hint')}</p><p className="text-[14px] text-gray-400 mt-1">{t('cv.click_hint')}</p></div>
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" onChange={handleFileSelect} className="hidden" />
              </div>
            )}
            {parseSuccess && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 bg-[#34c759]/10 text-[#34c759] text-[14px] font-medium px-5 py-3.5 rounded-2xl border border-green-100"><Sparkles className="w-4 h-4 flex-shrink-0" />{parseSuccess}<KiBadge label="KI-extrahiert" className="ml-auto" /></div>
                <KiDisclaimer feature="cv-parser" />
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('cv.attached_files')}</p>
                {attachedFiles.map((f, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white dark:bg-[#1c1c1e] rounded-2xl px-5 py-3 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3"><FileText className="w-4 h-4 text-[#0071e3]" /><span className="text-[14px] font-medium text-black dark:text-white">{f.name}</span><span className="text-[12px] text-gray-400">{(f.size / 1024).toFixed(0)} KB</span></div>
                    <button type="button" onClick={() => removeAttachedFile(idx)} className="p-1 text-gray-400 hover:text-[#ff3b30] transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Personal Data */}
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">{t('form.personal')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label={t('form.name') + ' *'} placeholder="Max Mustermann" value={form.name} onChange={handleChange('name')} required />
            <Input label={t('form.email')} type="email" placeholder="max@example.com" value={form.email} onChange={handleChange('email')} />
            <Input label={t('form.phone')} placeholder="+49 171 1234567" value={form.phone} onChange={handleChange('phone')} />
            <Input label={t('form.location')} placeholder="Berlin" value={form.location} onChange={handleChange('location')} />
            <Input label={t('form.nationality')} placeholder="Deutsch" value={form.nationality} onChange={handleChange('nationality')} />
            <Input label={t('form.current_employer')} placeholder="Firma GmbH" value={form.current_employer} onChange={handleChange('current_employer')} />
            <Input label={t('form.current_position')} placeholder="Senior Developer" value={form.current_position} onChange={handleChange('current_position')} />
          </div>
        </Card>

        {/* Social Profiles */}
        <Card className="p-12">
          <div className="flex items-center gap-3 mb-8">
            <Globe className="w-5 h-5 text-[#0071e3]" />
            <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.social_profiles')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label={t('form.linkedin')} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={handleChange('linkedin_url')} />
            <Input label={t('form.xing')} placeholder="https://xing.com/profile/..." value={form.xing_url} onChange={handleChange('xing_url')} />
            <Input label={t('form.github')} placeholder="https://github.com/..." value={form.github_url} onChange={handleChange('github_url')} />
            <Input label={t('form.portfolio')} placeholder="https://mein-portfolio.de" value={form.portfolio_url} onChange={handleChange('portfolio_url')} />
          </div>
        </Card>

        {/* Professional Profile */}
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">{t('form.professional')}</h2>
          <div className="space-y-8">
            <Textarea label={t('form.experience')} placeholder="5 Jahre Software-Entwicklung bei Firma XY, davon 2 Jahre als Teamlead..." value={form.experience} onChange={handleChange('experience')} rows={4} />
            <Input label={t('form.skills')} placeholder="JavaScript, React, Node.js, Python (kommagetrennt)" value={form.skills} onChange={handleChange('skills')} />
            <Input label={t('form.education')} placeholder="B.Sc. Informatik, Universität Berlin" value={form.education} onChange={handleChange('education')} />
            <Input label={t('form.certificates')} placeholder="AWS Solutions Architect, PMP, Scrum Master" value={form.certificates} onChange={handleChange('certificates')} />
          </div>
        </Card>

        {/* Structured Work History */}
        <Card className="p-12">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3"><Building2 className="w-5 h-5 text-[#ff9f0a]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.work_history')}</h2></div>
            <button type="button" onClick={addWorkEntry} className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#ff9f0a]/10 text-[#ff9f0a] text-[14px] font-semibold hover:bg-[#ff9f0a]/20 transition-colors cursor-pointer"><Plus className="w-4 h-4" />{t('form.add_entry')}</button>
          </div>
          {workHistory.length === 0 ? (
            <p className="text-center text-gray-400 py-8">{t('form.no_work_history')}</p>
          ) : (
            <div className="space-y-6">
              {workHistory.map((w, idx) => (
                <div key={idx} className="p-6 rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] relative group">
                  <button type="button" onClick={() => removeWorkEntry(idx)} className="absolute top-4 right-4 w-8 h-8 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"><Trash2 className="w-4 h-4 text-[#ff3b30]" /></button>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input label={t('form.employer')} placeholder="Firma GmbH" value={w.employer} onChange={(e) => updateWorkEntry(idx, 'employer', e.target.value)} />
                    <Input label={t('form.position')} placeholder="Senior Developer" value={w.position} onChange={(e) => updateWorkEntry(idx, 'position', e.target.value)} />
                    <Input label={t('form.from_date')} type="month" value={w.from_date} onChange={(e) => updateWorkEntry(idx, 'from_date', e.target.value)} />
                    {!w.is_current && <Input label={t('form.to_date')} type="month" value={w.to_date} onChange={(e) => updateWorkEntry(idx, 'to_date', e.target.value)} />}
                    <Input label={t('form.work_location')} placeholder="Berlin" value={w.location} onChange={(e) => updateWorkEntry(idx, 'location', e.target.value)} />
                    <div className="flex items-center gap-3 self-end pb-2">
                      <input type="checkbox" checked={w.is_current} onChange={(e) => updateWorkEntry(idx, 'is_current', e.target.checked)} className="w-5 h-5 rounded accent-[#34c759]" />
                      <label className="text-[15px] font-medium text-gray-600 dark:text-gray-400">{t('form.is_current')}</label>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Textarea label={t('form.description')} placeholder={t('form.work_desc_placeholder')} value={w.description} onChange={(e) => updateWorkEntry(idx, 'description', e.target.value)} rows={2} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Structured Education */}
        <Card className="p-12">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3"><Shield className="w-5 h-5 text-[#8b5cf6]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.education_history')}</h2></div>
            <button type="button" onClick={addEduEntry} className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6] text-[14px] font-semibold hover:bg-[#8b5cf6]/20 transition-colors cursor-pointer"><Plus className="w-4 h-4" />{t('form.add_entry')}</button>
          </div>
          {educationList.length === 0 ? (
            <p className="text-center text-gray-400 py-8">{t('form.no_education')}</p>
          ) : (
            <div className="space-y-6">
              {educationList.map((e, idx) => (
                <div key={idx} className="p-6 rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e] relative group">
                  <button type="button" onClick={() => removeEduEntry(idx)} className="absolute top-4 right-4 w-8 h-8 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"><Trash2 className="w-4 h-4 text-[#ff3b30]" /></button>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input label={t('form.institution')} placeholder="Universität Berlin" value={e.institution} onChange={(ev) => updateEduEntry(idx, 'institution', ev.target.value)} />
                    <Input label={t('form.degree')} placeholder="B.Sc. Informatik" value={e.degree} onChange={(ev) => updateEduEntry(idx, 'degree', ev.target.value)} />
                    <Input label={t('form.field_of_study')} placeholder="Informatik" value={e.field_of_study} onChange={(ev) => updateEduEntry(idx, 'field_of_study', ev.target.value)} />
                    <Input label={t('form.from_date')} type="month" value={e.from_date} onChange={(ev) => updateEduEntry(idx, 'from_date', ev.target.value)} />
                    <Input label={t('form.to_date')} type="month" value={e.to_date} onChange={(ev) => updateEduEntry(idx, 'to_date', ev.target.value)} />
                  </div>
                  <div className="mt-4">
                    <Textarea label={t('form.description')} placeholder={t('form.edu_desc_placeholder')} value={e.description} onChange={(ev) => updateEduEntry(idx, 'description', ev.target.value)} rows={2} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Extended Info */}
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">{t('form.extended')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Input label={t('form.languages')} placeholder="Deutsch (C2), Englisch (C1)" value={form.languages} onChange={handleChange('languages')} />
            <Input label={t('form.drivers_license')} placeholder="B, BE" value={form.drivers_license} onChange={handleChange('drivers_license')} />
            <Input label={t('form.mobility')} placeholder="Bundesweit, Remote bevorzugt" value={form.mobility} onChange={handleChange('mobility')} />
          </div>
        </Card>

        {/* Salary Structure */}
        <Card className="p-12">
          <div className="flex items-center gap-3 mb-8"><DollarSign className="w-5 h-5 text-[#34c759]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.salary_structure')}</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <Input label={t('form.salary_min')} type="number" placeholder="50000" value={form.salary_min} onChange={handleChange('salary_min')} />
            <Input label={t('form.salary_max')} type="number" placeholder="70000" value={form.salary_max} onChange={handleChange('salary_max')} />
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.salary_currency')}</label>
              <select value={form.salary_currency} onChange={handleChange('salary_currency')} className={selectClass}>
                <option value="EUR">EUR (€)</option><option value="USD">USD ($)</option><option value="GBP">GBP (£)</option><option value="CHF">CHF</option>
              </select>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.salary_interval')}</label>
              <select value={form.salary_interval} onChange={handleChange('salary_interval')} className={selectClass}>
                <option value="yearly">{t('form.yearly')}</option><option value="monthly">{t('form.monthly')}</option><option value="hourly">{t('form.hourly')}</option>
              </select>
            </div>
          </div>
          <div className="mt-6">
            <Input label={t('form.salary') + ' (Freitext)'} placeholder="55.000 - 65.000 € p.a." value={form.desired_salary} onChange={handleChange('desired_salary')} />
          </div>
        </Card>

        {/* Availability & Notice Period */}
        <Card className="p-12">
          <div className="flex items-center gap-3 mb-8"><Calendar className="w-5 h-5 text-[#0071e3]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.availability_structure')}</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.notice_period')}</label>
              <select value={form.notice_period} onChange={handleChange('notice_period')} className={selectClass}>
                <option value="">{t('form.select')}</option>
                {NOTICE_PERIOD_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <Input label={t('form.available_from')} type="date" value={form.available_from} onChange={handleChange('available_from')} />
            <Input label={t('form.availability') + ' (Freitext)'} placeholder="Ab sofort" value={form.availability} onChange={handleChange('availability')} />
          </div>
        </Card>

        {/* Work Permit */}
        <Card className="p-12">
          <div className="flex items-center gap-3 mb-8"><Shield className="w-5 h-5 text-[#ff9f0a]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.work_permit_section')}</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.work_permit')}</label>
              <select value={form.work_permit} onChange={handleChange('work_permit')} className={selectClass}>
                <option value="">{t('form.select')}</option>
                {WORK_PERMIT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <Input label={t('form.work_permit_until')} type="date" value={form.work_permit_until} onChange={handleChange('work_permit_until')} />
            <Input label={t('form.nationality')} placeholder="Deutsch" value={form.nationality} onChange={handleChange('nationality')} />
          </div>
        </Card>

        {/* GDPR Consent */}
        <Card className="p-12">
          <div className="flex items-center gap-3 mb-4"><Shield className="w-5 h-5 text-[#34c759]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.gdpr_section')}</h2></div>
          <p className="text-[14px] text-gray-400 mb-8">{t('form.gdpr_hint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Input label={t('form.gdpr_consent_date')} type="date" value={form.gdpr_consent_date} onChange={handleChange('gdpr_consent_date')} />
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.gdpr_consent_type')}</label>
              <select value={form.gdpr_consent_type} onChange={handleChange('gdpr_consent_type')} className={selectClass}>
                <option value="">{t('form.select')}</option>
                {GDPR_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <Input label={t('form.gdpr_consent_expires')} type="date" value={form.gdpr_consent_expires} onChange={handleChange('gdpr_consent_expires')} />
          </div>
        </Card>

        {/* Referral - only show when source is Empfehlung */}
        {form.source === 'Empfehlung' && (
          <Card className="p-12">
            <div className="flex items-center gap-3 mb-8"><Building2 className="w-5 h-5 text-[#8b5cf6]" /><h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">{t('form.referral_section')}</h2></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Input label={t('form.referrer_name')} placeholder="Vorname Nachname" value={form.referrer_name} onChange={handleChange('referrer_name')} />
              <Input label={t('form.referrer_email')} type="email" placeholder="empfehler@firma.de" value={form.referrer_email} onChange={handleChange('referrer_email')} />
            </div>
          </Card>
        )}

        {/* Custom Fields */}
        {customFields.length > 0 && (
          <Card className="p-12">
            <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">{t('form.custom_fields')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {customFields.map(cf => (
                <div key={cf.id}>
                  {cf.field_type === 'text' && <Input label={cf.name} value={customValues[cf.id] || ''} onChange={(e) => setCustomValues(prev => ({ ...prev, [cf.id]: e.target.value }))} />}
                  {cf.field_type === 'dropdown' && (
                    <div className="flex flex-col gap-3">
                      <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{cf.name}</label>
                      <select value={customValues[cf.id] || ''} onChange={(e) => setCustomValues(prev => ({ ...prev, [cf.id]: e.target.value }))} className={selectClass}>
                        <option value="">{t('form.select')}</option>
                        {(cf.options ? JSON.parse(cf.options) : []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  {cf.field_type === 'checkbox' && (
                    <div className="flex items-center gap-3 pt-8">
                      <input type="checkbox" checked={customValues[cf.id] === 'true'} onChange={(e) => setCustomValues(prev => ({ ...prev, [cf.id]: e.target.checked ? 'true' : 'false' }))} className="w-5 h-5 rounded accent-[#0071e3]" />
                      <label className="text-[15px] font-medium text-gray-600 dark:text-gray-400">{cf.name}</label>
                    </div>
                  )}
                  {cf.field_type === 'date' && <Input label={cf.name} type="date" value={customValues[cf.id] || ''} onChange={(e) => setCustomValues(prev => ({ ...prev, [cf.id]: e.target.value }))} />}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Notes */}
        <Card className="p-12">
          <Textarea label={t('form.notes')} placeholder={t('form.notes_placeholder')} value={form.notes} onChange={handleChange('notes')} rows={3} />
        </Card>

        {/* Settings (Status / Source / Tags) */}
        <Card className="p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-white mb-8">{t('form.settings')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.status')}</label>
              <select value={form.status} onChange={handleChange('status')} className={selectClass}>
                <option value="Aktiv">Aktiv</option><option value="Passiv">Passiv</option><option value="In Prozess">In Prozess</option><option value="Blacklist">Blacklist</option>
              </select>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{t('form.source')}</label>
              <select value={form.source} onChange={handleChange('source')} className={selectClass}>
                <option value="">{t('form.select')}</option>
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Input label={t('form.tags')} placeholder="Top-Kandidat, Remote, Senior (kommagetrennt)" value={form.tags} onChange={handleChange('tags')} />
            {(() => {
              const currentTags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
              const availableSuggestions = SUGGESTED_TAGS.filter(t => !currentTags.includes(t));
              const addTag = (tag) => { const tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []; if (!tags.includes(tag)) setForm(prev => ({ ...prev, tags: [...tags, tag].join(', ') })) };
              const removeTag = (tag) => { const tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []; setForm(prev => ({ ...prev, tags: tags.filter(t => t !== tag).join(', ') })) };
              return (
                <div className="md:col-span-2">
                  {currentTags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {currentTags.map(tag => (
                        <span key={tag} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] text-[14px] font-semibold">
                          <Tag className="w-3 h-3" />{tag}
                          <button type="button" onClick={() => removeTag(tag)} className="w-5 h-5 rounded-full hover:bg-[#5e5ce6]/20 flex items-center justify-center cursor-pointer transition-colors"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  {availableSuggestions.length > 0 && (
                    <div><p className="text-[12px] font-medium text-gray-400 dark:text-gray-500 mb-2">{t('form.tags_suggestions')}</p>
                      <div className="flex flex-wrap gap-2">
                        {availableSuggestions.map(tag => (<button key={tag} type="button" onClick={() => addTag(tag)} className="px-3 py-1.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[13px] font-medium text-gray-600 dark:text-gray-400 hover:bg-[#5e5ce6]/10 hover:text-[#5e5ce6] transition-all cursor-pointer border border-transparent hover:border-[#5e5ce6]/20">+ {tag}</button>))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-5 pt-6 pb-12">
          <Button variant="secondary" size="lg" type="button" onClick={() => navigate('/candidates')}>{t('form.cancel')}</Button>
          <Button variant="dark" type="submit" size="lg" disabled={saving || !form.name.trim()}><Save className="w-5 h-5" />{saving ? t('form.saving') : (isEdit ? t('form.update') : t('form.save'))}</Button>
        </div>
      </form>
    </div>
  )
}
