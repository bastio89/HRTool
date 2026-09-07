import { test, expect } from '@playwright/test'

test('mein neuer test', async ({ page }) => {
  const currentUser = {
    id: 'user-1',
    username: 'admin',
    display_name: 'Admin',
    role: 'user',
  }

  const importedCandidates = [
    {
      id: 'cand-1',
      name: 'Patrik Kasper',
      email: 'patrik.kasper@example.com',
      location: 'Zürich',
      status: 'Aktiv',
      source: 'CV Import',
    },
    {
      id: 'cand-2',
      name: 'Anna Meier',
      email: 'anna.meier@example.com',
      location: 'Bern',
      status: 'Aktiv',
      source: 'CV Import',
    },
  ]

  let importFinished = false

  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, '')

    const fulfillJson = async (body, status = 200) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    }

    if (path === '/auth/login' && request.method() === 'POST') {
      return fulfillJson({ token: 'test-token', user: currentUser })
    }

    if (path === '/auth/me' && request.method() === 'GET') {
      return fulfillJson(currentUser)
    }

    if (path === '/health' && request.method() === 'GET') {
      return fulfillJson({
        status: 'ok',
        timestamp: new Date().toISOString(),
        aiUsage: { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        services: { backend: 'ok', database: 'ok', graphrag: 'ok' },
      })
    }

    if (path === '/settings/ai/config' && request.method() === 'GET') {
      return fulfillJson({ provider: 'ollama', baseUrl: 'http://localhost:11434' })
    }

    if (path === '/settings/ai/test' && request.method() === 'POST') {
      return fulfillJson({ reachable: true })
    }

    if (path === '/candidates' && request.method() === 'GET') {
      return fulfillJson({
        data: importFinished ? importedCandidates : [],
        total: importFinished ? importedCandidates.length : 0,
        totalPages: 1,
      })
    }

    if (path === '/candidates/stats/overview' && request.method() === 'GET') {
      return fulfillJson({
        totalCandidates: 12,
        newThisWeek: 2,
        newPrevWeek: 1,
        newThisMonth: 4,
        newLastMonth: 3,
        matchingsThisWeek: 1,
        matchingsPrevWeek: 1,
        topLocations: [{ location: 'Zürich', count: 5 }],
      })
    }

    if (path === '/candidates/stats/sources' && request.method() === 'GET') {
      return fulfillJson({ total: 0, sources: [] })
    }

    if (path === '/candidates/stats/time-to-hire' && request.method() === 'GET') {
      return fulfillJson({
        overview: {
          avgDaysToHire: 12,
          medianDays: 10,
          minDays: 3,
          maxDays: 21,
          totalHired: 4,
        },
        stageMetrics: [
          { stage: 'Beworben', avgDays: 2, count: 4 },
          { stage: 'Vorauswahl', avgDays: 3, count: 4 },
          { stage: 'Interview', avgDays: 4, count: 3 },
        ],
        bottleneck: { stage: 'Interview', avgDays: 4 },
        perJob: [
          { jobTitle: 'Treasury Analyst', hired: 2, avgDays: 9 },
        ],
        monthlyTrend: [
          { month: 'Jul', avgDays: 14, hired: 1 },
          { month: 'Aug', avgDays: 10, hired: 3 },
        ],
        inPipeline: { count: 2, avgDaysWaiting: 6 },
      })
    }

    if (path === '/matching/history' && request.method() === 'GET') {
      return fulfillJson({ data: [] })
    }

    if (path === '/pipeline/active-jobs' && request.method() === 'GET') {
      return fulfillJson({ data: [] })
    }

    if (path === '/interviews/upcoming' && request.method() === 'GET') {
      return fulfillJson({ data: [] })
    }

    if (path === '/candidates/stats/tags' && request.method() === 'GET') {
      return fulfillJson({ tags: [] })
    }

    if (path === '/ratings/candidates/averages' && request.method() === 'POST') {
      return fulfillJson({
        data: {
          'cand-1': { average: 4.8 },
          'cand-2': { average: 3.9 },
        },
      })
    }

    if (path === '/candidates/import' && request.method() === 'POST') {
      importFinished = true
      return fulfillJson({ imported: 1, duplicates: 0, errors: 0 })
    }

    if (path === '/uploads/candidate/cand-1' && request.method() === 'POST') {
      return fulfillJson({ ok: true })
    }

    return fulfillJson({})
  })

  await page.route('**/graphrag-api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/graphrag-api/, '')

    const fulfillJson = async (body, status = 200) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    }

    if (path === '/cv-parser/parse' && request.method() === 'POST') {
      importFinished = true
      return fulfillJson({
        candidate: {
          id: 'cand-1',
          name: 'Patrik Kasper',
        },
        persisted: true,
        graphRag: { persisted: true },
        parsingMethod: 'llm',
      })
    }

    return fulfillJson({})
  })

  await page.addInitScript(() => {
    localStorage.setItem('hr-locale', 'de')
  })

  await page.goto('/login')

  await page.getByRole('textbox').first().fill('admin')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Bewerber' }).click()
  await expect(page).toHaveURL(/\/candidates$/)
  await expect(page.getByRole('heading', { name: 'Bewerber' })).toBeVisible()

  await page.getByRole('button', { name: 'CV Batch-Import' }).click()
  await expect(page.getByRole('heading', { name: 'Batch-Import: Lebensläufe' })).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles('/Users/pak/Downloads/Patrik.Kasper - finnova AG Bankware - 05-09-26.pdf')

  await expect(page.getByText('Patrik.Kasper - finnova AG Bankware - 05-09-26.pdf')).toBeVisible()
  await page.getByRole('button', { name: /1 CVs importieren|1 CV importieren/ }).click()

  await expect(page.getByText('Bewerber angelegt ✓')).toBeVisible()
  await page.getByRole('button', { name: 'Schließen' }).click()

  await expect(page.locator('h3').first()).toHaveText('Patrik Kasper')
  await expect(page.getByRole('heading', { name: 'Patrik Kasper' })).toBeVisible()
})