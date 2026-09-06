import { test, expect } from '@playwright/test'

test('shows the login screen and key form controls', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: 'HR System' })).toBeVisible()
  await expect(page.getByText(/Melde dich an, um fortzufahren|Sign in to continue/)).toBeVisible()
  await expect(page.locator('input[type="text"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeDisabled()
  await expect(page.getByText('Standardzugang: admin / admin123')).toBeVisible()
})

test('logs in and opens the dashboard', async ({ page }) => {
  const currentUser = {
    id: 'user-1',
    username: 'admin',
    display_name: 'Admin',
    role: 'user',
  }

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

    return fulfillJson({})
  })

  await page.goto('/login')

  await page.getByRole('textbox').first().fill('admin')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: /Übersicht|Overview/ })).toBeVisible()
  await expect(page.getByText(/Willkommen zurück|Welcome back/)).toBeVisible()
  await expect(page.getByText('HR System')).toBeVisible()
})