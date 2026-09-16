// Dev-only timeline of one scan: photos sent → review → meals → photos → plating → the deck opening.
// Each mark prints to the Metro log as it happens, and the whole run prints again as one block when
// it ends, so a single paste shows where the wait went.
//
// Wall-clock times on purpose: generated_meals and image_cache only record their own moment, and a
// phone mark has to line up against those rows to split network from server work.
//
// A mark with no timeline running is dropped. fetchMealImage is shared with Home, Saved and the meal
// screen, and those must not log into (or keep alive) a scan's timeline.

type Mark = { at: number; label: string }
let marks: Mark[] | null = null

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const clock = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`
}

// Seconds since `from`, one decimal — the unit the handoff timelines are written in.
export const secsSince = (from: number) => ((Date.now() - from) / 1000).toFixed(1)

export function scanPerfStart(label: string) {
  if (!__DEV__) return
  marks = [] // a retry or a second scan starts clean rather than appending to the last run
  scanPerfMark(label)
}

export function scanPerfMark(label: string) {
  if (!__DEV__ || !marks) return
  const at = Date.now()
  const t0 = marks[0]?.at ?? at
  marks.push({ at, label })
  console.log(`[perf] ${clock(at)} +${((at - t0) / 1000).toFixed(1)}s ${label}`)
}

export function scanPerfEnd(label: string) {
  if (!__DEV__ || !marks) return
  scanPerfMark(label)
  const t0 = marks[0].at
  const lines = marks.map(m => `  ${clock(m.at)} ${`+${((m.at - t0) / 1000).toFixed(1)}s`.padStart(8)}  ${m.label}`)
  console.log(['[perf] ── scan timeline ──', ...lines].join('\n'))
  marks = null
}
