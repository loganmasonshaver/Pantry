// Bring an over- or under-sized recipe into its calorie band by changing the FOOD.
//
// Why this exists rather than another filter: the ranking already sorts by macro fit and slices
// the best 3 of 10, so a meal landing at 1.4x target IS the closest the model produced. Dropping
// it harder starves the deck (the fat filter had to be floored for exactly this reason). Filtering
// cannot fix over-shoot; changing the quantities can.
//
// CLAUDE.md's landmine is explicit: "Do NOT linearly scale ingredients to hit per-serving macros —
// that produced '0.5 large eggs'." The rule is obeyed by construction here rather than by rounding
// afterwards: an ingredient is only scaled when its own visual carries a MEASURE word (a cup, a
// tablespoon, grams). Anything counted — "2 large", "3-4 slices", "2 cloves" — is left completely
// alone, so a half egg can never be produced. Unrecognised visuals default to fixed, so the failure
// direction is "scaled less than we wanted", never "invented a fractional egg".

import { estimateMacros } from './macro-estimate.ts'

// Words that mean a quantity is measured out, not counted. Only these are scalable.
// Two branches, because a symbol unit attaches to its number with no word boundary between them:
// \bg\b cannot match the "g" in "30g" (both are word characters), so a gram weight read as
// unscalable and the recipe silently refused to move. Caught by a test.
const MEASURE_WORDS = /\b(?:cups?|tbsps?|tablespoons?|tsps?|teaspoons?|ounces?|grams?|scoops?|handfuls?|palm|fist|drizzle|pinch|splash|dash|glugs?)\b|\d\s*(?:g|kg|ml|l|oz)\b/i

/**
 * Past this the dish stops being the dish — a bolognese at 0.5x is a different meal, not a smaller
 * one, and a regeneration is the better answer. Same reasoning and the same band as the
 * scale-instead-of-regenerate design in docs/PRELAUNCH.md 2h.
 */
export const SCALE_MIN = 0.7
export const SCALE_MAX = 1.4
// Calorie-dense, protein-poor food (rice, nuts, butter, oil, cheese) may shrink further than the
// dish as a whole: half the rice under the same cottage cheese is still that dish, and it is where
// the calories were. Run 48 shrank everything alike and took a 46g bowl to 33g to lose 235 kcal,
// when the 30g of pecans alone carried 207 of them.
export const DENSE_MIN = 0.5
// Protein's share of an ingredient's own calories, at or above which it is protected. Eggs sit at
// 0.35 and ground beef at 0.35; shredded cheese (0.25), milk (0.26) and peanut butter (0.17) do
// not. Vegetables clear it too, which is right for a different reason: they cost almost nothing.
const LEAN_SHARE = 0.3

export type ScalableIngredient = { name?: unknown; grams?: unknown; visual?: unknown }

// A COUNT of four or more is divisible in practice. "15 large shrimp" and "8 florets" are bulk
// written as a count, and leaving them fixed is what let a 690 kcal dish sit against a 467 kcal
// cutting target: the only movable things left were a tablespoon of soy sauce and half a clove of
// garlic. The landmine this file exists to avoid is "0.5 large eggs" — a count of 3 or fewer stays
// untouchable, and counts that do scale round to WHOLE items, never quarters.
const COUNT_MIN_SCALABLE = 4
const LEADING_COUNT = /^\s*(\d+)(?!\s*[\/.])/

export function countScalable(visual: string | undefined): boolean {
  if (!visual || MEASURE_WORDS.test(visual)) return false
  const m = visual.match(LEADING_COUNT)
  return !!m && Number(m[1]) >= COUNT_MIN_SCALABLE
}

export function isScalable(ing: ScalableIngredient): boolean {
  const visual = String(ing?.visual ?? '')
  return MEASURE_WORDS.test(visual) || countScalable(visual)
}

/** Scale the leading number of a visual, preserving ranges and the trailing text. */
export function scaleVisualText(visual: string | undefined, factor: number): string | undefined {
  if (!visual || !Number.isFinite(factor) || factor <= 0 || factor === 1) return visual
  // A glyph fraction has to be consumed WITH its whole number, and the "1/2" branch has to come
  // before plain digits or \d+ eats the "1" and leaves "/2 tsp" behind. Both matter because this
  // function's own output uses ½ ¼ ¾ — "1½ cups" scaled once became "¾½ cups", so a visual that
  // had already been scaled (or one the model wrote with a glyph) was corrupted.
  const NUM = String.raw`(?:\d+\s*[¼½¾]|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾])`
  const m = visual.match(new RegExp(String.raw`^\s*(${NUM})(\s*[-–]\s*(${NUM}))?`))
  if (!m) return visual
  const GLYPH: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 }
  const toNum = (t: string) => {
    const g = t.match(/[¼½¾]/)
    if (g) {
      const whole = parseFloat(t.replace(/[¼½¾]/, '').trim())
      return (Number.isFinite(whole) ? whole : 0) + GLYPH[g[0]]
    }
    if (!t.includes('/')) return parseFloat(t)
    const [a, b] = t.split('/').map(Number)
    return b ? a / b : NaN
  }
  const fmt = (n: number) => {
    const r = quarter(n)
    if (r >= 10) return String(Math.round(r))
    const whole = Math.floor(r)
    const frac = r - whole
    const glyph = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : ''
    if (!glyph) return String(r)
    return whole > 0 ? `${whole}${glyph}` : glyph
  }
  const lo = toNum(m[1])
  if (!Number.isFinite(lo) || lo <= 0) return visual
  const rest = visual.slice(m[0].length)
  // "15 large shrimp" x0.7 is 11 shrimp, not 10½ — a count has no quarters.
  if (countScalable(visual)) {
    const scaledCount = Math.max(1, Math.round(lo * factor))
    return `${scaledCount}${rest}`
  }
  if (m[3] !== undefined) {
    const hi = toNum(m[3])
    if (!Number.isFinite(hi) || hi <= 0) return visual
    // agree() must see the value the reader SEES. 1.05 formats to "1" but is > 1, which printed
    // "1 cups" on a real recipe — the rounding has to happen before the plural decision.
    return `${fmt(lo * factor)}-${fmt(hi * factor)}${agree(rest, quarter(hi * factor))}`
  }
  // Quarter-rounding cannot show less than ¼ cup, so halving "¼ cup" of pecans printed "¼ cup" over
  // 15g. Below that a cook measures in tablespoons anyway (16 to the cup).
  if (lo * factor < 0.25 && /^\s*cups?\b/i.test(rest)) {
    const tbsp = lo * factor * 16
    return `${fmt(tbsp)}${rest.replace(/^(\s*)cups?\b/i, '$1tbsp')}`
  }
  return `${fmt(lo * factor)}${agree(rest, quarter(lo * factor))}`
}

// Scaling the number without the noun produces "1 cups", which reads as a bug to anyone cooking
// from it — the visual is the line a user actually follows in the kitchen. Only units are
// adjusted; the food itself is left alone, because "2 chickens" is not a thing this ever writes.
// Spelled-out units take a plural; abbreviations never do — "1½ tbsps" is not how a recipe is
// written, while "1 cups" is simply wrong.
const PLURAL_UNITS = ['cup', 'tablespoon', 'teaspoon', 'scoop', 'handful', 'slice', 'clove',
                      'piece', 'ounce', 'gram', 'glug', 'splash', 'dash', 'pinch']
function agree(rest: string, value: number): string {
  return rest.replace(/^(\s*)([a-z]+)\b/i, (whole, space: string, word: string) => {
    const lower = word.toLowerCase()
    const base = lower.endsWith('s') ? lower.slice(0, -1) : lower
    if (!PLURAL_UNITS.includes(base)) return whole
    return `${space}${base}${value > 1 ? 's' : ''}`
  })
}

/** Quarter-rounding, shared by the formatter and the plural decision so they cannot disagree. */
function quarter(n: number): number { return Math.round(n * 4) / 4 }

type MacroKey = 'kcal' | 'protein' | 'carbs' | 'fat'
const KEYS: MacroKey[] = ['kcal', 'protein', 'carbs', 'fat']

export type ScaleResult = {
  ingredients: ScalableIngredient[]
  /** multiplier for the meal's calorie total; 1 when nothing was changed */
  macroFactor: number
  /** one multiplier per macro. Protein moves less than calories when only dense food was cut, so
   *  scaling every total by the calorie factor misreports it. */
  factors: Record<MacroKey, number>
  /** applied to measured calorie-dense food, and to measured lean food */
  denseFactor: number
  leanFactor: number
  reason: string
}

const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v))

/**
 * Move a recipe's measured ingredients so its total lands near `targetKcal`.
 *
 * DOWN cuts calorie-dense food first, to DENSE_MIN, aiming at the target. Only if the dish is still
 * out of band does lean food shrink, and only to the band's edge: past that, every gram is protein
 * given up for calories that are already close enough. UP grows all measured food together.
 *
 * Works in the LOCAL table's units rather than the corrected totals, on purpose: the table is
 * approximate in absolute terms (it ran 20-30% from FatSecret on real recipes) but this only needs
 * RATIOS between groups, which survive a table that is uniformly off.
 */
export function scaleToTarget(
  ingredients: ScalableIngredient[] | undefined,
  currentKcal: number,
  targetKcal: number,
  { min = SCALE_MIN, max = SCALE_MAX, denseMin = DENSE_MIN, tolerance = 0.15 } = {},
): ScaleResult {
  const ings = Array.isArray(ingredients) ? ingredients : []
  const unit1 = { kcal: 1, protein: 1, carbs: 1, fat: 1 }
  const noop = (reason: string): ScaleResult => ({ ingredients: ings, macroFactor: 1, factors: unit1, denseFactor: 1, leanFactor: 1, reason })
  if (ings.length === 0 || !(currentKcal > 0) || !(targetKcal > 0)) return noop('no quantities to work with')
  const ratio = currentKcal / targetKcal
  if (ratio >= 1 - tolerance && ratio <= 1 + tolerance) return noop(`already within ${Math.round(tolerance * 100)}% of target`)
  if (!ings.some(isScalable)) return noop('every ingredient is counted, not measured')

  // Unmatched food counts as lean: not knowing what it is, it is cut only after everything else.
  const est = ings.map(i => estimateMacros([i] as never))
  const group = ings.map((ing, i): 'fixed' | 'dense' | 'lean' =>
    !isScalable(ing) ? 'fixed'
    : est[i].kcal > 0 && (est[i].protein * 4) / est[i].kcal < LEAN_SHARE ? 'dense' : 'lean')
  const kcalOf = (g: string) => est.reduce((s, e, i) => s + (group[i] === g ? e.kcal : 0), 0)
  const F = kcalOf('fixed'), D = kcalOf('dense'), L = kcalOf('lean')
  const total = F + D + L
  if (!(D + L > 0)) return noop('the measured ingredients carry no calories')
  const k = currentKcal / total // corrected kcal per table kcal
  const want = targetKcal / k

  let denseFactor = 1, leanFactor = 1
  if (ratio > 1) {
    if (D > 0) denseFactor = clamp(denseMin, 1, 1 - (total - want) / D)
    const edge = (targetKcal * (1 + tolerance)) / k
    const afterDense = F + D * denseFactor + L
    if (afterDense > edge && L > 0) leanFactor = clamp(min, 1, (edge - F - D * denseFactor) / L)
  } else {
    // Counted food does not grow, so the measured share must grow by MORE than the ratio. Using the
    // ratio itself left the old version short of target whenever a recipe held eggs.
    denseFactor = leanFactor = clamp(1, max, (want - F) / (D + L))
  }
  if (Math.abs(denseFactor - 1) < 0.05 && Math.abs(leanFactor - 1) < 0.05) return noop('adjustment too small to be worth making')

  const factorOf = (i: number) => (group[i] === 'dense' ? denseFactor : group[i] === 'lean' ? leanFactor : 1)
  const scaled = ings.map((ing, i) => {
    const f = factorOf(i)
    if (f === 1) return ing
    const g = parseFloat(String(ing.grams ?? '').replace(/[^0-9.]/g, ''))
    const unit = String(ing.grams ?? '').replace(/[0-9.\s]/g, '') || 'g'
    return {
      ...ing,
      grams: Number.isFinite(g) && g > 0 ? `${Math.max(1, Math.round(g * f))}${unit}` : ing.grams,
      visual: scaleVisualText(String(ing.visual ?? '') || undefined, f),
    }
  })

  const factors = { ...unit1 }
  for (const key of KEYS) {
    const before = est.reduce((s, e) => s + e[key], 0)
    const after = est.reduce((s, e, i) => s + e[key] * factorOf(i), 0)
    factors[key] = before > 0 ? after / before : 1
  }
  const nDense = group.filter(g => g === 'dense').length, nLean = group.filter(g => g === 'lean').length
  return {
    ingredients: scaled,
    macroFactor: factors.kcal,
    factors,
    denseFactor,
    leanFactor,
    reason: `${Math.round(currentKcal)} → ~${Math.round(currentKcal * factors.kcal)} kcal (target ${Math.round(targetKcal)}); ` +
      `dense ×${denseFactor.toFixed(2)} (${nDense}), lean ×${leanFactor.toFixed(2)} (${nLean}), protein ×${factors.protein.toFixed(2)}`,
  }
}
