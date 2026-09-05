import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { AlertTriangle, Trash2, Info } from 'lucide-react'
import Modal from './Modal'
import { Button } from './UI'
import { useI18n } from '../I18nContext'

/**
 * One confirmation dialog for the whole app – replaces the native `confirm()`
 * calls and the inline "are you sure?" rows that each page used to invent.
 *
 * Imperative usage (drop-in for `confirm()`):
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: '…', message: '…', tone: 'danger' }))) return
 */

const ConfirmContext = createContext(() => Promise.resolve(false))

export const useConfirm = () => useContext(ConfirmContext)

const TONES = {
  danger: { icon: Trash2, ring: 'bg-[#ff3b30]/10', color: 'text-[#ff3b30]', variant: 'danger' },
  warning: { icon: AlertTriangle, ring: 'bg-[#ff9f0a]/10', color: 'text-[#ff9f0a]', variant: 'dark' },
  info: { icon: Info, ring: 'bg-[#0071e3]/10', color: 'text-[#0071e3]', variant: 'dark' },
}

export function ConfirmProvider({ children }) {
  const { t } = useI18n()
  const [state, setState] = useState(null)
  const [lastState, setLastState] = useState(null)
  const resolverRef = useRef(null)
  const confirmButtonRef = useRef(null)

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options || {}
    return new Promise((resolve) => {
      resolverRef.current = resolve
      const next = { tone: 'danger', ...opts }
      setState(next)
      setLastState(next)
    })
  }, [])

  const settle = useCallback((result) => {
    setState(null)
    // Let the dialog finish leaving before its content is dropped.
    setTimeout(() => setLastState(null), 250)
    const resolve = resolverRef.current
    resolverRef.current = null
    if (resolve) resolve(result)
  }, [])

  const tone = TONES[lastState?.tone] || TONES.danger
  const ToneIcon = tone.icon

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* The Modal stays mounted for its exit animation, so `open` toggles
          rather than the whole element appearing and disappearing. The last
          options are kept while it leaves, otherwise the dialog would blank out
          its own text mid-dismissal. */}
      {lastState && (
        <Modal
          open={Boolean(state)}
          onClose={() => settle(false)}
          size="sm"
          showClose={false}
          initialFocusRef={confirmButtonRef}
          title={lastState.title || t('common.confirm_title', 'Sind Sie sicher?')}
          footer={
            <>
              <Button variant="secondary" onClick={() => settle(false)}>
                {lastState.cancelLabel || t('common.cancel')}
              </Button>
              <Button
                ref={confirmButtonRef}
                variant={lastState.confirmVariant || tone.variant}
                onClick={() => settle(true)}
              >
                {lastState.confirmLabel || t('common.delete')}
              </Button>
            </>
          }
        >
          <div className="flex gap-4">
            <div className={`w-11 h-11 rounded-full ${tone.ring} flex items-center justify-center flex-shrink-0`}>
              <ToneIcon className={`w-5 h-5 ${tone.color}`} />
            </div>
            <p className="text-[16px] leading-relaxed text-gray-600 dark:text-gray-300 pt-2">
              {lastState.message}
            </p>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}
