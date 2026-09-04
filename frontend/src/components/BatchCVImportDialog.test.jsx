import { render, waitFor, screen } from '@testing-library/react'
import { vi } from 'vitest'
import BatchCVImportDialog from './BatchCVImportDialog'
import { I18nProvider } from '../I18nContext'

vi.mock('../api', () => ({
  cvParserApi: {
    parse: vi.fn(),
  },
  uploadsApi: {
    upload: vi.fn(),
  },
  healthApi: {
    check: vi.fn().mockResolvedValue({ aiUsage: { calls: 0, total_tokens: 0 }, services: { graphrag: 'ok' } }),
  },
}))

describe('BatchCVImportDialog', () => {
  beforeEach(() => {
    localStorage.setItem('hr-locale', 'de')
  })

  test('renders through a portal so a transformed page wrapper cannot displace it', async () => {
    const { container } = render(
      <div className="fade-in">
        <I18nProvider>
          <BatchCVImportDialog onClose={vi.fn()} onImported={vi.fn()} />
        </I18nProvider>
      </div>
    )

    const dialog = await screen.findByRole('dialog')

    // The dialog must NOT live inside the (transformed) page wrapper – otherwise
    // `position: fixed` resolves against the page box instead of the viewport
    // and the user has to scroll down to find it.
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.contains(dialog)).toBe(true)

    // Viewport-anchored, centred overlay.
    const overlay = dialog.parentElement
    expect(overlay).toHaveClass('fixed')
    expect(overlay).toHaveClass('inset-0')
    expect(overlay).toHaveClass('items-center')
  })

  test('exposes proper dialog semantics', async () => {
    render(
      <I18nProvider>
        <BatchCVImportDialog onClose={vi.fn()} onImported={vi.fn()} />
      </I18nProvider>
    )

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby')
    })
  })
})
