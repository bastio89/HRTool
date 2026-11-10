import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleAlert, CopyCheck, GitMerge, RefreshCw, CalendarX, Network } from 'lucide-react'
import { duplicatesApi } from '../api'
import { Button, Card, EmptyState, LoadingSpinner, PageContainer } from '../components/UI'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { useI18n } from '../I18nContext'

const REASON_TONE = {
  identity: 'bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff6961]',
  url: 'bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff6961]',
  title_company_location: 'bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff6961]',
  email: 'bg-[#ff9500]/10 text-[#a35b00] dark:text-[#ffb340]',
  phone: 'bg-[#ff9500]/10 text-[#a35b00] dark:text-[#ffb340]',
  name: 'bg-[#8e8e93]/15 text-gray-600 dark:text-gray-300',
}

const formatDate = (value) => {
  if (!value) return '—'
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-')
    return `${day}.${month}.${year}`
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString('de-CH')
}

// Eine Gruppe moeglicher Dubletten: der Admin waehlt den fuehrenden
// Datensatz, alle anderen werden in ihn uebernommen.
function DuplicateGroup({ group, kind, onMerge, busy, t }) {
  const [keepId, setKeepId] = useState(group.members[0]?.id)
  const isCandidate = kind === 'candidates'
  const columns = isCandidate
    ? [
      ['name', t('duplicates.col_name')],
      ['birth_date', t('duplicates.col_birth_date')],
      ['email', t('duplicates.col_email')],
      ['phone', t('duplicates.col_phone')],
      ['pipeline_count', t('duplicates.col_pipelines')],
      ['created_at', t('duplicates.col_created')],
    ]
    : [
      ['title', t('duplicates.col_title')],
      ['company', t('duplicates.col_company')],
      ['location', t('duplicates.col_location')],
      ['url', t('duplicates.col_url')],
      ['pipeline_count', t('duplicates.col_pipelines')],
      ['created_at', t('duplicates.col_created')],
    ]
  const cell = (member, key) => {
    if (key === 'birth_date' || key === 'created_at') return formatDate(member[key])
    if (key === 'name') return <Link to={`/candidates/${member.id}`} className="font-semibold text-[var(--apple-blue-text)] hover:underline">{member.name}</Link>
    if (key === 'title') return <Link to={`/jobs/${member.id}/edit`} className="font-semibold text-[var(--apple-blue-text)] hover:underline">{member.title}</Link>
    return member[key] === null || member[key] === undefined || member[key] === '' ? '—' : String(member[key])
  }
  const legend = `${t(`duplicates.reason_${group.reason}`)}: ${group.key}`

  return (
    <Card className="!p-5 sm:!p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`px-3 py-1 rounded-full text-[12px] font-semibold ${REASON_TONE[group.reason] || REASON_TONE.name}`}>{t(`duplicates.reason_${group.reason}`)}</span>
        <span className="text-[13px] text-gray-500 dark:text-gray-400 truncate min-w-0">{group.key}</span>
        <span className="ml-auto text-[13px] text-gray-500 dark:text-gray-400">{t('duplicates.records').replace('{n}', group.members.length)}</span>
      </div>
      <fieldset>
        <legend className="sr-only">{legend}</legend>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-left text-[13px] min-w-[640px]">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="px-2 py-2 font-medium w-[90px]">{t('duplicates.col_keep')}</th>
                {columns.map(([key, label]) => <th key={key} className="px-2 py-2 font-medium whitespace-nowrap">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {group.members.map(member => (
                <tr key={member.id} className={`border-b border-gray-50 dark:border-gray-800 text-black dark:text-white ${member.id === keepId ? 'bg-[#0071e3]/5' : ''}`}>
                  <td className="px-2 py-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`keep-${kind}-${group.ids.join('-')}`}
                        checked={member.id === keepId}
                        onChange={() => setKeepId(member.id)}
                        className="w-4 h-4 accent-[#0071e3]"
                        aria-label={`${t('duplicates.col_keep')}: ${member.name || member.title} (ID ${member.id})`}
                      />
                      <span className="text-gray-500 dark:text-gray-400">#{member.id}</span>
                    </label>
                  </td>
                  {columns.map(([key]) => <td key={key} className="px-2 py-2 max-w-[220px] truncate" title={String(member[key] ?? '')}>{cell(member, key)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button size="sm" variant="dark" disabled={busy} onClick={() => onMerge(group, keepId)}>
          <GitMerge className="w-4 h-4" /> {t('duplicates.merge')}
        </Button>
      </div>
    </Card>
  )
}

function StatusCard({ icon: Icon, title, children, tone = 'neutral' }) {
  const iconTone = tone === 'ok' ? 'text-[#34c759]' : tone === 'warn' ? 'text-[#ff9500]' : 'text-[#0071e3]'
  return (
    <Card className="!p-5 sm:!p-6 space-y-3">
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${iconTone}`} aria-hidden="true" />
        <h2 className="text-[16px] font-semibold text-black dark:text-white">{title}</h2>
      </div>
      {children}
    </Card>
  )
}

export default function Duplicates() {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError('')
    return duplicatesApi.getOverview().then(setData).catch(err => setError(err.message))
  }, [])

  useEffect(() => { load() }, [load])

  const handleMerge = (kind) => async (group, keepId) => {
    const keep = group.members.find(member => member.id === keepId)
    const others = group.members.filter(member => member.id !== keepId)
    const label = (member) => member.name || member.title
    const ok = await confirm({
      title: t('duplicates.merge_title'),
      message: t('duplicates.merge_confirm')
        .replace('{others}', others.map(member => `„${label(member)}“ (#${member.id})`).join(', '))
        .replace('{keep}', `„${label(keep)}“ (#${keep.id})`),
      confirmLabel: t('duplicates.merge'),
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const mergeIds = others.map(member => member.id)
      if (kind === 'candidates') await duplicatesApi.mergeCandidates(keepId, mergeIds)
      else await duplicatesApi.mergeJobs(keepId, mergeIds)
      toast.success(t('duplicates.merged').replace('{name}', label(keep)))
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSync = async () => {
    setBusy(true)
    try {
      const result = await duplicatesApi.syncCandidates()
      toast.success(t('duplicates.synced').replace('{synced}', result.synced).replace('{remaining}', result.remaining))
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!data && !error) return <LoadingSpinner text={t('common.loading')} />
  if (!data) {
    return (
      <PageContainer>
        <EmptyState icon={CopyCheck} title={t('duplicates.title')} description={error} />
      </PageContainer>
    )
  }

  const inactiveRules = data.rules.filter(rule => !rule.active)
  const sections = [
    ['candidates', t('duplicates.section_candidates'), data.candidates.groups],
    ['jobs', t('duplicates.section_jobs'), data.jobs.groups],
  ]

  return (
    <PageContainer width="wide" className="space-y-8">
      <div>
        <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight text-black dark:text-white">{t('duplicates.title')}</h1>
        <p className="text-[15px] sm:text-[18px] text-gray-500 dark:text-gray-400 mt-1 sm:mt-3">{t('duplicates.subtitle')}</p>
      </div>

      {error && <p className="text-[14px] text-[#ff3b30]" role="alert">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <StatusCard icon={inactiveRules.length ? CircleAlert : CheckCircle2} title={t('duplicates.rules_title')} tone={inactiveRules.length ? 'warn' : 'ok'}>
          <ul className="space-y-1.5 text-[14px]">
            {data.rules.map(rule => (
              <li key={rule.key} className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                {rule.active
                  ? <CheckCircle2 className="w-4 h-4 text-[#34c759] flex-shrink-0" aria-hidden="true" />
                  : <CircleAlert className="w-4 h-4 text-[#ff9500] flex-shrink-0" aria-hidden="true" />}
                <span>{rule.label}</span>
                <span className="sr-only">{rule.active ? t('duplicates.rule_active') : t('duplicates.rule_inactive')}</span>
              </li>
            ))}
          </ul>
          {inactiveRules.length > 0 && <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('duplicates.rules_inactive_hint')}</p>}
        </StatusCard>

        <StatusCard icon={CalendarX} title={t('duplicates.missing_birth_title')} tone="neutral">
          <p className="text-[32px] leading-none font-semibold text-black dark:text-white">{data.candidates.withoutBirthDate}</p>
          <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('duplicates.missing_birth_hint').replace('{total}', data.candidates.total)}</p>
        </StatusCard>

        <StatusCard icon={Network} title={t('duplicates.sync_title')} tone={data.candidates.notSynced ? 'warn' : 'ok'}>
          <p className="text-[32px] leading-none font-semibold text-black dark:text-white">{data.candidates.notSynced}</p>
          <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('duplicates.sync_hint')}</p>
          {data.candidates.notSynced > 0 && (
            <Button size="sm" variant="secondary" onClick={handleSync} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {t('duplicates.sync_action')}
            </Button>
          )}
        </StatusCard>
      </div>

      {sections.map(([kind, title, groups]) => (
        <section key={kind} className="space-y-4" aria-labelledby={`duplicates-${kind}`}>
          <h2 id={`duplicates-${kind}`} className="text-[20px] font-semibold tracking-tight text-black dark:text-white">
            {title} <span className="text-gray-500 dark:text-gray-400 font-medium">({groups.length})</span>
          </h2>
          {groups.length === 0 ? (
            <Card className="!p-6 flex items-center gap-3 text-[15px] text-gray-600 dark:text-gray-300">
              <CheckCircle2 className="w-5 h-5 text-[#34c759]" aria-hidden="true" /> {t(`duplicates.none_${kind}`)}
            </Card>
          ) : groups.map(group => (
            <DuplicateGroup key={`${group.reason}-${group.ids.join('-')}`} group={group} kind={kind} onMerge={handleMerge(kind)} busy={busy} t={t} />
          ))}
        </section>
      ))}
    </PageContainer>
  )
}
