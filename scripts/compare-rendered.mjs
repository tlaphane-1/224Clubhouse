// Compare what two running builds actually render: document title, visible text
// and the heading font. compare-builds.mjs cannot see React-rendered copy, so
// this is the proof that moving facts into tenant.json changed nothing visible.
//
//   node scripts/compare-rendered.mjs <urlA> <urlB> [extraRoute ...]
//
// Extra routes (e.g. /events/<id> when no event is listed live) are compared too.
//
// Exit 1 if any route differs, or if either build renders "undefined" or
// "[object Object]" in visible text.
import { chromium } from '@playwright/test'

const [urlA, urlB, ...extraRoutes] = process.argv.slice(2).map((u) => u?.replace(/\/$/, ''))
if (!urlA || !urlB) {
  console.error('usage: node scripts/compare-rendered.mjs <urlA> <urlB> [extraRoute ...]')
  process.exit(2)
}

const STATIC_ROUTES = [
  '/', '/store', '/events', '/membership', '/about', '/contact', '/cart', '/checkout',
  '/track', '/orders', '/account', '/terms', '/privacy', '/delivery-returns',
  '/unsubscribe', '/reset-password', '/admin/login', '/driver', '/does-not-exist',
]
const BAD_TEXT = /undefined|\[object Object\]/
const VIEWPORT = { width: 390, height: 844 }

const normalise = (text) => text.replace(/\s+/g, ' ').trim()

async function capture(context, base, route) {
  const page = await context.newPage()
  // An uncaught error usually means a blank page; two equally blank pages must not compare as equal.
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // networkidle can stall on long-lived connections; a miss is fine, the fixed wait follows.
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(2500)
    return await page.evaluate(() => {
      const heading = document.querySelector('h1') || document.querySelector('h2')
      return {
        title: document.title,
        text: document.body.innerText,
        font: heading ? getComputedStyle(heading).fontFamily : '(no heading)',
        iframes: document.querySelectorAll('iframe').length,
      }
    }).then((r) => ({ ...r, errors }))
  } finally {
    await page.close()
  }
}

// Line diff (LCS) over whitespace-normalised lines, so a one-word change shows as one -/+ pair.
function lineDiff(a, b) {
  const x = a.split('\n')
  const y = b.split('\n')
  const lcs = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++ }
    else if (j < y.length && (i >= x.length || lcs[i][j + 1] >= lcs[i + 1][j])) out.push(`    + ${y[j++]}`)
    else out.push(`    - ${x[i++]}`)
  }
  return out
}

const lines = (text) => text.split('\n').map(normalise).filter(Boolean).join('\n')

function compare(a, b) {
  const problems = []
  if (a.title !== b.title) problems.push([`  title: ${JSON.stringify(a.title)} vs ${JSON.stringify(b.title)}`])
  if (a.font !== b.font) problems.push([`  h1/h2 font-family: ${a.font} vs ${b.font}`])
  if (normalise(a.text) !== normalise(b.text)) problems.push(['  text differs (- A, + B):', ...lineDiff(lines(a.text), lines(b.text))])
  for (const [label, side] of [['A', a], ['B', b]]) {
    for (const message of side.errors) problems.push([`  build ${label} threw a page error: ${message}`])
    const hit = normalise(side.text).match(BAD_TEXT)
    if (hit) problems.push([`  build ${label} renders "${hit[0]}" in visible text`])
  }
  return problems
}

const browser = await chromium.launch()
const contexts = {}
for (const [key, base] of [['A', urlA], ['B', urlB]]) {
  const context = await browser.newContext({ viewport: VIEWPORT })
  await context.addInitScript(() => {
    try { localStorage.setItem('age-verified', 'true') } catch { /* storage unavailable */ }
  })
  contexts[key] = { base, context }
}

// Detail pages: take the first product/event link from A, then use the same one on B.
async function firstLink(listRoute, prefix) {
  const page = await contexts.A.context.newPage()
  try {
    await page.goto(urlA + listRoute, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(2500)
    return await page.evaluate((p) => {
      const a = [...document.querySelectorAll('a[href]')]
        .map((el) => el.getAttribute('href'))
        .find((h) => h.startsWith(p) && h.length > p.length)
      return a || null
    }, prefix)
  } finally {
    await page.close()
  }
}

const routes = [...STATIC_ROUTES, ...extraRoutes.map((r) => (r.startsWith('/') ? r : `/${r}`))]
for (const [list, prefix] of [['/store', '/store/'], ['/events', '/events/']]) {
  const link = await firstLink(list, prefix)
  if (link) routes.push(link)
  else console.log(`WARN no ${prefix}* link found on ${list}; detail page not compared`)
}

let failed = 0
for (const route of routes) {
  let problems = []
  let a
  let b
  // One retry: both builds read the same live data, but ordering/timing can differ between loads.
  for (let attempt = 1; attempt <= 2; attempt++) {
    a = await capture(contexts.A.context, urlA, route)
    b = await capture(contexts.B.context, urlB, route)
    problems = compare(a, b)
    if (problems.length === 0) break
  }
  const notes = `iframes A=${a.iframes} B=${b.iframes}`
  if (problems.length === 0) {
    console.log(`PASS ${route}  (${notes})`)
  } else {
    failed++
    console.log(`FAIL ${route}  (${notes})`)
    for (const p of problems) console.log(p.join('\n'))
  }
}

await browser.close()
console.log(`\n${routes.length - failed}/${routes.length} routes match`)
process.exit(failed ? 1 : 0)
