import { test, expect } from '@playwright/test'

test('searches LinkedIn profiles and exports selected ones as PDF', async ({ page }) => {
  const currentUser = {
    id: 'user-1',
    username: 'admin',
    display_name: 'Admin',
    role: 'user',
  }

  let exportPayload = null

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

    if (path === '/matching/history' && request.method() === 'GET') {
      return fulfillJson({ data: [] })
    }

    if (path === '/pipeline/active-jobs' && request.method() === 'GET') {
      return fulfillJson({ data: [] })
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

    if (path === '/interviews/upcoming' && request.method() === 'GET') {
      return fulfillJson({ data: [] })
    }

    if (path === '/candidates/stats/tags' && request.method() === 'GET') {
      return fulfillJson({ tags: [] })
    }

    if (path === '/ratings/candidates/averages' && request.method() === 'POST') {
      return fulfillJson({ data: {} })
    }

    return fulfillJson({})
  })

  await page.route('**/graphrag-api/linkedin/people-search.csv', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      headers: {
        'Content-Disposition': 'attachment; filename="linkedin_search-010126_01.csv"',
      },
      body: [
        'linkedinUrl,firstName,lastName,headline,location,topSkills,currentPosition',
        '"https://www.linkedin.com/in/ada-lovelace/",Ada,Lovelace,"Senior Treasury Analyst","{\"linkedinText\":\"Zürich Metropolitan Area\",\"parsed\":{\"text\":\"Zürich, Switzerland\"}}","[\"Treasury\",\"SQL\"]","[{\"companyName\":\"Finance AG\",\"position\":\"Lead Analyst\"}]"',
        '"https://www.linkedin.com/in/maria-stein/",Maria,Stein,"Data Engineer","Zürich","[\"Python\",\"Data Platforms\"]","[{\"companyName\":\"Bank XYZ\",\"position\":\"Engineer\"}]"',
      ].join('\n'),
    })
  })

  await page.route('**/api/linkedin/export-pdf', async route => {
    exportPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/zip',
      headers: {
        'Content-Disposition': 'attachment; filename="linkedin-profiles.zip"',
      },
      body: Buffer.from('PK\x03\x04fake-zip'),
    })
  })

  await page.addInitScript(() => {
    localStorage.setItem('hr-locale', 'de')
  })

  await page.goto('/login')

  await page.getByRole('textbox').first().fill('admin')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByRole('link', { name: 'LinkedIn' }).click()

  await expect(page).toHaveURL(/\/tools\/linkedin$/)
  await page.getByRole('button', { name: 'Profile suchen' }).click()

  await expect(page.getByText('Ada Lovelace')).toBeVisible()
  await expect(page.getByText('Maria Stein')).toBeVisible()

  await page.locator('section').last().getByRole('checkbox').first().check()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportiere als PDF' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('linkedin-profiles.zip')
  await expect(page.getByText(/PDFs exportiert und Download gestartet/)).toBeVisible()
  expect(exportPayload).toMatchObject({
    profiles: [
      expect.objectContaining({
        linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace/',
      }),
    ],
  })
})