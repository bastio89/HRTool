import { useEffect, useRef, useCallback } from 'react'
import { useBlocker } from 'react-router-dom'

/**
 * Guards a form against losing edits.
 *
 * Covers every way out of a dirty form:
 *  - closing / reloading the tab   -> native beforeunload prompt
 *  - any in-app navigation         -> useBlocker (sidebar, breadcrumb, browser
 *                                     back/forward, programmatic navigate)
 *  - the form's own Cancel / back  -> confirmLeave() before navigate()
 *
 * useBlocker needs a data router; the app was moved from <BrowserRouter> to
 * createBrowserRouter for exactly this reason. Before that, a click in the
 * sidebar silently discarded the edits.
 *
 * Returns { confirmLeave, markSaved }. Call markSaved() right before navigating
 * away after a successful save - it clears the dirty flag synchronously, which
 * a state update cannot do: the router asks the block predicate inside
 * navigate(), before React has re-rendered, so a state-based flag would still
 * read "dirty" and pop the dialog on a successful save.
 */
export default function useUnsavedChanges(isDirty, confirm, texts = {}) {
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty

  const savedRef = useRef(false)
  const isBlocked = () => dirtyRef.current && !savedRef.current

  useEffect(() => {
    if (!isDirty) return undefined
    const onBeforeUnload = (e) => {
      if (!isBlocked()) return undefined
      e.preventDefault()
      // Browsers ignore custom text, but a returnValue is still required.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  const askRef = useRef({ title: '', message: '', discardLabel: '', stayLabel: '' })
  askRef.current = texts

  const ask = useCallback(() => confirm({
    title: askRef.current.title,
    message: askRef.current.message,
    confirmLabel: askRef.current.discardLabel,
    cancelLabel: askRef.current.stayLabel,
    tone: 'warning',
  }), [confirm])

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isBlocked() && currentLocation.pathname !== nextLocation.pathname
  )

  // Guarded by a ref rather than state: resetting the blocker re-runs this
  // effect while `state` is briefly still "blocked", and a state flag would let
  // it re-open the dialog immediately - an endless prompt loop.
  const pendingRef = useRef(false)
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      pendingRef.current = false
      return
    }
    if (pendingRef.current) return
    pendingRef.current = true
    ask().then((ok) => {
      pendingRef.current = false
      if (ok) blocker.proceed()
      else blocker.reset()
    })
    // `blocker` is a new object each render, so key the effect on its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state])

  const confirmLeave = useCallback(async () => {
    if (!isBlocked()) return true
    return ask()
  }, [ask])

  const markSaved = useCallback(() => { savedRef.current = true }, [])

  return { confirmLeave, markSaved }
}
