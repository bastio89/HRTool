import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'
import Modal from './Modal'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('.fade-in page wrapper', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const rule = css.slice(css.indexOf('.fade-in {'), css.indexOf('}', css.indexOf('.fade-in {')))

  // jsdom has no animation engine, so guard the CSS contract at the source.
  // `forwards` would freeze an interpolated transform on every page root, and
  // an interpolated `transform: none` still computes to matrix(1,0,0,1,0,0) –
  // enough to make the element a containing block for fixed children and push
  // every dialog below the fold. Verified in Chromium.
  test('does not use animation-fill-mode: forwards', () => {
    expect(rule).not.toMatch(/forwards/)
  })

  test('declares an untransformed base state to fall back to', () => {
    expect(rule).toMatch(/transform:\s*none/)
  })
})

describe('Modal', () => {
  test('portals out of a transformed page wrapper', () => {
    // `.fade-in` leaves a transform on the page root; a fixed-position child of
    // it would be positioned against the page box instead of the viewport,
    // which is what forced users to scroll to find a dialog.
    const { container } = render(
      <div className="fade-in">
        <Modal onClose={vi.fn()} title="Titel">Inhalt</Modal>
      </div>
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  test('is centred in the viewport, not the document', () => {
    render(<Modal onClose={vi.fn()} title="Titel">Inhalt</Modal>)
    const overlay = screen.getByRole('dialog').parentElement
    expect(overlay.className).toContain('fixed')
    expect(overlay.className).toContain('inset-0')
    expect(overlay.className).toContain('items-center')
    expect(overlay.className).toContain('justify-center')
  })

  test('carries dialog semantics and is labelled by its title', () => {
    render(<Modal onClose={vi.fn()} title="Mein Dialog">Inhalt</Modal>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(document.getElementById(labelId)).toHaveTextContent('Mein Dialog')
  })

  test('Escape closes, and can be opted out of', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Modal onClose={onClose} title="T">x</Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<Modal onClose={onClose} title="T" closeOnEscape={false}>x</Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('backdrop click closes, and can be opted out of', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Modal onClose={onClose} title="T">x</Modal>)
    const backdrop = screen.getByRole('dialog').parentElement.firstChild
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<Modal onClose={onClose} title="T" closeOnBackdrop={false}>x</Modal>)
    fireEvent.click(screen.getByRole('dialog').parentElement.firstChild)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('locks the app scroll container while open and restores it on close', () => {
    const scroller = document.createElement('div')
    scroller.setAttribute('data-app-scroll-container', '')
    scroller.style.overflow = 'auto'
    document.body.appendChild(scroller)

    const { unmount } = render(<Modal onClose={vi.fn()} title="T">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    expect(scroller.style.overflow).toBe('hidden')

    unmount()
    expect(scroller.style.overflow).toBe('auto')
    scroller.remove()
  })

  test('moves focus into the dialog and returns it to the trigger on close', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(
      <Modal onClose={vi.fn()} title="T">
        <button>Innen</button>
      </Modal>
    )
    await waitFor(() => {
      expect(document.activeElement).not.toBe(trigger)
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    })

    await act(async () => { unmount() })
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  test('traps Tab inside the dialog', async () => {
    render(
      <Modal onClose={vi.fn()} title="T" showClose={false}>
        <button>erster</button>
        <button>letzter</button>
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    const first = screen.getByText('erster')
    const last = screen.getByText('letzter')

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
