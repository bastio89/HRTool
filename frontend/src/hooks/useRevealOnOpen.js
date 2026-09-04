import { useEffect, useRef } from 'react'

/**
 * Scrolls a panel into view when it opens.
 *
 * Inline panels (an "add task" form under a card deep in a list, a dropdown near
 * the bottom of the viewport) used to appear off-screen: the user clicked a
 * button and nothing visibly happened until they scrolled. Attaching this ref
 * makes the panel reveal itself.
 *
 *   const panelRef = useRevealOnOpen(isOpen)
 *   {isOpen && <div ref={panelRef}>…</div>}
 */
export default function useRevealOnOpen(open, { block = 'nearest' } = {}) {
  const ref = useRef(null)

  useEffect(() => {
    if (!open || !ref.current) return undefined
    const el = ref.current
    const id = requestAnimationFrame(() => {
      const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block })
    })
    return () => cancelAnimationFrame(id)
  }, [open, block])

  return ref
}
