import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Phone, Mail, Users, GitBranch, FileText,
  MessageSquare, MapPin, Briefcase, GraduationCap, Globe, Award, Car, Star, Clock,
  Upload, Download, File, Image, X, Printer, Eye
} from 'lucide-react'
import { candidatesApi, activitiesApi, uploadsApi, ratingsApi } from '../api'
import { Button, LoadingSpinner } from '../components/UI'
import CandidatePrintProfile from '../components/CandidatePrintProfile'

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
    ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export default function CandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
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
  const [previewFile, setPreviewFile] = useState(null)
  const [ratings, setRatings] = useState([])
  const [ratingAverages, setRatingAverages] = useState({})
  const [ratingOverall, setRatingOverall] = useState(null)
  const [newRating, setNewRating] = useState({ category: 'gesamt', rating: 0, comment: '' })
  const [hoverRating, setHoverRating] = useState(0)
  const [ratingSubmitting, setRatingSubmitting] = useState(false)

  const candidateId = id

  const loadData = async () => {
    try {
      const [cRes, aRes, fRes, rRes] = await Promise.all([
        candidatesApi.getById(candidateId),
        activitiesApi.getByCandidate(candidateId),
        uploadsApi.getByCandidate(candidateId).catch(() => ({ data: [] })),
        ratingsApi.getByCandidate(candidateId).catch(() => ({ data: [], averages: {}, overall: null })),
      ])
      // getById returns the candidate object directly
      setCandidate(cRes?.id ? cRes : (cRes.candidate || cRes.data))
      setActivities(aRes.data || [])
      setFiles(fRes.data || [])
      setRatings(rRes.data || [])
      setRatingAverages(rRes.averages || {})
      setRatingOverall(rRes.overall)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [candidateId])

  const handleAddActivity = async (e) => {
    e.preventDefault()
    if (!newText.trim()) return
    setSubmitting(true)
    try {
      await activitiesApi.create(candidateId, newType, newText.trim())
      setNewText('')
      const aRes = await activitiesApi.getByCandidate(candidateId)
      setActivities(aRes.data || [])
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteActivity = async (actId) => {
    try {
      await activitiesApi.delete(actId)
      setActivities(prev => prev.filter(a => a.id !== actId))
      setDeleteConfirm(null)
    } catch (err) {
      alert(err.message)
    }
  }

  const handleFileUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    try {
      for (const file of fileList) {
        await uploadsApi.upload(candidateId, file)
      }
      const fRes = await uploadsApi.getByCandidate(candidateId)
      setFiles(fRes.data || [])
      // Reload activities to show upload activity
      const aRes = await activitiesApi.getByCandidate(candidateId)
      setActivities(aRes.data || [])
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
      setDragOver(false)
    }
  }

  const handleDeleteFile = async (fileId) => {
    try {
      await uploadsApi.delete(fileId)
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      alert(err.message)
    }
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
    } catch (err) {
      alert(err.message)
    } finally {
      setRatingSubmitting(false)
    }
  }

  const handleDeleteRating = async (ratingId) => {
    try {
      await ratingsApi.delete(ratingId)
      const rRes = await ratingsApi.getByCandidate(candidateId)
      setRatings(rRes.data || [])
      setRatingAverages(rRes.averages || {})
      setRatingOverall(rRes.overall)
    } catch (err) {
      alert(err.message)
    }
  }

  const RATING_CATEGORIES = [
    { key: 'gesamt', label: 'Gesamt', color: '#ff9f0a' },
    { key: 'fachlich', label: 'Fachlich', color: '#0071e3' },
    { key: 'persönlich', label: 'Persönlich', color: '#34c759' },
    { key: 'kulturfit', label: 'Kulturfit', color: '#8b5cf6' },
  ]

  const canPreview = (mimeType) => {
    return mimeType?.startsWith('image/') || mimeType === 'application/pdf'
  }

  const getFileIcon = (mimeType) => {
    if (mimeType?.startsWith('image/')) return Image
    return File
  }

  if (loading) return <LoadingSpinner text="Profil wird geladen..." />
  if (!candidate) return (
    <div className="fade-in max-w-[800px] mx-auto text-center py-24">
      <p className="text-[20px] font-semibold text-gray-400">Bewerber nicht gefunden.</p>
      <Button variant="dark" size="md" onClick={() => navigate('/candidates')} className="mt-8">
        <ArrowLeft className="w-5 h-5" /> Zurück
      </Button>
    </div>
  )

  const tags = candidate.tags ? candidate.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const status = candidate.status || 'Aktiv'

  return (
    <div className="fade-in max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 sm:gap-6 mb-6 sm:mb-10">
        <button onClick={() => navigate(-1)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
        <div className="flex-1">
          <p className="text-[13px] sm:text-[15px] font-medium text-gray-400 mb-0.5">Bewerberprofil</p>
          <h1 className="text-[24px] sm:text-[36px] font-semibold tracking-tight text-black dark:text-white leading-tight">{candidate.name}</h1>
        </div>
        <button
          onClick={() => setShowPrint(true)}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
          title="Profil drucken"
        >
          <Printer className="w-5 h-5 sm:w-6 sm:h-6 text-black dark:text-white" />
        </button>
      </div>

      {/* Candidate Info Card */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row items-start gap-5 sm:gap-8">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[22px] sm:text-[28px] font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">
            {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 flex-wrap mb-4">
              <h2 className="text-[24px] font-semibold text-black dark:text-white">{candidate.name}</h2>
              <span className={`px-4 py-1.5 rounded-full text-[14px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES['Aktiv']}`}>
                {status}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {candidate.location && <InfoRow icon={MapPin} text={candidate.location} />}
              {candidate.experience && <InfoRow icon={Briefcase} text={candidate.experience} />}
              {candidate.education && <InfoRow icon={GraduationCap} text={candidate.education} />}
              {candidate.languages && <InfoRow icon={Globe} text={candidate.languages} />}
              {candidate.mobility && <InfoRow icon={Car} text={candidate.mobility} />}
              {candidate.availability && <InfoRow icon={Clock} text={candidate.availability} />}
            </div>
            {candidate.skills && (
              <div className="mt-5">
                <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {candidate.skills.split(',').map((s, i) => (
                    <span key={i} className="px-3.5 py-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full text-[14px] font-medium text-gray-700 dark:text-gray-300">{s.trim()}</span>
                  ))}
                </div>
              </div>
            )}
            {tags.length > 0 && (
              <div className="mt-4">
                <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t, i) => (
                    <span key={i} className="px-3.5 py-1.5 bg-[#0071e3]/10 rounded-full text-[14px] font-semibold text-[#0071e3]">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rating Section */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 p-5 sm:p-10 mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[22px] font-semibold text-black dark:text-white">Bewertung</h2>
          {ratingOverall !== null && (
            <div className="flex items-center gap-2">
              <div className="flex">
                {[1, 2, 3, 4, 5].map(s => (
                  <Star key={s} className={`w-5 h-5 ${s <= Math.round(ratingOverall) ? 'text-[#ff9f0a] fill-[#ff9f0a]' : 'text-gray-200 dark:text-gray-600'}`} />
                ))}
              </div>
              <span className="text-[18px] font-bold text-black dark:text-white">{ratingOverall}</span>
              <span className="text-[14px] font-medium text-gray-400">({ratings.length})</span>
            </div>
          )}
        </div>

        {/* Category averages */}
        {Object.keys(ratingAverages).length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {RATING_CATEGORIES.map(({ key, label, color }) => {
              const avg = ratingAverages[key]
              if (!avg) return null
              return (
                <div key={key} className="rounded-[16px] p-4 text-center" style={{ background: `${color}10` }}>
                  <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color }}>{label}</p>
                  <div className="flex items-center justify-center gap-1.5">
                    <Star className="w-4 h-4 fill-current" style={{ color }} />
                    <span className="text-[20px] font-bold text-black dark:text-white">{avg}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add rating form */}
        <form onSubmit={handleAddRating} className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-6 mb-8">
          <p className="text-[15px] font-semibold text-gray-600 dark:text-gray-400 mb-4">Neue Bewertung</p>
          <div className="flex flex-col gap-4">
            {/* Category selector */}
            <div className="flex gap-2 flex-wrap">
              {RATING_CATEGORIES.map(({ key, label, color }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNewRating(prev => ({ ...prev, category: key }))}
                  className={`px-4 py-2 rounded-full text-[14px] font-semibold transition-all cursor-pointer ${
                    newRating.category === key
                      ? 'text-white shadow-md'
                      : 'bg-white dark:bg-[#1c1c1e] text-gray-600 dark:text-gray-400 hover:bg-gray-50'
                  }`}
                  style={newRating.category === key ? { backgroundColor: color } : {}}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Star selector */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(s => (
                <button
                  key={s}
                  type="button"
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setNewRating(prev => ({ ...prev, rating: s }))}
                  className="p-1 cursor-pointer transition-transform hover:scale-110"
                >
                  <Star className={`w-8 h-8 transition-colors ${
                    s <= (hoverRating || newRating.rating)
                      ? 'text-[#ff9f0a] fill-[#ff9f0a]'
                      : 'text-gray-300 dark:text-gray-600'
                  }`} />
                </button>
              ))}
              {newRating.rating > 0 && (
                <span className="ml-3 text-[16px] font-bold text-black dark:text-white">{newRating.rating}/5</span>
              )}
            </div>
            {/* Comment */}
            <textarea
              value={newRating.comment}
              onChange={e => setNewRating(prev => ({ ...prev, comment: e.target.value }))}
              placeholder="Kommentar (optional)..."
              rows={2}
              className="w-full px-5 py-4 bg-white dark:bg-[#1c1c1e] rounded-[20px] text-[16px] font-medium text-black dark:text-white resize-none
                focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
            />
            <div className="flex justify-end">
              <Button variant="dark" size="md" disabled={ratingSubmitting || newRating.rating < 1}>
                <Star className="w-5 h-5" /> Bewerten
              </Button>
            </div>
          </div>
        </form>

        {/* Rating history */}
        {ratings.length === 0 ? (
          <div className="text-center py-8">
            <Star className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-[16px] font-semibold text-gray-400">Noch keine Bewertungen</p>
          </div>
        ) : (
          <div className="space-y-3">
            {ratings.map(r => {
              const cat = RATING_CATEGORIES.find(c => c.key === r.category)
              return (
                <div key={r.id} className="flex items-start gap-4 p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] group">
                  <div className="flex-shrink-0">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star key={s} className={`w-4 h-4 ${s <= r.rating ? 'fill-[#ff9f0a] text-[#ff9f0a]' : 'text-gray-300 dark:text-gray-600'}`} />
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold" style={{ background: `${cat?.color || '#999'}20`, color: cat?.color || '#999' }}>
                        {cat?.label || r.category}
                      </span>
                      <span className="text-[13px] font-medium text-gray-400">{r.created_by}</span>
                      <span className="text-[13px] font-medium text-gray-400">{formatDate(r.created_at)}</span>
                    </div>
                    {r.comment && (
                      <p className="text-[15px] font-medium text-gray-700 dark:text-gray-300 mt-2">{r.comment}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteRating(r.id)}
                    className="w-7 h-7 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Files Section */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 dark:border-gray-700/80 p-10 mb-8">
        <h2 className="text-[22px] font-semibold text-black dark:text-white mb-6">Dokumente</h2>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files) }}
          className={`border-2 border-dashed rounded-[24px] p-8 text-center transition-all cursor-pointer mb-6 ${
            dragOver ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
          }`}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.multiple = true
            input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png'
            input.onchange = (e) => handleFileUpload(e.target.files)
            input.click()
          }}
        >
          <Upload className={`w-8 h-8 mx-auto mb-3 ${dragOver ? 'text-[#0071e3]' : 'text-gray-300'}`} />
          <p className="text-[15px] font-medium text-gray-500 dark:text-gray-400">
            {uploading ? 'Wird hochgeladen...' : 'Dateien hierher ziehen oder klicken'}
          </p>
          <p className="text-[13px] text-gray-400 mt-1">PDF, Word, JPG, PNG — max. 10 MB</p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-3">
            {files.map(f => {
              const FileIcon = getFileIcon(f.mime_type)
              return (
                <div key={f.id} className="flex items-center gap-4 p-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] group">
                  <div className="w-10 h-10 rounded-[12px] bg-white dark:bg-[#1c1c1e] flex items-center justify-center flex-shrink-0">
                    <FileIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-black dark:text-white truncate">{f.original_name}</p>
                    <p className="text-[12px] text-gray-400 mt-0.5">
                      {formatFileSize(f.size)} · {new Date(f.created_at).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  {canPreview(f.mime_type) && (
                    <button
                      onClick={() => setPreviewFile(f)}
                      className="w-9 h-9 rounded-full hover:bg-[#8b5cf6]/10 flex items-center justify-center transition-colors cursor-pointer"
                      title="Vorschau"
                    >
                      <Eye className="w-4.5 h-4.5 text-[#8b5cf6]" />
                    </button>
                  )}
                  <a
                    href={uploadsApi.getDownloadUrl(f.id)}
                    className="w-9 h-9 rounded-full hover:bg-[#0071e3]/10 flex items-center justify-center transition-colors cursor-pointer"
                    title="Herunterladen"
                  >
                    <Download className="w-4.5 h-4.5 text-[#0071e3]" />
                  </a>
                  <button
                    onClick={() => handleDeleteFile(f.id)}
                    className="w-9 h-9 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    title="Löschen"
                  >
                    <X className="w-4 h-4 text-[#ff3b30]" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {files.length === 0 && !uploading && (
          <p className="text-[15px] text-gray-400 text-center">Noch keine Dokumente hochgeladen.</p>
        )}
      </div>

      {/* Activity Log */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/8 dark:border-gray-700/80 dark:border-gray-700/80 p-10">
        <h2 className="text-[22px] font-semibold text-black dark:text-white mb-8">Aktivitätslog</h2>

        {/* Add activity form */}
        <form onSubmit={handleAddActivity} className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-6 mb-10">
          <p className="text-[15px] font-semibold text-gray-600 dark:text-gray-400 mb-5">Neue Aktivität</p>
          <div className="flex flex-col gap-4">
            <div className="flex gap-3 flex-wrap">
              {ACTIVITY_TYPES.map(type => {
                const { Icon, color, bg } = activityIcon[type]
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setNewType(type)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full text-[14px] font-semibold transition-all cursor-pointer ${
                      newType === type ? 'bg-black text-white shadow-md' : 'bg-white dark:bg-[#1c1c1e] text-gray-600 dark:text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {type}
                  </button>
                )
              })}
            </div>
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Details, Notizen, Ergebnisse..."
              rows={3}
              className="w-full px-5 py-4 bg-white dark:bg-[#1c1c1e] rounded-[20px] text-[16px] font-medium text-black dark:text-white resize-none
                focus:outline-none focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
            />
            <div className="flex justify-end">
              <Button variant="dark" size="md" disabled={submitting || !newText.trim()}>
                <Plus className="w-5 h-5" /> Hinzufügen
              </Button>
            </div>
          </div>
        </form>

        {/* Timeline */}
        {activities.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center mx-auto mb-5">
              <FileText className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-[18px] font-semibold text-gray-400">Noch keine Aktivitäten</p>
            <p className="text-[15px] font-medium text-gray-300 mt-2">Füge Notizen, Anrufe und Termine hinzu.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity, idx) => {
              const { Icon, color, bg } = activityIcon[activity.type] || activityIcon.Notiz
              return (
                <div key={activity.id} className="flex gap-5 group">
                  {/* Timeline line */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    {idx < activities.length - 1 && (
                      <div className="w-px flex-1 mt-2 bg-gray-100 dark:bg-[#2c2c2e]" />
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[15px] font-bold text-black dark:text-white">{activity.type}</span>
                        {activity.auto_generated === 1 && (
                          <span className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#2c2c2e] text-[12px] font-medium text-gray-500 dark:text-gray-400">Automatisch</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[13px] font-medium text-gray-400">{formatDate(activity.created_at)}</span>
                        {deleteConfirm === activity.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDeleteActivity(activity.id)}
                              className="px-3 py-1.5 rounded-full bg-[#ff3b30] text-white text-[13px] font-semibold cursor-pointer hover:opacity-80 transition-opacity"
                            >Löschen</button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 text-[13px] font-semibold cursor-pointer hover:opacity-80 transition-opacity"
                            >Abbrechen</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(activity.id)}
                            className="w-8 h-8 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-4 h-4 text-[#ff3b30]" />
                          </button>
                        )}
                      </div>
                      {deleteConfirm !== activity.id && (
                        <span className="text-[13px] font-medium text-gray-400 group-hover:hidden">{formatDate(activity.created_at)}</span>
                      )}
                    </div>
                    <p className="text-[16px] font-medium text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{activity.content}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CandidatePrintProfile
        candidate={candidate}
        open={showPrint}
        onClose={() => setShowPrint(false)}
      />

      {/* File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPreviewFile(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-[24px] w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700/80 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Eye className="w-5 h-5 text-[#8b5cf6] flex-shrink-0" />
                <p className="text-[16px] font-semibold text-black dark:text-white truncate">{previewFile.original_name}</p>
                <span className="text-[13px] text-gray-400 flex-shrink-0">{formatFileSize(previewFile.size)}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={uploadsApi.getDownloadUrl(previewFile.id)}
                  className="px-4 py-2 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[14px] font-semibold hover:bg-[#0071e3]/20 transition-colors"
                >
                  <Download className="w-4 h-4 inline mr-1.5" />Download
                </a>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="w-9 h-9 rounded-full hover:bg-gray-100 dark:hover:bg-[#2c2c2e] flex items-center justify-center cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-auto p-2 min-h-0">
              {previewFile.mime_type?.startsWith('image/') ? (
                <div className="flex items-center justify-center h-full">
                  <img
                    src={uploadsApi.getPreviewUrl(previewFile.id)}
                    alt={previewFile.original_name}
                    className="max-w-full max-h-[75vh] object-contain rounded-[16px]"
                  />
                </div>
              ) : previewFile.mime_type === 'application/pdf' ? (
                <iframe
                  src={uploadsApi.getPreviewUrl(previewFile.id)}
                  className="w-full h-[75vh] rounded-[16px]"
                  title={previewFile.original_name}
                />
              ) : (
                <div className="flex items-center justify-center h-64">
                  <p className="text-[16px] text-gray-400">Vorschau nicht verfügbar</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-3 text-[15px] font-medium text-gray-600 dark:text-gray-400">
      <Icon className="w-4.5 h-4.5 text-gray-400 flex-shrink-0" />
      <span>{text}</span>
    </div>
  )
}
