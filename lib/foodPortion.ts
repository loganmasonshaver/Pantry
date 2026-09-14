// Portion math for the food log screen: which units a food can be logged in, what a portion
// weighs, what it contains, and how a user's nutrition correction scales onto it.
//
// Pure and supabase-free so it runs under `node --test`. The component only renders what this
// returns; every number on that screen and every number written to meal_logs comes from here, so
// the screen can never show one thing and log another.
import type { FoodServing } from './fatsecretServing.ts'

export type Nutrients = { calories: number; protein: number; carbs: number; fat: number }
export type Extras = { fiber?: number; sugar?: number; saturated_fat?: number; sodium?: number; cholesterol?: number; potassium?: number }

// A household serving FatSecret issued, or a weight/volume the user types directly.
export type Unit =
  | { kind: 'serving'; servingId: string }
  | { kind: 'g' }
  | { kind: 'oz' }
  | { kind: 'ml' }

export type MetricUnit = 'g' | 'ml'
export const OZ_G = 28.349523125

// A correction stores the portion it was made on, so it can be scaled to any other portion.
// basis_amount/basis_unit: that portion's weight or volume. serving_id: the serving it was made on,
// the only way to apply it to a food FatSecret gives no weight for.
export type Override = Nutrients & {
  basis_amount: number | null
  basis_unit: MetricUnit | null
  serving_id: string | null
}

// '__' ids are the app's own. FatSecret never issues one.
const UNIT_LOG_IDS: Record<'g' | 'oz' | 'ml', string> = { g: '__1g', oz: '__1oz', ml: '__1ml' }

export function realServings(servings: FoodServing[]): FoodServing[] {
  return servings.filter(s => !s.serving_id?.startsWith('__'))
}

export function metricOf(s: FoodServing): { amount: number; unit: MetricUnit } | null {
  const amount = parseFloat(s.metric_serving_amount ?? '')
  const unit = s.metric_serving_unit
  if (!(amount > 0) || (unit !== 'g' && unit !== 'ml')) return null
  return { amount, unit }
}

// The serving a food's per-gram (or per-ml) rates are taken from. Grams win over millilitres — a
// scale is the precise path — and the LARGEST serving wins within a unit, because FatSecret rounds
// each serving's nutrients and a big serving loses the least to that rounding.
export function metricBasis(servings: FoodServing[]): { unit: MetricUnit; ref: FoodServing; amount: number } | null {
  let best: { unit: MetricUnit; ref: FoodServing; amount: number } | null = null
  for (const s of realServings(servings)) {
    const m = metricOf(s)
    if (!m) continue
    const better = !best
      || (m.unit === 'g' && best.unit === 'ml')
      || (m.unit === best.unit && m.amount > best.amount)
    if (better) best = { unit: m.unit, ref: s, amount: m.amount }
  }
  return best
}

const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : 0 }
const opt = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : undefined }

function servingValues(s: FoodServing): Nutrients & Extras {
  return {
    calories: num(s.calories), protein: num(s.protein), carbs: num(s.carbohydrate), fat: num(s.fat),
    fiber: opt(s.fiber), sugar: opt(s.sugar), saturated_fat: opt(s.saturated_fat),
    sodium: opt(s.sodium), cholesterol: opt(s.cholesterol), potassium: opt(s.potassium),
  }
}

function scale<T extends Record<string, number | undefined>>(v: T, k: number): T {
  const out: Record<string, number | undefined> = {}
  for (const [key, val] of Object.entries(v)) out[key] = val === undefined ? undefined : val * k
  return out as T
}

// Weight units need a gram basis, volume needs a millilitre one. A food FatSecret gives no metric
// data for offers only its own servings.
export function availableUnits(servings: FoodServing[]): Unit[] {
  const units: Unit[] = realServings(servings).map(s => ({ kind: 'serving', servingId: s.serving_id }))
  const basis = metricBasis(servings)
  if (basis?.unit === 'g') units.push({ kind: 'g' }, { kind: 'oz' })
  if (basis?.unit === 'ml') units.push({ kind: 'ml' })
  return units
}

export const sameUnit = (a: Unit, b: Unit) =>
  a.kind === b.kind && (a.kind !== 'serving' || a.servingId === (b as { servingId: string }).servingId)

export function findServing(unit: Unit, servings: FoodServing[]): FoodServing | undefined {
  return unit.kind === 'serving' ? servings.find(s => s.serving_id === unit.servingId) : undefined
}

// Weight or volume of a portion, in the unit the food's basis uses. Null when it cannot be known.
export function portionMetric(unit: Unit, amount: number, servings: FoodServing[]): { amount: number; unit: MetricUnit } | null {
  if (unit.kind === 'g') return { amount, unit: 'g' }
  if (unit.kind === 'oz') return { amount: amount * OZ_G, unit: 'g' }
  if (unit.kind === 'ml') return { amount, unit: 'ml' }
  const s = findServing(unit, servings)
  const m = s ? metricOf(s) : null
  return m ? { amount: m.amount * amount, unit: m.unit } : null
}

// What FatSecret says the portion contains, exact (round only for display).
export function fatsecretNutrients(unit: Unit, amount: number, servings: FoodServing[]): (Nutrients & Extras) | null {
  if (unit.kind === 'serving') {
    const s = findServing(unit, servings)
    return s ? scale(servingValues(s), amount) : null
  }
  const basis = metricBasis(servings)
  const metric = portionMetric(unit, amount, servings)
  if (!basis || !metric || metric.unit !== basis.unit) return null
  return scale(servingValues(basis.ref), metric.amount / basis.amount)
}

// A correction applies by WEIGHT when both it and the portion have one in the same unit, and
// otherwise only to the exact serving it was made on. It used to apply its absolute numbers as the
// per-unit value of ANY serving, so a cup's 150 kcal logged by the gram became 150 kcal per gram.
export function applyOverride(base: Nutrients, override: Override | null, unit: Unit, amount: number, servings: FoodServing[]): { nutrients: Nutrients; overridden: boolean } {
  if (!override) return { nutrients: base, overridden: false }
  const metric = portionMetric(unit, amount, servings)
  if (override.basis_amount && override.basis_unit && metric && metric.unit === override.basis_unit) {
    return { nutrients: scale(pickNutrients(override), metric.amount / override.basis_amount), overridden: true }
  }
  if (override.serving_id && unit.kind === 'serving' && unit.servingId === override.serving_id) {
    return { nutrients: scale(pickNutrients(override), amount), overridden: true }
  }
  // Units that no weight can bridge — FatSecret gives milk's cup in millilitres and the user is
  // logging grams. Scale FatSecret's own numbers for this portion by how far the correction moved
  // them on the serving it was made on. A macro FatSecret has as 0 has no ratio and stays 0.
  if (override.serving_id) {
    const ref = servings.find(s => s.serving_id === override.serving_id)
    if (ref) {
      const fsRef = servingValues(ref)
      const k = (key: keyof Nutrients) => (fsRef[key] > 0 ? override[key] / fsRef[key] : 1)
      return {
        nutrients: { calories: base.calories * k('calories'), protein: base.protein * k('protein'), carbs: base.carbs * k('carbs'), fat: base.fat * k('fat') },
        overridden: true,
      }
    }
  }
  return { nutrients: base, overridden: false }
}

const pickNutrients = (n: Nutrients): Nutrients => ({ calories: n.calories, protein: n.protein, carbs: n.carbs, fat: n.fat })

// The portion a correction is entered against: one serving, 100 g, 1 oz or 100 ml. Per gram would
// be unreadable, and per the typed amount would make the stored numbers depend on a passing value.
export function correctionPortion(unit: Unit, servings: FoodServing[]): { unit: Unit; amount: number; basis: Pick<Override, 'basis_amount' | 'basis_unit' | 'serving_id'> } {
  const amount = unit.kind === 'g' || unit.kind === 'ml' ? 100 : 1
  const metric = portionMetric(unit, amount, servings)
  return {
    unit,
    amount,
    basis: {
      basis_amount: metric?.amount ?? null,
      basis_unit: metric?.unit ?? null,
      serving_id: unit.kind === 'serving' ? unit.servingId : null,
    },
  }
}

// A correction saved before corrections stored a basis carries none. The screen always opened on
// the default serving, so that is the serving it was made on.
export function legacyBasis(servings: FoodServing[], defaultServing: FoodServing | null): Pick<Override, 'basis_amount' | 'basis_unit' | 'serving_id'> | null {
  if (!defaultServing) return null
  return correctionPortion({ kind: 'serving', servingId: defaultServing.serving_id }, servings).basis
}

// meal_logs stores a portion as serving_id + quantity. Weight and volume use the app's '__' ids
// with the quantity IN that unit, so an entry reopens exactly as it was typed.
export function logFields(unit: Unit, amount: number): { serving_id: string; quantity: number } {
  return unit.kind === 'serving'
    ? { serving_id: unit.servingId, quantity: amount }
    : { serving_id: UNIT_LOG_IDS[unit.kind], quantity: amount }
}

export function unitFromLog(servingId: string | undefined, quantity: number | undefined, servings: FoodServing[], defaultServing: FoodServing | null): { unit: Unit; amount: number } {
  const q = quantity && quantity > 0 ? quantity : 1
  // '__100g' / '__100ml' were synthetic servings in an older build: quantity 1.5 meant 150 g.
  if (servingId === '__1g') return { unit: { kind: 'g' }, amount: q }
  if (servingId === '__100g') return { unit: { kind: 'g' }, amount: q * 100 }
  if (servingId === '__1oz') return { unit: { kind: 'oz' }, amount: q }
  if (servingId === '__1ml') return { unit: { kind: 'ml' }, amount: q }
  if (servingId === '__100ml') return { unit: { kind: 'ml' }, amount: q * 100 }
  if (servingId && servings.some(s => s.serving_id === servingId)) return { unit: { kind: 'serving', servingId }, amount: q }
  return { unit: defaultServing ? { kind: 'serving', servingId: defaultServing.serving_id } : { kind: 'g' }, amount: q }
}

// Recents store a unit as a string.
export function unitKey(unit: Unit): string {
  return unit.kind === 'serving' ? `serving:${unit.servingId}` : unit.kind
}
export function unitFromKey(key: string | undefined, servings: FoodServing[]): Unit | null {
  if (!key) return null
  if (key.startsWith('serving:')) {
    const id = key.slice('serving:'.length)
    return servings.some(s => s.serving_id === id) ? { kind: 'serving', servingId: id } : null
  }
  const u = availableUnits(servings).find(x => x.kind === key)
  return u ?? null
}

// A comma-decimal keypad types "1,5". Anything not a positive finite number is not an amount.
export function parseAmount(text: string): number | null {
  const n = parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

// Grams and millilitres read as whole numbers; ounces and servings keep the fraction someone typed.
export function formatAmount(amount: number, unit: Unit): string {
  const digits = unit.kind === 'g' || unit.kind === 'ml' ? (amount < 10 ? 1 : 0) : unit.kind === 'oz' ? 1 : 2
  return String(Number(amount.toFixed(digits)))
}

// Switching unit keeps the PORTION, not the number: 1 cup shredded becomes 113 g, not 1 g.
// Falls back to a sensible starting amount when the portion's weight is unknown.
export function convertAmount(from: Unit, amount: number, to: Unit, servings: FoodServing[]): number {
  const fallback = to.kind === 'g' || to.kind === 'ml' ? 100 : 1
  const metric = portionMetric(from, amount, servings)
  if (!metric) return fallback
  if (to.kind === 'g') return metric.unit === 'g' ? metric.amount : fallback
  if (to.kind === 'oz') return metric.unit === 'g' ? metric.amount / OZ_G : fallback
  if (to.kind === 'ml') return metric.unit === 'ml' ? metric.amount : fallback
  const target = portionMetric(to, 1, servings)
  return target && target.unit === metric.unit ? metric.amount / target.amount : fallback
}

// Each macro's share of the food's calories, the number Logan reads to judge protein per calorie.
// Largest-remainder rounding so the three always add to exactly 100. Null when nothing has energy.
export function calorieSplit(n: Nutrients): { protein: number; carbs: number; fat: number } | null {
  const kcal = { protein: n.protein * 4, carbs: n.carbs * 4, fat: n.fat * 9 }
  const total = kcal.protein + kcal.carbs + kcal.fat
  if (!(total > 0)) return null
  const keys = ['protein', 'carbs', 'fat'] as const
  const raw = keys.map(k => (kcal[k] / total) * 100)
  const floors = raw.map(Math.floor)
  let remaining = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) { if (remaining <= 0) break; floors[i]++; remaining-- }
  return { protein: floors[0], carbs: floors[1], fat: floors[2] }
}

// "TODAY AFTER THIS": what is already logged, what this portion adds, what is left. When editing,
// `replacing` is the entry's current value, which is already inside `consumed` and must not count twice.
export function dayImpact(goal: number, consumed: number, adding: number, replacing = 0): { basePct: number; addPct: number; left: number } {
  const base = Math.max(0, consumed - replacing)
  if (!(goal > 0)) return { basePct: 0, addPct: 0, left: 0 }
  const basePct = Math.min(100, (base / goal) * 100)
  const addPct = Math.min(100 - basePct, (Math.max(0, adding) / goal) * 100)
  return { basePct, addPct, left: goal - base - adding }
}

// normalizeServings appends "(113g)" to a household description; the screen shows grams on its own line.
export function servingTitle(s: FoodServing): string {
  return s.serving_description.replace(/\s*\(\d+(\.\d+)?\s*(g|ml)\)\s*$/i, '').trim()
}

// The unit pill beside the amount. "1 cup shredded" reads as "cup shredded" next to the number;
// "0.5 cup" cannot drop its number, so it reads "× 0.5 cup".
export function unitLabel(unit: Unit, servings: FoodServing[]): string {
  if (unit.kind === 'g') return 'grams'
  if (unit.kind === 'oz') return 'ounces'
  if (unit.kind === 'ml') return 'milliliters'
  const s = findServing(unit, servings)
  if (!s) return 'serving'
  const t = servingTitle(s)
  return /^1\s+\D/.test(t) ? t.replace(/^1\s+/, '') : `× ${t}`
}

// A portion in words: "1 cup shredded", "2 × 0.5 cup", "150 g". withMetric adds the weight of a
// household serving: "1 cup shredded (113 g)".
export function portionText(unit: Unit, amount: number, servings: FoodServing[], withMetric = false): string {
  const n = formatAmount(amount, unit)
  if (unit.kind === 'g') return `${n} g`
  if (unit.kind === 'oz') return `${n} oz`
  if (unit.kind === 'ml') return `${n} ml`
  const s = findServing(unit, servings)
  if (!s) return `${n} serving`
  const title = servingTitle(s)
  const m = withMetric ? portionMetric(unit, amount, servings) : null
  const metric = m ? ` (${Math.round(m.amount)} ${m.unit})` : ''
  return `${amount === 1 ? title : `${n} × ${title}`}${metric}`
}

// What a correction STORES, from what the user typed against the portion they chose. Serving
// portions are normalized to ONE serving — every tier of applyOverride reads a serving-keyed
// correction as per-serving — and weight portions are stored as typed, with the typed weight as
// their basis. A label's "2 Tbsp (32 g) · 190 kcal" becomes 95 kcal per tbsp with a 16 g basis.
export function correctionToStore(unit: Unit, amount: number, entered: Nutrients, servings: FoodServing[]): { nutrients: Nutrients; basis: Pick<Override, 'basis_amount' | 'basis_unit' | 'serving_id'> } {
  if (unit.kind === 'serving') {
    const one = portionMetric(unit, 1, servings)
    return {
      nutrients: scale(pickNutrients(entered), 1 / amount),
      basis: { basis_amount: one?.amount ?? null, basis_unit: one?.unit ?? null, serving_id: unit.servingId },
    }
  }
  const metric = portionMetric(unit, amount, servings)
  return {
    nutrients: pickNutrients(entered),
    basis: { basis_amount: metric?.amount ?? null, basis_unit: metric?.unit ?? null, serving_id: null },
  }
}

// Where the correction sheet opens: the correction's own serving when one exists, else the LABEL
// serving — the household default, which is what a package prints — never the unit the user
// happens to be logging in. A food with only metric servings opens on 100 of them.
export function defaultCorrectionPortion(servings: FoodServing[], override: Override | null, defaultServing: FoodServing | null): { unit: Unit; amount: number } {
  if (override?.serving_id && servings.some(s => s.serving_id === override.serving_id)) {
    return { unit: { kind: 'serving', servingId: override.serving_id }, amount: 1 }
  }
  if (defaultServing && !defaultServing.serving_id.startsWith('__')) {
    return { unit: { kind: 'serving', servingId: defaultServing.serving_id }, amount: 1 }
  }
  const units = availableUnits(servings)
  const u = units.find(x => x.kind === 'g') ?? units.find(x => x.kind === 'ml') ?? units[0]
  if (!u) return { unit: { kind: 'g' }, amount: 100 }
  return { unit: u, amount: u.kind === 'serving' || u.kind === 'oz' ? 1 : 100 }
}

// The amount a unit starts at when picked in the correction sheet. No conversion: "per 1 cup"
// switching to tbsp means "per 1 tbsp", because the next thing typed is what the label says.
export function correctionStartAmount(unit: Unit): number {
  return unit.kind === 'g' || unit.kind === 'ml' ? 100 : 1
}
