import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Trash2, Edit3, MapPin, Briefcase, GraduationCap, Globe, Award, Car, ChevronDown, Activity, SlidersHorizontal, X, ArrowUpDown, Download, ChevronLeft, ChevronRight, CheckSquare, Square, MinusSquare, Upload, Printer, Star, Tag } from 'lucide-react'
import { candidatesApi, ratingsApi } from '../api'
import { Card, Button, EmptyState, LoadingSpinner } from '../components/UI'
import CSVImportDialog from '../components/CSVImportDialog'
import { useToast } from '../components/Toast'
import CandidatePrintProfile from '../components/CandidatePrintProfile'
import { useI18n } from '../I18nContext'

const STATUS_OPTIONS = ['Aktiv', 'Passiv', 'In Prozess', 'Blacklist']
const STATUS_STYLE = {
  'Aktiv':      'bg-[#34c759]/10 text-[#34c759]',
  'Passiv':     'bg-[#ff9f0a]/10 text-[#ff9f0a]',
  'In Prozess': 'bg-[#0071e3]/10 text-[#0071e3]',
  'Blacklist':  'bg-[#ff3b30]/10 text-[#ff3b30]',
}
const SORT_OPTIONS = [
  { value: 'name_asc',  labelKey: 'filter.sort_name_asc' },
  { value: 'name_desc', labelKey: 'filter.sort_name_desc' },
  { value: 'newest',    labelKey: 'filter.sort_newest' },
  { value: 'oldest',    labelKey: 'filter.sort_oldest' },
]
const PAGE_SIZE = 20

export default function Candidates() {
  const [candidates, setCandidates] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [filterStatus, setFilterStatus] = useState([])
  const [filterAvail, setFilterAvail] = useState('')
  const [filterSkills, setFilterSkills] = useState([])
  const [skillInput, setSkillInput] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [debouncedLocation, setDebouncedLocation] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [printCandidate, setPrintCandidate] = useState(null)
  const [candidateRatings, setCandidateRatings] = useState({})
  const [filterTags, setFilterTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [availableTags, setAvailableTags] = useState([])
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useI18n()

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Debounce location filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLocation(filterLocation)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [filterLocation])

  // Load available tags
  useEffect(() => {
    candidatesApi.getTags().then(res => setAvailableTags(res.tags || [])).catch(() => {})
  }, [])

  const sortMap = { name_asc: { sort: 'name', order: 'asc' }, name_desc: { sort: 'name', order: 'desc' }, newest: { sort: 'created_at', order: 'desc' }, oldest: { sort: 'created_at', order: 'asc' } }

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    try {
      const { sort, order } = sortMap[sortBy] || sortMap.newest
      const params = {
        search: debouncedSearch,
        page: currentPage,
        limit: PAGE_SIZE,
        sort,
        order,
      }
      if (filterSkills.length > 0) params.skills = filterSkills.join(',')
      if (filterStatus.length > 0) params.status = filterStatus.join(',')
      if (debouncedLocation) params.location = debouncedLocation
      if (filterTags.length > 0) params.tags = filterTags.join(',')
      const data = await candidatesApi.getAll(params)
      setCandidates(data.data || [])
      setTotalCount(data.total || 0)
      setTotalPages(data.totalPages || 1)
      // Load ratings for displayed candidates
      const ids = (data.data || []).map(c => c.id)
      if (ids.length > 0) {
        try {
          const rRes = await ratingsApi.getBatchAverages(ids)
          setCandidateRatings(rRes.data || {})
        } catch (_) {}
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, currentPage, sortBy, filterSkills, filterStatus, debouncedLocation, filterTags])

  useEffect(() => { loadCandidates() }, [loadCandidates])

  const handleDelete = async (id) => {
    try {
      await candidatesApi.delete(id)
      setDeleteConfirm(null)
      toast.success(t('candidates.deleted'))
      loadCandidates()
    } catch (err) {
      toast.error(t('candidates.delete_error') + ': ' + err.message)
    }
  }

  const toggleStatus = (s) => {
    setFilterStatus(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
    setCurrentPage(1)
  }

  const addSkill = (skill) => {
    const s = skill.trim()
    if (s && !filterSkills.includes(s)) {
      setFilterSkills(prev => [...prev, s])
      setCurrentPage(1)
    }
    setSkillInput('')
  }

  const removeSkill = (skill) => {
    setFilterSkills(prev => prev.filter(s => s !== skill))
    setCurrentPage(1)
  }

  const handleSkillKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addSkill(skillInput)
    } else if (e.key === 'Backspace' && !skillInput && filterSkills.length > 0) {
      removeSkill(filterSkills[filterSkills.length - 1])
    }
  }

  const clearFilters = () => { setFilterStatus([]); setFilterAvail(''); setFilterSkills([]); setSkillInput(''); setFilterLocation(''); setFilterTags([]); setTagInput(''); setSearch('') }

  const activeFilterCount = filterStatus.length + (filterAvail ? 1 : 0) + filterSkills.length + (filterLocation ? 1 : 0) + filterTags.length

  const addTag = (tag) => {
    const t = tag.trim()
    if (t && !filterTags.includes(t)) {
      setFilterTags(prev => [...prev, t])
      setCurrentPage(1)
    }
    setTagInput('')
  }

  const removeTag = (tag) => {
    setFilterTags(prev => prev.filter(t => t !== tag))
    setCurrentPage(1)
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && filterTags.length > 0) {
      removeTag(filterTags[filterTags.length - 1])
    }
  }

  // Batch selection helpers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)))
    }
  }

  const handleBatchDelete = async () => {
    try {
      const count = selectedIds.size
      await candidatesApi.batchDelete([...selectedIds])
      setSelectedIds(new Set())
      setBatchDeleteConfirm(false)
      toast.success(t('candidates.batch_deleted').replace('{count}', count))
      loadCandidates()
    } catch (err) {
      toast.error(t('candidates.batch_delete_error') + ': ' + err.message)
    }
  }

  const handleBatchStatus = async (status) => {
    try {
      const count = selectedIds.size
      await candidatesApi.batchStatus([...selectedIds], status)
      setSelectedIds(new Set())
      toast.success(t('candidates.batch_status_set').replace('{count}', count).replace('{status}', status))
      loadCandidates()
    } catch (err) {
      toast.error(t('candidates.batch_status_error') + ': ' + err.message)
    }
  }

  const exportCSV = () => {
    const headers = [t('csv.name'), t('csv.email'), t('csv.phone'), t('csv.location'), t('csv.status'), t('csv.availability'), t('csv.skills'), t('csv.education'), t('csv.languages'), t('csv.certificates'), t('csv.drivers_license'), t('csv.mobility'), t('csv.salary'), t('csv.source'), t('csv.tags'), t('csv.notes')]
    const escape = (v) => {
      if (!v) return ''
      const s = String(v).replace(/\"/g, '\"\"')
      return s.includes(',') || s.includes('\"') || s.includes('\n') ? `\"${s}\"` : s
    }
    const rows = filtered.map(c => [
      c.name, c.email, c.phone, c.location, c.status || 'Aktiv', c.availability,
      c.skills, c.education, c.languages, c.certificates, c.drivers_license,
      c.mobility, c.desired_salary, c.source, c.tags, c.notes
    ].map(escape).join(','))
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bewerber_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    let list = [...candidates]
    // Client-side filter for availability (not sent to server)
    if (filterAvail)
      list = list.filter(c => c.availability && c.availability.toLowerCase().includes(filterAvail.toLowerCase()))
    return list
  }, [candidates, filterAvail])

  return (
    <div className="fade-in max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 sm:mb-14 gap-4">
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('candidates.title')}</h1>
          <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">
            {loading ? '...' : `${filtered.length} ${t('candidates.of')} ${totalCount} ${t('candidates.profiles')}`}
          </p>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {filtered.length > 0 && (
            <Button size="md" variant="secondary" onClick={exportCSV}>
              <Download className="w-5 h-5" />
              <span className="hidden sm:inline">CSV Export</span>
            </Button>
          )}
          <Button size="md" variant="secondary" onClick={() => setShowImport(true)}>
            <Upload className="w-5 h-5" />
            <span className="hidden sm:inline">CSV Import</span>
          </Button>
          <Link to="/candidates/new">
            <Button size="md" variant="dark">
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">{t('candidates.new')}</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-5 sm:left-6 top-1/2 -translate-y-1/2 w-5 h-5 sm:w-6 sm:h-6 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t('candidates.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-13 sm:pl-16 pr-8 py-4 sm:py-5 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[20px] sm:rounded-[24px]
                text-black dark:text-white text-[15px] sm:text-[18px] placeholder:text-gray-400 dark:placeholder:text-gray-500
                focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all duration-300 shadow-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center cursor-pointer transition-colors">
                <X className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              </button>
            )}
          </div>
          <div className="flex gap-3 sm:gap-4">
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-2 sm:gap-3 px-5 sm:px-7 py-3 sm:py-4 rounded-[20px] sm:rounded-[24px] text-[15px] sm:text-[17px] font-semibold transition-all cursor-pointer border ${
                showFilters || activeFilterCount > 0
                  ? 'bg-black text-white border-black'
                  : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300 border-transparent hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
              }`}
            >
              <SlidersHorizontal className="w-5 h-5" />
              <span className="hidden sm:inline">{t('candidates.filter')}</span>
              {activeFilterCount > 0 && (
                <span className="w-6 h-6 rounded-full bg-white dark:bg-[#1c1c1e] text-black dark:text-white text-[13px] font-bold flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
            <div className="relative">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="appearance-none pl-10 sm:pl-12 pr-4 sm:pr-6 py-3 sm:py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] sm:rounded-[24px] text-[15px] sm:text-[17px] font-semibold text-gray-700 dark:text-gray-300 cursor-pointer border border-transparent hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] focus:outline-none transition-all"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
              </select>
              <ArrowUpDown className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white dark:bg-[#1c1c1e] rounded-[28px] border border-gray-100/80 dark:border-gray-700 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-8 space-y-7">
            {/* Skills filter with AND logic */}
            <div>
              <p className="text-[13px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">{t('filter.skills')} <span className="normal-case font-medium">({t('filter.skills_and')})</span></p>
              <div className="flex flex-wrap items-center gap-2 p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] min-h-[56px]">
                {filterSkills.map(skill => (
                  <span key={skill} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0071e3] text-white text-[14px] font-semibold">
                    {skill}
                    <button onClick={() => removeSkill(skill)} className="w-5 h-5 rounded-full hover:bg-white/20 flex items-center justify-center cursor-pointer transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder={filterSkills.length > 0 ? t('filter.skill_more') : t('filter.skill_placeholder')}
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={handleSkillKeyDown}
                  className="flex-1 min-w-[180px] px-3 py-2 bg-transparent text-[16px] font-medium text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
                />
              </div>
              {filterSkills.length >= 2 && (
                <p className="text-[13px] text-gray-400 dark:text-gray-500 mt-2 ml-1">{t('filter.skills_hint')}</p>
              )}
            </div>
            {/* Status filter */}
            <div>
              <p className="text-[13px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">{t('filter.status')}</p>
              <div className="flex flex-wrap gap-3">
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleStatus(s)}
                    className={`px-5 py-2.5 rounded-full text-[15px] font-semibold transition-all cursor-pointer border ${
                      filterStatus.includes(s)
                        ? `${STATUS_STYLE[s]} border-current`
                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 border-transparent hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {/* Availability filter */}
            <div>
              <p className="text-[13px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">{t('filter.availability')}</p>
              <input
                type="text"
                placeholder={t('filter.availability_placeholder')}
                value={filterAvail}
                onChange={e => setFilterAvail(e.target.value)}
                className="w-full max-w-md px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white border border-transparent
                  focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
              />
            </div>
            {/* Location filter */}
            <div>
              <p className="text-[13px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">{t('filter.location')}</p>
              <input
                type="text"
                placeholder={t('filter.location_placeholder')}
                value={filterLocation}
                onChange={e => setFilterLocation(e.target.value)}
                className="w-full max-w-md px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] text-[16px] font-medium text-black dark:text-white border border-transparent
                  focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
              />
            </div>
            {/* Tags filter */}
            <div>
              <p className="text-[13px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">{t('filter.tags')} <span className="normal-case font-medium">({t('filter.skills_and')})</span></p>
              <div className="flex flex-wrap items-center gap-2 p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[20px] min-h-[56px] max-w-2xl">
                {filterTags.map(tag => (
                  <span key={tag} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#5e5ce6] text-white text-[14px] font-semibold">
                    <Tag className="w-3 h-3" />
                    {tag}
                    <button onClick={() => removeTag(tag)} className="w-5 h-5 rounded-full hover:bg-white/20 flex items-center justify-center cursor-pointer transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder={filterTags.length > 0 ? t('filter.tag_more') : t('filter.tag_placeholder')}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  className="flex-1 min-w-[180px] px-3 py-2 bg-transparent text-[16px] font-medium text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
                />
              </div>
              {availableTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {availableTags.filter(t => !filterTags.includes(t.tag)).slice(0, 10).map(t => (
                    <button key={t.tag} onClick={() => addTag(t.tag)}
                      className="px-3 py-1.5 rounded-full bg-[#5e5ce6]/5 text-[13px] font-medium text-[#5e5ce6] hover:bg-[#5e5ce6]/10 transition-all cursor-pointer border border-[#5e5ce6]/10">
                      {t.tag} <span className="text-[11px] opacity-60">({t.count})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="flex items-center gap-2 text-[15px] font-semibold text-[#ff3b30] hover:opacity-70 cursor-pointer transition-opacity">
                <X className="w-4 h-4" /> {t('candidates.clear_filters')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-6 bg-black rounded-[20px] p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center gap-4">
            <span className="text-white text-[15px] sm:text-[17px] font-semibold">
              {selectedIds.size} {t('candidates.selected')}
            </span>
            <button onClick={() => setSelectedIds(new Set())} className="text-white/60 hover:text-white text-[14px] cursor-pointer transition-colors">
              {t('candidates.deselect')}
            </button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => handleBatchStatus(s)}
                className={`px-4 py-2 rounded-full text-[13px] sm:text-[14px] font-semibold cursor-pointer transition-all ${STATUS_STYLE[s]} hover:opacity-80`}
              >
                → {s}
              </button>
            ))}
            <button
              onClick={() => setBatchDeleteConfirm(true)}
              className="px-4 py-2 rounded-full bg-[#ff3b30] text-white text-[13px] sm:text-[14px] font-semibold cursor-pointer hover:opacity-80 transition-all flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t('candidates.delete')}
            </button>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation */}
      {batchDeleteConfirm && (
        <div className="mb-6 bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-[20px] p-5 flex items-center justify-between">
          <span className="text-[16px] font-medium text-[#ff3b30]">
            {t('candidates.batch_delete_confirm').replace('{count}', selectedIds.size)}
          </span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => setBatchDeleteConfirm(false)}>{t('candidates.cancel')}</Button>
            <Button variant="danger" onClick={handleBatchDelete}>{t('candidates.final_delete')}</Button>
          </div>
        </div>
      )}

      {/* Candidates List */}
      {loading ? (
        <LoadingSpinner text={t('candidates.loading')} />
      ) : filtered.length === 0 ? (
        <Card className="p-16">
          <EmptyState
            icon={Briefcase}
            title={t('candidates.no_results')}
            description={candidates.length === 0 ? t('candidates.no_results_desc') : t('candidates.no_filter_results')}
            action={
              candidates.length === 0
                ? <Link to="/candidates/new"><Button size="lg" variant="dark"><Plus className="w-5 h-5" /> {t('candidates.create')}</Button></Link>
                : <Button size="lg" variant="secondary" onClick={clearFilters}>{t('candidates.reset_filters')}</Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Select All */}
          {filtered.length > 0 && (
            <div className="flex items-center gap-3 px-2">
              <button onClick={toggleSelectAll} className="cursor-pointer text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white transition-colors">
                {selectedIds.size === filtered.length ? (
                  <CheckSquare className="w-5 h-5 text-[#0071e3]" />
                ) : selectedIds.size > 0 ? (
                  <MinusSquare className="w-5 h-5 text-[#0071e3]" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </button>
              <span className="text-[14px] text-gray-400 dark:text-gray-500 font-medium">
                {selectedIds.size > 0 ? `${selectedIds.size} ${t('candidates.selected')}` : t('candidates.select_all')}
              </span>
            </div>
          )}
          {filtered.map((candidate) => (
            <Card key={candidate.id} className="overflow-hidden p-0" hover>
              {/* Main row */}
              <div 
                className="flex flex-col sm:flex-row sm:items-center justify-between p-5 sm:p-8 cursor-pointer gap-4 sm:gap-0"
                onClick={() => setExpandedId(expandedId === candidate.id ? null : candidate.id)}
              >
                <div className="flex items-start sm:items-center gap-4 sm:gap-8 flex-1 min-w-0">
                  {/* Selection checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(candidate.id) }}
                    className="flex-shrink-0 cursor-pointer text-gray-300 hover:text-[#0071e3] transition-colors mt-1 sm:mt-0"
                  >
                    {selectedIds.has(candidate.id) ? (
                      <CheckSquare className="w-5 h-5 text-[#0071e3]" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
                  {/* Avatar */}
                  <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center flex-shrink-0 border border-gray-200/50 dark:border-gray-700">
                    <span className="text-[16px] sm:text-[22px] font-semibold text-gray-600 dark:text-gray-400 tracking-tight">
                      {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                      <h3 className="text-[18px] sm:text-[24px] font-semibold tracking-tight text-black dark:text-white break-words">{candidate.name}</h3>
                      {candidate.status && candidate.status !== 'Aktiv' && (
                        <span className={`px-3 py-1 rounded-full text-[12px] sm:text-[13px] font-semibold whitespace-nowrap ${
                          candidate.status === 'Passiv' ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' :
                          candidate.status === 'In Prozess' ? 'bg-[#0071e3]/10 text-[#0071e3]' :
                          candidate.status === 'Blacklist' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' :
                          'bg-[#34c759]/10 text-[#34c759]'}`}>{candidate.status}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 sm:gap-6 mt-2 sm:mt-3 flex-wrap">
                      {candidate.location && (
                        <span className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[15px] font-medium text-gray-500 dark:text-gray-400">
                          <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> {candidate.location}
                        </span>
                      )}
                      {candidate.availability && (
                        <span className="text-[13px] sm:text-[15px] font-medium text-[#34c759]">{candidate.availability}</span>
                      )}
                      {candidate.tags && candidate.tags.split(',').filter(Boolean).slice(0, 2).map((tag, i) => (
                        <span key={i} className="px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full bg-[#0071e3]/10 text-[12px] sm:text-[13px] font-semibold text-[#0071e3]">{tag.trim()}</span>
                      ))}
                      {candidate.source && (
                        <span className="px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full bg-[#8b5cf6]/10 text-[12px] sm:text-[13px] font-semibold text-[#8b5cf6]">{candidate.source}</span>
                      )}
                      {candidateRatings[candidate.id] && (
                        <span className="flex items-center gap-1 text-[13px] sm:text-[14px] font-semibold text-[#ff9f0a]">
                          <Star className="w-3.5 h-3.5 fill-[#ff9f0a]" />
                          {candidateRatings[candidate.id].average}
                        </span>
                      )}
                    </div>

                    {/* Skills pills - always below name/meta */}
                    {candidate.skills && (
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap mt-3">
                        {candidate.skills.split(',').slice(0, 4).map((skill, i) => (
                          <span key={i} className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300 text-[12px] sm:text-[14px] font-medium">
                            {skill.trim()}
                          </span>
                        ))}
                        {candidate.skills.split(',').length > 4 && (
                          <span className="text-[12px] sm:text-[14px] font-medium text-gray-400 dark:text-gray-500 px-2">
                            +{candidate.skills.split(',').length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 ml-0 sm:ml-8 self-end sm:self-center flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-10 h-10 sm:w-12 sm:h-12 !p-0 rounded-full hover:bg-[#0071e3]/10 hover:text-[#0071e3]"
                    onClick={(e) => { e.stopPropagation(); navigate(`/candidates/${candidate.id}/detail`) }}
                    title={t('candidates.profile_log')}
                  >
                    <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-10 h-10 sm:w-12 sm:h-12 !p-0 rounded-full hover:bg-[#34c759]/10 hover:text-[#34c759]"
                    onClick={(e) => { e.stopPropagation(); setPrintCandidate(candidate) }}
                    title={t('candidates.print_profile')}
                  >
                    <Printer className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-10 h-10 sm:w-12 sm:h-12 !p-0 rounded-full"
                    onClick={(e) => { e.stopPropagation(); navigate(`/candidates/${candidate.id}/edit`) }}
                  >
                    <Edit3 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-10 h-10 sm:w-12 sm:h-12 !p-0 rounded-full hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(candidate.id) }}
                  >
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors ml-1 sm:ml-2">
                    <ChevronDown className={`w-5 h-5 sm:w-6 sm:h-6 text-gray-400 dark:text-gray-500 transition-transform duration-400 ${expandedId === candidate.id ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${expandedId === candidate.id ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-10 pb-10 pt-4 border-t border-gray-100/80 dark:border-gray-700">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 pt-8">
                    {candidate.email && <DetailItem label={t('form.email')} value={candidate.email} />}
                    {candidate.phone && <DetailItem label={t('form.phone')} value={candidate.phone} />}
                    {candidate.education && <DetailItem label={t('form.education')} value={candidate.education} icon={GraduationCap} />}
                    {candidate.languages && <DetailItem label={t('form.languages')} value={candidate.languages} icon={Globe} />}
                    {candidate.certificates && <DetailItem label={t('form.certificates')} value={candidate.certificates} icon={Award} />}
                    {candidate.drivers_license && <DetailItem label={t('form.drivers_license')} value={candidate.drivers_license} icon={Car} />}
                    {candidate.mobility && <DetailItem label={t('form.mobility')} value={candidate.mobility} />}
                    {candidate.desired_salary && <DetailItem label={t('form.salary')} value={candidate.desired_salary} />}
                    {candidate.source && <DetailItem label={t('form.source')} value={candidate.source} />}
                  </div>
                  {candidate.experience && (
                    <div className="mt-12">
                      <p className="text-[13px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">{t('candidates.experience')}</p>
                      <p className="text-[16px] text-gray-700 dark:text-gray-300 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-8 whitespace-pre-wrap leading-relaxed">
                        {candidate.experience}
                      </p>
                    </div>
                  )}
                  {candidate.notes && (
                    <div className="mt-8">
                      <p className="text-[13px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">{t('form.notes')}</p>
                      <p className="text-[16px] text-gray-700 dark:text-gray-300 bg-[#ff9f0a]/10 rounded-[24px] p-8 whitespace-pre-wrap leading-relaxed">
                        {candidate.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete confirmation */}
              {deleteConfirm === candidate.id && (
                <div className="px-10 py-6 flex items-center justify-end gap-4 border-t border-[#ff3b30]/20 bg-[#ff3b30]/5">
                  <span className="text-[16px] font-medium text-[#ff3b30] mr-auto">{t('candidates.delete_confirm')}</span>
                  <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>{t('candidates.cancel')}</Button>
                  <Button variant="danger" onClick={() => handleDelete(candidate.id)}>{t('candidates.delete')}</Button>
                </div>
              )}
            </Card>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-2 text-gray-400 dark:text-gray-500 text-[15px]">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full text-[15px] sm:text-[17px] font-semibold transition-all cursor-pointer ${
                        p === currentPage
                          ? 'bg-black text-white'
                          : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          )}
        </div>
      )}

      <CSVImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={loadCandidates}
      />

      <CandidatePrintProfile
        candidate={printCandidate}
        open={!!printCandidate}
        onClose={() => setPrintCandidate(null)}
      />
    </div>
  )
}

function DetailItem({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-4">
      {Icon && <Icon className="w-5 h-5 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />}
      <div>
        <p className="text-[13px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</p>
        <p className="text-[16px] font-medium text-black dark:text-white mt-1.5">{value}</p>
      </div>
    </div>
  )
}
