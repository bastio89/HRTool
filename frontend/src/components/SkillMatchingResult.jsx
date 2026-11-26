import { matchingScorePercent } from '../api'
import { ScoreBadge, ScoreRing } from './UI'
import { useI18n } from '../I18nContext'

function formatSkillScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : null
}

export default function SkillMatchingResult({ result, failure }) {
  const { t } = useI18n()
  const score = result ? matchingScorePercent(result.score, 'vector') : null

  return (
    <div className="mt-3 rounded-[14px] bg-[#0071e3]/5 border border-[#0071e3]/10 px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold text-[#0071e3]">
            {t('matching.skill_result')}{score == null ? `: ${t('matching.score_missing')}` : ''}
          </span>
          {result && (
            <>
              <span>{t('matching.hard_skill')}: {formatSkillScore(result.hardSkillScore) ?? t('matching.score_missing')}</span>
              <span>{t('matching.soft_skill')}: {formatSkillScore(result.softSkillScore) ?? t('matching.score_missing')}</span>
            </>
          )}
        </div>
        {score != null && (
          <div className="flex shrink-0 items-center gap-3">
            <div role="img" aria-label={`${t('matching.skill_result')}: ${score}%`}>
              <ScoreRing score={score / 100} size={72} strokeWidth={5} />
            </div>
            <ScoreBadge score={score / 100} />
          </div>
        )}
      </div>
      {failure && <p role="alert" className="mt-1 text-[#ff3b30]">{failure}</p>}
      {result?.summary && <p className="mt-1 text-gray-600 dark:text-gray-300">{result.summary}</p>}
    </div>
  )
}
