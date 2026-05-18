#!/usr/bin/env node
// Renders every frame in frames.json into output/{id}-{slug}.png at App Store
// iPhone 6.9" dimensions (1320×2868). Re-run any time copy/screenshots change.
//
// Setup (one time):
//   cd appstore-screenshots && npm install
//
// Run:
//   node render.js

const fs = require('fs')
const path = require('path')

let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('Playwright not installed. Run:  cd appstore-screenshots && npm install')
  process.exit(1)
}

const root = __dirname
const frames = require(path.join(root, 'frames.json'))
const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8')
const outDir = path.join(root, 'output')

const escapeHTML = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderLine(line) {
  const safe = escapeHTML(line.text)
  if (!line.accent) return safe
  const accentSafe = escapeHTML(line.accent)
  return safe.replace(accentSafe, `<span class="accent">${accentSafe}</span>`)
}

;(async () => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1320, height: 2868 },
    deviceScaleFactor: 1,
  })

  for (const frame of frames) {
    const screenshotPath = path.join(root, 'raw', frame.screenshot)
    if (!fs.existsSync(screenshotPath)) {
      console.warn(`✗ skip ${frame.id} — missing ${screenshotPath}`)
      continue
    }

    // Inline screenshot as a data URL — Playwright's setContent runs from about:blank
    // which blocks file:// origins, so the <img> would render black.
    const screenshotBase64 = fs.readFileSync(screenshotPath).toString('base64')
    const screenshotDataUri = `data:image/png;base64,${screenshotBase64}`

    const html = template
      .replace('{{LINE1}}', renderLine(frame.lines[0]))
      .replace('{{LINE2}}', renderLine(frame.lines[1]))
      .replace('{{SCREENSHOT}}', screenshotDataUri)
      .replace('{{TRANSFORM}}', frame.transform || '')

    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    // Wait for the screenshot img to actually decode before capturing
    await page.waitForFunction(() => {
      const img = document.querySelector('.phone-screen img')
      return img && img.complete && img.naturalWidth > 0
    })

    const outPath = path.join(outDir, `${frame.id}-${frame.slug}.png`)
    await page.screenshot({ path: outPath, fullPage: false, omitBackground: false })
    await page.close()
    console.log(`✓ ${path.relative(root, outPath)}`)
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
