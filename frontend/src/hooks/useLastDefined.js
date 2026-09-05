import { useRef } from 'react'

/**
 * Keeps the last non-empty value.
 *
 * A dialog stays mounted for the length of its exit animation, but the state
 * that fed it is usually cleared the moment it closes. Without this the panel
 * would blank out its own content - or crash on a null - while leaving.
 */
export default function useLastDefined(value) {
  const ref = useRef(value)
  if (value !== null && value !== undefined) ref.current = value
  return value ?? ref.current
}
