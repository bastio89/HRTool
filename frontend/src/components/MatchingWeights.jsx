import { useState, useEffect } from 'react'
import { SlidersHorizontal, Save, Trash2, Star, ChevronDown, ChevronUp, RotateCcw, Plus } from 'lucide-react'
import { matchingWeightsApi } from '../api'
import { useI18n } from '../I18nContext'

const CRITERIA = [
  { key: 'skills',       icon: '🎯' },
  { key: 'experience',   icon: '💼' },
  { key: 'education',    icon: '🎓' },
  { key: 'location',     icon: '📍' },
  { key: 'languages',    icon: '🌐' },
  { key: 'salary',       icon: '💰' },
  { key: 'availability', icon: '📅' },
  { key: 'certificates', icon: '📜' },
  { key: 'cultural_fit', icon: '🤝' },
  { key: 'mobility',     icon: '🚗' },
]

const DEFAULT_WEIGHTS = Object.fromEntries(CRITERIA.map(c => [c.key, 0]))

function WeightSlider({ label, icon, value, onChange, t }) {
  const getColor = (val) => {
    if (val > 0) return `rgba(52, 199, 89, ${0.3 + (val / 10) * 0.7})`
    if (val < 0) return `rgba(255, 59, 48, ${0.3 + (Math.abs(val) / 10) * 0.7})`
    return '#8e8e93'
  }

  const getLabel = (val) => {
    if (val >= 7) return t('weights.very_high')
    if (val >= 4) return t('weights.high')
    if (val >= 1) return t('weights.slightly_higher')
    if (val === 0) return t('weights.standard')
    if (val >= -3) return t('weights.slightly_lower')
    if (val >= -6) return t('weights.low')
    return t('weights.ignore')
  }

  const percentage = ((value + 10) / 20) * 100

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <span className="text-[16px]">{icon}</span>
          <span className="text-[14px] font-semibold text-black dark:text-white">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[12px] font-bold px-2.5 py-1 rounded-full"
            style={{ 
              backgroundColor: value === 0 ? 'rgba(142, 142, 147, 0.12)' : getColor(value),
              color: value === 0 ? '#8e8e93' : '#fff'
            }}
          >
            {value > 0 ? `+${value}` : value}
          </span>
          <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 w-[80px] text-right">
            {getLabel(value)}
          </span>
        </div>
      </div>
      <div className="relative h-[6px] rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-150"
          style={{
            left: value >= 0 ? '50%' : `${percentage}%`,
            width: value >= 0 ? `${(value / 10) * 50}%` : `${50 - percentage}%`,
            backgroundColor: getColor(value),
          }}
        />
        <div className="absolute top-0 left-1/2 w-[1px] h-full bg-gray-300 dark:bg-gray-600" />
      </div>
      <input
        type="range"
        min={-10}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-[24px] mt-[-9px] relative z-10 appearance-none bg-transparent cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:h-[18px] 
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-gray-200 dark:[&::-webkit-slider-thumb]:border-gray-600
          [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125
          [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:rounded-full 
          [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:border-2
          [&::-moz-range-thumb]:border-gray-200"
      />
    </div>
  )
}

export default function MatchingWeights({ weights, onChange }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [saving, setSaving] = useState(false)

  // Check if any weights are non-zero
  const hasCustomWeights = Object.values(weights).some(v => v !== 0)
  const activeCount = Object.values(weights).filter(v => v !== 0).length

  useEffect(() => {
    matchingWeightsApi.getProfiles()
      .then(res => {
        setProfiles(res.data || [])
        // Auto-select default profile
        const def = (res.data || []).find(p => p.is_default)
        if (def) {
          setSelectedProfileId(def.id)
          // Only load if all weights are currently 0
          const allZero = Object.values(weights).every(v => v === 0)
          if (!allZero) return
          const defWeights = def.weights
          const hasNonZero = Object.values(defWeights).some(v => v !== 0)
          if (hasNonZero) {
            onChange(defWeights)
          }
        }
      })
      .catch(() => {})
  }, [])

  const handleProfileSelect = (profile) => {
    setSelectedProfileId(profile.id)
    onChange(profile.weights)
  }

  const handleReset = () => {
    onChange({ ...DEFAULT_WEIGHTS })
    setSelectedProfileId(null)
  }

  const handleSave = async () => {
    if (!profileName.trim()) return
    setSaving(true)
    try {
      const res = await matchingWeightsApi.createProfile(profileName.trim(), weights)
      setProfiles(prev => [...prev, { ...res, weights }])
      setSelectedProfileId(res.id)
      setShowSaveDialog(false)
      setProfileName('')
    } catch (err) {
      console.error('Error saving profile:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateProfile = async () => {
    if (!selectedProfileId) return
    const profile = profiles.find(p => p.id === selectedProfileId)
    if (!profile) return
    try {
      await matchingWeightsApi.updateProfile(selectedProfileId, profile.name, weights)
      setProfiles(prev => prev.map(p => p.id === selectedProfileId ? { ...p, weights } : p))
    } catch (err) {
      console.error('Error updating profile:', err)
    }
  }

  const handleDeleteProfile = async (id) => {
    try {
      await matchingWeightsApi.deleteProfile(id)
      setProfiles(prev => prev.filter(p => p.id !== id))
      if (selectedProfileId === id) setSelectedProfileId(null)
    } catch (err) {
      console.error('Error deleting profile:', err)
    }
  }

  const handleWeightChange = (key, value) => {
    onChange({ ...weights, [key]: value })
  }

  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-[24px] border border-[#e5e5ea] dark:border-[#38383a] overflow-hidden transition-all">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-[#f5f5f7]/50 dark:hover:bg-[#2c2c2e]/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#af52de] to-[#5856d6] flex items-center justify-center">
            <SlidersHorizontal className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-[16px] font-semibold text-black dark:text-white">
              {t('weights.title')}
            </h3>
            <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">
              {hasCustomWeights
                ? t('weights.active_count').replace('{count}', activeCount)
                : t('weights.subtitle')
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasCustomWeights && (
            <span className="px-3 py-1 rounded-full bg-[#af52de]/10 text-[#af52de] text-[12px] font-bold">
              {t('weights.customized')}
            </span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-6 pb-6 border-t border-[#e5e5ea] dark:border-[#38383a]">
          {/* Info */}
          <div className="mt-5 mb-6 p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
            <p className="text-[13px] font-medium text-gray-600 dark:text-gray-400 leading-relaxed">
              {t('weights.info')}
            </p>
          </div>

          {/* Profile selector */}
          {profiles.length > 0 && (
            <div className="mb-6">
              <label className="text-[13px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 block">
                {t('weights.profiles')}
              </label>
              <div className="flex flex-wrap gap-2">
                {profiles.map(profile => (
                  <div key={profile.id} className="flex items-center">
                    <button
                      onClick={() => handleProfileSelect(profile)}
                      className={`px-4 py-2 rounded-l-full text-[13px] font-semibold transition-all cursor-pointer ${
                        selectedProfileId === profile.id
                          ? 'bg-[#af52de] text-white'
                          : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
                      }`}
                    >
                      {profile.is_default ? <Star className="w-3 h-3 inline mr-1.5" /> : null}
                      {profile.name}
                    </button>
                    {!profile.is_default && (
                      <button
                        onClick={() => handleDeleteProfile(profile.id)}
                        className={`px-2 py-2 rounded-r-full text-[13px] transition-all cursor-pointer border-l ${
                          selectedProfileId === profile.id
                            ? 'bg-[#af52de]/80 text-white/80 hover:text-white border-white/20'
                            : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-400 hover:text-[#ff3b30] border-gray-200 dark:border-gray-600'
                        }`}
                        title={t('weights.delete_profile')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    {profile.is_default && (
                      <div className="px-2 py-2 rounded-r-full bg-[#af52de]/80 text-white/50 text-[13px]">
                        <Star className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sliders */}
          <div className="space-y-5">
            {CRITERIA.map(({ key, icon }) => (
              <WeightSlider
                key={key}
                label={t(`weights.${key}`)}
                icon={icon}
                value={weights[key] || 0}
                onChange={(val) => handleWeightChange(key, val)}
                t={t}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 mt-8 pt-6 border-t border-[#e5e5ea] dark:border-[#38383a]">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold
                bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 
                hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> {t('weights.reset')}
            </button>

            {selectedProfileId && hasCustomWeights && (
              <button
                onClick={handleUpdateProfile}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold
                  bg-[#af52de]/10 text-[#af52de] hover:bg-[#af52de]/20 transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> {t('weights.update_profile')}
              </button>
            )}

            {showSaveDialog ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  placeholder={t('weights.profile_name_placeholder')}
                  className="px-4 py-2.5 rounded-full text-[13px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e]
                    text-black dark:text-white border border-[#af52de]/30 focus:outline-none focus:border-[#af52de]
                    focus:ring-2 focus:ring-[#af52de]/20 w-[180px]"
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={saving || !profileName.trim()}
                  className="px-4 py-2.5 rounded-full text-[13px] font-semibold bg-[#af52de] text-white
                    hover:bg-[#9b41c9] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('weights.save')}
                </button>
                <button
                  onClick={() => { setShowSaveDialog(false); setProfileName('') }}
                  className="px-3 py-2.5 rounded-full text-[13px] font-semibold text-gray-500 hover:text-black
                    dark:hover:text-white transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold
                  bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 
                  hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> {t('weights.save_as_profile')}
              </button>
            )}
          </div>

          {/* Scale legend */}
          <div className="mt-5 flex items-center justify-between text-[11px] font-medium text-gray-400 dark:text-gray-500 px-1">
            <span>-10 ({t('weights.ignore')})</span>
            <span>0 ({t('weights.standard')})</span>
            <span>+10 ({t('weights.very_high')})</span>
          </div>
        </div>
      )}
    </div>
  )
}
