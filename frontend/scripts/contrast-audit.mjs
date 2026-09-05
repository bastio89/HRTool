/**
 * WCAG contrast audit against the running app.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node scripts/contrast-audit.mjs
 *
 * Exists because static class analysis cannot see what a user actually sees:
 * colours arrive as oklch()/oklab(), translucent surfaces stack, and this app
 * switches theme via a `.dark` class rather than prefers-color-scheme — all
 * three produced wrong numbers in earlier hand-rolled checks.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const ROUTES = ['/', '/candidates', '/candidates/new', '/jobs', '/jobs/new', '/matching',
                '/history', '/admin/users', '/admin/audit', '/admin/dsgvo',
                '/admin/ki-transparenz', '/admin/email', '/admin/ai']

const AUDIT = `(() => {
  const srgb = v => { v = v <= 0.0031308 ? 12.92*v : 1.055*Math.pow(Math.max(v,0),1/2.4)-0.055
    return Math.min(255, Math.max(0, v*255)) }
  const oklabToRgb = (L, a, bb) => {
    const l = (L + 0.3963377774*a + 0.2158037573*bb)**3
    const m = (L - 0.1055613458*a - 0.0638541728*bb)**3
    const s = (L - 0.0894841775*a - 1.2914855480*bb)**3
    return { r: srgb( 4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
             g: srgb(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
             b: srgb(-0.0041960863*l - 0.7034186147*m + 1.7076147010*s) }
  }
  const nums = s => (s.match(/-?[\\d.]+%?/g) || []).map(x => x.endsWith('%') ? parseFloat(x)/100 : parseFloat(x))
  const parse = s => {
    if (!s) return { r:0, g:0, b:0, a:0 }
    const alpha = s.includes('/') ? (parseFloat(s.split('/').pop()) || 1) : 1
    if (s.startsWith('oklch')) { const n = nums(s), h = (n[2]||0)*Math.PI/180
      return { ...oklabToRgb(n[0], n[1]*Math.cos(h), n[1]*Math.sin(h)), a: alpha } }
    if (s.startsWith('oklab')) { const n = nums(s); return { ...oklabToRgb(n[0], n[1], n[2]), a: alpha } }
    const n = nums(s)
    return { r:n[0]||0, g:n[1]||0, b:n[2]||0, a: n.length>3 ? n[3] : 1 }
  }
  const over = (f, b) => ({ r:f.r*f.a+b.r*(1-f.a), g:f.g*f.a+b.g*(1-f.a), b:f.b*f.a+b.b*(1-f.a), a:1 })
  const lum = c => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4 }
    return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b) }
  const contrast = (l1, l2) => (Math.max(l1,l2)+0.05) / (Math.min(l1,l2)+0.05)
  const hexToRgbString = h => {
    h = h.slice(1)
    if (h.length === 3) h = h.split('').map(c => c+c).join('')
    return \`rgb(\${parseInt(h.slice(0,2),16)}, \${parseInt(h.slice(2,4),16)}, \${parseInt(h.slice(4,6),16)})\`
  }
  // A gradient has no backgroundColor; take its worst stop so the check is
  // pessimistic rather than silently passing.
  const worstStop = (img, fg) => {
    const stops = img.match(/(?:rgba?|oklch|oklab)\([^)]*\)|#[0-9a-f]{3,8}/gi) || []
    let worst = null, worstRatio = Infinity
    for (const raw of stops) {
      const c = parse(raw.startsWith('#') ? hexToRgbString(raw) : raw)
      if (c.a === 0) continue
      const ratio = contrast(lum(fg), lum(c))
      if (ratio < worstRatio) { worstRatio = ratio; worst = c }
    }
    return worst
  }
  const resolveBg = (el, fgColor) => {
    const stack = []
    for (let n = el; n; n = n.parentElement) {
      const st = getComputedStyle(n)
      const img = st.backgroundImage
      if (img && img !== 'none' && fgColor) {
        // Keep the stop's own alpha: a 5% tint is nearly invisible, and
        // treating it as opaque invents failures.
        const c = worstStop(img, fgColor)
        if (c && c.a > 0) {
          stack.push(c)
          if (c.a === 1) break
        }
      }
      const c = parse(st.backgroundColor)
      if (c.a > 0) stack.push(c)
      if (c.a === 1) break
    }
    let base = document.documentElement.classList.contains('dark')
      ? { r:0,g:0,b:0,a:1 } : { r:255,g:255,b:255,a:1 }
    if (stack.length && stack[stack.length-1].a === 1) base = stack.pop()
    for (let i = stack.length-1; i >= 0; i--) base = over(stack[i], base)
    return base
  }
  const hex = c => '#' + [c.r,c.g,c.b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('')
  const out = []
  for (const el of document.querySelectorAll('p,span,label,h1,h2,h3,h4,a,button,td,th,div,li')) {
    const t = el.textContent && el.textContent.trim()
    if (!t || el.children.length) continue
    if (el.closest('[aria-hidden="true"]') || el.getAttribute('aria-hidden') === 'true') continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.3) continue
    if (!el.getClientRects().length) continue
    const rawFg = parse(st.color)
    const bg = resolveBg(el, rawFg)
    const fg = over(rawFg, bg)
    const ratio = contrast(lum(fg), lum(bg))
    const px = parseFloat(st.fontSize), bold = parseInt(st.fontWeight) >= 700
    const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5
    if (ratio < need) out.push({ t: t.slice(0,32), r: +ratio.toFixed(2), need, fg: hex(fg), bg: hex(bg), px })
  }
  return out
})()`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('  ! JS-Fehler:', e.message.slice(0, 100)))

// Stub the API so the audit runs without a backend.
await page.route('**/api/**', route => {
  const u = route.request().url()
  const json = x => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.includes('/auth/me')) return json({ id: 1, username: 'admin', display_name: 'Admin', role: 'admin' })
  if (u.includes('/auth/users')) return json({ data: [{ id: 1, username: 'admin', display_name: 'Admin', role: 'admin' }] })
  if (u.includes('/health')) return json({ status: 'ok', services: {}, aiUsage: { calls: 12, total_tokens: 3456 } })
  return json({ data: [], pagination: { total: 0, totalPages: 1, page: 1 } })
})

await page.goto(`${BASE}/login`)
const findings = new Map()
for (const theme of ['light', 'dark']) {
  await page.evaluate(t => {
    localStorage.setItem('hrtool_token', 'audit')
    localStorage.setItem('hr-locale', 'de')
    localStorage.setItem('hr-theme', t)
  }, theme)
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(300)
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    if ((theme === 'dark') !== isDark) { console.log(`  ! Theme ${theme} nicht aktiv auf ${route}`); continue }
    for (const v of await page.evaluate(AUDIT)) {
      const key = `${theme}|${v.fg}|${v.bg}|${v.px}`
      if (!findings.has(key)) findings.set(key, { ...v, theme, route })
    }
  }
}
await browser.close()

const rows = [...findings.values()].sort((a, b) => a.r - b.r)
if (rows.length === 0) {
  console.log(`OK: keine Kontrastverstoesse auf ${ROUTES.length} Routen in hell und dunkel.`)
} else {
  console.log(`${rows.length} Kontrastverstoesse:\n`)
  for (const v of rows) {
    console.log(`  ${v.theme.padEnd(5)} ${String(v.r).padStart(5)}:1 (noetig ${v.need})  ${v.fg} auf ${v.bg}  ${String(v.px).padStart(4)}px  "${v.t}"  [${v.route}]`)
  }
}
process.exit(rows.length ? 1 : 0)
