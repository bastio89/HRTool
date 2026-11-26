import { useCallback, useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { batchesApi, matchingApi } from '../api'
import { useAuth } from '../AuthContext'
import { useI18n } from '../I18nContext'
import { useConfirm } from '../components/ConfirmDialog'
import { Button, Card, PageContainer } from '../components/UI'
import { localeTag } from '../utils/format'

const RUN_STAGES = ['queued', 'preparing', 'matching', 'blocked_credits', 'completed', 'completed_with_errors', 'needs_review', 'failed']
const PAIR_STATES = ['pending', 'running', 'computed', 'cached', 'shared', 'failed', 'skipped', 'needs_review', 'preparation_required']

function useVisiblePolling(load) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setData(null)
    setError('')
    setLastUpdated(null)
  }, [load])
  useEffect(() => {
    let active = true
    let epoch = 0
    let timer
    let controller
    const refresh = async () => {
      if (!active || document.hidden) return
      const current = ++epoch
      controller?.abort()
      controller = new AbortController()
      try {
        const result = await load(controller.signal)
        if (active && current === epoch) {
          setData(result)
          setError('')
          setLastUpdated(new Date())
        }
      } catch (failure) {
        if (active && current === epoch && failure.name !== 'AbortError') setError(failure.message)
      } finally {
        if (active && current === epoch && !document.hidden) timer = setTimeout(refresh, 3000)
      }
    }
    const visibility = () => {
      ++epoch
      clearTimeout(timer)
      controller?.abort()
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', visibility)
    refresh()
    return () => {
      active = false
      ++epoch
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [load, revision])
  return { data, error, lastUpdated, refresh: () => setRevision(value => value + 1) }
}

function RunProgress({ counters }) {
  const { t, locale } = useI18n()
  if (!counters) return null
  const known = counters.targetCount !== null
  return (
    <div className="space-y-2">
      <p>{known ? `${counters.processedCount}/${counters.targetCount}` : t('batches.preparing_count')}
        {counters.progressPercent !== null ? ` (${counters.progressPercent.toLocaleString(localeTag(locale), { maximumFractionDigits: 1 })}%)` : ''}</p>
      {counters.progressPercent !== null && <progress aria-label={t('batches.progress')} max="100" value={counters.progressPercent} className="w-full" />}
      <dl className="flex flex-wrap gap-4 text-sm">
        {['computed', 'cached', 'shared', 'failed', 'skipped', 'needsReview', 'preparationRequired', 'pending'].map(key => (
          <div key={key}><dt>{t(`batches.count_${key}`)}</dt><dd>{counters[`${key}Count`]}</dd></div>
        ))}
      </dl>
    </div>
  )
}

function PollStatus({ error, lastUpdated }) {
  const { t, locale } = useI18n()
  return <div aria-live="polite">
    {error && <p role="alert" className="text-red-600">{t('batches.stale')}: {error}</p>}
    <p className="text-sm text-gray-500">{t('batches.last_update')}: {lastUpdated ? lastUpdated.toLocaleString(localeTag(locale)) : t('batches.never')}</p>
  </div>
}

export default function BatchProcessing() {
  const { user } = useAuth()
  return user?.role === 'admin' ? <BatchAdministration /> : <Navigate to="/" replace />
}

function BatchAdministration() {
  const { t, locale } = useI18n()
  const confirm = useConfirm()
  const [search, setSearch] = useSearchParams()
  const runId = search.get('runId') || ''
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [searchText, setSearchText] = useState('')
  const [method, setMethod] = useState('')
  const [entityType, setEntityType] = useState('')
  const [cursor, setCursor] = useState(null)
  const [pairStatus, setPairStatus] = useState('')
  const [pairCursor, setPairCursor] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [retryError, setRetryError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const load = useCallback(async signal => {
    const [queue, detail] = await Promise.all([
      batchesApi.list({ status, source, search: searchText, method, entityType, cursor, limit: 25 }, { signal }),
      runId ? batchesApi.get(runId, { pairStatus, cursor: pairCursor, limit: 25 }, { signal }) : null,
    ])
    return { queue, detail }
  }, [status, source, searchText, method, entityType, cursor, runId, pairStatus, pairCursor])
  const polling = useVisiblePolling(load)
  const queue = polling.data?.queue
  const detail = polling.data?.detail
  const eligible = row => ['failed', 'preparation_required', 'needs_review'].includes(row.status)
    || (row.status === 'pending' && detail?.run.stage === 'blocked_credits')
  const selected = (detail?.pairs || []).filter(row => selectedIds.includes(row.pairId) && eligible(row))
  const resetPairs = () => { setSelectedIds([]); setPairCursor(null); setRetryError('') }
  const retry = async () => {
    if (!selected.length || !(await confirm({
      title: t('batches.retry'), message: t('batches.retry_warning'), tone: 'warning',
    }))) return
    setRetrying(true)
    setRetryError('')
    try {
      await batchesApi.retry(runId, selected.map(row => row.pairId), true)
      setSelectedIds([])
      polling.refresh()
    } catch (failure) {
      setRetryError(failure.message)
    } finally {
      setRetrying(false)
    }
  }
  const deleteRun = async targetRunId => {
    if (!(await confirm({
      title: t('batches.delete'), message: t('batches.delete_warning'), tone: 'danger',
    }))) return
    setDeletingId(targetRunId)
    setDeleteError('')
    try {
      await batchesApi.delete(targetRunId)
      if (runId === targetRunId) {
        resetPairs()
        setSearch({}, { replace: true })
      }
      polling.refresh()
    } catch (failure) {
      setDeleteError(failure.message)
    } finally {
      setDeletingId('')
    }
  }
  return <PageContainer>
    <h1 className="text-2xl font-semibold mb-4">{t('nav.batches')}</h1>
    <p>{t('batches.description')}</p>
    <PollStatus error={polling.error} lastUpdated={polling.lastUpdated} />
    <div className="flex flex-wrap gap-3 my-4">
      <label>{t('batches.status')} <select value={status} onChange={event => { setStatus(event.target.value); setCursor(null) }}>
        <option value="">{t('batches.all')}</option>
        {RUN_STAGES.map(value => <option key={value} value={value}>{t(`batches.state_${value}`)}</option>)}
      </select></label>
      <label>{t('batches.source')} <input value={source} maxLength={255} onChange={event => { setSource(event.target.value); setCursor(null) }} /></label>
      <label>{t('batches.search')} <input value={searchText} maxLength={255} onChange={event => { setSearchText(event.target.value); setCursor(null) }} /></label>
      <label>{t('batches.method')} <select value={method} onChange={event => { setMethod(event.target.value); setCursor(null) }}>
        <option value="">{t('batches.all')}</option>
        <option value="vector">{t('matching.method_skill')}</option>
        <option value="ai">{t('matching.method_ai')}</option>
      </select></label>
      <label>{t('batches.entity_type')} <select value={entityType} onChange={event => { setEntityType(event.target.value); setCursor(null) }}>
        <option value="">{t('batches.all')}</option>
        <option value="candidate">{t('batches.entity_candidate')}</option>
        <option value="job">{t('batches.entity_job')}</option>
      </select></label>
      <Button onClick={polling.refresh}>{t('batches.refresh')}</Button>
    </div>
    <Card>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left">
        <thead><tr>{['run', 'source', 'actor', 'method', 'status', 'credits', 'created', 'actions'].map(key => <th key={key} className="p-2">{t(`batches.${key}`)}</th>)}</tr></thead>
        <tbody>{queue?.items.map(({ run, counters }) => <tr key={run.runId}>
          <td className="p-2"><button className="text-blue-600 underline" onClick={() => { resetPairs(); setSearch({ runId: run.runId }) }}>{run.runId}</button>
            <div>{run.entityType && t(`batches.entity_${run.entityType}`, run.entityType)} {run.entityId}</div><div>{counters.targetCount === null ? t('batches.preparing_count') : `${counters.processedCount}/${counters.targetCount}`}</div></td>
          <td>{run.source}</td><td>{run.actorDisplayName || run.actorUsername || run.actorUserId || '-'}</td>
          <td>{t(run.method === 'ai' ? 'matching.method_ai' : 'matching.method_skill')}</td>
          <td>{t(`batches.state_${run.stage}`)}{run.errorCode && <div>{t(`batches.error_${run.errorCode}`, run.errorCode)}</div>}</td>
          <td>{t(`batches.credit_${run.creditStatus}`)} {run.chargedAmount}</td><td>{new Date(run.createdAt).toLocaleString(localeTag(locale))}</td>
          <td><Button size="sm" variant="danger" disabled={deletingId === run.runId || ['preparing', 'matching'].includes(run.stage)}
            title={['preparing', 'matching'].includes(run.stage) ? t('batches.delete_active') : undefined}
            onClick={() => deleteRun(run.runId)}>{t('batches.delete')}</Button></td>
        </tr>)}</tbody>
      </table></div>
      {queue?.items.length === 0 && <p>{t('batches.empty')}</p>}
      {!queue && !polling.error && <p role="status">{t('common.loading')}</p>}
      {deleteError && <p role="alert" className="text-red-600">{deleteError}</p>}
      <Button disabled={!cursor} onClick={() => setCursor(null)}>{t('batches.first_page')}</Button>
      <Button disabled={!queue?.nextCursor} onClick={() => setCursor(queue.nextCursor)}>{t('batches.next_page')}</Button>
    </Card>
    {detail && <Card className="mt-4">
      <h2 className="text-xl">{t('batches.run')}: {detail.run.runId}</h2>
      <p>{t(`batches.state_${detail.run.stage}`)} {detail.run.errorCode && t(`batches.error_${detail.run.errorCode}`, detail.run.errorCode)}</p>
      <RunProgress counters={detail.counters} />
      <p>{t('batches.server_update')}: {detail.counters.updatedAt}</p>
      <label>{t('batches.pair_status')} <select value={pairStatus} onChange={event => { resetPairs(); setPairStatus(event.target.value) }}>
        <option value="">{t('batches.all')}</option>
        {PAIR_STATES.map(value => <option key={value} value={value}>{t(`batches.state_${value}`)}</option>)}
      </select></label>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left">
        <thead><tr>{['select', 'pair_id', 'candidate_id', 'job_id', 'status', 'score', 'matched_at'].map(key => <th key={key}>{t(`batches.${key}`)}</th>)}</tr></thead>
        <tbody>{detail.pairs.map(row => <tr key={row.pairId}>
          <td><input type="checkbox" aria-label={`${t('batches.select')} ${row.pairId}`} disabled={!eligible(row) || retrying}
            checked={selected.some(pair => pair.pairId === row.pairId)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, row.pairId] : ids.filter(id => id !== row.pairId))} /></td>
          <td>{row.pairId}</td><td>{row.candidateId ?? '-'}</td><td>{row.jobId ?? '-'}</td>
          <td>{t(`batches.state_${row.status}`)}{row.errorCode && <div>{t(`batches.error_${row.errorCode}`, row.errorCode)}</div>}</td>
          <td>{row.resultPayload?.score ?? '-'}</td><td>{row.matchedAt || '-'}</td>
        </tr>)}</tbody>
      </table></div>
      <Button disabled={!pairCursor} onClick={() => { setPairCursor(null); setSelectedIds([]) }}>{t('batches.first_page')}</Button>
      <Button disabled={!detail.nextCursor} onClick={() => { setPairCursor(detail.nextCursor); setSelectedIds([]) }}>{t('batches.next_page')}</Button>
      <Button disabled={!selected.length || retrying} onClick={retry}>{t('batches.retry')}</Button>
      <p>{t('batches.idle_only')}</p>
      {retryError && <p role="alert" className="text-red-600">{retryError}</p>}
    </Card>}
  </PageContainer>
}

export function OwnMatchingRunStatus() {
  const { runId } = useParams()
  const { t } = useI18n()
  const load = useCallback(signal => matchingApi.getRun(runId, { signal }), [runId])
  const polling = useVisiblePolling(load)
  return <PageContainer>
    <h1>{t('batches.run')}: {runId}</h1>
    <PollStatus error={polling.error} lastUpdated={polling.lastUpdated} />
    {polling.data && <>
      <p>{t(`batches.state_${polling.data.stage}`)}</p>
      {polling.data.errorCode && <p role="alert">{t(`batches.error_${polling.data.errorCode}`, polling.data.errorCode)}</p>}
      <RunProgress counters={polling.data.counters} />
    </>}
  </PageContainer>
}
