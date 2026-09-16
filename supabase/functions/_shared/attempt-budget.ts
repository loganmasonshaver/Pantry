// Wall-clock budget and provider choice for generate-trending-meals' model retries. Pure, so the
// arithmetic that decides whether a thin day gets another attempt is unit-tested rather than
// discovered at 08:00 UTC.
//
// The gateway answers 504 IDLE_TIMEOUT at exactly 150 s and a run that never returns stores
// nothing (Sep 14 and 15). The fixed budget that replaced "no budget" — no attempt starts after
// 50 s, none runs past 85 s — reserved a 12-recipe tail on every run, so on Sep 16 a 3-survivor
// day stopped at 2 attempts and returned in 58 s with ~90 s unused. The tail grows with survivors,
// so a thin union is exactly when there is time for another attempt.

// 15 s under the gateway's 150 s.
export const WALL_BUDGET_MS = 135_000
// Measured tail after the loop, from funnel.timing on real runs: 10 rows took 1.7 s to rank,
// look up and insert, then 9.2 s for images — and 9 rows took 29.8 s for images an hour later,
// same code, slower FAL. The reserve covers rank + insert + ONE image wave; the image stage is
// bounded by its own deadline in the function (a row that misses it keeps its thumbnail and the
// next run's self-heal regenerates it), so a slow FAL day cannot turn into a 504.
export const TAIL_BASE_MS = 10_000
export const TAIL_PER_RECIPE_MS = 1_000
// What the NEXT attempt may add, so the reserve covers the tail the attempt itself creates.
// Single-attempt yields seen: 1-11.
export const NEXT_ATTEMPT_YIELD = 8
// FatSecret runs on every survivor before the STORE_CAP slice, and an attempt keeps at most 30.
const TAIL_RECIPE_CEILING = 30
// Floor on how long an attempt is assumed to take before this run has measured one. Gemini
// answered in ~17 s on Sep 13 and ~45-50 s on Sep 15.
export const MIN_ATTEMPT_MS = 20_000
// Each attempt has run longer than the one before it on every run so far (5.9 → 16.5 → 24.2 s;
// 27.6 → 36.1 s): latency tracks output size and the rotation changes what the model returns.
// Predicting from the slowest so far under-shot and started an attempt that only hit its clamp.
export const ATTEMPT_GROWTH = 1.25
// A call's own abort. The floor stops a first attempt after a slow YouTube stage being aborted
// before the model has produced anything; the cap is the old per-call hard timeout.
const CALL_TIMEOUT_FLOOR_MS = 15_000
const CALL_TIMEOUT_CAP_MS = 90_000

// The moment no model call may run past, given how many recipes have survived so far.
export function llmLoopEndMs(survivors: number): number {
  const tailRecipes = Math.min(TAIL_RECIPE_CEILING, Math.max(0, survivors) + NEXT_ATTEMPT_YIELD)
  return WALL_BUDGET_MS - (TAIL_BASE_MS + TAIL_PER_RECIPE_MS * tailRecipes)
}

export type StartDecision = { start: boolean; loopEndMs: number; expectedMs: number; callTimeoutMs: number }

// The first attempt always starts — a run with no attempt stores nothing. A later one starts only
// if this run's slowest attempt so far would still finish before the loop's end.
export function decideAttempt(attemptNo: number, elapsedMs: number, survivors: number, completedMs: number[]): StartDecision {
  const loopEndMs = llmLoopEndMs(survivors)
  const expectedMs = Math.round(Math.max(MIN_ATTEMPT_MS, ...completedMs.map(ms => ms * ATTEMPT_GROWTH)))
  const start = attemptNo === 0 || elapsedMs + expectedMs <= loopEndMs
  const callTimeoutMs = Math.max(CALL_TIMEOUT_FLOOR_MS, Math.min(CALL_TIMEOUT_CAP_MS, loopEndMs - elapsedMs))
  return { start, loopEndMs, expectedMs, callTimeoutMs }
}

// Gemini is the provider by Logan's call; OpenAI (gpt-4o-mini) produced visibly worse recipes and
// is kept for outages. It runs only in the slot right after a primary attempt that returned
// nothing at all — an error, a timeout, unparseable or empty output. A primary answer whose recipes
// were all REJECTED is model selectivity, not an outage, and does not hand over the next slot.
export function pickProvider<P>(primary: P, fallback: P | null, primaryFailedLast: boolean): P {
  return primaryFailedLast && fallback ? fallback : primary
}

// Which videos the NEXT attempt asks about, and in what order. Videos already kept or terminally
// rejected are out: on 2026-09-16's real run the model spent ~25 of 39 later-attempt picks on the
// same tiramisu balls, the same paneer pasta and dishes it had already been given. The rest rotate
// so a different video leads each attempt. `terminal` holds 1-based video_index values; the
// result is 0-based positions into the candidate list, which is what the prompt renderer takes.
export function nextAttemptOrder(total: number, terminal: Set<number>, attemptNo: number, maxAttempts: number): number[] {
  const remaining: number[] = []
  for (let i = 0; i < total; i++) if (!terminal.has(i + 1)) remaining.push(i)
  if (remaining.length === 0) return []
  const step = Math.ceil(remaining.length / Math.max(1, maxAttempts))
  const offset = (attemptNo * step) % remaining.length
  return remaining.map((_, k) => remaining[(k + offset) % remaining.length])
}

// Splits one attempt's video list into parallel calls. On 2026-09-16 the model returned about a
// third of a 25-48 video list and favoured the top of it; a short list has no bottom. Shards are
// balanced (25 at size 6 is 5x5, not 6,6,6,6,1) and capped at `maxShards` concurrent calls, which
// raises the size rather than the call count — Gemini's per-minute limits are per account and not
// published. size <= 0 means one call with the whole list, the behaviour before shards.
export const MAX_PARALLEL_SHARDS = 5
export function chunkOrder(order: number[], size: number, maxShards = MAX_PARALLEL_SHARDS): number[][] {
  if (order.length === 0) return []
  if (size <= 0) return [order]
  const count = Math.min(Math.max(1, maxShards), Math.ceil(order.length / size))
  const per = Math.ceil(order.length / count)
  const out: number[][] = []
  for (let i = 0; i < order.length; i += per) out.push(order.slice(i, i + per))
  return out
}

export type Counts = Record<string, number>

// Per-attempt rejection counts from the run's cumulative counters. Only non-zero keys, so an
// attempt's entry in the funnel reads as the reasons that actually fired.
export function countDelta(after: Counts, before: Counts): Counts {
  const out: Counts = {}
  for (const [k, v] of Object.entries(after)) {
    const d = v - (before[k] ?? 0)
    if (d !== 0) out[k] = d
  }
  return out
}

// Folds one attempt's delta into a provider's running total, keeping every key (zeros included)
// so llm_<provider>.rejected keeps the shape older funnel rows have.
export function addCounts(total: Counts, delta: Counts, keys: string[]): Counts {
  const out: Counts = {}
  for (const k of keys) out[k] = (total[k] ?? 0) + (delta[k] ?? 0)
  return out
}
