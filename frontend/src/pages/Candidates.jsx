import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Trash2, Edit3, MapPin, Briefcase, GraduationCap, Globe, Award, Car, ChevronDown } from 'lucide-react'
import { candidatesApi } from '../api'
import { Card, Button, EmptyState, LoadingSpinner } from '../components/UI'

export default function Candidates() {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const navigate = useNavigate()

  const loadCandidates = async (searchTerm = '') => {
    setLoading(true)
    try {
      const data = await candidatesApi.getAll(searchTerm)
      setCandidates(data.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCandidates()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => loadCandidates(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleDelete = async (id) => {
    try {
      await candidatesApi.delete(id)
      setCandidates(prev => prev.filter(c => c.id !== id))
      setDeleteConfirm(null)
    } catch (err) {
      alert('Fehler beim Löschen: ' + err.message)
    }
  }

  return (
    <div className="fade-in max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-14">
        <div>
          <h1 className="text-[40px] font-semibold tracking-tight text-black">Bewerber</h1>
          <p className="text-[18px] text-gray-500 mt-3">
            {candidates.length} Profile in der Datenbank
          </p>
        </div>
        <Link to="/candidates/new">
          <Button size="lg" variant="dark">
            <Plus className="w-5 h-5" />
            Neuer Bewerber
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-12">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
        <input
          type="text"
          placeholder="Suche nach Name, Skills, Standort..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-16 pr-8 py-5 bg-[#f5f5f7] border border-transparent rounded-[24px] 
            text-black text-[18px] placeholder:text-gray-400
            focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all duration-300 shadow-sm"
        />
      </div>

      {/* Candidates List */}
      {loading ? (
        <LoadingSpinner text="Bewerber werden geladen..." />
      ) : candidates.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={Briefcase}
            title="Keine Bewerber gefunden"
            description={search ? 'Passe deine Suche an oder füge neue Bewerber hinzu.' : 'Starte indem du deinen ersten Bewerber anlegst.'}
            action={
              <Link to="/candidates/new">
                <Button size="lg" variant="dark"><Plus className="w-5 h-5" /> Bewerber anlegen</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {candidates.map((candidate) => (
            <Card key={candidate.id} className="overflow-hidden p-0" hover>
              {/* Main row */}
              <div 
                className="flex items-center justify-between p-8 cursor-pointer"
                onClick={() => setExpandedId(expandedId === candidate.id ? null : candidate.id)}
              >
                <div className="flex items-center gap-8 flex-1 min-w-0">
                  {/* Avatar */}
                  <div className="w-20 h-20 rounded-full bg-[#f5f5f7] flex items-center justify-center flex-shrink-0 border border-gray-200/50">
                    <span className="text-[22px] font-semibold text-gray-600 tracking-tight">
                      {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-[24px] font-semibold tracking-tight text-black truncate">{candidate.name}</h3>
                    <div className="flex items-center gap-6 mt-3 flex-wrap">
                      {candidate.location && (
                        <span className="flex items-center gap-2 text-[15px] font-medium text-gray-500">
                          <MapPin className="w-4 h-4" /> {candidate.location}
                        </span>
                      )}
                      {candidate.availability && (
                        <span className="text-[15px] font-medium text-[#34c759]">{candidate.availability}</span>
                      )}
                    </div>
                  </div>

                  {/* Skills pills */}
                  {candidate.skills && (
                    <div className="hidden md:flex items-center gap-3 flex-wrap max-w-md">
                      {candidate.skills.split(',').slice(0, 3).map((skill, i) => (
                        <span key={i} className="px-4 py-2 rounded-full bg-[#f5f5f7] text-gray-700 text-[14px] font-medium">
                          {skill.trim()}
                        </span>
                      ))}
                      {candidate.skills.split(',').length > 3 && (
                        <span className="text-[14px] font-medium text-gray-400 px-2">
                          +{candidate.skills.split(',').length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 ml-8">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-12 h-12 !p-0 rounded-full"
                    onClick={(e) => { e.stopPropagation(); navigate(`/candidates/${candidate.id}/edit`) }}
                  >
                    <Edit3 className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-12 h-12 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(candidate.id) }}
                  >
                    <Trash2 className="w-5 h-5" />
                  </Button>
                  <div className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors ml-2">
                    <ChevronDown className={`w-6 h-6 text-gray-400 transition-transform duration-400 ${expandedId === candidate.id ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedId === candidate.id ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-10 pb-10 pt-4 border-t border-gray-100/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 pt-8">
                    {candidate.email && <DetailItem label="E-Mail" value={candidate.email} />}
                    {candidate.phone && <DetailItem label="Telefon" value={candidate.phone} />}
                    {candidate.education && <DetailItem label="Ausbildung" value={candidate.education} icon={GraduationCap} />}
                    {candidate.languages && <DetailItem label="Sprachen" value={candidate.languages} icon={Globe} />}
                    {candidate.certificates && <DetailItem label="Zertifikate" value={candidate.certificates} icon={Award} />}
                    {candidate.drivers_license && <DetailItem label="Führerschein" value={candidate.drivers_license} icon={Car} />}
                    {candidate.mobility && <DetailItem label="Mobilität" value={candidate.mobility} />}
                    {candidate.desired_salary && <DetailItem label="Gehaltsvorstellung" value={candidate.desired_salary} />}
                  </div>
                  {candidate.experience && (
                    <div className="mt-12">
                      <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Berufserfahrung</p>
                      <p className="text-[16px] text-gray-700 bg-[#f5f5f7] rounded-[24px] p-8 whitespace-pre-wrap leading-relaxed">
                        {candidate.experience}
                      </p>
                    </div>
                  )}
                  {candidate.notes && (
                    <div className="mt-8">
                      <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Notizen</p>
                      <p className="text-[16px] text-gray-700 bg-[#ff9f0a]/10 rounded-[24px] p-8 whitespace-pre-wrap leading-relaxed">
                        {candidate.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete confirmation */}
              {deleteConfirm === candidate.id && (
                <div className="px-10 py-6 flex items-center justify-end gap-4 border-t border-[#ff3b30]/20 bg-[#ff3b30]/5">
                  <span className="text-[16px] font-medium text-[#ff3b30] mr-auto">Bewerber wirklich löschen?</span>
                  <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
                  <Button variant="danger" onClick={() => handleDelete(candidate.id)}>Löschen</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-4">
      {Icon && <Icon className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />}
      <div>
        <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
        <p className="text-[16px] font-medium text-black mt-1.5">{value}</p>
      </div>
    </div>
  )
}
