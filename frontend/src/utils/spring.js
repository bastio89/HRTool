/**
 * Springs, parameterised the way Apple exposes them to designers: a response
 * time and a damping ratio, rather than mass/stiffness/damping.
 *
 *   response      how quickly the value reaches the target, in seconds.
 *                 Lower is snappier. This is NOT a duration - a spring has no
 *                 fixed one; the settle time falls out of the parameters.
 *   dampingRatio  1.0 settles without overshoot; below 1.0 overshoots.
 *                 Bounce belongs to momentum-driven gestures (a flick, a
 *                 throw), never to something that merely appeared.
 *
 * Why a spring and not a CSS transition: a transition cannot be grabbed and
 * redirected halfway. A spring takes a new target at any moment and keeps
 * moving continuously from wherever it currently is, carrying its velocity -
 * which is exactly what an interruptible gesture needs.
 */

export const SPRING_MOVE = { response: 0.4, dampingRatio: 1.0 }   // reposition
export const SPRING_FLICK = { response: 0.4, dampingRatio: 0.8 }  // after a throw

const EPSILON = 0.5       // px - below this the eye cannot tell it is still moving
const EPSILON_V = 2       // px/s
const MAX_DT = 1 / 30     // clamp so a stalled tab cannot explode the integrator

/**
 * Animates {x, y} to a target with two independent integrators.
 *
 * X and Y are deliberately separate: a single spring driven by the 2D distance
 * desynchronises as soon as the two axes carry different velocities.
 *
 * Returns a handle whose `stop()` yields the live value and velocity, so a new
 * gesture can pick up exactly where this one was — no jump, no velocity
 * discontinuity at the hand-off.
 */
export function springTo({
  from,
  to,
  velocity = { x: 0, y: 0 },
  response = SPRING_MOVE.response,
  dampingRatio = SPRING_MOVE.dampingRatio,
  onUpdate,
  onRest,
}) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const state = { x: from.x, y: from.y }
  const vel = { x: velocity.x, y: velocity.y }

  if (reduced) {
    onUpdate?.({ ...to })
    onRest?.()
    return { stop: () => ({ value: { ...to }, velocity: { x: 0, y: 0 } }), isRunning: () => false }
  }

  const omega = (2 * Math.PI) / response
  let raf = null
  let last = null
  let running = true

  const step = (now) => {
    if (!running) return
    if (last === null) last = now
    let dt = Math.min((now - last) / 1000, MAX_DT)
    last = now

    let settled = true
    for (const axis of ['x', 'y']) {
      const displacement = state[axis] - to[axis]
      // Semi-implicit Euler: stable at the frame rates a browser actually hits.
      const accel = -omega * omega * displacement - 2 * dampingRatio * omega * vel[axis]
      vel[axis] += accel * dt
      state[axis] += vel[axis] * dt
      if (Math.abs(state[axis] - to[axis]) > EPSILON || Math.abs(vel[axis]) > EPSILON_V) settled = false
    }

    if (settled) {
      state.x = to.x; state.y = to.y
      vel.x = 0; vel.y = 0
      running = false
      onUpdate?.({ ...state })
      onRest?.()
      return
    }
    onUpdate?.({ ...state })
    raf = requestAnimationFrame(step)
  }

  raf = requestAnimationFrame(step)

  return {
    isRunning: () => running,
    stop() {
      running = false
      if (raf !== null) cancelAnimationFrame(raf)
      return { value: { ...state }, velocity: { ...vel } }
    },
  }
}

/**
 * Where a flick would come to rest, using the same exponential decay a scroll
 * view uses. Snapping to whatever sits under the release point ignores that the
 * user threw the card; projecting first is what makes a small flick produce a
 * big, intentional-feeling move.
 *
 * Note this is not the textbook v^2/(2a) - it is the decay form UIScrollView
 * behaves like, and the one Apple's own sample code uses.
 */
export function projectMomentum(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}

/**
 * Progressive resistance past a boundary. A hard stop reads as "frozen"; this
 * reads as "responsive, but there is nothing more this way".
 */
export function rubberband(overshoot, dimension, constant = 0.55) {
  if (!dimension) return 0
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}
