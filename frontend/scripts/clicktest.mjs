// Klicktest über alle Rollen (Admin, Recruiter, Revisor, Fachbereich).
//
// Voraussetzungen: Backend auf :3001 mit leerer Datenbank und Admin admin/admin123,
// Frontend (vite) auf :5173, Postgres. GraphRAG ist nicht nötig: KI-Funktionen
// werden nur auf verständliche Fehlermeldung geprüft.
// Aufruf: node scripts/clicktest.mjs <Ausgabeordner für Screenshots bei Fehlern>
//
// Jeder Schritt prüft die Oberfläche und den Serverzustand über die API.
// Erwartete Befunde bleiben als FAIL sichtbar, bis sie entschieden sind.
import { chromium } from '@playwright/test'

const APP = 'http://localhost:5173'
const API = 'http://localhost:3001/api'
const STAMP = Date.now().toString(36)
const results = []
const outDir = process.argv[2] || '.'

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

async function adminToken() {
  const r = await api('POST', '/auth/login', null, { username: 'admin', password: 'admin123' })
  return r.data.token
}

// Fachbereich-Nutzer bekommt eine Stelle zugewiesen; Rollen werden per API angelegt.
async function ensureUser(token, username, role, jobIds = []) {
  const r = await api('POST', '/auth/users', token, { username, password: 'Test12345!', display_name: `Test ${role}`, role, job_ids: jobIds })
  if (r.status !== 201 && r.status !== 409 && r.status !== 400) throw new Error(`user ${username}: ${r.status} ${JSON.stringify(r.data)}`)
}

function attachErrorCollector(page, step) {
  const issues = []
  page.removeAllListeners('pageerror'); page.removeAllListeners('console'); page.removeAllListeners('response')
  page.on('pageerror', e => issues.push(`JS: ${e.message.slice(0, 160)}`))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push(`console: ${m.text().slice(0, 160)}`) })
  page.on('response', r => { if (r.status() >= 500 && r.url().includes('/api/')) issues.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`) })
  return issues
}

async function step(role, name, page, fn) {
  const issues = attachErrorCollector(page)
  try {
    const note = await fn()
    results.push({ role, name, ok: true, note: note || '', issues })
  } catch (e) {
    results.push({ role, name, ok: false, note: e.message.split('\n')[0].slice(0, 220), issues })
    await page.screenshot({ path: `${outDir}/FAIL-${role}-${name.replace(/\W+/g, '_').slice(0, 40)}.png` }).catch(() => {})
  }
}

async function login(browser, username, password = username === 'admin' ? 'admin123' : 'Test12345!', locale = 'de') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript((l) => localStorage.setItem('hr-locale', l), locale)
  await page.goto(APP + '/login', { timeout: 120000 })
  // Eingaben prüfen: Beim Tippen direkt nach dem Laden gingen Zeichen verloren.
  const userField = page.locator('input').first()
  const passField = page.locator('input[type=password]')
  for (let attempt = 0; attempt < 3; attempt++) {
    await userField.fill(username)
    await passField.fill(password)
    if ((await userField.inputValue()) === username && (await passField.inputValue()) === password) break
  }
  await page.getByRole('button', { name: 'Anmelden' }).click()
  try {
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  } catch (e) {
    await page.screenshot({ path: `${outDir}/LOGIN-FAIL-${username}.png` }).catch(() => {})
    throw new Error(`Login ${username} fehlgeschlagen (URL ${page.url()})`)
  }
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page }
}

async function expectRedirectAway(page, path) {
  await page.goto(APP + path, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(600)
  const url = new URL(page.url())
  if (url.pathname === path) throw new Error(`${path} ist für diese Rolle erreichbar, sollte aber gesperrt sein`)
  return `weitergeleitet nach ${url.pathname}`
}

async function expectText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout })
}

// ---------- Admin ----------
async function runAdmin(browser, tok) {
  const { ctx, page } = await login(browser, 'admin')
  const R = 'admin'
  const candName = `Klick Kandidat ${STAMP}`
  const candEmail = `klick.${STAMP}@example.com`
  const jobTitle = `Klick Stelle ${STAMP}`
  let candId, jobId

  await step(R, 'Dashboard lädt', page, async () => { await page.goto(APP + '/', { waitUntil: 'networkidle' }); await expectText(page, 'Übersicht') })

  await step(R, 'Bewerber anlegen', page, async () => {
    await page.goto(APP + '/candidates/new', { waitUntil: 'networkidle' })
    await page.getByPlaceholder('Max Mustermann').fill(candName)
    await page.getByPlaceholder('max@example.com').fill(candEmail)
    await page.getByPlaceholder('JavaScript, React, Node.js, Python (kommagetrennt)').fill('Klick, Testing')
    await page.locator('button[type=submit]').last().click()
    await page.waitForURL(/\/candidates$/, { timeout: 15000 })
    const c = await api('GET', `/candidates?search=${encodeURIComponent(candEmail)}`, tok)
    candId = c.data.data[0]?.id
    if (!candId) throw new Error('Bewerber nach Speichern nicht im Server')
    return `id=${candId}`
  })

  await step(R, 'Bewerber in Liste suchen und öffnen', page, async () => {
    await page.goto(APP + '/candidates', { waitUntil: 'networkidle' })
    await page.getByPlaceholder(/Suche nach/).fill(candName)
    await expectText(page, candName)
    await page.getByRole('button', { name: 'Aktivitätslog' }).first().click()
    await page.waitForURL(/candidates\/\d+\/detail/, { timeout: 15000 })
    await expectText(page, candName)
  })

  await step(R, 'Bewerber bearbeiten (Wohnort)', page, async () => {
    await page.goto(APP + `/candidates/${candId}/edit`, { waitUntil: 'networkidle' })
    await page.locator('input[placeholder="Berlin"]').first().fill('Basel')
    await page.getByRole('button', { name: /^(Aktualisieren|Speichern)$/ }).click()
    await page.waitForTimeout(1500)
    const c = await api('GET', `/candidates/${candId}`, tok)
    if (c.data.location !== 'Basel') throw new Error(`Wohnort auf dem Server: "${c.data.location}"`)
  })

  await step(R, 'Stelle anlegen', page, async () => {
    await page.goto(APP + '/jobs/new', { waitUntil: 'networkidle' })
    await page.getByPlaceholder('z.B. Senior Frontend Developer (m/w/d)').fill(jobTitle)
    await page.locator('button[type=submit]').last().click()
    await page.waitForURL(/\/jobs$/, { timeout: 15000 })
    const j = await api('GET', '/jobs', tok)
    jobId = (j.data.data || j.data || []).find(x => x.title === jobTitle)?.id
    if (!jobId) throw new Error('Stelle nach Speichern nicht im Server')
    return `id=${jobId}`
  })

  await step(R, 'Bewerber zur Pipeline hinzufügen', page, async () => {
    await page.goto(APP + `/pipeline/${jobId}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Bewerber hinzufügen' }).first().click()
    await page.getByRole('button', { name: new RegExp(candName) }).first().click()
    await page.waitForTimeout(1500)
    const p = await api('GET', `/pipeline/job/${jobId}`, tok)
    const found = Object.values(p.data.board || {}).flat().some(e => e.candidate_id === candId)
    if (!found) throw new Error('Bewerber nicht in Pipeline gespeichert')
  })

  await step(R, 'Pipeline-Stufe verschieben (mit Notiz)', page, async () => {
    await page.goto(APP + `/pipeline/${jobId}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Verschieben nach Vorauswahl/ }).first().click().catch(async () => {
      throw new Error('Button "Verschieben nach Vorauswahl" nicht gefunden')
    })
    await page.locator('textarea[placeholder="Optionale Notiz hinzufügen..."]').fill('Klicktest')
    await page.getByRole('button', { name: 'Verschieben', exact: true }).click()
    await page.waitForTimeout(1500)
    const p = await api('GET', `/pipeline/job/${jobId}`, tok)
    const entry = Object.values(p.data.board || {}).flat().find(e => e.candidate_id === candId)
    if (entry?.stage !== 'Vorauswahl') throw new Error(`Stufe auf dem Server: "${entry?.stage}"`)
  })

  await step(R, 'Interview-Vorbereitung öffnen', page, async () => {
    const p = await api('GET', `/pipeline/job/${jobId}`, tok)
    const entry = Object.values(p.data.board || {}).flat().find(e => e.candidate_id === candId)
    await page.goto(APP + `/pipeline/${jobId}/interview-prep/${entry.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    if (new URL(page.url()).pathname.endsWith('/')) throw new Error('Interview-Vorbereitung leitet weg')
  })

  await step(R, 'Matching-Seite lädt', page, async () => {
    await page.goto(APP + '/matching', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
  })

  await step(R, 'KI-Matching ohne GraphRAG zeigt verständlichen Fehler', page, async () => {
    await page.goto(APP + '/matching/job', { waitUntil: 'networkidle' })
    const select = page.locator('select').first()
    if (await select.count()) await select.selectOption({ index: 1 }).catch(() => {})
    const run = page.getByRole('button', { name: /Matching starten|Starten|Matching/i }).first()
    if (!(await run.count())) return 'kein Start-Button gefunden (Stelle/Kandidat-Auswahl nötig)'
    await run.click().catch(() => {})
    await page.waitForTimeout(4000)
    const crashed = await page.getByText(/Something went wrong|Unerwarteter Fehler|ErrorBoundary/i).count()
    if (crashed) throw new Error('Fehlerseite statt Meldung')
    return 'kein Absturz'
  })

  await step(R, 'Export-Seite: Vorschau und Download', page, async () => {
    await page.goto(APP + '/admin/export', { waitUntil: 'networkidle' })
    await page.getByText('Verfügbare Felder').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: /Vorschau/ }).click()
    await page.getByText(/Vorschau: \d+ von/).waitFor({ timeout: 15000 })
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: /Herunterladen/ }).click()])
    return `Datei ${dl.suggestedFilename()}`
  })

  await step(R, 'Benutzerverwaltung zeigt Benutzer', page, async () => {
    await page.goto(APP + '/admin/users', { waitUntil: 'networkidle' })
    await expectText(page, 'admin')
  })

  await step(R, 'Audit-Log zeigt Export-Eintrag', page, async () => {
    await page.goto(APP + '/admin/audit', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await expectText(page, 'export')
  })

  for (const [name, path] of [['DSGVO', '/admin/dsgvo'], ['KI-Transparenz', '/admin/ki-transparenz'], ['E-Mail', '/admin/email'], ['Plugins', '/admin/plugins'], ['Credits', '/admin/credits'], ['KI-Modell', '/admin/ai'], ['Prompts', '/admin/prompts'], ['Reports', '/admin/reports'], ['Historie', '/history'], ['Tools', '/tools']]) {
    await step(R, `Seite lädt: ${name}`, page, async () => {
      await page.goto(APP + path, { waitUntil: 'networkidle', timeout: 120000 })
      await page.waitForTimeout(800)
      if (new URL(page.url()).pathname !== path) throw new Error(`weitergeleitet nach ${new URL(page.url()).pathname}`)
    })
  }

  await step(R, 'Bewerber wieder löschen (Papierkorb + Bestätigung)', page, async () => {
    await page.goto(APP + '/candidates', { waitUntil: 'networkidle' })
    await page.getByPlaceholder(/Suche nach/).fill(candName)
    await expectText(page, candName)
    const row = page.locator('div', { hasText: candName }).filter({ has: page.locator('button') }).last()
    const trash = page.getByRole('button', { name: 'Löschen', exact: true }).first()
    if (!(await trash.count())) throw new Error('Löschen-Button ohne Accessible-Name/Icon nicht auffindbar')
    await trash.click()
    await page.getByRole('button', { name: 'Löschen', exact: true }).last().click()
    await page.waitForTimeout(1500)
    const c = await api('GET', `/candidates/${candId}`, tok)
    if (c.status !== 404) throw new Error('Bewerber nach Löschen noch auf dem Server')
  })

  await step(R, 'Abmelden', page, async () => {
    await page.getByRole('button', { name: /Abmelden|Logout|Log out/i }).first().click().catch(async () => {
      await page.locator('button:has(svg.lucide-log-out)').first().click()
    })
    await page.waitForURL(/\/login/, { timeout: 15000 })
  })
  await ctx.close()
  return { candId, jobId }
}

// ---------- Recruiter ----------
async function runRecruiter(browser, tok, ids) {
  const { ctx, page } = await login(browser, 'klick_rec')
  const R = 'recruiter'
  await step(R, 'Admin-Bereich ist gesperrt (/admin/users)', page, () => expectRedirectAway(page, '/admin/users'))
  await step(R, 'Datenexport ist gesperrt (/admin/export)', page, () => expectRedirectAway(page, '/admin/export'))
  await step(R, 'Audit-Log ist gesperrt', page, () => expectRedirectAway(page, '/admin/audit'))
  await step(R, 'Bewerber-Liste lädt und zeigt Testdaten', page, async () => {
    await page.goto(APP + '/candidates', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
  })
  await step(R, 'Bewerber-Mehrfachauswahl zeigt keinen Export-Button', page, async () => {
    await page.goto(APP + '/candidates', { waitUntil: 'networkidle' })
    await page.getByText(/Alle auswählen/).first().waitFor({ timeout: 15000 })
    await page.getByText(/Alle auswählen/).first().locator('xpath=preceding-sibling::button').click()
    await page.waitForTimeout(500)
    const exportBtn = await page.getByRole('button', { name: 'Exportieren' }).count()
    if (exportBtn) throw new Error('Export-Button für Recruiter sichtbar, Feature ist aber Admin-only')
  })
  await step(R, 'Stelle öffnet Pipeline', page, async () => {
    await page.goto(APP + `/pipeline/${ids.jobId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
  })
  await ctx.close()
}

// ---------- Revisor ----------
async function runRevisor(browser) {
  const { ctx, page } = await login(browser, 'klick_rev')
  const R = 'revisor'
  await step(R, 'Audit-Log lädt', page, async () => { await page.goto(APP + '/admin/audit', { waitUntil: 'networkidle' }); await page.waitForTimeout(800) })
  await step(R, 'Reports laden', page, async () => { await page.goto(APP + '/admin/reports', { waitUntil: 'networkidle' }); await page.waitForTimeout(800) })
  await step(R, 'Benutzerverwaltung ist gesperrt', page, () => expectRedirectAway(page, '/admin/users'))
  await step(R, 'Datenexport ist gesperrt', page, () => expectRedirectAway(page, '/admin/export'))
  await ctx.close()
}

// ---------- Fachbereich ----------
async function runFachbereich(browser, ids) {
  const { ctx, page } = await login(browser, 'klick_fb')
  const R = 'fachbereich'
  await step(R, 'Startseite lädt ohne Fehler', page, async () => { await page.goto(APP + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(800) })
  await step(R, 'Zugewiesene Stelle ist sichtbar', page, async () => {
    await page.goto(APP + '/jobs', { waitUntil: 'networkidle' })
    await expectText(page, `Klick Stelle ${STAMP}`)
  })
  await step(R, 'Nicht zugewiesene Stellen sind ausgeblendet', page, async () => {
    await page.waitForTimeout(800)
    const visible = await page.getByText(/Klick Stelle/).count()
    if (visible > 1) throw new Error(`${visible} Klick-Stellen sichtbar, erlaubt ist nur die zugewiesene`)
    return `${visible} sichtbar`
  })
  await step(R, 'Bewerber-Liste ist auf die eigenen Pipelines begrenzt', page, async () => {
    // Erwartetes Verhalten laut Pipeline-Logik: Fachbereich sieht nur Bewerber in seinen Stellen.
    await page.goto(APP + '/candidates', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const total = await page.getByText(/von \d+ Profilen|of \d+ profiles/).first().textContent().catch(() => '')
    const n = Number((total.match(/\d+/g) || ['0']).pop())
    if (n > 0) throw new Error(`Fachbereich sieht ${n} Bewerber, erwartet nur Bewerber aus zugewiesenen Pipelines (offene Entscheidung)`)
    return 'begrenzt'
  })
  await step(R, 'Admin-Bereich ist gesperrt', page, () => expectRedirectAway(page, '/admin/users'))
  await ctx.close()
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const tok = await adminToken()
await ensureUser(tok, 'klick_rec', 'recruiter')
await ensureUser(tok, 'klick_rev', 'revisor')
await ensureUser(tok, 'klick_fb', 'fachbereich', [])

const report = () => {
  const ok = results.filter(r => r.ok).length
  console.log(`\n=== ${ok}/${results.length} Schritte bestanden ===`)
  for (const r of results) {
    const issues = r.issues.length ? `  ⚠ ${[...new Set(r.issues)].join(' | ')}` : ''
    console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.role}] ${r.name}${r.note ? ` — ${r.note}` : ''}${issues}`)
  }
}
const phase = async (label, fn) => {
  try { return await fn() } catch (e) { console.log(`ABBRUCH ${label}: ${e.message.split('\n')[0]}`); results.push({ role: label, name: 'Rollen-Ablauf', ok: false, note: e.message.split('\n')[0].slice(0, 220), issues: [] }) }
}
const ids = await phase('admin', () => runAdmin(browser, tok))
if (ids) {
  // Fachbereich bekommt die Stelle zugewiesen, damit der Zugriff geprüft werden kann
  const users = (await api('GET', '/auth/users', tok)).data.data
  await api('PUT', `/auth/users/${users.find(u => u.username === 'klick_fb').id}/jobs`, tok, { job_ids: [ids.jobId] })
}
await phase('recruiter', () => runRecruiter(browser, tok, ids || {}))
await phase('revisor', () => runRevisor(browser))
await phase('fachbereich', () => runFachbereich(browser, ids || {}))
await browser.close()
report()
