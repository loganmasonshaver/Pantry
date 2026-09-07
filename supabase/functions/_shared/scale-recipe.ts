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

export type ScalableIngredient = { name?: unknown; grams?: unknown; visual?: unknown }

export function isScalable(ing: ScalableIngredient): boolean {
  return MEASURE_WORDS.test(String(ing?.visual ?? ''))
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
  if (m[3] !== undefined) {
    const hi = toNum(m[3])
    if (!Number.isFinite(hi) || hi <= 0) return visual
    // agree() must see the value the reader SEES. 1.05 formats to "1" but is > 1, which printed
    // "1 cups" on a real recipe — the rounding has to happen before the plural decision.
    return `${fmt(lo * factor)}-${fmt(hi * factor)}${agree(rest, quarter(hi * factor))}`
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

export type ScaleResult = {
  ingredients: ScalableIngredient[]
  /** multiplier applied to the meal's macro totals; 1 when nothing was changed */
  macroFactor: number
  factor: number
  reason: string
}

/**
 * Move a recipe's measured ingredients so its total lands near `targetKcal`.
 *
 * The share of calories that is actually movable is read from the LOCAL table rather than the
 * corrected totals, on purpose: the table is approximate in absolute terms (it ran 20-30% from
 * FatSecret on real recipes) but this only needs the RATIO of movable to fixed calories, and a
 * ratio is far more robust to a table being uniformly off than a total is.
 */
export function scaleToTarget(
  ingredients: ScalableIngredient[] | undefined,
  currentKcal: number,
  targetKcal: number,
  { min = SCALE_MIN, max = SCALE_MAX, tolerance = 0.15 } = {},
): ScaleResult {
  const ings = Array.isArray(ingredients) ? ingredients : []
  const noop = (reason: string): ScaleResult => ({ ingredients: ings, macroFactor: 1, factor: 1, reason })
  if (ings.length === 0 || !(currentKcal > 0) || !(targetKcal > 0)) return noop('no quantities to work with')
  const ratio = currentKcal / targetKcal
  if (ratio >= 1 - tolerance && ratio <= 1 + tolerance) return noop(`already within ${Math.round(tolerance * 100)}% of target`)

  const movable = ings.filter(isScalable)
  if (movable.length === 0) return noop('every ingredient is counted, not measured')

  const all = estimateMacros(ings as never)
  const fixedOnly = estimateMacros(ings.filter(i => !isScalable(i)) as never)
  const movableKcal = all.kcal - fixedOnly.kcal
  if (!(movableKcal > 0)) return noop('the measured ingredients carry no calories')

  // How much the movable share must change so fixed + movable*f hits the target.
  const wantMovable = movableKcal - (currentKcal - targetKcal) * (movableKcal / currentKcal)
  const raw = wantMovable / movableKcal
  const factor = Math.min(max, Math.max(min, raw))
  if (Math.abs(factor - 1) < 0.05) return noop('adjustment too small to be worth making')

  const scaled = ings.map(ing => {
    if (!isScalable(ing)) return ing
    const g = parseFloat(String(ing.grams ?? '').replace(/[^0-9.]/g, ''))
    const unit = String(ing.grams ?? '').replace(/[0-9.\s]/g, '') || 'g'
    return {
      ...ing,
      grams: Number.isFinite(g) && g > 0 ? `${Math.max(1, Math.round(g * factor))}${unit}` : ing.grams,
      visual: scaleVisualText(String(ing.visual ?? '') || undefined, factor),
    }
  })

  // Only the movable share moved, so the meal's totals move by less than `factor`.
  const movableShare = movableKcal / all.kcal
  const macroFactor = (1 - movableShare) + movableShare * factor
  return {
    ingredients: scaled,
    macroFactor,
    factor,
    reason: `${Math.round(currentKcal)} → ~${Math.round(currentKcal * macroFactor)} kcal (target ${Math.round(targetKcal)}); scaled ${movable.length}/${ings.length} measured ingredients by ${factor.toFixed(2)}x`,
  }
}
