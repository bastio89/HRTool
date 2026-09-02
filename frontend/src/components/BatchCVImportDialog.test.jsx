import { render, waitFor } from '@testing-library/react'
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

  test('keeps the overlay scrollable and top-aligned', async () => {
    const { container } = render(
      <I18nProvider>
        <BatchCVImportDialog onClose={vi.fn()} onImported={vi.fn()} />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(container.firstChild).toHaveClass('items-start')
      expect(container.firstChild).toHaveClass('overflow-y-auto')
    })
  })
})
