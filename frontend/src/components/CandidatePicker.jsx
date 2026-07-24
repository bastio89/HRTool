import { Search, CheckSquare, Square, Circle, CheckCircle2, Loader2, Users } from 'lucide-react'
import { EmptyState, Button } from './UI'
import { useI18n } from '../I18nContext'

/**
 * Reusable candidate selection list for the matching pages.
 *
 * Props:
 * - candidates: array of { id, name, skills }
 * - selectedIds: number[]
 * - onToggle(id): toggle a candidate
 * - onToggleAll(): select/deselect all (multi mode only)
 * - selectAll: boolean (multi mode only)
 * - searchTerm, onSearch: controlled search input
 * - single: boolean — single-select (radio) vs multi-select (checkbox)
 * - pipelineIds: number[] — candidates highlighted as coming from a job pipeline
 * - pipelineLoading: boolean
 * - onCreate(): callback for the empty-state action
 */
export default function CandidatePicker({
  candidates,
  selectedIds,
  onToggle,
  onToggleAll,
  selectAll = false,
  searchTerm,
  onSearch,
  single = false,
  pipelineIds = [],
  pipelineLoading = false,
  onCreate,
}) {
  const { t } = useI18n()

  const filtered = candidates.filter(c =>
    !searchTerm ||
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.skills && c.skills.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('matching.no_candidates')}
        description={t('matching.no_candidates_desc')}
        action={onCreate && <Button variant="secondary" size="md" onClick={onCreate}>{t('matching.create_candidate')}</Button>}
      />
    )
  }

  return (
    <>
      <div className="relative mb-6">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder={t('matching.filter')}
          value={searchTerm}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full pl-14 pr-5 py-4 text-[15px] bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[20px]
            text-black dark:text-white font-medium focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10 transition-all"
        />
      </div>

      {!single && (
        <button
          onClick={onToggleAll}
          className="flex items-center gap-4 w-full px-5 py-4 rounded-[20px] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors text-[15px] font-semibold text-gray-700 dark:text-gray-300 cursor-pointer mb-4"
        >
          {selectAll ? <CheckSquare className="w-6 h-6 text-[#0071e3]" /> : <Square className="w-6 h-6 text-gray-300" />}
          {t('matching.select_all')}
        </button>
      )}

      {pipelineLoading && (
        <div className="flex items-center gap-3 px-5 py-3 mb-3 rounded-[16px] bg-[#0071e3]/5 text-[#0071e3] text-[13px] font-medium">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('matching.pipeline_loading')}
        </div>
      )}

      <div className="space-y-2 max-h-[450px] overflow-y-auto pr-2">
        {filtered.map(candidate => {
          const isSelected = selectedIds.includes(candidate.id)
          const isFromPipeline = pipelineIds.includes(candidate.id)
          const SelectedIcon = single ? CheckCircle2 : CheckSquare
          const EmptyIcon = single ? Circle : Square
          return (
            <button
              key={candidate.id}
              onClick={() => onToggle(candidate.id)}
              className={`flex items-center gap-5 w-full px-5 py-4 rounded-[20px] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors text-left cursor-pointer ${
                isFromPipeline && isSelected ? 'bg-[#0071e3]/5 ring-1 ring-[#0071e3]/20' : ''
              }`}
            >
              {isSelected
                ? <SelectedIcon className="w-6 h-6 text-[#0071e3] flex-shrink-0" />
                : <EmptyIcon className="w-6 h-6 text-gray-300 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[16px] font-semibold text-black dark:text-white truncate">{candidate.name}</p>
                  {isFromPipeline && (
                    <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[11px] font-bold">
                      {t('matching.pipeline_badge')}
                    </span>
                  )}
                </div>
                {candidate.skills && (
                  <p className="text-[14px] font-medium text-gray-500 dark:text-gray-400 truncate mt-1">
                    {candidate.skills}
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}
