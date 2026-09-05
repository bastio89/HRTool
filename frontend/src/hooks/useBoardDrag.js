import { useCallback, useRef, useState, useEffect } from 'react'
import { springTo, projectMomentum, rubberband, SPRING_MOVE, SPRING_FLICK } from '../utils/spring'

/**
 * Pointer-driven card dragging for the kanban board.
 *
 * Replaces HTML5 drag-and-drop, which gave us none of the things that make a
 * drag feel physical: it reports no position during the gesture, carries no
 * velocity into the drop, cannot be interrupted, and never fires at all on
 * touch. Pointer Events give one code path for mouse, pen and touch.
 *
 * What this implements:
 *  - the card stays glued to the pointer, respecting where it was grabbed
 *  - a short threshold before the drag commits, so taps and button presses
 *    inside the card still work
 *  - horizontal intent wins the gesture; a vertical drag is handed back to the
 *    browser so a column can still be scrolled by touch
 *  - release velocity is projected forward, so a flick throws the card into the
 *    column it was aimed at rather than the one it happened to be over
 *  - the card springs home carrying that velocity, and the spring can be
 *    grabbed again mid-flight
 */

const DRAG_THRESHOLD = 8          // px before a press becomes a drag
const DIRECTION_BIAS = 1.2        // how much more horizontal than vertical to claim it
const VELOCITY_WINDOW = 100       // ms of pointer history used for the release velocity
const MAX_SAMPLES = 8

export default function useBoardDrag({ onDrop, canDrag = true }) {
  const [activeId, setActiveId] = useState(null)
  const [hoverStage, setHoverStage] = useState(null)

  const cardsRef = useRef(new Map())          // entryId -> element
  const getColumnsRef = useRef(() => [])      // supplied by the board
  const columnsRef = useRef([])               // [{ stage, rect }] captured at drag start
  const springRef = useRef(null)
  const gestureRef = useRef(null)
  const suppressClickRef = useRef(false)

  const registerCard = useCallback((id, el) => {
    if (el) cardsRef.current.set(id, el)
    else cardsRef.current.delete(id)
  }, [])

  const registerColumns = useCallback((getRects) => { getColumnsRef.current = getRects }, [])

  const setTransform = (el, x, y, lifted) => {
    if (!el) return
    el.style.transform = lifted
      ? `translate3d(${x}px, ${y}px, 0) scale(1.03)`
      : `translate3d(${x}px, ${y}px, 0)`
  }

  // Nearest column by horizontal distance - used when a throw carries the
  // projected point past the edge of the board.
  const nearestStage = (point) => {
    let best = null, bestDist = Infinity
    for (const col of columnsRef.current) {
      const r = col.rect
      const cx = (r.left + r.right) / 2
      const d = Math.abs(point.x - cx)
      if (d < bestDist) { bestDist = d; best = col.stage }
    }
    return best
  }

  const stageAt = (point) => {
    for (const col of columnsRef.current) {
      const r = col.rect
      if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) return col.stage
    }
    return null
  }

  /**
   * Progressive resistance past the outer columns.
   *
   * Without it the card follows the pointer into empty space, which says
   * nothing; a hard stop instead would read as "frozen". Resistance says
   * "still responding, but there is nothing more this way" - and it keeps the
   * card visually attached to the board it belongs to.
   */
  const resist = (g, offset) => {
    if (!g.bounds || !g.cardRect) return offset
    const out = { ...offset }
    // The reference dimension is also the asymptote: however hard you pull, the
    // card cannot get further past the edge than this. One column horizontally
    // reads as "one more stage would be off the board"; vertically half the
    // board is enough to show the give without letting the card wander away.
    const columnWidth = columnsRef.current[0]?.rect.width || 200
    const axes = [
      { key: 'x', lo: 'left', hi: 'right', size: columnWidth },
      { key: 'y', lo: 'top', hi: 'bottom', size: (g.bounds.bottom - g.bounds.top) / 2 },
    ]
    for (const a of axes) {
      const lead = g.cardRect[a.lo] + out[a.key]
      const trail = g.cardRect[a.hi] + out[a.key]
      if (lead < g.bounds[a.lo]) {
        const over = g.bounds[a.lo] - lead
        out[a.key] += over - rubberband(over, a.size)
      } else if (trail > g.bounds[a.hi]) {
        const over = trail - g.bounds[a.hi]
        out[a.key] -= over - rubberband(over, a.size)
      }
    }
    return out
  }

  const endGesture = useCallback((commit) => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null

    const el = g.el
    try { el?.releasePointerCapture?.(g.pointerId) } catch { /* already released */ }

    if (!g.dragging) {
      setActiveId(null)
      setHoverStage(null)
      return
    }

    // Velocity over the last few samples, not just the final two - a single
    // frame is far too noisy to steer a projection with.
    const now = performance.now()
    const recent = g.samples.filter(s => now - s.t <= VELOCITY_WINDOW)
    const first = recent[0] || g.samples[0]
    const last = g.samples[g.samples.length - 1]
    let vx = 0, vy = 0
    // A synthetic or coalesced burst can put two samples in the same
    // millisecond; dividing by that produces an infinite velocity and a
    // projection that lands nowhere.
    const span = first && last ? last.t - first.t : 0
    if (span > 4) {
      const dt = span / 1000
      vx = (last.x - first.x) / dt
      vy = (last.y - first.y) / dt
    }
    const MAX_V = 6000   // px/s - beyond this it is noise, not intent
    vx = Math.max(-MAX_V, Math.min(MAX_V, vx))
    vy = Math.max(-MAX_V, Math.min(MAX_V, vy))

    let targetStage = null
    if (commit) {
      // Aim at where the gesture was heading, not where the finger stopped.
      //
      // The throw is capped at two columns. Unbounded, a hard flick projects
      // roughly a thousand pixels - past the whole board - and every fast
      // gesture would land in the last stage, which here means "rejected".
      // Two columns still reads as thrown while keeping the result plausible;
      // the confirmation prompt that follows remains the real safety net.
      const columnWidth = columnsRef.current[0]
        ? columnsRef.current[0].rect.width
        : 200
      const cap = columnWidth * 2
      const clamp = v => Math.max(-cap, Math.min(cap, v))
      const projected = {
        x: g.pointer.x + clamp(projectMomentum(vx)),
        y: g.pointer.y + clamp(projectMomentum(vy)),
      }
      // Past the outermost column the nearest one still wins, rather than
      // collapsing back to wherever the finger happened to stop.
      targetStage = stageAt(projected) || nearestStage(projected) || stageAt(g.pointer)
    }

    // Spring home from wherever the card currently is, carrying the release
    // velocity so there is no seam between dragging and animating.
    const flicked = Math.hypot(vx, vy) > 200
    springRef.current = springTo({
      from: { x: g.offset.x, y: g.offset.y },
      to: { x: 0, y: 0 },
      velocity: { x: vx, y: vy },
      ...(flicked ? SPRING_FLICK : SPRING_MOVE),
      onUpdate: ({ x, y }) => setTransform(el, x, y, false),
      onRest: () => {
        if (el) { el.style.transform = ''; el.style.zIndex = ''; el.style.willChange = '' }
        springRef.current = null
        setActiveId(null)
      },
    })

    setHoverStage(null)
    if (commit && targetStage) onDrop?.(g.entry, targetStage)
  }, [onDrop])

  const handlePointerDown = useCallback((e, entry) => {
    if (!canDrag) return
    if (e.button !== undefined && e.button !== 0) return
    // Controls inside the card keep their own behaviour.
    if (e.target.closest('button, a, input, select, textarea')) return

    const el = cardsRef.current.get(entry.id)
    if (!el) return

    // Interrupting a settling card: take over its current position and speed
    // instead of snapping back to the logical origin first.
    let startOffset = { x: 0, y: 0 }
    let carried = { x: 0, y: 0 }
    if (springRef.current?.isRunning()) {
      const s = springRef.current.stop()
      startOffset = s.value
      carried = s.velocity
      springRef.current = null
    }

    gestureRef.current = {
      entry, el,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      pointer: { x: e.clientX, y: e.clientY },
      offset: startOffset,
      base: startOffset,
      carried,
      dragging: false,
      abandoned: false,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    }
  }, [canDrag])

  const handlePointerMove = useCallback((e) => {
    const g = gestureRef.current
    if (!g || g.abandoned || e.pointerId !== g.pointerId) return

    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y

    if (!g.dragging) {
      const dist = Math.hypot(dx, dy)
      if (dist < DRAG_THRESHOLD) return
      // Decide between "drag a card" and "scroll the column" once, at the
      // moment intent becomes readable, then commit to the winner.
      if (Math.abs(dy) > Math.abs(dx) * DIRECTION_BIAS) { g.abandoned = true; return }
      g.dragging = true
      // Measured once, here: the board does not reflow while a card is airborne,
      // and re-measuring per frame would be the expensive part of the gesture.
      columnsRef.current = getColumnsRef.current() || []

      // The card's own box, with any transform from an interrupted spring taken
      // back out, so the boundary maths works on real page coordinates.
      const r = g.el.getBoundingClientRect()
      g.cardRect = {
        left: r.left - g.base.x, right: r.right - g.base.x,
        top: r.top - g.base.y, bottom: r.bottom - g.base.y,
        width: r.width, height: r.height,
      }
      const cols = columnsRef.current
      g.bounds = cols.length ? {
        left: Math.min(...cols.map(c => c.rect.left)),
        right: Math.max(...cols.map(c => c.rect.right)),
        top: Math.min(...cols.map(c => c.rect.top)),
        bottom: Math.max(...cols.map(c => c.rect.bottom)),
      } : null
      try { g.el.setPointerCapture(g.pointerId) } catch { /* capture unsupported */ }
      g.el.style.zIndex = '40'
      g.el.style.willChange = 'transform'
      setActiveId(g.entry.id)
    }

    e.preventDefault()
    g.pointer = { x: e.clientX, y: e.clientY }
    g.offset = resist(g, { x: g.base.x + dx, y: g.base.y + dy })
    setTransform(g.el, g.offset.x, g.offset.y, true)

    g.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (g.samples.length > MAX_SAMPLES) g.samples.shift()

    const over = stageAt(g.pointer)
    setHoverStage(prev => (prev === over ? prev : over))
  }, [])

  const handlePointerUp = useCallback((e) => {
    const g = gestureRef.current
    if (!g || e.pointerId !== g.pointerId) return
    if (g.dragging) suppressClickRef.current = true
    endGesture(true)
  }, [endGesture])

  const handlePointerCancel = useCallback((e) => {
    const g = gestureRef.current
    if (!g || e.pointerId !== g.pointerId) return
    endGesture(false)
  }, [endGesture])

  // A drag must not also register as a click on the card behind it.
  const handleClickCapture = useCallback((e) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  useEffect(() => () => { springRef.current?.stop() }, [])

  const cardProps = useCallback((entry) => ({
    onPointerDown: (e) => handlePointerDown(e, entry),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onClickCapture: handleClickCapture,
    // Vertical panning stays with the browser so columns can still be scrolled
    // by touch; horizontal movement is ours.
    style: { touchAction: 'pan-y' },
  }), [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handleClickCapture])

  return { activeId, hoverStage, registerCard, registerColumns, cardProps }
}
