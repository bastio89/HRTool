const express = require('express')
const request = require('supertest')

describe('skill matching tests plugin', () => {
  const originalFetch = global.fetch
  let settingsStore
  let app

  beforeEach(() => {
    jest.resetModules()
    settingsStore = {}
    jest.doMock('../database', () => ({
      prepare: (sql) => {
        if (String(sql).includes('SELECT value FROM settings WHERE key = ?')) {
          return {
            get: (key) => (settingsStore[key] !== undefined ? { value: settingsStore[key] } : undefined),
          }
        }
        if (String(sql).includes('INSERT OR REPLACE INTO settings')) {
          return {
            run: (key, value) => {
              settingsStore[key] = value
              return { changes: 1 }
            },
          }
        }
        return { get: () => undefined, run: () => ({ changes: 0 }) }
      },
    }))
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }))

    const pluginsRouter = require('../routes/plugins')
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.user = { role: req.headers['x-user-role'] || 'admin' }
      next()
    })
    app.use('/api/plugins', pluginsRouter)
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.resetModules()
    jest.restoreAllMocks()
  })

  test('defaults to disabled, requires an admin, then proxies the test run when enabled', async () => {
    const listing = await request(app).get('/api/plugins')
    const testPlugin = listing.body.plugins.find((plugin) => plugin.id === 'skill_matching_tests')
    expect(testPlugin.enabled).toBe(false)

    const disabledRun = await request(app).post('/api/plugins/skill_matching_tests/run')
    expect(disabledRun.status).toBe(404)
    const disabledCases = await request(app).get('/api/plugins/skill_matching_tests/cases')
    expect(disabledCases.status).toBe(404)

    const forbiddenToggle = await request(app)
      .put('/api/plugins/skill_matching_tests')
      .set('x-user-role', 'recruiter')
      .send({ enabled: true })
    expect(forbiddenToggle.status).toBe(403)

    const enabled = await request(app)
      .put('/api/plugins/skill_matching_tests')
      .send({ enabled: true })
    expect(enabled.status).toBe(200)

    global.fetch = jest.fn().mockImplementation((url) => new Response(
      JSON.stringify(url.endsWith('/cases') ? { cases: [_case()] } : { passed: true, output: '2 passed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const cases = await request(app).get('/api/plugins/skill_matching_tests/cases')
    expect(cases.status).toBe(200)
    expect(cases.body.cases[0].test_id).toBe('case_one')

    const result = await request(app).post('/api/plugins/skill_matching_tests/run')

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ passed: true, output: '2 passed' })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://graphrag:8000/plugins/skill_matching_tests/run',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

function _case() {
  return {
    id: 1,
    test_id: 'case_one',
    need_skills: [{ name: 'Python', priority: 'mandatory' }],
    has_skills: ['Python'],
    expected_score: 100,
  }
}
