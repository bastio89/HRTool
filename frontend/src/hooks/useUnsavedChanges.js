import { useEffect, useRef, useCallback } from 'react'

/**
 * Guards a form against losing edits.
 *
 * Long forms used to let you navigate away (or close the tab) silently, with the
 * save button parked at the very bottom of the page. This hook covers the two
 * exits we can actually intercept:
 *
 *  - closing / reloading the tab  -> native beforeunload prompt
 *  - in-app navigation we control -> `confirmLeave()` before navigate()
 *
 * The app mounts a plain <BrowserRouter>, not a data router, so react-router's
 * useBlocker is unavailable; route changes therefore have to go through
 * `confirmLeave()` explicitly (Cancel button, back link).
 */
export default function useUnsavedChanges(isDirty, confirm, texts = {}) {
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty

  useEffect(() => {
    if (!isDirty) return undefined
    const onBeforeUnload = (e) => {
      e.preventDefault()
      // Browsers ignore custom text, but a returnValue is still required.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return true
    return confirm({
      title: texts.title,
      message: texts.message,
      confirmLabel: texts.discardLabel,
      cancelLabel: texts.stayLabel,
      tone: 'warning',
    })
  }, [confirm, texts.title, texts.message, texts.discardLabel, texts.stayLabel])

  return confirmLeave
}
