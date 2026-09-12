// What a kitchen is assumed to hold beyond the scanned pantry.
//
// Conservative cooking ENABLERS only (fats, seasonings, baking basics) — never meal-defining items
// (eggs, rice, produce, proteins), which must come from the scan or the meal is not cookable.
// KEEP IN SYNC with constants/staples.ts (the client copy).
//
// Lives here rather than inside generate-meals so anything judging whether a deck was cookable —
// the function itself, and the sweep harness that scores it — reads the SAME list. Scoring
// cookability against a second, drifting copy would grade the generator against a rule it never had.
export const ASSUMED_STAPLES: readonly string[] = [
  'salt', 'black pepper', 'cooking oil', 'olive oil', 'butter', 'all-purpose flour', 'sugar',
  'garlic powder', 'onion powder', 'paprika', 'cumin', 'chili powder', 'oregano', 'basil',
  'Italian seasoning', 'cinnamon', 'red pepper flakes',
  // "ice cubes", never bare "ice" — isInPantry matches on substrings, so 'ice' would make rice and
  // juice permanently in-stock and they would silently stop showing as missing. The head-noun rule
  // still matches a recipe line that just says "ice".
  'ice cubes',
]

/**
 * Diet-aware auto-exclusion: never assume butter for a vegan or dairy-free user, or flour for a
 * gluten-free one, on top of anything they tapped "I don't keep this" on.
 * KEEP IN SYNC with dietExcludedStaples() in constants/staples.ts.
 */
export function assumedStaplesFor(
  dietaryRestrictions: readonly unknown[] = [],
  optedOut: readonly unknown[] = [],
): string[] {
  const excluded = optedOut.map(s => String(s).toLowerCase().trim()).filter(Boolean)
  const diet = dietaryRestrictions.map(x => String(x).toLowerCase())
  if (diet.includes('vegan') || diet.includes('dairy-free')) excluded.push('butter')
  if (diet.includes('gluten-free')) excluded.push('all-purpose flour')
  return ASSUMED_STAPLES.filter(s => !excluded.includes(s.toLowerCase()))
}
