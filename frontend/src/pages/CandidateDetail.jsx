import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useI18n } from '../I18nContext'
import {
  ArrowLeft, Plus, Trash2, Phone, Mail, Users, GitBranch, FileText,
  MessageSquare, MapPin, Briefcase, GraduationCap, Globe, Award, Car, Star, Clock,
  Upload, Download, File, Image, X, Printer, Eye, Calendar, Linkedin, Github, Shield,
  DollarSign, Building2, ExternalLink, Camera, ClipboardList, ChevronDown, ChevronUp, MessageCircle
} from 'lucide-react'
import { candidatesApi, activitiesApi, uploadsApi, ratingsApi, candidateDetailsApi, scorecardsApi } from '../api'
import { Button, LoadingSpinner } from '../components/UI'
import CandidatePrintProfile from '../components/CandidatePrintProfile'
import SendEmailModal from '../components/SendEmailModal'
import CommentSection from '../components/CommentSection'

const ACTIVITY_TYPES = ['Notiz', 'Anruf', 'E-Mail', 'Interview', 'Angebot', 'Absage', 'Pipeline']

const activityIcon = {
  Notiz:     { Icon: FileText,     color: 'text-gray-500 dark:text-gray-400',    bg: 'bg-gray-100 dark:bg-[#2c2c2e]' },
  Anruf:     { Icon: Phone,        color: 'text-[#34c759]',   bg: 'bg-[#34c759]/10' },
  'E-Mail':  { Icon: Mail,         color: 'text-[#0071e3]',   bg: 'bg-[#0071e3]/10' },
  Interview: { Icon: Users,        color: 'text-[#ff9f0a]',   bg: 'bg-[#ff9f0a]/10' },
  Angebot:   { Icon: Star,         color: 'text-[#8b5cf6]',   bg: 'bg-[#8b5cf6]/10' },
  Absage:    { Icon: MessageSquare, color: 'text-[#ff3b30]',  bg: 'bg-[#ff3b30]/10' },
  Pipeline:  { Icon: GitBranch,    color: 'text-[#0071e3]',   bg: 'bg-[#0071e3]/10' },
}

const STATUS_STYLES = {
  'Aktiv':      'bg-[#34c759]/10 text-[#34c759]',
  'Passiv':     'bg-[#ff9f0a]/10 text-[#ff9f0a]',
  'In Prozess': 'bg-[#0071e3]/10 text-[#0071e3]',
  'Blacklist':  'bg-[#ff3b30]/10 text-[#ff3b30]',
}

function formatDate(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' \u00b7 ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function formatMonth(dateStr) {
  if (!dateStr) return ''
  const [y, m] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'M\u00e4r', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  return `${months[parseInt(m) - 1] || ''} ${y}`
}

export default function CandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [candidate, setCandidate] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [newType, setNewType] = useState('Notiz')
  const [newText, setNewText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showPrint, setShowPrint] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [ratings, setRatings] = useState([])
  const [ratingAverages, setRatingAverages] = useState({})
  const [ratingOverall, setRatingOverall] = useState(null)
  const [newRating, setNewRating] = useState({ category: 'gesamt', rating: 0, comment: '' })
  const [hoverRating, setHoverRating] = useState(0)
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const [pipelineHistory, setPipelineHistory] = useState({ entries: [], stageChanges: [], interviews: [] })
  const [scorecardResponses, setScorecardResponses] = useState([])
  const [expandedScorecard, setExpandedScorecard] = useState(null)
  const [workHistory, setWorkHistory] = useState([])
  const [educationList, setEducationList] = useState([])
  const [customValues, setCustomValues] = useState([])
  const [photoError, setPhotoError] = useState(false)

  const candidateId = id

  const loadData = async () => {
    try {
      const [cRes, aRes, fRes, rRes, hRes, whRes, eduRes, cvRes, scRes] = await Promise.all([
        candidatesApi.getById(candidateId),
        activitiesApi.getByCandidate(candidateId),
        uploadsApi.getByCandidate(candidateId).catch(() => ({ data: [] })),
        ratingsApi.getByCandidate(candidateId).catch(() => ({ data: [], averages: {}, overall: null })),
        candidatesApi.getHistory(candidateId).catch(() => ({ entries: [], stageChanges: [], interviews: [] })),
        candidateDetailsApi.getWorkHistory(candidateId).catch(() => ({ data: [] })),
        candidateDetailsApi.getEducation(candidateId).catch(() => ({ data: [] })),
        candidateDetailsApi.getCustomValues(candidateId).catch(() => ({ data: [] })),
        scorecardsApi.getResponses({ candidate_id: candidateId }).catch(() => ({ data: [] })),
      ])
      setCandidate(cRes?.id ? cRes : (cRes.candidate || cRes.data))
      setActivities(aRes.data || [])
      setFiles(fRes.data || [])
      setRatings(rRes.data || [])
      setRatingAverages(rRes.averages || {})
      setRatingOverall(rRes.overall)
      setPipelineHistory(hRes)
      setWorkHistory(whRes.data || [])
      setEducationList(eduRes.data || [])
      setCustomValues((cvRes.data || []).filter(v => v.value))
      setScorecardResponses(scRes.data || [])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [candidateId])

  // Match scorecard responses to interview activities by evaluator name + close timestamp
  const findMatchingResponse = (activity) => {
    if (activity.type !== 'Interview' || !activity.content?.startsWith('Interview-Bewertung von ')) return null
    const match = activity.content.match(/^Interview-Bewertung von (.+)\n/)
    if (!match) return null
    const evaluator = match[1].trim()
    const actDate = new Date(activity.created_at).getTime()
    return scorecardResponses.find(r => {
      const rDate = new Date(r.created_at).getTime()
      return r.evaluator_name === evaluator && Math.abs(actDate - rDate) < 120000
    }) || null
  }

  const handleAddActivity = async (e) => {
    e.preventDefault()
    if (!newText.trim()) return
    setSubmitting(true)
    try {
      await activitiesApi.create(candidateId, newType, newText.trim())
      setNewText('')
      const aRes = await activitiesApi.getByCandidate(candidateId)
      setActivities(aRes.data || [])
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  const handleDeleteActivity = async (actId) => {
    try { await activitiesApi.delete(actId); setActivities(prev => prev.filter(a => a.id !== actId)); setDeleteConfirm(null) }
    catch (err) { alert(err.message) }
  }

  const handleFileUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    try {
      for (const file of fileList) await uploadsApi.upload(candidateId, file)
      const fRes = await uploadsApi.getByCandidate(candidateId)
      setFiles(fRes.data || [])
      const aRes = await activitiesApi.getByCandidate(candidateId)
      setActivities(aRes.data || [])
    } catch (err) { alert(err.message) }
    finally { setUploading(false); setDragOver(false) }
  }

  const handleDeleteFile = async (fileId) => {
    try { await uploadsApi.delete(fileId); setFiles(prev => prev.filter(f => f.id !== fileId)) }
    catch (err) { alert(err.message) }
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try { await candidateDetailsApi.uploadPhoto(candidateId, file); setPhotoError(false); loadData() }
    catch (err) { alert(err.message) }
    e.target.value = ''
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const handleAddRating = async (e) => {
    e.preventDefault()
    if (newRating.rating < 1) return
    setRatingSubmitting(true)
    try {
      await ratingsApi.create(candidateId, newRating)
      setNewRating({ category: 'gesamt', rating: 0, comment: '' })
      setHoverRating(0)
      const rRes = await ratingsApi.getByCandidate(candidateId)
      setRatings(rRes.data || [])
      setRatingAverages(rRes.averages || {})
      setRatingOverall(rRes.overall)
    } catch (err) { alert(err.message) }
    finally { setRatingSubmitting(false) }
  }

  const handleDeleteRating = async (ratingId) => {
    try {
      await ratingsApi.delete(ratingId)
      const rRes = await ratingsApi.getByCandidate(candidateId)
      setRatings(rRes.data || [])
      setRatingAverages(rRes.averages || {})
      setRatingOverall(rRes.overall)
    } catch (err) { alert(err.message) }
  }

  const RATING_CATEGORIES = [
    { key: 'gesamt', labelKey: 'detail.overall', color: '#ff9f0a' },
    { key: 'fachlich', labelKey: 'detail.technical', color: '#0071e3' },
    { key: 'pers\u00f6nlich', labelKey: 'detail.personal', color: '#34c759' },
    { key: 'kulturfit', labelKey: 'detail.culture_fit', color: '#8b5cf6' },
  ]

  const canPreview = (mimeType) => mimeType?.startsWith('image/') || mimeType === 'application/pdf'
  const getFileIcon = (mimeType) => mimeType?.startsWith('image/') ? Image : File

  if (loading) return <LoadingSpinner text={t('detail.loading')} />
  if (!candidate) return (
    <div className="fade-in max-w-[1000px] mx-auto text-center py-24">
      <p className="text-[20px] font-semibold text-gray-400">{t('detail.not_found')}</p>
      <Button variant="dark" size="md" onClick={() => navigate('/candidates')} className="mt-8"><ArrowLeft className="w-5 h-5" /> {t('common.back')}</Button>
    </div>
  )

  const tags = candidate.tags ? candidate.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const status = candidate.status || 'Aktiv'
  const hasSocialLinks = candidate.linkedin_url || candidate.xing_url || candidate.github_url || candidate.portfolio_url
  const hasSalaryStructure = candidate.salary_min || candidate.salary_max
  const currencySymbol = { EUR: '\u20ac', USD: '$', GBP: '\u00a3', CHF: 'CHF' }[candidate.salary_currency] || '\u20ac'
  const intervalLabel = { yearly: t('form.yearly'), monthly: t('form.monthly'), hourly: t('form.hourly') }[candidate.salary_interval] || ''

  return (
    <div className="fade-in max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 sm:gap-6 mb-6 sm:mb-10">
        <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div className="flex-1">
          <p className="text-[13px] sm:text-[15px] font-medium text-gray-400 mb-0.5">{t('detail.profile')}</p>
          <h1 className="text-[24px] sm:text-[36px] font-semibold tracking-tight text-black dark:text-white leading-tight">{candidate.name}</h1>
        </div>
        <button onClick={() => setShowEmailModal(true)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#0071e3]/10 dark:bg-[#0a84ff]/20 hover:bg-[#0071e3]/20 dark:hover:bg-[#0a84ff]/30 flex items-center justify-center transition-colors cursor-pointer flex-shrink-0" title={t('email.send_email')}><Mail className="w-5 h-5 sm:w-6 sm:h-6 text-[#0071e3] dark:text-[#0a84ff]" /></button>
        <button onClick={() => setShowPrint(true)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0" title={t('detail.print')}><Printer className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" /></button>
      </div>

      {/* Candidate Info Card with Photo */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row items-start gap-5 sm:gap-8">
          <div className="relative group flex-shrink-0">
            {candidate.photo_filename && !photoError ? (
              <img src={candidateDetailsApi.getPhotoUrl(candidateId)} alt={candidate.name} onError={() => setPhotoError(true)} className="w-16 h-16 sm:w-24 sm:h-24 rounded-full object-cover border-2 border-gray-100 dark:border-gray-700" />
            ) : (
              <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[22px] sm:text-[32px] font-semibold text-gray-600 dark:text-gray-400">
                {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
            )}
            <label className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#0071e3] text-white flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
              <Camera className="w-3.5 h-3.5" />
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            </label>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 flex-wrap mb-4">
              <h2 className="text-[24px] font-semibold text-black dark:text-white">{candidate.name}</h2>
              <span className={`px-4 py-1.5 rounded-full text-[14px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES['Aktiv']}`}>{status}</span>
            </div>
            {(candidate.current_position || candidate.current_employer) && (
              <p className="text-[16px] font-medium text-gray-600 dark:text-gray-400 mb-3">
                {candidate.current_position}{candidate.current_position && candidate.current_employer ? ' bei ' : ''}{candidate.current_employer}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {candidate.email && <InfoRow icon={Mail} text={candidate.email} link={`mailto:${candidate.email}`} />}
              {candidate.phone && <InfoRow icon={Phone} text={candidate.phone} link={`tel:${candidate.phone}`} />}
              {candidate.location && <InfoRow icon={MapPin} text={candidate.location} />}
              {candidate.nationality && <InfoRow icon={Shield} text={candidate.nationality} />}
              {candidate.experience && <InfoRow icon={Briefcase} text={candidate.experience} />}
              {candidate.education && <InfoRow icon={GraduationCap} text={candidate.education} />}
              {candidate.languages && <InfoRow icon={Globe} text={candidate.languages} />}
              {candidate.mobility && <InfoRow icon={Car} text={candidate.mobility} />}
              {candidate.availability && <InfoRow icon={Clock} text={candidate.availability} />}
              {candidate.notice_period && <InfoRow icon={Calendar} text={`${t('form.notice_period')}: ${candidate.notice_period}`} />}
              {candidate.available_from && <InfoRow icon={Calendar} text={`${t('form.available_from')}: ${new Date(candidate.available_from).toLocaleDateString('de-DE')}`} />}
              {candidate.work_permit && <InfoRow icon={Shield} text={`${candidate.work_permit}${candidate.work_permit_until ? ` (bis ${new Date(candidate.work_permit_until).toLocaleDateString('de-DE')})` : ''}`} />}
            </div>

            {(hasSalaryStructure || candidate.desired_salary) && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <DollarSign className="w-4 h-4 text-[#34c759]" />
                {hasSalaryStructure ? (
                  <span className="text-[15px] font-semibold text-[#34c759]">
                    {candidate.salary_min?.toLocaleString('de-DE')} \u2013 {candidate.salary_max?.toLocaleString('de-DE')} {currencySymbol} {intervalLabel}
                  </span>
                ) : (
                  <span className="text-[15px] font-medium text-gray-600 dark:text-gray-400">{candidate.desired_salary}</span>
                )}
              </div>
            )}

            {hasSocialLinks && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                {candidate.linkedin_url && <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0077b5]/10 text-[#0077b5] text-[13px] font-semibold hover:bg-[#0077b5]/20 transition-colors"><Linkedin className="w-3.5 h-3.5" />LinkedIn<ExternalLink className="w-3 h-3" /></a>}
                {candidate.xing_url && <a href={candidate.xing_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#006567]/10 text-[#006567] text-[13px] font-semibold hover:bg-[#006567]/20 transition-colors"><Globe className="w-3.5 h-3.5" />Xing<ExternalLink className="w-3 h-3" /></a>}
                {candidate.github_url && <a href={candidate.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#333]/10 text-[#333] dark:text-gray-300 text-[13px] font-semibold hover:bg-[#333]/20 transition-colors"><Github className="w-3.5 h-3.5" />GitHub<ExternalLink className="w-3 h-3" /></a>}
                {candidate.portfolio_url && <a href={candidate.portfolio_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#8b5cf6]/10 text-[#8b5cf6] text-[13px] font-semibold hover:bg-[#8b5cf6]/20 transition-colors"><Globe className="w-3.5 h-3.5" />Portfolio<ExternalLink className="w-3 h-3" /></a>}
              </div>
            )}

            {candidate.skills && (
              <div className="mt-5">
                <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {candidate.skills.split(',').map((s, i) => (<span key={i} className="px-3.5 py-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full text-[14px] font-medium text-gray-700 dark:text-gray-300">{s.trim()}</span>))}
                </div>
              </div>
            )}
            {tags.length > 0 && (
              <div className="mt-4">
                <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tg, i) => (<span key={i} className="px-3.5 py-1.5 bg-[#0071e3]/10 rounded-full text-[14px] font-semibold text-[#0071e3]">{tg}</span>))}
                </div>
              </div>
            )}

            {candidate.gdpr_consent_date && (
              <div className="mt-4 flex items-center gap-2 text-[13px] text-gray-400">
                <Shield className="w-3.5 h-3.5 text-[#34c759]" />
                DSGVO: {candidate.gdpr_consent_type} am {new Date(candidate.gdpr_consent_date).toLocaleDateString('de-DE')}
                {candidate.gdpr_consent_expires && <span className="text-[#ff9f0a]"> (l\u00e4uft ab: {new Date(candidate.gdpr_consent_expires).toLocaleDateString('de-DE')})</span>}
              </div>
            )}

            {candidate.referrer_name && (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-gray-400">
                <Building2 className="w-3.5 h-3.5 text-[#8b5cf6]" />
                {t('form.referral_section')}: {candidate.referrer_name} {candidate.referrer_email && `(${candidate.referrer_email})`}
              </div>
            )}

            {customValues.length > 0 && (
              <div className="mt-5">
                <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('form.custom_fields')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {customValues.map(cv => (
                    <div key={cv.field_id} className="text-[14px]">
                      <span className="font-medium text-gray-500">{cv.name}: </span>
                      <span className="text-black dark:text-white">{cv.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Work History Timeline */}
      {workHistory.length > 0 && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-8">
            <Briefcase className="w-5 h-5 text-[#ff9f0a]" />
            <h2 className="text-[22px] font-semibold text-black dark:text-white">{t('form.work_history')}</h2>
          </div>
          <div className="space-y-1">
            {workHistory.map((w, idx) => (
              <div key={w.id || idx} className="flex gap-5">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${w.is_current ? 'bg-[#34c759]/10' : 'bg-[#ff9f0a]/10'}`}>
                    <Briefcase className={`w-5 h-5 ${w.is_current ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`} />
                  </div>
                  {idx < workHistory.length - 1 && <div className="w-px flex-1 mt-2 bg-gray-100 dark:bg-[#2c2c2e]" />}
                </div>
                <div className="flex-1 pb-6">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-[16px] font-bold text-black dark:text-white">{w.position}</h3>
                    {w.is_current ? <span className="px-2.5 py-0.5 rounded-full bg-[#34c759]/10 text-[#34c759] text-[12px] font-semibold">{t('form.is_current')}</span> : null}
                  </div>
                  <p className="text-[15px] font-medium text-gray-600 dark:text-gray-400">{w.employer}{w.location ? ` \u00b7 ${w.location}` : ''}</p>
                  <p className="text-[13px] text-gray-400 mt-1">{formatMonth(w.from_date)} {' \u2013 '} {w.is_current ? t('detail.present') : formatMonth(w.to_date)}</p>
                  {w.description && <p className="text-[14px] text-gray-600 dark:text-gray-400 mt-2 whitespace-pre-wrap">{w.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Education Timeline */}
      {educationList.length > 0 && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-8">
            <GraduationCap className="w-5 h-5 text-[#8b5cf6]" />
            <h2 className="text-[22px] font-semibold text-black dark:text-white">{t('form.education_history')}</h2>
          </div>
          <div className="space-y-1">
            {educationList.map((edu, idx) => (
              <div key={edu.id || idx} className="flex gap-5">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-[#8b5cf6]/10 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-[#8b5cf6]" /></div>
                  {idx < educationList.length - 1 && <div className="w-px flex-1 mt-2 bg-gray-100 dark:bg-[#2c2c2e]" />}
                </div>
                <div className="flex-1 pb-6">
                  <h3 className="text-[16px] font-bold text-black dark:text-white">{edu.degree || edu.institution}</h3>
                  <p className="text-[15px] font-medium text-gray-600 dark:text-gray-400">{edu.institution}{edu.field_of_study ? ` \u00b7 ${edu.field_of_study}` : ''}</p>
                  <p className="text-[13px] text-gray-400 mt-1">{formatMonth(edu.from_date)} {' \u2013 '} {formatMonth(edu.to_date)}</p>
                  {edu.description && <p className="text-[14px] text-gray-600 dark:text-gray-400 mt-2 whitespace-pre-wrap">{edu.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rating Section */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[22px] font-semibold text-black dark:text-white">{t('detail.rating')}</h2>
          {ratingOverall !== null && (
            <div className="flex items-center gap-2">
              <div className="flex">{[1,2,3,4,5].map(s => <Star key={s} className={`w-5 h-5 ${s <= Math.round(ratingOverall) ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-200 dark:text-gray-600'}`} />)}</div>
              <span className="text-[18px] font-bold text-black dark:text-white">{ratingOverall}</span>
              <span className="text-[14px] font-medium text-gray-400">({ratings.length})</span>
            </div>
          )}
        </div>
        {Object.keys(ratingAverages).length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {RATING_CATEGORIES.map(({ key, labelKey, color }) => {
              const avg = ratingAverages[key]; if (!avg) return null
              return (<div key={key} className="rounded-[16px] p-4 text-center" style={{ background: `${color}10` }}><p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color }}>{t(labelKey)}</p><div className="flex items-center justify-center gap-1.5"><Star className="w-4 h-4 fill-current" style={{ color }} /><span className="text-[20px] font-bold text-black dark:text-white">{avg}</span></div></div>)
            })}
          </div>
        )}
        <form onSubmit={handleAddRating} className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-6 mb-8">
          <p className="text-[15px] font-semibold text-gray-600 dark:text-gray-400 mb-4">{t('detail.new_rating')}</p>
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 flex-wrap">
              {RATING_CATEGORIES.map(({ key, labelKey, color }) => (
                <button key={key} type="button" onClick={() => setNewRating(prev => ({ ...prev, category: key }))} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full text-[14px] font-semibold transition-all cursor-pointer ${newRating.category === key ? 'text-white shadow-md' : 'bg-white dark:bg-[#1c1c1e] text-gray-600 dark:text-gray-400 hover:bg-gray-50'}`} style={newRating.category === key ? { backgroundColor: color } : {}}>{t(labelKey)}</button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {[1,2,3,4,5].map(s => (<button key={s} type="button" onMouseEnter={() => setHoverRating(s)} onMouseLeave={() => setHoverRating(0)} onClick={() => setNewRating(prev => ({ ...prev, rating: s }))} className="p-1 cursor-pointer transition-transform hover:scale-110"><Star className={`w-8 h-8 transition-colors ${s <= (hoverRating || newRating.rating) ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-300 dark:text-gray-600'}`} /></button>))}
              {newRating.rating > 0 && <span className="ml-3 text-[16px] font-bold text-black dark:text-white">{newRating.rating}/5</span>}
            </div>
            <textarea value={newRating.comment} onChange={e => setNewRating(prev => ({ ...prev, comment: e.target.value }))} placeholder={t('detail.comment_placeholder')} rows={2} className="w-full px-5 py-4 bg-white dark:bg-[#1c1c1e] rounded-[20px] text-[16px] font-medium text-black dark:text-white resize-none focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all" />
            <div className="flex justify-end"><Button variant="dark" size="md" disabled={ratingSubmitting || newRating.rating < 1}><Star className="w-5 h-5" /> {t('detail.rate')}</Button></div>
          </div>
        </form>
        {ratings.length === 0 ? (
          <div className="text-center py-8"><Star className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" /><p className="text-[16px] font-semibold text-gray-400">{t('detail.no_ratings')}</p></div>
        ) : (
          <div className="space-y-3">
            {ratings.map(r => { const cat = RATING_CATEGORIES.find(c => c.key === r.category); return (
              <div key={r.id} className="flex items-start gap-4 p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] group">
                <div className="flex-shrink-0"><div className="flex">{[1,2,3,4,5].map(s => <Star key={s} className={`w-4 h-4 ${s <= r.rating ? 'fill-[#ff9f0a] text-[#ff9f0a]' : 'text-gray-300 dark:text-gray-600'}`} />)}</div></div>
                <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold" style={{ background: `${cat?.color||'#999'}20`, color: cat?.color||'#999' }}>{cat ? t(cat.labelKey) : r.category}</span><span className="text-[13px] font-medium text-gray-400">{r.created_by}</span><span className="text-[13px] font-medium text-gray-400">{formatDate(r.created_at)}</span></div>{r.comment && <p className="text-[15px] font-medium text-gray-700 dark:text-gray-300 mt-2">{r.comment}</p>}</div>
                <button onClick={() => handleDeleteRating(r.id)} className="w-7 h-7 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 cursor-pointer"><Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" /></button>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* Files Section */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
        <h2 className="text-[22px] font-semibold text-black dark:text-white mb-6">{t('detail.documents')}</h2>
        <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); handleFileUpload(e.dataTransfer.files) }} className={`border-2 border-dashed rounded-[24px] p-8 text-center transition-all cursor-pointer mb-6 ${dragOver ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`} onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png'; input.onchange = (e) => handleFileUpload(e.target.files); input.click() }}>
          <Upload className={`w-8 h-8 mx-auto mb-3 ${dragOver ? 'text-[#0071e3]' : 'text-gray-300'}`} />
          <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400">{uploading ? t('detail.uploading') : t('detail.drop_files')}</p>
          <p className="text-[13px] text-gray-400 mt-1">{t('detail.file_format_hint')}</p>
        </div>
        {files.length > 0 && (
          <div className="space-y-3">
            {files.map(f => { const FileIcon = getFileIcon(f.mime_type); return (
              <div key={f.id} className="flex items-center gap-4 p-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] group">
                <div className="w-10 h-10 rounded-[12px] bg-white dark:bg-[#1c1c1e] flex items-center justify-center flex-shrink-0"><FileIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" /></div>
                <div className="flex-1 min-w-0"><p className="text-[15px] font-semibold text-black dark:text-white truncate">{f.original_name}</p><p className="text-[12px] text-gray-400 mt-0.5">{formatFileSize(f.size)} \u00b7 {new Date(f.created_at).toLocaleDateString('de-DE')}</p></div>
                {canPreview(f.mime_type) && <button onClick={() => setPreviewFile(f)} className="w-9 h-9 rounded-full hover:bg-[#8b5cf6]/10 flex items-center justify-center transition-colors cursor-pointer" title={t('detail.preview')}><Eye className="w-4.5 h-4.5 text-[#8b5cf6]" /></button>}
                <a href={uploadsApi.getDownloadUrl(f.id)} className="w-9 h-9 rounded-full hover:bg-[#0071e3]/10 flex items-center justify-center transition-colors cursor-pointer" title={t('detail.download')}><Download className="w-4.5 h-4.5 text-[#0071e3]" /></a>
                <button onClick={() => handleDeleteFile(f.id)} className="w-9 h-9 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer" title={t('common.delete')}><X className="w-4 h-4 text-[#ff3b30]" /></button>
              </div>
            )})}
          </div>
        )}
        {files.length === 0 && !uploading && <p className="text-[15px] text-gray-400 text-center">{t('detail.no_documents')}</p>}
      </div>

      {/* Activity Log */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
        <h2 className="text-[22px] font-semibold text-black dark:text-white mb-8">{t('detail.activity_log')}</h2>
        <form onSubmit={handleAddActivity} className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-6 mb-10">
          <p className="text-[15px] font-semibold text-gray-600 dark:text-gray-400 mb-5">{t('detail.new_activity')}</p>
          <div className="flex flex-col gap-4">
            <div className="flex gap-3 flex-wrap">
              {ACTIVITY_TYPES.map((type, idx) => { const { Icon, color, bg } = activityIcon[type]; const typeLabels = t('detail.activity_types'); const displayLabel = Array.isArray(typeLabels) ? typeLabels[idx] : type; return (
                <button key={type} type="button" onClick={() => setNewType(type)} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full text-[14px] font-semibold transition-all cursor-pointer ${newType === type ? 'bg-black text-white shadow-md' : 'bg-white dark:bg-[#1c1c1e] text-gray-600 dark:text-gray-400 hover:bg-gray-50'}`}><Icon className="w-4 h-4" />{displayLabel}</button>
              )})}
            </div>
            <textarea value={newText} onChange={e => setNewText(e.target.value)} placeholder={t('detail.activity_placeholder')} rows={3} className="w-full px-5 py-4 bg-white dark:bg-[#1c1c1e] rounded-[20px] text-[16px] font-medium text-black dark:text-white resize-none focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all" />
            <div className="flex justify-end"><Button variant="dark" size="md" disabled={submitting || !newText.trim()}><Plus className="w-5 h-5" /> {t('detail.add')}</Button></div>
          </div>
        </form>
        {activities.length === 0 ? (
          <div className="text-center py-16"><div className="w-16 h-16 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center mx-auto mb-5"><FileText className="w-8 h-8 text-gray-300" /></div><p className="text-[18px] font-semibold text-gray-400">{t('detail.no_activities')}</p><p className="text-[15px] font-medium text-gray-300 mt-2">{t('detail.no_activities_desc')}</p></div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity, idx) => { const { Icon, color, bg } = activityIcon[activity.type] || activityIcon.Notiz; return (
              <div key={activity.id} className="flex gap-5 group">
                <div className="flex flex-col items-center flex-shrink-0"><div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${color}`} /></div>{idx < activities.length - 1 && <div className="w-px flex-1 mt-2 bg-gray-100 dark:bg-[#2c2c2e]" />}</div>
                <div className="flex-1 pb-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3"><span className="text-[15px] font-bold text-black dark:text-white">{(() => { const typeLabels = t('detail.activity_types'); const i = ACTIVITY_TYPES.indexOf(activity.type); return Array.isArray(typeLabels) && i >= 0 ? typeLabels[i] : activity.type })()}</span>{activity.auto_generated === 1 && <span className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#2c2c2e] text-[12px] font-medium text-gray-500 dark:text-gray-400">{t('detail.auto_generated')}</span>}</div>
                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[13px] font-medium text-gray-400">{formatDate(activity.created_at)}</span>
                      {deleteConfirm === activity.id ? (
                        <div className="flex items-center gap-2"><button onClick={() => handleDeleteActivity(activity.id)} className="px-3 py-1.5 rounded-full bg-[#ff3b30] text-white text-[13px] font-semibold cursor-pointer hover:opacity-80 transition-opacity">{t('common.delete')}</button><button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 text-[13px] font-semibold cursor-pointer hover:opacity-80 transition-opacity">{t('common.cancel')}</button></div>
                      ) : (<button onClick={() => setDeleteConfirm(activity.id)} className="w-8 h-8 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center cursor-pointer transition-colors"><Trash2 className="w-4 h-4 text-[#ff3b30]" /></button>)}
                    </div>
                    {deleteConfirm !== activity.id && <span className="text-[13px] font-medium text-gray-400 group-hover:hidden">{formatDate(activity.created_at)}</span>}
                  </div>
                  <p className="text-[16px] font-medium text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{activity.content}</p>
                  {/* Expandable interview scorecard details */}
                  {(() => {
                    const resp = findMatchingResponse(activity)
                    if (!resp) return null
                    const isExpanded = expandedScorecard === resp.id
                    const ratedAnswers = (resp.answers || []).filter(a => a.score > 0)
                    return (
                      <div className="mt-3">
                        <button
                          onClick={() => setExpandedScorecard(isExpanded ? null : resp.id)}
                          className="flex items-center gap-2 text-[13px] font-semibold text-[#5e5ce6] hover:text-[#4b4acf] cursor-pointer transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {isExpanded ? t('detail.hide_interview_details') : t('detail.show_interview_details')} ({ratedAnswers.length} {t('detail.questions_rated')})
                        </button>
                        {isExpanded && (
                          <div className="mt-4 space-y-3">
                            {(resp.answers || []).map((a, i) => (
                              <div key={i} className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl p-4">
                                <div className="flex items-start justify-between gap-3 mb-1">
                                  <p className="text-[14px] font-semibold text-black dark:text-white flex-1">{i + 1}. {a.question}</p>
                                  {a.score > 0 && (
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <div className="flex gap-0.5">
                                        {[1,2,3,4,5].map(s => (
                                          <Star key={s} className={`w-3.5 h-3.5 ${s <= a.score ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-300 dark:text-gray-600'}`} />
                                        ))}
                                      </div>
                                      <span className="text-[13px] font-bold text-[#ff9f0a]">{a.score}/5</span>
                                    </div>
                                  )}
                                  {a.score === 0 && <span className="text-[12px] font-medium text-gray-400 italic">{t('detail.not_rated')}</span>}
                                </div>
                                {a.comment && (
                                  <div className="flex items-start gap-2 mt-2">
                                    <MessageCircle className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{a.comment}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                            {resp.notes && (
                              <div className="bg-[#5e5ce6]/5 dark:bg-[#5e5ce6]/10 rounded-2xl p-4 border border-[#5e5ce6]/10">
                                <p className="text-[12px] font-bold text-[#5e5ce6] uppercase tracking-wide mb-1">{t('detail.interview_fazit')}</p>
                                <p className="text-[14px] text-gray-700 dark:text-gray-300 leading-relaxed">{resp.notes}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* Pipeline History */}
      {pipelineHistory.entries.length > 0 && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
          <h2 className="text-[22px] font-semibold text-black dark:text-white mb-8"><GitBranch className="w-5 h-5 inline mr-2 text-[#0071e3]" />{t('detail.history')}</h2>
          <div className="space-y-4">
            {pipelineHistory.entries.map(entry => {
              const stageChanges = pipelineHistory.stageChanges.filter(sc => sc.job_id === entry.job_id)
              const interviews = pipelineHistory.interviews.filter(iv => iv.job_id === entry.job_id)
              const stageColor = { Beworben: '#9ca3af', Vorauswahl: '#0071e3', Interview: '#ff9f0a', Angebot: '#8b5cf6', Hired: '#34c759', Abgesagt: '#ff3b30' }[entry.stage] || '#9ca3af'
              return (
                <div key={entry.id} className="p-5 rounded-[20px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                  <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                    <div className="flex items-center gap-3"><Briefcase className="w-5 h-5 text-gray-400" /><Link to={`/pipeline/${entry.job_id}`} className="text-[17px] font-bold text-black dark:text-white hover:text-[#0071e3] transition-colors">{entry.job_title}</Link>{entry.job_location && <span className="text-[13px] text-gray-400 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{entry.job_location}</span>}</div>
                    <div className="flex items-center gap-2"><span className="px-3 py-1 rounded-full text-[13px] font-bold text-white" style={{ backgroundColor: stageColor }}>{entry.stage}</span><span className="px-3 py-1 rounded-full text-[12px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{entry.job_status}</span></div>
                  </div>
                  {stageChanges.length > 0 && <div className="ml-7 mt-3 space-y-1.5">{stageChanges.slice(0, 5).map(sc => (<div key={sc.id} className="flex items-center gap-2 text-[13px]"><span className="font-medium text-gray-400">{new Date(sc.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}</span><span className="text-gray-500 dark:text-gray-400">{sc.old_stage}</span><span className="text-gray-400">{'\u2192'}</span><span className="font-semibold text-black dark:text-white">{sc.new_stage}</span>{sc.content && <span className="text-gray-400 truncate max-w-[200px]">{'\u2014'} {sc.content}</span>}</div>))}</div>}
                  {interviews.length > 0 && <div className="ml-7 mt-3 flex flex-wrap gap-2">{interviews.map(iv => (<span key={iv.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ff9f0a]/10 text-[12px] font-semibold text-[#ff9f0a]"><Calendar className="w-3 h-3" />{new Date(iv.interview_date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}{iv.interview_time && ` \u00b7 ${iv.interview_time}`}<span className="text-[#ff9f0a]/60">({iv.status})</span></span>))}</div>}
                  <div className="ml-7 mt-3 flex items-center gap-3">
                    <Link to={`/pipeline/${entry.job_id}/interview-prep/${entry.id}`} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5e5ce6] hover:underline"><ClipboardList className="w-3.5 h-3.5" />{t('interview_prep.prepare')}</Link>
                  </div>
                  <div className="ml-7 mt-2 text-[12px] text-gray-400">{t('detail.added_on')}: {new Date(entry.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Team Comments */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10">
        <CommentSection entityType="candidate" entityId={parseInt(id)} />
      </div>

      <CandidatePrintProfile candidate={candidate} open={showPrint} onClose={() => setShowPrint(false)} />
      {showEmailModal && <SendEmailModal candidate={candidate} onClose={() => setShowEmailModal(false)} onSent={() => { activitiesApi.getByCandidate(id).then(r => setActivities(r.data || [])).catch(() => {}) }} />}
      {previewFile && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setPreviewFile(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-[24px] w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700/80 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0"><Eye className="w-5 h-5 text-[#8b5cf6] flex-shrink-0" /><p className="text-[16px] font-semibold text-black dark:text-white truncate">{previewFile.original_name}</p><span className="text-[13px] text-gray-400 flex-shrink-0">{formatFileSize(previewFile.size)}</span></div>
              <div className="flex items-center gap-2"><a href={uploadsApi.getDownloadUrl(previewFile.id)} className="px-4 py-2 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[14px] font-semibold hover:bg-[#0071e3]/20 transition-colors"><Download className="w-4 h-4 inline mr-1.5" />Download</a><button onClick={() => setPreviewFile(null)} className="w-9 h-9 rounded-full hover:bg-gray-100 dark:hover:bg-[#2c2c2e] flex items-center justify-center cursor-pointer transition-colors"><X className="w-5 h-5 text-gray-500" /></button></div>
            </div>
            <div className="flex-1 overflow-auto p-2 min-h-0">
              {previewFile.mime_type?.startsWith('image/') ? (<div className="flex items-center justify-center h-full"><img src={uploadsApi.getPreviewUrl(previewFile.id)} alt={previewFile.original_name} className="max-w-full max-h-[75vh] object-contain rounded-[16px]" /></div>) : previewFile.mime_type === 'application/pdf' ? (<iframe src={uploadsApi.getPreviewUrl(previewFile.id)} className="w-full h-[75vh] rounded-[16px]" title={previewFile.original_name} />) : (<div className="flex items-center justify-center h-64"><p className="text-[16px] text-gray-400">{t('detail.preview_unavailable')}</p></div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, text, link }) {
  const content = (
    <div className="flex items-center gap-3 text-[15px] font-medium text-gray-600 dark:text-gray-400">
      <Icon className="w-4.5 h-4.5 text-gray-400 flex-shrink-0" />
      <span>{text}</span>
    </div>
  )
  if (link) return <a href={link} className="hover:text-[#0071e3] transition-colors">{content}</a>
  return content
}
