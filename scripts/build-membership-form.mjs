// Renders docs/membership-form/membership-form.html to a print-ready A4 PDF.
// Usage: node scripts/build-membership-form.mjs [outPath] [--png]
import { chromium } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const html = path.resolve(root, '../docs/membership-form/membership-form.html')
const outArg = process.argv.slice(2).find(a => !a.startsWith('--'))
const out = outArg ?? path.resolve(root, '../docs/membership-form/224-Clubhouse-Membership-Form.pdf')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } })
await page.goto(pathToFileURL(html).href, { waitUntil: 'load', timeout: 30000 })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
if (process.argv.includes('--png')) await page.screenshot({ path: out.replace(/\.pdf$/, '.png'), fullPage: true })
await browser.close()
console.log(`wrote ${out}`)
