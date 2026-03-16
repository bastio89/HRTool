import { useState, useEffect } from 'react'
import { X, Calendar, Clock, MapPin, Video, Phone, Users, Link2, Save, Loader2, Trash2, Check } from 'lucide-react'
import { interviewsApi } from '../api'
import { useI18n } from '../I18nContext'

const INTERVIEW_TYPES = [
  { value: 'vor Ort', labelKey: 'interview.type_onsite', icon: MapPin },
  { value: 'Video', labelKey: 'interview.type_video', icon: Video },
  { value: 'Telefon', labelKey: 'interview.type_phone', icon: Phone },
]

const TYPE_LABEL_KEYS = {
  'vor Ort': 'interview.type_onsite',
  'Video': 'interview.type_video',
  'Telefon': 'interview.type_phone',
}

const STATUS_LABEL_KEYS = {
  'geplant': 'interview.status_planned',
  'bestätigt': 'interview.status_confirmed',
  'abgeschlossen': 'interview.status_completed',
  'abgesagt': 'interview.status_cancelled',
}

export default function InterviewScheduler({ open, onClose, entry, onSaved }) {
  const { t, locale } = useI18n()
  const [interviews, setInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [form, setForm] = useState({
    interview_date: '',
    interview_time: '10:00',
    duration_minutes: 60,
    interview_type: 'vor Ort',
    location: '',
    meeting_link: '',
    participants: '',
    notes: '',
  })

  useEffect(() => {
    if (open && entry) {
      loadInterviews()
    }
  }, [open, entry])

  const loadInterviews = async () => {
    setLoading(true)
    try {
      const res = await interviewsApi.getByPipelineEntry(entry.id)
      setInterviews(res.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await interviewsApi.create({
        pipeline_entry_id: entry.id,
        candidate_id: entry.candidate_id,
        job_id: entry.job_id,
        ...form
      })
      setShowForm(false)
      setForm({
        interview_date: '', interview_time: '10:00', duration_minutes: 60,
        interview_type: 'vor Ort', location: '', meeting_link: '', participants: '', notes: ''
      })
      await loadInterviews()
      if (onSaved) onSaved()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await interviewsApi.delete(id)
      setDeleteConfirm(null)
      await loadInterviews()
      if (onSaved) onSaved()
    } catch (err) {
      console.error(err)
    }
  }

  const handleStatusChange = async (id, status) => {
    try {
      await interviewsApi.update(id, { status })
      await loadInterviews()
    } catch (err) {
      console.error(err)
    }
  }

  if (!open || !entry) return null

  const formatDate = (d) => {
    if (!d) return '—'
    return new Date(d + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-US' : 'de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  }

  const statusColors = {
    geplant: 'bg-[#0071e3]/10 text-[#0071e3]',
    bestätigt: 'bg-[#34c759]/10 text-[#34c759]',
    abgeschlossen: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
    abgesagt: 'bg-[#ff3b30]/10 text-[#ff3b30]',
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1c1c1e] rounded-[24px] shadow-2xl w-full max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div>
            <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('interview.title')}</h3>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">{entry.candidate_name}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
            </div>
          ) : (
            <>
              {/* Existing Interviews */}
              {interviews.length > 0 && (
                <div className="space-y-3 mb-6">
                  {interviews.map(iv => (
                    <div key={iv.id} className="p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center flex-shrink-0">
                            <Calendar className="w-4.5 h-4.5 text-[#0071e3]" />
                          </div>
                          <div>
                            <p className="text-[15px] font-semibold text-black dark:text-white">
                              {formatDate(iv.interview_date)}
                              {iv.interview_time && ` · ${iv.interview_time}${locale === 'de' ? ' Uhr' : ''}`}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-2.5 py-0.5 rounded-full text-[12px] font-semibold ${statusColors[iv.status] || statusColors.geplant}`}>
                                {t(STATUS_LABEL_KEYS[iv.status]) || iv.status}
                              </span>
                              <span className="text-[12px] text-gray-400">
                                {t(TYPE_LABEL_KEYS[iv.interview_type]) || iv.interview_type} · {iv.duration_minutes} {t('interview.minutes_short')}
                              </span>
                            </div>
                          </div>
                        </div>
                        {deleteConfirm === iv.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleDelete(iv.id)} className="w-7 h-7 rounded-full bg-[#ff3b30]/10 flex items-center justify-center cursor-pointer">
                              <Check className="w-3.5 h-3.5 text-[#ff3b30]" />
                            </button>
                            <button onClick={() => setDeleteConfirm(null)} className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center cursor-pointer">
                              <X className="w-3.5 h-3.5 text-gray-400" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(iv.id)} className="w-7 h-7 rounded-full hover:bg-[#ff3b30]/10 flex items-center justify-center transition-colors cursor-pointer opacity-0 group-hover:opacity-100">
                            <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-[#ff3b30]" />
                          </button>
                        )}
                      </div>
                      {iv.location && (
                        <p className="text-[13px] text-gray-500 mt-2 flex items-center gap-1.5 ml-[52px]">
                          <MapPin className="w-3 h-3" /> {iv.location}
                        </p>
                      )}
                      {iv.meeting_link && (
                        <a href={iv.meeting_link} target="_blank" rel="noreferrer" className="text-[13px] text-[#0071e3] mt-1 flex items-center gap-1.5 ml-[52px] hover:opacity-70">
                          <Link2 className="w-3 h-3" /> {t('interview.join_meeting')}
                        </a>
                      )}
                      {iv.participants && (
                        <p className="text-[13px] text-gray-500 mt-1 flex items-center gap-1.5 ml-[52px]">
                          <Users className="w-3 h-3" /> {iv.participants}
                        </p>
                      )}
                      {/* Status buttons */}
                      <div className="flex items-center gap-2 mt-3 ml-[52px]">
                        {[
                          { value: 'geplant', labelKey: 'interview.status_planned' },
                          { value: 'bestätigt', labelKey: 'interview.status_confirmed' },
                          { value: 'abgeschlossen', labelKey: 'interview.status_completed' },
                          { value: 'abgesagt', labelKey: 'interview.status_cancelled' },
                        ].map(s => (
                          <button
                            key={s.value}
                            onClick={() => handleStatusChange(iv.id, s.value)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                              iv.status === s.value
                                ? statusColors[s.value]
                                : 'bg-transparent text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            {t(s.labelKey)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* New Interview Form */}
              {showForm ? (
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.date_label')} *</label>
                      <input
                        type="date"
                        value={form.interview_date}
                        onChange={e => setForm(f => ({ ...f, interview_date: e.target.value }))}
                        required
                        className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.time_label')}</label>
                      <input
                        type="time"
                        value={form.interview_time}
                        onChange={e => setForm(f => ({ ...f, interview_time: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.type_label')}</label>
                      <div className="flex gap-2">
                        {INTERVIEW_TYPES.map(({ value, labelKey, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, interview_type: value }))}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-[12px] text-[13px] font-medium transition-all cursor-pointer ${
                              form.interview_type === value
                                ? 'bg-[#0071e3] text-white'
                                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {t(labelKey)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.duration_label')}</label>
                      <select
                        value={form.duration_minutes}
                        onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) }))}
                        className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all"
                      >
                        <option value={30}>{t('interview.duration_30')}</option>
                        <option value={45}>{t('interview.duration_45')}</option>
                        <option value={60}>{t('interview.duration_60')}</option>
                        <option value={90}>{t('interview.duration_90')}</option>
                        <option value={120}>{t('interview.duration_120')}</option>
                      </select>
                    </div>
                  </div>

                  {form.interview_type === 'vor Ort' && (
                    <div>
                      <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.location_label')}</label>
                      <input
                        value={form.location}
                        onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                        placeholder={t('interview.location_placeholder')}
                        className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all"
                      />
                    </div>
                  )}

                  {form.interview_type === 'Video' && (
                    <div>
                      <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.meeting_link_label')}</label>
                      <input
                        value={form.meeting_link}
                        onChange={e => setForm(f => ({ ...f, meeting_link: e.target.value }))}
                        placeholder="https://meet.google.com/... oder https://zoom.us/..."
                        type="url"
                        className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.participants_label')}</label>
                    <input
                      value={form.participants}
                      onChange={e => setForm(f => ({ ...f, participants: e.target.value }))}
                      placeholder={t('interview.participants_placeholder')}
                      className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">{t('interview.notes_label')}</label>
                    <textarea
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder={t('interview.notes_placeholder')}
                      rows={2}
                      className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[14px] text-[15px] text-black dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 border border-transparent focus:border-[#0071e3]/30 transition-all resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={saving || !form.interview_date}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-black dark:bg-white text-white dark:text-black text-[14px] font-semibold hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {saving ? t('interview.saving') : t('interview.create')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="px-4 py-2.5 rounded-full text-[14px] font-medium text-gray-500 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-all cursor-pointer"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-[16px] border-2 border-dashed border-gray-200 dark:border-gray-700 text-[14px] font-medium text-gray-500 hover:border-[#0071e3] hover:text-[#0071e3] transition-all cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  {t('interview.plan')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
