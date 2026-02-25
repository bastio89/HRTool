import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Trash2, Phone, Mail, Users, GitBranch, FileText,
  MessageSquare, MapPin, Briefcase, GraduationCap, Globe, Award, Car, Star, Clock,
  Upload, Download, File, Image, X
} from 'lucide-react'
import { candidatesApi, activitiesApi, uploadsApi } from '../api'
import { Button, LoadingSpinner } from '../components/UI'

const ACTIVITY_TYPES = ['Notiz', 'Anruf', 'E-Mail', 'Interview', 'Angebot', 'Absage', 'Pipeline']

const activityIcon = {
  Notiz:     { Icon: FileText,     color: 'text-gray-500',    bg: 'bg-gray-100' },
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

  const candidateId = id

  const loadData = async () => {
    try {
      const [cRes, aRes, fRes] = await Promise.all([
        candidatesApi.getById(candidateId),
        activitiesApi.getByCandidate(candidateId),
        uploadsApi.getByCandidate(candidateId).catch(() => ({ data: [] })),
      ])
      // getById returns the candidate object directly
      setCandidate(cRes?.id ? cRes : (cRes.candidate || cRes.data))
      setActivities(aRes.activities || [])
      setFiles(fRes.data || [])
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
      setActivities(aRes.activities || [])
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
      setActivities(aRes.activities || [])
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
      <div className="flex items-center gap-6 mb-10">
        <button onClick={() => navigate(-1)} className="w-12 h-12 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer flex-shrink-0">
          <ArrowLeft className="w-6 h-6 text-black" />
        </button>
        <div>
          <p className="text-[15px] font-medium text-gray-400 mb-0.5">Bewerberprofil</p>
          <h1 className="text-[36px] font-semibold tracking-tight text-black leading-tight">{candidate.name}</h1>
        </div>
      </div>

      {/* Candidate Info Card */}
      <div className="bg-white rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/80 p-10 mb-8">
        <div className="flex items-start gap-8">
          <div className="w-20 h-20 rounded-full bg-[#f5f5f7] flex items-center justify-center text-[28px] font-semibold text-gray-600 flex-shrink-0">
            {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 flex-wrap mb-4">
              <h2 className="text-[24px] font-semibold text-black">{candidate.name}</h2>
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
                    <span key={i} className="px-3.5 py-1.5 bg-[#f5f5f7] rounded-full text-[14px] font-medium text-gray-700">{s.trim()}</span>
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

      {/* Files Section */}
      <div className="bg-white rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/80 p-10 mb-8">
        <h2 className="text-[22px] font-semibold text-black mb-6">Dokumente</h2>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); handleFileUpload(e.dataTransfer.files) }}
          className={`border-2 border-dashed rounded-[24px] p-8 text-center transition-all cursor-pointer mb-6 ${
            dragOver ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 hover:border-gray-300'
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
          <p className="text-[15px] font-medium text-gray-500">
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
                <div key={f.id} className="flex items-center gap-4 p-4 bg-[#f5f5f7] rounded-[16px] group">
                  <div className="w-10 h-10 rounded-[12px] bg-white flex items-center justify-center flex-shrink-0">
                    <FileIcon className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-black truncate">{f.original_name}</p>
                    <p className="text-[12px] text-gray-400 mt-0.5">
                      {formatFileSize(f.size)} · {new Date(f.created_at).toLocaleDateString('de-DE')}
                    </p>
                  </div>
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
      <div className="bg-white rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/80 p-10">
        <h2 className="text-[22px] font-semibold text-black mb-8">Aktivitätslog</h2>

        {/* Add activity form */}
        <form onSubmit={handleAddActivity} className="bg-[#f5f5f7] rounded-[24px] p-6 mb-10">
          <p className="text-[15px] font-semibold text-gray-600 mb-5">Neue Aktivität</p>
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
                      newType === type ? 'bg-black text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50'
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
              className="w-full px-5 py-4 bg-white rounded-[20px] text-[16px] font-medium text-black resize-none
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
            <div className="w-16 h-16 rounded-full bg-[#f5f5f7] flex items-center justify-center mx-auto mb-5">
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
                      <div className="w-px flex-1 mt-2 bg-gray-100" />
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[15px] font-bold text-black">{activity.type}</span>
                        {activity.auto_generated === 1 && (
                          <span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-[12px] font-medium text-gray-500">Automatisch</span>
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
                              className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-[13px] font-semibold cursor-pointer hover:opacity-80 transition-opacity"
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
                    <p className="text-[16px] font-medium text-gray-700 leading-relaxed whitespace-pre-wrap">{activity.text}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-3 text-[15px] font-medium text-gray-600">
      <Icon className="w-4.5 h-4.5 text-gray-400 flex-shrink-0" />
      <span>{text}</span>
    </div>
  )
}
