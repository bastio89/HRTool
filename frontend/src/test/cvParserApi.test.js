import { afterEach, describe, expect, test, vi } from 'vitest'

import { cvParserApi } from '../api'


describe('cvParserApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('sends persisted imports to the fast CV importer', async () => {
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
    expect(url).toBe('/graphrag-api/cv-fast-importer/import?persist=true')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('file')).toBe(file)
  })

  test('uses the deprecated Node route for legacy LLM imports', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, candidate: { id: 'candidate-legacy' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['cv data'], 'candidate.pdf', { type: 'application/pdf' })

    const result = await cvParserApi.parse(file, undefined, true, 'llm_import')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/cv-parser/parse?persist=true')
    expect(fetchMock.mock.calls[0][1].body.get('file')).toBe(file)
    expect(result.candidate.id).toBe('candidate-legacy')
  })

  test('shows detailed errors returned in legacy SSE events', async () => {
    const message = 'GraphRAG-Parsing fehlgeschlagen: model unavailable'
    const encodedEvent = new TextEncoder().encode(`data: ${JSON.stringify({
      type: 'error',
      error: 'Fehler beim Verarbeiten der Datei',
      details: message,
    })}\n\n`)
    let hasReadEvent = false
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader: () => ({
          read: async () => {
            if (hasReadEvent) return { done: true }
            hasReadEvent = true
            return { done: false, value: encodedEvent }
          },
        }),
      },
    }))
    const file = new File(['cv data'], 'candidate.pdf', { type: 'application/pdf' })

    await expect(cvParserApi.parse(file, vi.fn(), true, 'llm_import')).rejects.toThrow(message)
  })

  test('reports the HTTP status when the server returns a non-JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      headers: { get: () => 'text/html' },
      json: async () => { throw new SyntaxError('Unexpected token <') },
    }))
    const file = new File(['cv data'], 'candidate.pdf', { type: 'application/pdf' })

    await expect(cvParserApi.parse(file)).rejects.toThrow('CV-Analyse fehlgeschlagen (HTTP 413)')
  })

  test('turns a GraphRAG duplicate (409 with detail object) into a readable error with code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      json: async () => ({
        detail: {
          error: 'Diese Person ist bereits im Tool angelegt: Anna Muster (ID 7)',
          code: 'DUPLICATE_CANDIDATE',
          existing: { id: 7, name: 'Anna Muster' },
        },
      }),
    }))
    const file = new File(['cv data'], 'candidate.pdf', { type: 'application/pdf' })

    const failure = await cvParserApi.parse(file, undefined, true).catch(error => error)
    expect(failure.message).toBe('Diese Person ist bereits im Tool angelegt: Anna Muster (ID 7)')
    expect(failure.code).toBe('DUPLICATE_CANDIDATE')
    expect(failure.existing).toEqual({ id: 7, name: 'Anna Muster' })
    expect(failure.status).toBe(409)
  })
})