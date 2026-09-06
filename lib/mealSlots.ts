// The user's meal-slot structure, derived from the one question onboarding already asks.
//
// `profiles.meal_slots` shipped with a flat default of four for everyone, which ignored the answer
// the user had already given. Asking again in Profile would be a second question for information we
// hold — so the count SEEDS the names, once, and `meal_slots` is the source of truth afterwards.

/** Fallback when a profile has no stored structure. Matches the column default. */
export const DEFAULT_SLOT_LABELS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']

export const slotId = (label: string) => label.toLowerCase().replace(/\s+/g, '-')

// ORDERED THROUGH THE DAY, not "three meals with snacks appended". A five-meal day is breakfast,
// a morning snack, lunch, dinner, an evening snack — that is when the eating actually happens, and
// the log reads top-to-bottom in the same order the day does.
//
// Every name is DISTINCT. Two slots sharing a name would collapse to the same slotId AND write the
// same `slot` string onto every log row, so they could never be told apart again — which is exactly
// what the case-insensitive guard in Home's add-slot flow rejects. My first draft of this table had
// "Lunch" twice at n=5 and would have produced that collision; Logan caught it.
const PLANS: string[][] = [
  [],                                                                                    // 0 — unused
  ['Breakfast'],
  ['Breakfast', 'Dinner'],
  ['Breakfast', 'Lunch', 'Dinner'],
  ['Breakfast', 'Lunch', 'Dinner', 'Snack'],
  ['Breakfast', 'Morning snack', 'Lunch', 'Dinner', 'Evening snack'],
  ['Breakfast', 'Morning snack', 'Lunch', 'Afternoon snack', 'Dinner', 'Evening snack'],
]

/**
 * Slot names for a given meals-per-day count. Clamped to 1..10: `meals_per_day` is a free numeric
 * field in Profile, so a typo of 0 or 99 must not produce an empty or absurd day.
 */
export function slotsForMealsPerDay(mealsPerDay: number | null | undefined): string[] {
  const n = Math.round(Number(mealsPerDay) || 0)
  if (!n) return DEFAULT_SLOT_LABELS
  const count = Math.max(1, Math.min(n, 10))
  if (count <= 6) return PLANS[count]
  // Past six there is no natural mealtime name left, so number them — Logan's rule for names that
  // would otherwise repeat. #4 because Morning/Afternoon/Evening already account for three snacks.
  return [...PLANS[6], ...Array.from({ length: count - 6 }, (_, i) => `Snack #${i + 4}`)]
}
