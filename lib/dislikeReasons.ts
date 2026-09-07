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
  { key: 'taste', label: "Didn't taste good", suppress: true },
]

const SUPPRESSING = new Set(DISLIKE_REASONS.filter(r => r.suppress).map(r => r.key))

// A null reason suppresses. Every rating stored before the sheet existed has one, and suppressing
// is exactly what those rows do today — reading them any other way would silently resurrect dishes
// users have already rejected.
export function suppressesDish(reason: unknown): boolean {
  if (reason == null || reason === '') return true
  return SUPPRESSING.has(String(reason) as DislikeReason)
}
