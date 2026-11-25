import { Link } from 'react-router-dom'
import { matchingScorePercent } from '../api'
import { useI18n } from '../I18nContext'
import { localeTag } from '../utils/format'

export default function MatchingResultMetadata({ result, historical = false }) {
  const { t, locale } = useI18n()
  const verified = result.evaluationId && result.matchedAt && ['ai', 'vector'].includes(result.method)
    && ['hit', 'computed'].includes(result.cacheStatus)
  const validity = result.cacheStatus === 'stale' ? 'stale' : !verified ? 'unverified' : historical ? 'historical' : null
  return <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-1">
    {['ai', 'vector'].includes(result.method) && <p>{t(result.method === 'ai' ? 'matching.method_ai' : 'matching.method_skill')}</p>}
    {['hit', 'computed'].includes(result.cacheStatus) && <p>{t(`matching.cache_${result.cacheStatus}`)}</p>}
    {validity && <p>{t(`matching.validity_${validity}`)}</p>}
    {result.matchedAt && <p>{t('matching.original_time')}: <time dateTime={result.matchedAt}>{new Date(result.matchedAt).toLocaleString(localeTag(locale))}</time></p>}
    {result.evaluationId && <p>{t('matching.evaluation_id')}: {result.evaluationId}</p>}
  </div>
}

export function MatchingRunNotice({ progress }) {
  const { t, locale } = useI18n()
  if (!progress?.runId) return null
  const counters = progress.counters
  return <section aria-label={t('matching.run_status')} className="p-4 my-4 rounded-xl border border-blue-200" aria-live="polite">
    <h2>{t('matching.run_status')}</h2>
    <Link className="text-blue-600 underline break-all" to={`/matching/runs/${encodeURIComponent(progress.runId)}`}>{progress.runId}</Link>
    <p>{t(`batches.state_${progress.stage || 'pending'}`)}</p>
    {counters && <p>{counters.targetCount === null ? t('batches.preparing_count') : `${counters.processedCount}/${counters.targetCount}`}
      {Number.isFinite(counters.progressPercent) && ` (${counters.progressPercent.toLocaleString(localeTag(locale))}%)`}</p>}
    {progress.updatedAt && <p>{t('batches.server_update')}: <time dateTime={progress.updatedAt}>{new Date(progress.updatedAt).toLocaleString(localeTag(locale))}</time></p>}
    {(progress.availableResults || []).map((row, index) => <div key={`${row.candidateId}-${row.jobId}-${index}`}>
      <p>{row.candidateName || row.candidateId} · {row.jobTitle || row.jobId}: {row.score == null ? t('matching.score_missing') : `${matchingScorePercent(row.score, row.method)}%`}</p>
      <MatchingResultMetadata result={row} />
    </div>)}
    {(progress.pendingPairs || []).map((pair, index) => <p key={`${pair.candidateId}-${pair.jobId}-${index}`}>
      {t('detail.candidate_id')}: {pair.candidateId} · {t('jobs.id')}: {pair.jobId} · {t(`batches.state_${pair.status}`)}
    </p>)}
  </section>
}
