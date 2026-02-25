import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Briefcase, MapPin, Users,
  Clock, Trash2, ChevronRight, ExternalLink
} from 'lucide-react'
import { jobsApi } from '../api'
import { Card, Button, EmptyState, LoadingSpinner } from '../components/UI'

const JOB_TYPES = ['Vollzeit', 'Teilzeit', 'Freelance', 'Praktikum', 'Werkstudent']
const JOB_STATUSES = ['Offen', 'Besetzt', 'Pausiert', 'Archiviert']

const statusColor = {
  Offen: 'bg-[#34c759]/10 text-[#34c759]',
  Besetzt: 'bg-[#0071e3]/10 text-[#0071e3]',
  Pausiert: 'bg-[#ff9f0a]/10 text-[#ff9f0a]',
  Archiviert: 'bg-gray-100 text-gray-500',
}

export default function Jobs() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
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
      <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-8 sm:mb-14 gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black">Stellenverwaltung</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 mt-1 sm:mt-3">
            {openCount} offene Stelle{openCount !== 1 ? 'n' : ''}
          </p>
        </div>
        <Button size="md" variant="dark" onClick={() => navigate('/jobs/new')}>
          <Plus className="w-5 h-5" /> Neue Stelle
        </Button>
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-2 sm:gap-3 mb-6 sm:mb-10 flex-wrap">
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
              <Button size="lg" variant="dark" onClick={() => navigate('/jobs/new')}>
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
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 p-5 sm:p-8">
                  {/* Icon */}
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[16px] sm:rounded-[20px] bg-[#f5f5f7] flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-6 h-6 sm:w-7 sm:h-7 text-gray-600" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                      <h3 className="text-[18px] sm:text-[22px] font-semibold tracking-tight text-black">{job.title}</h3>
                      <span className={`px-3 py-1 rounded-full text-[12px] sm:text-[13px] font-semibold ${statusColor[job.status] || 'bg-gray-100 text-gray-500'}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-6 mt-2 sm:mt-3 flex-wrap">
                      {job.location && (
                        <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500">
                          <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />{job.location}
                        </span>
                      )}
                      <span className="text-[13px] sm:text-[15px] font-medium text-gray-500">{job.type}</span>
                      <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500">
                        <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />{job.candidate_count || 0} in Pipeline
                      </span>
                      <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-400">
                        <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        {new Date(job.created_at).toLocaleDateString('de-DE')}
                      </span>
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1.5 text-[13px] sm:text-[15px] font-medium text-[#0071e3] hover:opacity-70 transition-opacity"
                        >
                          <ExternalLink className="w-4 h-4" /> Zur Stelle
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 sm:gap-3 self-end sm:self-center">
                    <Button variant="secondary" size="sm" onClick={() => navigate(`/jobs/${job.id}/edit`)}>
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
    </div>
  )
}
