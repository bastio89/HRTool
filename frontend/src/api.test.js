import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchesApi, matchingApi, resolveMatchingResult } from './api'

const runId = '00000000-0000-0000-0000-000000000001'
const pending = { status: 'pending', runId, pendingPairs: [{ candidateId: '4', jobId: '9', status: 'running' }], availableResults: [] }
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn())
  localStorage.setItem('hrtool_token', 'actor-token')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('durable matching client', () => {
  it('refreshes a stored blocked checkpoint so an admin-resumed run is not stuck in its old state', async () => {
    const result = { method: 'ai', results: [{ score: 1 }] }
    fetch.mockResolvedValue(response({ runId, stage: 'completed', resultPayload: result }))
    expect(await resolveMatchingResult({ ...pending, stage: 'blocked_credits' })).toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(`/api/matching/runs/${runId}`)
  })

  it('polls the same 202 run without inventing results or repeating the POST', async () => {
    const progress = vi.fn()
    const original = { method: 'vector', runId, matrix: [{ jobId: '9', candidateId: '4', score: 75, cacheStatus: 'hit', matchedAt: '2025-01-01' }] }
    fetch.mockResolvedValueOnce(response(pending, 202))
      .mockResolvedValueOnce(response({ runId, stage: 'matching', pendingPairs: pending.pendingPairs }))
      .mockResolvedValueOnce(response({ runId, stage: 'completed', resultPayload: original }))
    let finished = false
    const work = matchingApi.vectorMatch({ jobId: 9 }, { onProgress: progress }).then(value => { finished = true; return value })
    await vi.advanceTimersByTimeAsync(3000)
    expect(finished).toBe(false)
    expect(progress.mock.calls[0][0]).toEqual(pending)
    expect(progress.mock.calls[0][0].results).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3000)
    expect(await work).toEqual(original)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/matching/vectormatch', `/api/matching/runs/${runId}`, `/api/matching/runs/${runId}`,
    ])
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })

  it('preserves ordinary 200 results without polling', async () => {
    const result = { method: 'ai', results: [{ score: 80, matchedAt: '2025-01-01' }] }
    fetch.mockResolvedValue(response(result))
    expect(await matchingApi.runSelected([{ jobId: 9, candidateId: 4 }])).toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends matching options separately from numeric weights', async () => {
    const result = { method: 'ai', results: [] }
    const controller = new AbortController()
    const onProgress = vi.fn()
    fetch.mockResolvedValue(response(result))

    await matchingApi.runSelected(
      [{ jobId: 9, candidateId: 4 }],
      null,
      { signal: controller.signal, onProgress },
    )

    const [, options] = fetch.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ pairs: [{ jobId: 9, candidateId: 4 }], weights: null })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(['needs_review', 'failed', 'blocked_credits'])('retains the run and explicit %s instead of returning an empty success', async stage => {
    fetch.mockResolvedValue(response({ runId, stage, errorCode: stage, resultPayload: null }))
    const work = resolveMatchingResult(pending)
    const rejected = expect(work).rejects.toMatchObject({ runId, stage })
    await vi.advanceTimersByTimeAsync(3000)
    await rejected
  })

  it('rejects an empty completed payload and retains HTTP errors with the known run', async () => {
    fetch.mockResolvedValueOnce(response({ runId, stage: 'completed', resultPayload: {} }))
    const empty = resolveMatchingResult(pending)
    const emptyError = expect(empty).rejects.toMatchObject({ runId })
    await vi.advanceTimersByTimeAsync(3000)
    await emptyError
    fetch.mockResolvedValueOnce(response({ error: 'Status nicht verfuegbar', details: 'Datenbankfehler' }, 503))
    const failed = resolveMatchingResult(pending)
    const failure = expect(failed).rejects.toMatchObject({ status: 503, runId, message: 'Datenbankfehler' })
    await vi.advanceTimersByTimeAsync(3000)
    await failure
  })

  it('aborts waiting and clears its poll timer without another request', async () => {
    const controller = new AbortController()
    const work = resolveMatchingResult(pending, { signal: controller.signal })
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates caller cancellation through a matching POST, not as a timeout', async () => {
    const controller = new AbortController()
    const scheduled = vi.spyOn(globalThis, 'setTimeout')
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const work = matchingApi.vectorMatch({}, { signal: controller.signal })
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(cleared).toHaveBeenCalledWith(scheduled.mock.results[0].value)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('provides queue/detail/retry and own status clients with authentication and server metadata', async () => {
  const detail = { run: { runId }, counters: { progressPercent: null }, pairs: [{ pairId: 42, evaluationId: null }], nextCursor: 42 }
  fetch.mockResolvedValue(response(detail))
  const controller = new AbortController()
  expect(await batchesApi.get(runId, { pairStatus: 'failed', cursor: 9, limit: 3 }, { signal: controller.signal })).toEqual(detail)
  expect(fetch.mock.calls[0][0]).toBe(`/api/batches/${runId}?pairStatus=failed&cursor=9&limit=3`)
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer actor-token')
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  await batchesApi.retry(runId, [42], true)
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ pairIds: [42], confirmUncertain: true })
  await matchingApi.getRun(runId)
  expect(fetch.mock.calls[2][0]).toBe(`/api/matching/runs/${runId}`)
})

it('forwards additional queue filters and deletes a batch request with DELETE', async () => {
  fetch.mockResolvedValue(response({ runId, deleted: true }))
  await batchesApi.list({ search: '283', method: 'ai', entityType: 'job' })
  expect(fetch.mock.calls[0][0]).toBe('/api/batches?search=283&method=ai&entityType=job')
  expect(await batchesApi.delete(runId)).toEqual({ runId, deleted: true })
  expect(fetch.mock.calls[1][0]).toBe(`/api/batches/${runId}`)
  expect(fetch.mock.calls[1][1].method).toBe('DELETE')
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer actor-token')
})
