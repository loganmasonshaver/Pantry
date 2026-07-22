// Goal- & diet-personalized pantry insight (see PLAN.md).
// PURE + testable: no I/O. Given the user's pantry items + goal + diet, returns ONE actionable
// "what to stock next" insight with diet-safe grocery suggestions.
//
// Design guardrails (from PLAN.md §10/§13):
// - Uses the EXISTING pantry_items.category as the primary signal (name keywords only refine),
//   and biases toward SILENCE when ambiguous — a false "you're missing X" is worse than quiet.
// - Never suggests a diet-forbidden food (four filters: diet_type → allergies → dislikes → have).
// - Food suggestions only: no micronutrient/deficiency claims, no supplements.
// - STOCKING language ("keep on hand"), never intake ("you're not eating enough").
// - Positive, non-shaming tone; never references "junk" the user has.

export type PantryItem = { name: string; category?: string | null }
export type FitnessGoal = 'lose' | 'maintain' | 'gain'
export type DietType = 'Classic' | 'Pescatarian' | 'Vegetarian' | 'Vegan'

// One cell of the "Pantry Check" coverage strip. `ok=false` renders as a ⚠ chip.
export type CoverageItem = { label: string; ok: boolean }

export type Insight = {
  headline: string
  detail: string
  suggestedItems: string[] // diet-safe grocery suggestions for the "Add to grocery" CTA
  tone: 'gap' | 'affirm' | 'empty'
  coverage: CoverageItem[] // at-a-glance macro-group scorecard (Protein/Produce/Carbs/Fats)
}

// ── keyword sets (lowercased, word-boundary matched) ───────────────────────────
const has = (n: string, kws: string[]) => kws.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(s|es)?\\b`, 'i').test(n))

const MEAT = ['chicken', 'beef', 'pork', 'turkey', 'lamb', 'steak', 'bacon', 'sausage', 'ham', 'bison', 'veal', 'venison', 'duck', 'brisket', 'ribeye', 'sirloin', 'chorizo', 'prosciutto', 'pepperoni', 'deli meat', 'hot dog', 'meatball', 'patty', 'hamburger', 'wing', 'thigh', 'drumstick']
const FISH = ['salmon', 'tuna', 'tilapia', 'cod', 'fish', 'sardine', 'anchovy', 'mackerel', 'trout', 'halibut', 'sea bass', 'haddock']
const SHELLFISH = ['shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'oyster']
const EGG = ['egg']
const NON_PROTEIN_DAIRY = ['butter', 'cream', 'ghee'] // in Dairy & Eggs but not a protein source
const PLANT_PROTEIN = ['tofu', 'tempeh', 'seitan', 'lentil', 'bean', 'chickpea', 'garbanzo', 'edamame', 'pea protein', 'plant protein', 'soy']
const HEALTHY_FAT = ['avocado', 'olive oil', 'avocado oil', 'almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'peanut', 'macadamia', 'chia', 'flax', 'hemp seed', 'sunflower seed', 'pumpkin seed', 'olive', 'nut butter', 'seeds', 'salmon']
const NUT = ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'peanut', 'macadamia', 'pine nut', 'nut butter', 'nutella']
const COMPLEX_CARB = ['oat', 'brown rice', 'quinoa', 'sweet potato', 'whole grain', 'whole wheat', 'farro', 'barley', 'bulgur', 'lentil', 'bean', 'chickpea']
// Aromatics/herbs are category "Produce" but aren't the fruit/veg servings that close the fiber gap.
const AROMATIC = ['garlic', 'onion', 'ginger', 'shallot', 'scallion', 'green onion', 'chive', 'basil', 'cilantro', 'parsley', 'mint', 'rosemary', 'thyme', 'dill', 'oregano', 'herb']

export type PantryProfile = {
  produceCount: number       // real fruit/veg (excludes aromatics/herbs)
  hasAnimalProtein: boolean
  hasFish: boolean
  hasEgg: boolean
  hasDairyProtein: boolean
  hasPlantProtein: boolean
  plantProteinVariety: number
  hasHealthyFat: boolean
  hasComplexCarb: boolean
  dairyProteinCount: number   // for the vegetarian "cheese crutch" nudge
  total: number
}

export function buildPantryProfile(items: PantryItem[]): PantryProfile {
  let produceCount = 0, plantProteinVariety = 0, dairyProteinCount = 0
  let hasAnimalProtein = false, hasFish = false, hasEgg = false, hasDairyProtein = false,
      hasPlantProtein = false, hasHealthyFat = false, hasComplexCarb = false
  for (const it of items) {
    const n = (it.name || '').toLowerCase()
    const cat = it.category || ''
    if (cat === 'Produce' && !has(n, AROMATIC)) produceCount++
    // Plant protein = keyword OR the Legumes category (robust to typos). Legumes are also a carb.
    if (has(n, PLANT_PROTEIN) || cat === 'Legumes') { hasPlantProtein = true; plantProteinVariety++; hasComplexCarb = true }
    if (has(n, MEAT)) hasAnimalProtein = true
    if (has(n, FISH)) hasFish = true
    if (has(n, EGG)) hasEgg = true
    // Category-robust: an unrecognized Meat & Fish item (e.g. a typo'd "chikn breast") is still
    // an animal protein — NOT plant — so omnivores get credit and vegans never do.
    if (cat === 'Meat & Fish' && !has(n, PLANT_PROTEIN) && !has(n, FISH) && !has(n, MEAT)) hasAnimalProtein = true
    // Dairy protein = anything in the Dairy & Eggs category that isn't an egg or a pure fat.
    // Category-driven (not a cheese-name list) so "mozzarella", "feta", etc. all count.
    if (cat === 'Dairy & Eggs' && !has(n, EGG) && !has(n, NON_PROTEIN_DAIRY)) { hasDairyProtein = true; dairyProteinCount++ }
    // Protein powder/shake is a real protein source. Plant if labeled so; otherwise treat as
    // non-vegan (could be whey) so a vegan is never wrongly credited.
    if (has(n, ['plant protein', 'pea protein', 'soy protein'])) { hasPlantProtein = true; plantProteinVariety++ }
    else if (has(n, ['whey', 'protein powder', 'protein shake', 'protein isolate'])) hasDairyProtein = true
    if (has(n, HEALTHY_FAT)) hasHealthyFat = true
    if (has(n, COMPLEX_CARB)) hasComplexCarb = true
  }
  return { produceCount, hasAnimalProtein, hasFish, hasEgg, hasDairyProtein, hasPlantProtein,
    plantProteinVariety, hasHealthyFat, hasComplexCarb, dairyProteinCount, total: items.length }
}

// Is there a protein source the user's diet actually allows?
function dietSafeProteinPresent(p: PantryProfile, diet: DietType): boolean {
  switch (diet) {
    case 'Vegan':       return p.hasPlantProtein
    case 'Vegetarian':  return p.hasPlantProtein || p.hasEgg || p.hasDairyProtein
    case 'Pescatarian': return p.hasPlantProtein || p.hasEgg || p.hasDairyProtein || p.hasFish
    default:            return p.hasPlantProtein || p.hasEgg || p.hasDairyProtein || p.hasFish || p.hasAnimalProtein
  }
}

// ── suggestion catalog (diet-tagged + cuisine-tagged) ──────────────────────────
// `cuisines` lets us RANK suggestions toward the user's cuisine_preferences (Asian, Mexican,
// Italian, Mediterranean, American). It only reorders within a pool AFTER diet/allergy filtering
// — it never changes what's safe to suggest.
type Sugg = { name: string; contains?: Array<'meat' | 'fish' | 'shellfish' | 'egg' | 'dairy' | 'gluten' | 'nut'>; cuisines?: string[] }

const PROTEIN_SUGG: Record<DietType, Sugg[]> = {
  Classic:     [{ name: 'chicken breast', contains: ['meat'], cuisines: ['American', 'Mexican', 'Italian'] }, { name: 'salmon', contains: ['fish'], cuisines: ['Mediterranean', 'Asian'] }, { name: 'eggs', contains: ['egg'], cuisines: ['American'] }, { name: 'greek yogurt', contains: ['dairy'], cuisines: ['Mediterranean'] }, { name: 'lentils', cuisines: ['Mediterranean'] }, { name: 'tofu', cuisines: ['Asian'] }],
  Pescatarian: [{ name: 'salmon', contains: ['fish'], cuisines: ['Mediterranean', 'Asian'] }, { name: 'tuna', contains: ['fish'], cuisines: ['Mediterranean', 'Italian'] }, { name: 'eggs', contains: ['egg'], cuisines: ['American'] }, { name: 'greek yogurt', contains: ['dairy'], cuisines: ['Mediterranean'] }, { name: 'tofu', cuisines: ['Asian'] }, { name: 'lentils', cuisines: ['Mediterranean'] }],
  Vegetarian:  [{ name: 'eggs', contains: ['egg'], cuisines: ['American'] }, { name: 'greek yogurt', contains: ['dairy'], cuisines: ['Mediterranean'] }, { name: 'tofu', cuisines: ['Asian'] }, { name: 'tempeh', cuisines: ['Asian'] }, { name: 'lentils', cuisines: ['Mediterranean'] }, { name: 'chickpeas', cuisines: ['Mediterranean', 'Mexican'] }],
  Vegan:       [{ name: 'tofu', cuisines: ['Asian'] }, { name: 'tempeh', cuisines: ['Asian'] }, { name: 'lentils', cuisines: ['Mediterranean'] }, { name: 'chickpeas', cuisines: ['Mediterranean', 'Mexican'] }, { name: 'edamame', cuisines: ['Asian'] }, { name: 'black beans', cuisines: ['Mexican'] }],
}
const PRODUCE_SUGG: Sugg[] = [{ name: 'spinach' }, { name: 'broccoli' }, { name: 'bell peppers', cuisines: ['Mexican', 'Asian'] }, { name: 'mixed greens', cuisines: ['Mediterranean'] }, { name: 'berries', cuisines: ['American'] }, { name: 'carrots' }]
const FAT_SUGG: Sugg[] = [{ name: 'avocado', cuisines: ['Mexican'] }, { name: 'olive oil', cuisines: ['Mediterranean', 'Italian'] }, { name: 'almonds', contains: ['nut'], cuisines: ['Mediterranean'] }, { name: 'chia seeds' }, { name: 'walnuts', contains: ['nut'], cuisines: ['Mediterranean'] }]
const CARB_SUGG: Sugg[] = [{ name: 'oats', contains: ['gluten'], cuisines: ['American'] }, { name: 'brown rice', cuisines: ['Asian'] }, { name: 'quinoa', cuisines: ['Mediterranean'] }, { name: 'sweet potato', cuisines: ['American'] }, { name: 'black beans', cuisines: ['Mexican'] }]
const FISH_SUGG: Sugg[] = [{ name: 'salmon', contains: ['fish'], cuisines: ['Mediterranean', 'Asian'] }, { name: 'tuna', contains: ['fish'], cuisines: ['Mediterranean', 'Italian'] }]

// Effort of a suggested food, for low-effort cooks (minimal skill or very short prep budget):
// ready-to-eat floats up, needs-real-cooking sinks. Kept as name-keyed sets (not inline tags) so
// the catalog stays readable. Untagged items are "quick" (rank 1) — the neutral middle.
const READY_TO_EAT = new Set(['tuna', 'greek yogurt', 'chickpeas', 'black beans', 'cottage cheese', 'edamame'])
const NEEDS_COOKING = new Set(['chicken breast', 'salmon', 'lentils', 'tempeh', 'brown rice', 'quinoa', 'sweet potato'])
function effortRank(name: string, lowEffort: boolean): number {
  if (!lowEffort) return 0 // no effort preference for capable cooks → all equal, cuisine leads
  const n = name.toLowerCase()
  if (READY_TO_EAT.has(n)) return 0
  if (NEEDS_COOKING.has(n)) return 2
  return 1
}

// Map free-form dislikes → allergen classes so "shellfish" blocks "shrimp", "nuts" blocks "almond".
function dislikeBlocks(sugg: Sugg, dislikes: string[]): boolean {
  const dl = dislikes.map(d => d.toLowerCase())
  const name = sugg.name.toLowerCase()
  if (dl.some(d => name.includes(d) || d.includes(name))) return true // direct name match
  const classWords: Record<string, string[]> = { nut: ['nut', 'almond', 'peanut', 'walnut', 'cashew'], dairy: ['dairy', 'milk', 'cheese', 'yogurt'], fish: ['fish', 'seafood'], shellfish: ['shellfish', 'shrimp', 'crab'], egg: ['egg'], gluten: ['gluten', 'wheat'], meat: ['meat', 'beef', 'pork', 'chicken'] }
  return (sugg.contains ?? []).some(tag => (classWords[tag] ?? []).some(w => dl.includes(w)))
}

// Apply the four filters (§5): diet_type → allergies (restrictions) → dislikes → already-have.
// THEN rank by the user's cuisine preferences (matches float to the top) and take the top 3.
// Ranking is stable and happens AFTER safety filtering — it can never surface a forbidden food.
function filterSuggestions(pool: Sugg[], diet: DietType, restrictions: string[], dislikes: string[], have: Set<string>, cuisinePrefs: string[] = [], lowEffort = false): string[] {
  const r = restrictions.map(x => x.toLowerCase())
  const dairyFree = r.includes('dairy-free'), glutenFree = r.includes('gluten-free'), nutFree = r.includes('nut-free'), shellfishFree = r.includes('shellfish-free')
  const safe = pool.filter(s => {
    const c = s.contains ?? []
    if (diet === 'Vegan' && (c.includes('meat') || c.includes('fish') || c.includes('shellfish') || c.includes('egg') || c.includes('dairy'))) return false
    if (diet === 'Vegetarian' && (c.includes('meat') || c.includes('fish') || c.includes('shellfish'))) return false
    if (diet === 'Pescatarian' && c.includes('meat')) return false
    if (dairyFree && c.includes('dairy')) return false
    if (glutenFree && c.includes('gluten')) return false
    if (nutFree && c.includes('nut')) return false
    if (shellfishFree && c.includes('shellfish')) return false
    if (dislikeBlocks(s, dislikes)) return false
    if (have.has(s.name.toLowerCase())) return false
    return true
  })
  const prefs = cuisinePrefs.map(c => c.toLowerCase())
  // Composite rank (all AFTER safety filtering, so it can't surface a forbidden food):
  //   effort → cuisine match → original catalog order.
  // effort is 0 for everyone unless lowEffort, so capable cooks keep pure cuisine ranking (Step A).
  return safe
    .map((s, i) => ({ s, i, effort: effortRank(s.name, lowEffort), cuisine: (s.cuisines ?? []).some(c => prefs.includes(c.toLowerCase())) ? 0 : 1 }))
    .sort((a, b) => (a.effort - b.effort) || (a.cuisine - b.cuisine) || (a.i - b.i))
    .slice(0, 3)
    .map(x => x.s.name)
}

const goalPhrase = (g: FitnessGoal) => g === 'lose' ? 'your cut' : g === 'gain' ? 'building muscle' : 'your recomp'

// ── coverage scorecard (Step C) ─────────────────────────────────────────────────
// The four macro groups as an at-a-glance strip. Each cell's `ok` MIRRORS the engine's own gap
// gates, so a group reads ⚠ exactly when a gap-tier would fire for it — the headline names the top
// gap, the strip shows the whole picture. Goal-weighted two ways:
//   • Carbs: a cutter deliberately keeps carbs low, so Carbs never shows ⚠ on a cut (non-shaming);
//     maintain/gain need complex carbs, so it reflects the real gap there.
//   • Order: most-weighted group first for the goal, so the eye lands where it matters.
function computeCoverage(p: PantryProfile, goal: FitnessGoal, diet: DietType): CoverageItem[] {
  const cells: Record<string, CoverageItem> = {
    Protein: { label: 'Protein', ok: dietSafeProteinPresent(p, diet) },
    Produce: { label: 'Produce', ok: p.produceCount >= 2 }, // matches the produce gap threshold
    Carbs:   { label: 'Carbs',   ok: goal === 'lose' ? true : p.hasComplexCarb },
    Fats:    { label: 'Fats',    ok: p.hasHealthyFat },
  }
  const order: Record<FitnessGoal, string[]> = {
    lose:     ['Protein', 'Produce', 'Fats', 'Carbs'],
    gain:     ['Protein', 'Carbs', 'Produce', 'Fats'],
    maintain: ['Protein', 'Produce', 'Carbs', 'Fats'],
  }
  return order[goal].map(label => cells[label])
}

// ── the rule engine (§6 + §13 order) ───────────────────────────────────────────
export function buildInsight(
  items: PantryItem[],
  fitnessGoal: FitnessGoal | null | undefined,
  dietType: DietType | null | undefined,
  restrictions: string[] = [],
  dislikes: string[] = [],
  cuisinePrefs: string[] = [],
  cookingSkill: string | null = null,
  maxPrepMinutes: number | null = null,
): Insight {
  if (!items.length) {
    return { headline: 'Scan your pantry', detail: 'Get picks tailored to your goal and diet.', suggestedItems: [], tone: 'empty', coverage: [] }
  }
  const goal: FitnessGoal = fitnessGoal ?? 'maintain'   // safe defaults for legacy/incomplete profiles
  const diet: DietType = dietType ?? 'Classic'
  // "Low-effort" cook → prefer ready-to-eat picks: minimal skill, or a very short prep budget.
  const lowEffort = cookingSkill === 'minimal' || (maxPrepMinutes != null && maxPrepMinutes <= 15)
  const p = buildPantryProfile(items)
  const have = new Set(items.map(i => (i.name || '').toLowerCase()))
  const pick = (pool: Sugg[]) => filterSuggestions(pool, diet, restrictions, dislikes, have, cuisinePrefs, lowEffort)

  // Coverage is the same for whichever tier fires (it's a function of the pantry, not the headline),
  // so compute it once and attach to the selected insight — keeps the tier returns unchanged.
  const coverage = computeCoverage(p, goal, diet)
  const base = ((): Omit<Insight, 'coverage'> => {

  // Tier 1 — foundational. Protein-absence before produce (can't build a meal without protein),
  // then produce/fiber (the #1 real gap for most people). Threshold < 2 so a stocked pantry
  // (2+ veg) isn't nagged every visit — bias toward silence over a repeated nudge.
  if (!dietSafeProteinPresent(p, diet)) {
    return { headline: 'Add a protein source', detail: `Your pantry has no ${diet === 'Vegan' || diet === 'Vegetarian' ? 'plant ' : ''}protein to build meals around — stock a few staples.`, suggestedItems: pick(PROTEIN_SUGG[diet]), tone: 'gap' }
  }
  if (p.produceCount < 2) {
    const detail = goal === 'lose'
      ? 'Fiber keeps you full on fewer calories — the one thing most pantries are short on.'
      : 'Fiber and micronutrients for recovery — the one thing most pantries are short on.'
    return { headline: 'Add fruits & veg', detail, suggestedItems: pick(PRODUCE_SUGG), tone: 'gap' }
  }

  // Tier 2 — goal tuning.
  if (goal === 'gain' && !p.hasComplexCarb) {
    return { headline: 'Fuel your gains', detail: 'Keep complex carbs on hand to power training and recovery.', suggestedItems: pick(CARB_SUGG), tone: 'gap' }
  }

  // Tier 3 — diet-specific, food-only (no micronutrient claims).
  if (diet === 'Vegetarian' && p.dairyProteinCount >= 2 && p.plantProteinVariety === 0) {
    return { headline: 'Vary your protein beyond cheese', detail: 'Keep beans, lentils, tofu, or eggs on hand for more variety.', suggestedItems: pick([{ name: 'lentils' }, { name: 'tofu' }, { name: 'chickpeas' }, { name: 'eggs', contains: ['egg'] }]), tone: 'gap' }
  }
  if (diet === 'Pescatarian' && !p.hasFish) {
    return { headline: 'Keep some fish on hand', detail: 'Salmon or tuna for easy protein and omega-3s.', suggestedItems: pick(FISH_SUGG), tone: 'gap' }
  }
  if (diet === 'Vegan' && p.plantProteinVariety < 2) {
    return { headline: 'Add plant-protein variety', detail: 'A couple of options keep meals interesting — tofu, tempeh, lentils.', suggestedItems: pick(PROTEIN_SUGG.Vegan), tone: 'gap' }
  }
  if (!p.hasHealthyFat) {
    return { headline: "You're light on healthy fats", detail: 'Avocado, olive oil, or seeds round out your meals.', suggestedItems: pick(FAT_SUGG), tone: 'gap' }
  }

  // Tier 4 — nothing to flag: reward a well-rounded pantry.
  return { headline: `Your pantry's dialed in for ${goalPhrase(goal)} 💪`, detail: 'Solid mix of protein, produce, and fats. Scan or add items anytime.', suggestedItems: [], tone: 'affirm' }
  })()
  return { ...base, coverage }
}
