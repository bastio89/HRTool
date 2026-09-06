# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: new-flow.spec.js >> mein neuer test
- Location: tests/e2e/new-flow.spec.js:3:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'HR Systemm' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'HR Systemm' }) with timeout 5000ms
  - waiting for getByRole('heading', { name: 'HR Systemm' })

```

```yaml
- heading "HR System" [level=1]
- paragraph: Melde dich an, um fortzufahren
- text: Username
- textbox "Enter username"
- text: Password
- textbox "Enter password"
- button "Login" [disabled]
- paragraph: "Standardzugang: admin / admin123"
```

# Test source

```ts
  1 | import { test, expect } from '@playwright/test'
  2 | 
  3 | test('mein neuer test', async ({ page }) => {
  4 |   await page.goto('/login')
> 5 |   await expect(page.getByRole('heading', { name: 'HR Systemm' })).toBeVisible()
    |                                                                   ^ Error: expect(locator).toBeVisible() failed
  6 | })
```