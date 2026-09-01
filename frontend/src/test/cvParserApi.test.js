import { afterEach, describe, expect, test, vi } from 'vitest'

import { cvParserApi } from '../api'


describe('cvParserApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('sends persisted batch imports directly to GraphRAG', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, candidate: { id: 'candidate-123' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['cv data'], 'candidate.pdf', { type: 'application/pdf' })

    const result = await cvParserApi.parse(file, undefined, true)

    expect(result.candidate.id).toBe('candidate-123')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/graphrag-api/cv-parser/parse?persist=true')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('file')).toBe(file)
  })
})