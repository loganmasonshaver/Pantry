// Canonical "assumed staples" — the basics meal generation treats as always on-hand, and that the
// recipe screen surfaces as a muted "basics we assumed" tier. Deliberately conservative: cooking
// ENABLERS (seasonings, fats, baking basics) that ~90% of kitchens keep — never anything a meal is
// built from (eggs, milk, rice, pasta, produce, proteins), which vary and must come from the scan.
// KEEP IN SYNC with the list embedded in supabase/functions/generate-meals/index.ts (separate Deno
// runtime — can't share the module).
export const ASSUMED_STAPLES = [
  'Salt', 'Black pepper', 'Cooking oil', 'Olive oil', 'Butter', 'All-purpose flour', 'Sugar',
  'Garlic powder', 'Onion powder', 'Paprika', 'Cumin', 'Chili powder', 'Oregano', 'Basil',
  'Italian seasoning', 'Cinnamon', 'Red pepper flakes', 'Water',
]

// Normalized aliases for matching a recipe ingredient to a staple. EXACT match (after cleaning) so
// produce like "bell pepper" / "red pepper" never collides with the basic "pepper".
const STAPLE_ALIASES = new Set([
  'salt', 'sea salt', 'kosher salt', 'table salt',
  'pepper', 'black pepper', 'ground pepper', 'ground black pepper',
  'oil', 'cooking oil', 'olive oil', 'extra virgin olive oil', 'vegetable oil', 'canola oil',
  'butter', 'unsalted butter', 'salted butter',
  'flour', 'all purpose flour', 'all-purpose flour', 'plain flour',
  'sugar', 'granulated sugar', 'white sugar',
  'garlic powder', 'onion powder', 'paprika', 'smoked paprika', 'cumin', 'ground cumin',
  'chili powder', 'chilli powder', 'oregano', 'dried oregano', 'basil', 'dried basil',
  'italian seasoning', 'cinnamon', 'ground cinnamon',
  'red pepper flakes', 'crushed red pepper', 'red chili flakes',
  'water', 'cooking spray',
])

// True when `name` is an assumed staple the user has NOT excluded. `excluded` is the user's
// staples_excluded list (things they've tapped "I don't keep this" on).
export function isAssumedStaple(name: string, excluded: Set<string> = new Set()): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim()
  if (excluded.has(n)) return false
  return STAPLE_ALIASES.has(n)
}

// Staples to auto-exclude based on a user's dietary_restrictions — so we NEVER assume butter for a
// vegan or flour for someone gluten-free, without asking them to opt out by hand. Values match the
// onboarding options (DIET_STYLES + ALLERGY_OPTIONS). Returns normalized alias forms so they match
// isAssumedStaple's exclusion check. KEEP IN SYNC with the mapping in generate-meals.
export function dietExcludedStaples(restrictions: string[] = []): string[] {
  const r = restrictions.map(x => String(x).toLowerCase().trim())
  const out: string[] = []
  if (r.includes('vegan') || r.includes('dairy-free')) out.push('butter', 'unsalted butter', 'salted butter')
  if (r.includes('gluten-free')) out.push('flour', 'all purpose flour', 'all-purpose flour', 'plain flour')
  return out
}
