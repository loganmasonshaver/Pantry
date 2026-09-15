#!/usr/bin/env node
// Summarises an Instruments "Animation Hitches" trace for docs/PLAN-motion.md: how much of the
// recording the app spent hitching, and when. Usage: node scripts/motion-trace-read.mjs <file.trace>
//
// The number to watch is HITCH TIME RATIO — milliseconds of hitch per second of recording. Apple's
// bands: under 5 good, 5–10 warning, over 10 critical. Compare runs of the SAME walkthrough only.
import { execFileSync } from 'node:child_process'

const trace = process.argv[2]
if (!trace) { console.error('usage: node scripts/motion-trace-read.mjs <file.trace>'); process.exit(1) }

const xctrace = (...args) => execFileSync('xcrun', ['xctrace', 'export', '--input', trace, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })

const toc = xctrace('--toc')
const seconds = Number(toc.match(/<duration>([\d.]+)<\/duration>/)?.[1] ?? NaN)
const appName = toc.match(/<process type="launched"[^>]*name="([^"]+)"/)?.[1] ?? 'Pantry'
const xml = xctrace('--xpath', '/trace-toc/run[@number="1"]/data/table[@schema="hitches"]')

// xctrace writes each distinct value once with id="N" and repeats it as ref="N", so resolve refs.
const byId = new Map()
for (const m of xml.matchAll(/<([\w-]+) id="(\d+)" fmt="([^"]*)"(?:\/>|>([^<]*))/g)) {
  byId.set(m[2], { fmt: m[3], text: m[4] ?? '' })
}

// Top-level cells of each row, in schema order: start, duration, process, is-system, swap-id, label, display, issue.
const cellsOf = (row) => {
  const cells = []
  let depth = 0
  for (const t of row.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>/g)) {
    const [, closing, , attrs, selfClosing] = t
    if (closing) { depth--; continue }
    if (depth === 0) {
      const ref = attrs.match(/ref="(\d+)"/)?.[1]
      const id = attrs.match(/id="(\d+)"/)?.[1]
      cells.push(byId.get(ref ?? id) ?? { fmt: '', text: '' })
    }
    if (!selfClosing) depth++
  }
  return cells
}

const hitches = []
for (const r of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
  const [start, duration, proc, , , , , issue] = cellsOf(r[1])
  if (!proc?.fmt.startsWith(appName)) continue
  hitches.push({ atS: Number(start.text) / 1e9, ms: Number(duration.text) / 1e6, issue: issue?.fmt ?? '' })
}

const total = hitches.reduce((s, h) => s + h.ms, 0)
const ratio = total / seconds
const band = ratio < 5 ? 'good' : ratio <= 10 ? 'warning' : 'critical'
const fmt = (n, d = 1) => n.toFixed(d)

console.log(`\n${trace.split('/').pop()}`)
console.log(`  recording        ${fmt(seconds)} s`)
console.log(`  hitches          ${hitches.length}  (${hitches.filter(h => h.ms > 33.4).length} longer than two 60Hz frames)`)
console.log(`  hitch time       ${fmt(total)} ms`)
console.log(`  HITCH TIME RATIO ${fmt(ratio, 2)} ms/s  → ${band}`)
console.log(`  worst            ${fmt(Math.max(0, ...hitches.map(h => h.ms)))} ms`)
const worst = [...hitches].sort((a, b) => b.ms - a.ms).slice(0, 12).sort((a, b) => a.atS - b.atS)
if (worst.length) {
  console.log('\n  longest hitches, in time order (match "at" against the walkthrough):')
  for (const h of worst) console.log(`    at ${fmt(h.atS).padStart(6)} s   ${fmt(h.ms).padStart(6)} ms   ${h.issue}`)
}
console.log()
