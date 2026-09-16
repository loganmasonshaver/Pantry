// The lines the scan wait tells in big type, built from the user's own onboarding answers.
//
// Two kinds, interleaved: FACTS from the profile (their calorie day, protein per meal, time limit,
// diet, dislikes) and GOAL lines that say this is how they get what they came for (fat loss,
// muscle, recomp, or — for anyone without a goal — consistency and better eating).
//
// Every line is an INTENTION, never a claim about the meals: during the photo scan the meals do not
// exist yet (they are generated after results land). So "built around", "about", "nothing over" —
// never "every meal is under 630 calories". A fact line is skipped when its field is empty, so a
// profile with no goal or no dislikes never shows a line with a hole in it.

export type StoryProfile = {
  calorie_goal?: number | null
  protein_goal?: number | null
  meals_per_day?: number | null
  fitness_goal?: string | null
  diet_type?: string | null
  dietary_restrictions?: string[] | null
  food_dislikes?: string[] | null
  cooking_skill?: string | null
  max_prep_minutes?: number | null
}

// Two lines at the scan screen's big type is ~46 characters. Enforced by the tests, not trimmed here.
export const STORY_MAX_CHARS = 46

const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const roundTo = (n: number, step: number) => Math.round(n / step) * step

// Goal lines speak to what the user said they want. Aspirational and plain — no promises of results,
// no medical language — and reassurance that this app is the thing that makes it easier.
const GOAL_LINES: Record<string, string[]> = {
  lose: [
    'Losing fat is easier when dinner is decided',
    'High protein keeps you full while you cut',
    "Fat loss that doesn't feel like a diet",
  ],
  gain: [
    'Muscle gets built in the kitchen, too',
    'Protein to grow on, every single meal',
    'Fuel for the gains, minus the guesswork',
  ],
  maintain: [
    'A recomp runs on protein and consistency',
    'Keep your weight, change your shape',
    'Lean out and build up, one plate at a time',
  ],
}

// For everyone. With no goal on the profile these carry the reassurance on their own.
const CONSISTENCY_LINES = [
  'Consistency beats perfect. This makes it easy',
  'Eating better, from food you already own',
  'No more guessing what is for dinner',
]

function factLines(p: StoryProfile | null, photoCount: number): string[] {
  const out: string[] = []
  out.push(photoCount > 1 ? `Reading every shelf in your ${photoCount} photos` : 'Reading every shelf in your photo')
  if (!p) return out
  const meals = Number(p.meals_per_day) > 0 ? Number(p.meals_per_day) : null
  const cal = Number(p.calorie_goal) > 0 ? Number(p.calorie_goal) : null
  const protein = Number(p.protein_goal) > 0 ? Number(p.protein_goal) : null

  if (cal) out.push(`Built around your ${thousands(cal)}-calorie day`)
  if (protein && meals) out.push(`About ${roundTo(protein / meals, 5)}g of protein in every meal`)
  if (cal && meals) out.push(`Around ${roundTo(cal / meals, 10)} calories a plate`)
  if (Number(p.max_prep_minutes) > 0) out.push(`Nothing over ${Math.round(Number(p.max_prep_minutes))} minutes`)

  // Diet: a restriction the user chose is worth saying; "Classic" (no restriction) is not.
  const restrictions = (p.dietary_restrictions ?? []).map(r => String(r).trim()).filter(r => r && r.toLowerCase() !== 'none')
  const diet = String(p.diet_type ?? '').trim()
  if (restrictions.length > 0) {
    out.push(`Every pick stays ${restrictions.slice(0, 2).map(r => r.toLowerCase()).join(' and ')}`)
  } else if (diet && diet.toLowerCase() !== 'classic') {
    out.push(`${diet}, all the way through`)
  }

  const dislikes = (p.food_dislikes ?? []).map(d => String(d).trim().toLowerCase()).filter(Boolean)
  if (dislikes.length === 1) out.push(`And no ${dislikes[0]}. Ever.`)
  else if (dislikes.length > 1) out.push(`And no ${dislikes[0]} or ${dislikes[1]}. Ever.`)

  const skill = String(p.cooking_skill ?? '').toLowerCase()
  if (skill === 'adventurous') out.push('With the bold flavors you like')
  else if (skill === 'culinary') out.push('Recipes worth your skills')
  else if (skill === 'moderate') out.push('Weeknight easy, nothing fussy')
  return out
}

function goalLines(p: StoryProfile | null): string[] {
  const goal = String(p?.fitness_goal ?? '').toLowerCase()
  const specific = GOAL_LINES[goal]
  // A goal gets its three lines plus two about consistency; no goal gets the consistency lines.
  return specific ? [...specific, ...CONSISTENCY_LINES.slice(0, 2)] : [...CONSISTENCY_LINES]
}

// Fact, goal, fact, goal… starting with the scan itself, then whichever list is longer runs out.
export function buildScanStory(profile: StoryProfile | null, photoCount: number): string[] {
  const facts = factLines(profile, photoCount)
  const goals = goalLines(profile)
  const out: string[] = []
  for (let i = 0; i < Math.max(facts.length, goals.length); i++) {
    if (i < facts.length) out.push(facts[i])
    if (i < goals.length) out.push(goals[i])
  }
  return out
}
