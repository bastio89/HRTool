import { useEffect, useRef, useCallback, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '../I18nContext'

/**
 * Shared modal primitive for the whole app.
 *
 * Every dialog MUST go through this component. It guarantees the behaviour that
 * used to be missing or inconsistent across the 11 hand-rolled dialogs:
 *
 *  - rendered through a portal into <body>, so a transformed ancestor (e.g. the
 *    `.fade-in` page wrapper) can never turn it into a page-anchored box that
 *    the user has to scroll to find
 *  - always centred in the viewport, never in the document
 *  - Escape closes, backdrop click closes (both opt-out via props)
 *  - focus moves into the dialog on open, is trapped while open and returns to
 *    the trigger on close
 *  - the page behind is scroll-locked (both <body> and the app scroll container)
 *  - correct dialog semantics: role, aria-modal, aria-labelledby
 *  - one size scale, one radius, one backdrop, one z-layer
 */

const SIZES = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[960px]',
  full: 'max-w-[1200px]',
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Must match .animate-modal-out in index.css. */
const EXIT_MS = 200

/** Number of modals currently mounted – the scroll lock is released by the last one. */
let openModalCount = 0
let previousBodyOverflow = ''
let previousScrollerOverflow = ''

function appScroller() {
  return document.querySelector('[data-app-scroll-container]')
}

function lockScroll() {
  if (openModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // The app does not scroll <body> – the real scroll container lives inside
    // the Layout, so it has to be locked separately.
    const scroller = appScroller()
    if (scroller) {
      previousScrollerOverflow = scroller.style.overflow
      scroller.style.overflow = 'hidden'
    }
  }
  openModalCount += 1
}

function unlockScroll() {
  openModalCount = Math.max(0, openModalCount - 1)
  if (openModalCount === 0) {
    document.body.style.overflow = previousBodyOverflow
    const scroller = appScroller()
    if (scroller) scroller.style.overflow = previousScrollerOverflow
  }
}

export default function Modal({
  open = true,
  onClose,
  title,
  subtitle,
  icon: Icon,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showClose = true,
  initialFocusRef,
  contentClassName = '',
  bodyClassName = '',
  labelledBy,
}) {
  const { t } = useI18n()
  const panelRef = useRef(null)
  const triggerRef = useRef(null)
  // `open` is the caller's intent; `present` is what is actually on screen.
  // They differ only while the dialog is playing its exit animation - without
  // that gap the panel disappeared on the same frame it unmounted.
  const [present, setPresent] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const generatedId = useId()
  const titleId = labelledBy || `${generatedId}-title`

  const handleClose = useCallback(() => {
    if (onClose) onClose()
  }, [onClose])

  useEffect(() => {
    if (open) {
      setPresent(true)
      setLeaving(false)
      return undefined
    }
    if (!present) return undefined
    // Play the exit, then unmount. A re-open during the exit cancels it
    // (the effect above runs first), so the dialog can be grabbed back
    // mid-dismissal instead of having to finish leaving first.
    setLeaving(true)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => { setPresent(false); setLeaving(false) }, reduced ? 0 : EXIT_MS)
    return () => clearTimeout(t)
  }, [open, present])

  // Scroll lock for as long as anything is on screen.
  useEffect(() => {
    if (!present) return undefined
    lockScroll()
    return unlockScroll
  }, [present])

  // Remember the trigger, move focus in, restore focus on close.
  useEffect(() => {
    if (!open) return undefined
    triggerRef.current = document.activeElement

    const raf = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ||
        panelRef.current?.querySelector('[data-autofocus]') ||
        panelRef.current?.querySelector(FOCUSABLE) ||
        panelRef.current
      target?.focus?.()
    })

    return () => {
      cancelAnimationFrame(raf)
      const trigger = triggerRef.current
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
        trigger.focus()
      }
    }
  }, [open, initialFocusRef])

  // Escape to close + focus trap on Tab.
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation()
        handleClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return

      // Do not filter on offsetParent: it is also null for position:fixed
      // elements (and always null without layout), which would silently drop
      // legitimate stops from the trap. Exclude explicitly hidden branches only.
      const nodes = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(
        (el) => !el.closest('[hidden],[aria-hidden="true"]')
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, closeOnEscape, handleClose])

  if (!present) return null

  const hasHeader = Boolean(title || showClose)

  return createPortal(
    <div
      className="fixed inset-0 layer-modal flex items-center justify-center p-4 sm:p-6"
      aria-hidden={leaving ? 'true' : undefined}
      style={leaving ? { pointerEvents: 'none' } : undefined}
    >
      <div
        className={`absolute inset-0 bg-black/40 ${leaving ? 'animate-overlay-out' : 'backdrop-blur-sm animate-overlay-in'}`}
        onClick={closeOnBackdrop ? handleClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? t('common.dialog', 'Dialog') : undefined}
        tabIndex={-1}
        className={`relative w-full ${SIZES[size] || SIZES.md} max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]
          bg-white dark:bg-[#1c1c1e] rounded-[24px]
          shadow-[var(--shadow-overlay)] border border-gray-200/60 dark:border-gray-700/60
          flex flex-col overflow-hidden outline-none ${leaving ? 'animate-modal-out' : 'animate-modal-in'} ${contentClassName}`}
      >
        {hasHeader && (
          <div className="flex items-start justify-between gap-4 px-6 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {Icon && (
                <div className="w-10 h-10 rounded-2xl bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#0071e3] dark:text-[#0a84ff]" />
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2
                    id={titleId}
                    className="text-[19px] sm:text-[20px] font-semibold tracking-tight text-black dark:text-white truncate"
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{subtitle}</p>
                )}
              </div>
            </div>
            {showClose && (
              <button
                type="button"
                onClick={handleClose}
                aria-label={t('common.close_dialog')}
                className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]
                  flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors"
              >
                <X className="w-4.5 h-4.5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto overscroll-contain scrollbar-thin px-6 sm:px-8 py-6 ${bodyClassName}`}>
          {children}
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 sm:px-8 py-5 border-t border-gray-100 dark:border-gray-800 bg-[#f5f5f7]/60 dark:bg-[#2c2c2e]/40 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
