// Renders the driver-app (PWA) icons: the white 224 logo centred on the brand
// background. Usage: node scripts/build-driver-icons.mjs
// Output: public/icons/driver-192.png, driver-512.png, driver-maskable-512.png
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const logo = readFileSync(path.resolve(root, '../docs/membership-form/logo.png')).toString('base64')
const outDir = path.resolve(root, '../public/icons')
mkdirSync(outDir, { recursive: true })

// Brand `background` token (tailwind.config.js). Icons are raster files, not
// components, so the value is inlined here.
const BG = '#0a0a0a'

// Maskable icons are cropped to a circle/squircle by the launcher: keep the
// logo inside the central ~60% safe zone.
const variants = [
  { file: 'driver-192.png', size: 192, logoWidth: 0.78 },
  { file: 'driver-512.png', size: 512, logoWidth: 0.78 },
  { file: 'driver-maskable-512.png', size: 512, logoWidth: 0.58 },
]

const browser = await chromium.launch()
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: v.size, height: v.size } })
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${v.size}px;height:${v.size}px;background:${BG};display:flex;align-items:center;justify-content:center">
    <img src="data:image/png;base64,${logo}" style="width:${Math.round(v.size * v.logoWidth)}px;height:auto">
  </body></html>`)
  await page.screenshot({ path: path.join(outDir, v.file), omitBackground: false })
  await page.close()
  console.log(`wrote ${v.file}`)
}
await browser.close()
