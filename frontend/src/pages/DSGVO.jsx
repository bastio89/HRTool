import { useState, useEffect } from 'react'
import { Shield, Trash2, AlertTriangle, Clock, Users, Settings, Check, Loader2 } from 'lucide-react'
import { settingsApi } from '../api'
import { Card, Button, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

export default function DSGVO() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [retentionMonths, setRetentionMonths] = useState(6)
  const [savedMonths, setSavedMonths] = useState(6)
  const [expired, setExpired] = useState([])
  const [expiredCount, setExpiredCount] = useState(0)
  const [totalCandidates, setTotalCandidates] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')

  const loadData = async () => {
    try {
      const [settings, expiredData] = await Promise.all([
        settingsApi.getAll(),
        settingsApi.getExpired()
      ])
      const months = parseInt(settings.dsgvo_retention_months) || 6
      setRetentionMonths(months)
      setSavedMonths(months)
      setExpired(expiredData.expired || [])
      setExpiredCount(expiredData.expiredCount || 0)
      setTotalCandidates(expiredData.totalCandidates || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccessMsg('')
    try {
      await settingsApi.update('dsgvo_retention_months', String(retentionMonths))
      setSavedMonths(retentionMonths)
      setSuccessMsg(t('dsgvo.saved'))
      // Reload expired list with new retention period
      const expiredData = await settingsApi.getExpired()
      setExpired(expiredData.expired || [])
      setExpiredCount(expiredData.expiredCount || 0)
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAll = async () => {
    setDeleting(true)
    setError('')
    setSuccessMsg('')
    try {
      const result = await settingsApi.deleteExpired()
      setSuccessMsg(t('dsgvo.deleted').replace('{count}', result.deleted))
      setDeleteConfirm(false)
      await loadData()
      setTimeout(() => setSuccessMsg(''), 5000)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (dt) => {
    if (!dt) return '—'
    return new Date(dt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loading) return <LoadingSpinner text={t('dsgvo.loading')} />

  return (
    <div className="fade-in max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-8 sm:mb-14">
        <div className="flex items-center gap-4 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 flex items-center justify-center">
            <Shield className="w-6 h-6 text-[#ff9f0a]" />
          </div>
          <div>
            <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('dsgvo.title')}</h1>
            <p className="text-[14px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1">{t('dsgvo.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-5 rounded-[20px] bg-[#ff3b30]/10 text-[#ff3b30] text-[15px] font-medium mb-6 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-5 rounded-[20px] bg-[#34c759]/10 text-[#34c759] text-[15px] font-medium mb-6 flex items-center gap-3">
          <Check className="w-5 h-5 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
        <Card className="p-6 text-center">
          <Users className="w-6 h-6 text-gray-400 mx-auto mb-3" />
          <p className="text-[28px] font-bold text-black dark:text-white">{totalCandidates}</p>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('dsgvo.total_candidates')}</p>
        </Card>
        <Card className={`p-6 text-center ${expiredCount > 0 ? 'ring-2 ring-[#ff9f0a]/30' : ''}`}>
          <AlertTriangle className={`w-6 h-6 mx-auto mb-3 ${expiredCount > 0 ? 'text-[#ff9f0a]' : 'text-gray-400'}`} />
          <p className={`text-[28px] font-bold ${expiredCount > 0 ? 'text-[#ff9f0a]' : 'text-black dark:text-white'}`}>{expiredCount}</p>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('dsgvo.expired')}</p>
        </Card>
        <Card className="p-6 text-center">
          <Clock className="w-6 h-6 text-gray-400 mx-auto mb-3" />
          <p className="text-[28px] font-bold text-black dark:text-white">{savedMonths}</p>
          <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 mt-1">{t('dsgvo.months_period')}</p>
        </Card>
      </div>

      {/* Retention Period Config */}
      <Card className="p-6 sm:p-10 mb-8">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-5 h-5 text-gray-400" />
          <h2 className="text-[20px] font-semibold text-black dark:text-white">{t('dsgvo.retention')}</h2>
        </div>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-6">
          {t('dsgvo.retention_desc_full')}
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="flex-1 w-full">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-semibold text-gray-600 dark:text-gray-400">
                {retentionMonths} {retentionMonths === 1 ? t('dsgvo.month_singular') : t('dsgvo.months_plural')}
              </span>
              <span className="text-[12px] text-gray-400">{t('dsgvo.months_range')}</span>
            </div>
            <input
              type="range"
              min={1}
              max={24}
              value={retentionMonths}
              onChange={e => setRetentionMonths(parseInt(e.target.value))}
              className="w-full h-2 bg-[#e5e5e7] dark:bg-[#3a3a3c] rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#0071e3]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
            />
            <div className="flex justify-between mt-2 text-[11px] text-gray-400">
              <span>{t('dsgvo.slider_tick').replace('{n}', '1')}</span>
              <span>{t('dsgvo.slider_tick').replace('{n}', '6')}</span>
              <span>{t('dsgvo.slider_tick').replace('{n}', '12')}</span>
              <span>{t('dsgvo.slider_tick').replace('{n}', '18')}</span>
              <span>{t('dsgvo.slider_tick').replace('{n}', '24')}</span>
            </div>
          </div>

          <Button
            variant="dark"
            size="md"
            onClick={handleSave}
            disabled={saving || retentionMonths === savedMonths}
            className="flex-shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? t('dsgvo.saving') : t('dsgvo.save')}
          </Button>
        </div>
      </Card>

      {/* Expired Candidates */}
      <Card className="p-6 sm:p-10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className={`w-5 h-5 ${expiredCount > 0 ? 'text-[#ff9f0a]' : 'text-gray-400'}`} />
            <h2 className="text-[20px] font-semibold text-black dark:text-white">
              {t('dsgvo.expired_candidates')}
              {expiredCount > 0 && (
                <span className="ml-3 px-3 py-1 rounded-full bg-[#ff9f0a]/10 text-[#ff9f0a] text-[14px]">{expiredCount}</span>
              )}
            </h2>
          </div>

          {expiredCount > 0 && !deleteConfirm && (
            <Button
              variant="danger"
              size="md"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 className="w-4 h-4" />
              {t('dsgvo.delete_all')}
            </Button>
          )}
        </div>

        {/* Delete Confirmation */}
        {deleteConfirm && (
          <div className="p-5 rounded-[20px] bg-[#ff3b30]/5 border border-[#ff3b30]/20 mb-6">
            <p className="text-[15px] font-medium text-[#ff3b30] mb-4">
              {t('dsgvo.delete_confirm').replace('{count}', expiredCount)}
            </p>
            <div className="flex items-center gap-3">
              <Button variant="danger" size="sm" onClick={handleDeleteAll} disabled={deleting}>
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? t('dsgvo.deleting') : t('dsgvo.delete_final')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)} disabled={deleting}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {expiredCount === 0 ? (
          <div className="text-center py-12">
            <Check className="w-12 h-12 text-[#34c759] mx-auto mb-4" />
            <p className="text-[17px] font-semibold text-black dark:text-white">{t('dsgvo.compliant')}</p>
            <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">{t('dsgvo.compliant_desc')}</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {expired.map(c => (
              <div key={c.id} className="flex items-center justify-between p-4 rounded-[16px] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center text-[14px] font-semibold text-gray-500 flex-shrink-0">
                    {c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-black dark:text-white truncate">{c.name}</p>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400">
                      {c.email || t('dsgvo.no_email')} {c.location ? `· ${c.location}` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-[13px] font-medium text-[#ff9f0a]">
                    {t('dsgvo.days_over').replace('{days}', Math.round(c.days_since_update))}
                  </p>
                  <p className="text-[12px] text-gray-400">
                    {t('dsgvo.last_change').replace('{date}', formatDate(c.updated_at || c.created_at))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
