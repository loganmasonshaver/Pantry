// What prep, cook and rest time MEAN, for recipes taken from creators.
//
// One definition shared by the Discover pipeline and the backfill, so the two can never disagree
// about a recipe. It mirrors the rules generate-meals gives Cook Tonight, minus the user's time
// budget, which Discover does not have.
//
// Why it exists: trending_meals used to store a single prep_time with no definition, and the model
// guessed per recipe — a 16-hour Ninja Creami freeze was dropped from one ("10 min") and counted as
// hands-on work in another ("1020 min").

export const TIME_RULES = `TIME — three separate numbers in minutes, because they answer different questions:
- "prepTime": HANDS-ON minutes the cook is actively working — chopping, mixing, blending, assembling.
- "cookTime": UNATTENDED minutes the cook must still be there for — an oven bake, a simmer, a roast, an air-fry, a Ninja Creami spin cycle. The food is cooking and they are waiting on it.
- "restTime": DETACHABLE minutes where the cook can walk away entirely and come back later or tomorrow — freezing, chilling, setting, soaking, marinating, rising. A Ninja Creami base frozen "at least 16 hours" is restTime 960. "Overnight" is 480. "Refrigerate 24 hours" is 1440. Use 0 when the dish is ready as soon as the work is done.
Ask of every wait: could the cook leave the house? Then it is restTime. Must they stay by the oven or the machine? Then it is cookTime.
NEVER fold a freeze or a chill into prepTime — a 10-minute blend with a 16-hour freeze is prepTime 10 and restTime 960, never prepTime 970. And NEVER drop it — the reader must know the dish is for tomorrow.
When the creator gives a range ("freeze 3-4 hours", "chill 1 to 2 hours"), use the LOWER bound — the earliest the dish can be eaten.
A MANDATORY step with NO stated duration still takes time — estimate a realistic one, never 0: "bake until golden brown" is cookTime about 35, "cook until tender" about 20, "chill until set" or "cool and chill before serving" restTime about 120, "freeze until solid" about 240, a Ninja Creami base about 960. 0 is only for no wait at all, or an OPTIONAL one ("eat immediately or freeze 5 more minutes").
These are NOT restTime: storage and reheating notes ("keeps 5 days", "reheat 90 seconds"), optional steps ("or chill for a thicker texture", "serve immediately or chill"), and a marinade or set the creator caps at under 30 minutes ("set aside 15-20 minutes, no longer") — that last one belongs in prepTime.`

// The SAME time, in the order the cook does it. Three totals cannot say whether a wait comes first
// (soak the lentils overnight, THEN blend) or in the middle (blend, freeze 16 hours, THEN spin) —
// measured on the pool: 13 of 23 waiting dishes wait at the end, 3 wait first, 6 wait mid-recipe.
export const PHASE_RULES = `TIME PHASES — "timePhases": the same minutes as an ORDERED list, in the order the cook does them, so the reader knows the order of operations. Each item is {"kind": "prep" | "cook" | "wait", "label": "...", "minutes": N}.
- kind "prep" is hands-on work; its label is always "prep".
- kind "cook" is unattended time the cook stays for; label is one of: bake, roast, simmer, boil, fry, air-fry, grill, pressure-cook, spin, cook.
- kind "wait" is walk-away time; label is one of: soak, marinate, chill, freeze, set, rise, cool, thaw, rest.
- They MUST add up: every "prep" phase sums to prepTime, every "cook" phase to cookTime, every "wait" phase to restTime.
- Merge consecutive steps of the same kind into one phase. Put each wait WHERE it happens: a soak the recipe starts with comes first; a freeze between blending and spinning sits between them.
- A Ninja Creami base is ALWAYS frozen BEFORE it is spun: prep → freeze → spin. A thaw, if the recipe has one, sits between the freeze and the spin. Never list the spin before the freeze.
- A dish with no cook and no wait is one phase.
Examples:
  Soak lentils overnight, blend, cook the pancakes: prepTime 20, cookTime 20, restTime 480 → [{"kind":"wait","label":"soak","minutes":480},{"kind":"prep","label":"prep","minutes":20},{"kind":"cook","label":"cook","minutes":20}]
  Ninja Creami — blend, freeze, spin: prepTime 5, cookTime 5, restTime 960 → [{"kind":"prep","label":"prep","minutes":5},{"kind":"wait","label":"freeze","minutes":960},{"kind":"cook","label":"spin","minutes":5}]
  Cheesecake — blend, bake, chill: prepTime 15, cookTime 45, restTime 120 → [{"kind":"prep","label":"prep","minutes":15},{"kind":"cook","label":"bake","minutes":45},{"kind":"wait","label":"chill","minutes":120}]`

export type MealTimes = { prepTime: number; cookTime: number; restTime: number }
export type TimePhase = { kind: 'prep' | 'cook' | 'wait'; label: string; minutes: number }

const COOK_LABELS = new Set(['bake', 'roast', 'simmer', 'boil', 'fry', 'air-fry', 'grill', 'pressure-cook', 'spin', 'cook'])
const WAIT_LABELS = new Set(['soak', 'marinate', 'chill', 'freeze', 'set', 'rise', 'cool', 'thaw', 'rest'])

// Phases may disagree with the totals by rounding, not by substance: the larger of 5 minutes or 10%.
const phaseSlack = (total: number) => Math.max(5, Math.round(total * 0.1))

// Upper bounds that catch a unit slip rather than police the model. 3 days of rest covers every real
// cure or ferment in this pool; an hour-for-minute mistake (prepTime 1020 meaning 17 hours of chopping)
// is exactly what this is here to reject.
const MAX_ACTIVE = 360
const MAX_REST = 4320

const toMinutes = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Coerce a model's time answer into three sane integers.
 *
 * Hands-on or unattended time over MAX_ACTIVE is treated as a wait that was mis-filed as work — a
 * 1020-minute prep is a freeze, not seventeen hours at the counter — and is MOVED into restTime
 * rather than discarded, so the fact that the dish takes a day survives the correction. The
 * counterpart direction (a wait dropped entirely) cannot be repaired here: there is no number left
 * to move, which is why TIME_RULES forbids it at the source.
 */
export function normaliseTimes(raw: { prepTime?: unknown; cookTime?: unknown; restTime?: unknown }): MealTimes {
  let prepTime = toMinutes(raw?.prepTime)
  let cookTime = toMinutes(raw?.cookTime)
  let restTime = toMinutes(raw?.restTime)
  if (prepTime > MAX_ACTIVE) { restTime = Math.max(restTime, prepTime); prepTime = 0 }
  if (cookTime > MAX_ACTIVE) { restTime = Math.max(restTime, cookTime); cookTime = 0 }
  restTime = Math.min(restTime, MAX_REST)
  return { prepTime, cookTime, restTime }
}

/**
 * Validate the model's ordered phases against the (already normalised) totals.
 *
 * The totals stay the source of truth — cards, "Ready in 15" and the prep budget all read them — so
 * phases are only kept when they tell the SAME story in order. Any kind that sums wrong returns
 * null and the detail screen falls back to the plain breakdown; faking an order from totals that
 * disagree would print a timeline nobody can follow. Labels outside the vocabulary become the
 * generic "cook" / "rest" rather than inventing a verb.
 */
export function normalisePhases(raw: unknown, times: MealTimes): TimePhase[] | null {
  if (!Array.isArray(raw)) return null
  // The model's LIST ORDER is the cooking order. Sorting by a per-phase step number was tried and
  // measured worse (3-4 of 24 misordered vs 1): a merged prep phase spans several steps, so one
  // anchor cannot place it, and the sort scrambled recipes the model had right.
  const phases: TimePhase[] = []
  for (const p of raw) {
    const kind = (p as any)?.kind
    if (kind !== 'prep' && kind !== 'cook' && kind !== 'wait') continue
    const minutes = toMinutes((p as any)?.minutes)
    if (minutes === 0) continue
    const said = String((p as any)?.label ?? '').trim().toLowerCase()
    const label = kind === 'prep' ? 'prep'
      : kind === 'cook' ? (COOK_LABELS.has(said) ? said : 'cook')
      : (WAIT_LABELS.has(said) ? said : 'rest')
    const last = phases[phases.length - 1]
    // Adjacent same-kind, same-label phases are one phase to the reader.
    if (last && last.kind === kind && last.label === label) last.minutes += minutes
    else phases.push({ kind, label, minutes })
  }
  if (phases.length === 0) return null
  const sum = (k: TimePhase['kind']) => phases.filter(p => p.kind === k).reduce((a, p) => a + p.minutes, 0)
  const agrees = (k: TimePhase['kind'], total: number) => Math.abs(sum(k) - total) <= (total === 0 ? 0 : phaseSlack(total))
  if (!agrees('prep', times.prepTime) || !agrees('cook', times.cookTime) || !agrees('wait', times.restTime)) return null
  return phases
}
