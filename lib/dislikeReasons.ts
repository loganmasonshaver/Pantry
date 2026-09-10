// What a thumbs-down actually meant, and what may be done about it.
//
// Lives in lib rather than beside the sheet because the ROUTING is the point: the sheet renders
// this table, and the two places that build the generator's dislike list read the same `suppress`
// flag. When they disagreed, a report about a shared photo deleted a working recipe from the
// user's future.
export type DislikeReason = 'too_often' | 'photo_mismatch' | 'recipe_wrong' | 'macros_fit' | 'taste'

export const DISLIKE_REASONS: { key: DislikeReason; label: string; suppress: boolean }[] = [
  // #1 by frequency in the feedback that prompted this (44%). Blunt on purpose — softer phrasings
  // ("too similar to others") ask the user to judge similarity instead of reporting their day.
  { key: 'too_often', label: 'Seen this too often', suppress: true },
  // Images are cached globally, so this is a report about a shared asset, not about the recipe.
  { key: 'photo_mismatch', label: "Photo doesn't match the dish", suppress: false },
  // Was "Ingredients don't add up", which Logan could not parse — and if he cannot, nobody can.
  // The user does not have to diagnose which defect it is; the tap points at the meal and the
  // funnel row says the rest.
  { key: 'recipe_wrong', label: "Recipe doesn't make sense", suppress: false },
  // Deliberately about FIT, not accuracy. Nobody can judge whether 533 kcal is the true number
  // without a scale, but everyone can see it against a 420 kcal slot.
  { key: 'macros_fit', label: "Doesn't fit my macros", suppress: false },
  // Suppresses THIS DISH only. Suppressing the whole food family was the original design and it
  // was wrong: it applies the broadest action to the most ambiguous signal, so one bad parfait
  // would delete yogurt bowls. The follow-up question is what narrows it, and the user decides.
  // Not "Didn't taste good": thumbs-down sits on every recipe BEFORE it is cooked, and most are
  // pressed then. This wording is true either side of cooking. Key stays 'taste' — stored rows.
  { key: 'taste', label: 'Not to my taste', suppress: true },
]

const SUPPRESSING = new Set(DISLIKE_REASONS.filter(r => r.suppress).map(r => r.key))

// A null reason suppresses. Every rating stored before the sheet existed has one, and suppressing
// is exactly what those rows do today — reading them any other way would silently resurrect dishes
// users have already rejected.
export function suppressesDish(reason: unknown): boolean {
  if (reason == null || reason === '') return true
  return SUPPRESSING.has(String(reason) as DislikeReason)
}

// The flavour row under "Was it something in it?". Ingredient chips miss a whole class of taste
// failure: a dish can contain nothing the user dislikes and still be bland, or a protein ice cream
// can be icy. Nothing acts on these automatically yet — they reach Logan's daily report, and a
// pattern there ("too bland" on Cook Tonight) is the evidence for tuning seasoning later.
// Keys are CHECKed in meal_ratings.reason_flavours; add a key there before adding one here.
export type FlavourIssue = 'too_bland' | 'too_spicy' | 'too_sweet' | 'texture_off'
export const FLAVOUR_ISSUES: { key: FlavourIssue; label: string }[] = [
  { key: 'too_bland', label: 'Too bland' },
  { key: 'too_spicy', label: 'Too spicy' },
  { key: 'too_sweet', label: 'Too sweet' },
  { key: 'texture_off', label: 'Texture was off' },
]

// Ingredients nobody can dislike, kept out of the culprit chips. "pasta water" and "spray oil" took
// two of nine chips on Beef Pasta Skillet, crowding the real suspects. Deliberately narrow: water,
// ice, plain salt, cooking oils/sprays and leaveners — anything with a taste someone could object to
// (black pepper, garlic, olive-oil-heavy dressings named as such) stays.
const NEUTRAL_INGREDIENTS = [
  /^((cold|warm|hot|boiling|ice|iced|pasta|cooking|filtered|sparkling|lukewarm)\s+)?water$/,
  /^ice( cubes?)?$/,
  /\bspray\b/,
  /^((extra[- ]virgin\s+)?olive|vegetable|canola|sunflower|avocado|cooking|neutral|rapeseed)?\s*oil$/,
  /^(sea |kosher |table |fine |flaky )?salt$/,
  /^salt\s*(&|and)\s*(black\s+)?pepper$/,
  /^baking (powder|soda)$/,
]

export function culpritCandidates(names: readonly string[]): string[] {
  const seen = new Set<string>()
  return names.filter(n => {
    const k = String(n ?? '').trim().toLowerCase()
    if (!k || seen.has(k) || NEUTRAL_INGREDIENTS.some(r => r.test(k))) return false
    seen.add(k)
    return true
  })
}
