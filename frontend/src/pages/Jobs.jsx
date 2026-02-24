import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Briefcase, MapPin, Users, GitCompare,
  Clock, X, Save, Trash2, ChevronRight
} from 'lucide-react'
import { jobsApi } from '../api'
import { Card, Button, Input, Textarea, EmptyState, LoadingSpinner } from '../components/UI'

const JOB_TYPES = ['Vollzeit', 'Teilzeit', 'Freelance', 'Praktikum', 'Werkstudent']
const JOB_STATUSES = ['Offen', 'Besetzt', 'Pausiert', 'Archiviert']

const statusColor = {
  Offen: 'bg-[#34c759]/10 text-[#34c759]',
  Besetzt: 'bg-[#0071e3]/10 text-[#0071e3]',
  Pausiert: 'bg-[#ff9f0a]/10 text-[#ff9f0a]',
  Archiviert: 'bg-gray-100 text-gray-500',
}

const emptyJob = {
  title: '', description: '', requirements: '',
  location: '', type: 'Vollzeit', status: 'Offen'
}

export default function Jobs() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null = create, obj = edit
  const [form, setForm] = useState(emptyJob)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')

  const loadJobs = async () => {
    setLoading(true)
    try {
      const data = await jobsApi.getAll(filterStatus)
      setJobs(data.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadJobs() }, [filterStatus])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyJob)
    setPanelOpen(true)
  }

  const openEdit = (job) => {
    setEditing(job)
    setForm({
      title: job.title || '', description: job.description || '',
      requirements: job.requirements || '', location: job.location || '',
      type: job.type || 'Vollzeit', status: job.status || 'Offen'
    })
    setPanelOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        const updated = await jobsApi.update(editing.id, form)
        setJobs(prev => prev.map(j => j.id === editing.id ? { ...j, ...updated } : j))
      } else {
        const created = await jobsApi.create(form)
        setJobs(prev => [created, ...prev])
      }
      setPanelOpen(false)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await jobsApi.delete(id)
      setJobs(prev => prev.filter(j => j.id !== id))
      setDeleteConfirm(null)
    } catch (err) {
      alert(err.message)
    }
  }

  const openCount = jobs.filter(j => j.status === 'Offen').length

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-14">
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight text-black">Stellenverwaltung</h1>
          <p className="text-[18px] text-gray-500 mt-3">
            {openCount} offene Stelle{openCount !== 1 ? 'n' : ''}
          </p>
        </div>
        <Button size="lg" variant="dark" onClick={openCreate}>
          <Plus className="w-5 h-5" /> Neue Stelle
        </Button>
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-3 mb-10">
        {['', ...JOB_STATUSES].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-5 py-2.5 rounded-full text-[15px] font-medium transition-all cursor-pointer ${
              filterStatus === s
                ? 'bg-black text-white'
                : 'bg-[#f5f5f7] text-gray-600 hover:bg-[#e8e8ed]'
            }`}
          >
            {s === '' ? 'Alle' : s}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner text="Stellen werden geladen..." />
      ) : jobs.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={Briefcase}
            title="Keine Stellen vorhanden"
            description="Lege deine erste Stelle an um die Pipeline zu nutzen."
            action={
              <Button size="lg" variant="dark" onClick={openCreate}>
                <Plus className="w-5 h-5" /> Stelle anlegen
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {jobs.map(job => (
            <Card key={job.id} className="p-0 overflow-hidden" hover>
              {deleteConfirm === job.id ? (
                <div className="flex items-center justify-between px-10 py-6 bg-[#ff3b30]/5 border-t border-[#ff3b30]/20">
                  <span className="text-[16px] font-medium text-[#ff3b30]">Stelle wirklich löschen?</span>
                  <div className="flex gap-4">
                    <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
                    <Button variant="danger" onClick={() => handleDelete(job.id)}>Löschen</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-8 p-8">
                  {/* Icon */}
                  <div className="w-16 h-16 rounded-[20px] bg-[#f5f5f7] flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-7 h-7 text-gray-600" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-4 flex-wrap">
                      <h3 className="text-[22px] font-semibold tracking-tight text-black">{job.title}</h3>
                      <span className={`px-3 py-1 rounded-full text-[13px] font-semibold ${statusColor[job.status] || 'bg-gray-100 text-gray-500'}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 mt-3 flex-wrap">
                      {job.location && (
                        <span className="flex items-center gap-2 text-[15px] font-medium text-gray-500">
                          <MapPin className="w-4 h-4" />{job.location}
                        </span>
                      )}
                      <span className="text-[15px] font-medium text-gray-500">{job.type}</span>
                      <span className="flex items-center gap-2 text-[15px] font-medium text-gray-500">
                        <Users className="w-4 h-4" />{job.candidate_count || 0} in Pipeline
                      </span>
                      <span className="flex items-center gap-2 text-[15px] font-medium text-gray-400">
                        <Clock className="w-4 h-4" />
                        {new Date(job.created_at).toLocaleDateString('de-DE')}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" size="sm" onClick={() => openEdit(job)}>
                      Bearbeiten
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={() => navigate(`/pipeline/${job.id}`)}
                    >
                      Pipeline <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-10 h-10 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
                      onClick={() => setDeleteConfirm(job.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Slide-in panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/20 backdrop-blur-sm"
            onClick={() => setPanelOpen(false)}
          />
          {/* Panel */}
          <div className="w-[560px] bg-white h-full overflow-auto shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-12 py-10 border-b border-gray-100">
              <h2 className="text-[26px] font-semibold tracking-tight text-black">
                {editing ? 'Stelle bearbeiten' : 'Neue Stelle anlegen'}
              </h2>
              <button
                onClick={() => setPanelOpen(false)}
                className="w-10 h-10 rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 flex flex-col px-12 py-10 gap-8">
              <Input
                label="Jobtitel *"
                placeholder="z.B. Senior Frontend Developer (m/w/d)"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                required
              />
              <Input
                label="Standort"
                placeholder="München / Remote"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="block text-[15px] font-medium text-gray-600 ml-2">Anstellungsart</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full px-6 py-4 bg-[#f5f5f7] rounded-[20px] text-black text-[16px] focus:outline-none focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                  >
                    {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="block text-[15px] font-medium text-gray-600 ml-2">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-6 py-4 bg-[#f5f5f7] rounded-[20px] text-black text-[16px] focus:outline-none focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10 border border-transparent focus:border-[#0071e3]/30 transition-all"
                  >
                    {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Textarea
                label="Stellenbeschreibung"
                placeholder="Was sind die Hauptaufgaben dieser Rolle?"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4}
              />
              <Textarea
                label="Anforderungen"
                placeholder="Welche Skills und Erfahrungen werden erwartet?"
                value={form.requirements}
                onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))}
                rows={4}
              />

              <div className="flex gap-4 mt-auto pt-6">
                <Button variant="secondary" size="lg" type="button" onClick={() => setPanelOpen(false)}>
                  Abbrechen
                </Button>
                <Button variant="dark" size="lg" type="submit" disabled={saving || !form.title.trim()}>
                  <Save className="w-5 h-5" />
                  {saving ? 'Speichern...' : (editing ? 'Aktualisieren' : 'Anlegen')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
