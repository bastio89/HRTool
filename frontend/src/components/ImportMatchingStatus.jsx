import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { useI18n } from '../I18nContext'

export default function ImportMatchingStatus({ runId, status }) {
  const auth = useAuth()
  const { t } = useI18n()
  if (!runId) return null
  const admin = auth?.user?.role === 'admin'
  const path = admin ? `/admin/batches?runId=${encodeURIComponent(runId)}` : `/matching/runs/${encodeURIComponent(runId)}`
  return <div className="text-sm mt-2">
    <p>{status === 'queued' ? t('batches.import_queued') : `${t('batches.import_saved')}: ${status ? t(`batches.state_${status}`, status) : t('batches.status_unknown')}`}</p>
    <Link className="text-blue-600 underline break-all" to={path} onClick={event => event.stopPropagation()}>
      {t(admin ? 'batches.open_admin' : 'batches.open_own')}: {runId}
    </Link>
  </div>
}
