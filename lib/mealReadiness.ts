// Which of a meal's ingredients the pantry cannot cover — the "Ready to cook" / "Need:" /
// "Better with:" line under each Cook Tonight card.
//
// Computed against the LIVE pantry on the client, never trusted from the server's own
// missing_ingredients: the model returns [] even when the pantry is near-empty, which produced a
// false "Got everything" on the card while the detail screen correctly showed every ingredient
// missing. Extracted from the Pantry tab so Home and the meal detail read from one definition.
import { isAssumedStaple } from '../constants/staples.ts'

type Named = { name: string }

// `pantryNames` is lower-cased in-stock names only — an "Out" item is not on hand, so it must read
// as missing here or the card says "have rice" while the detail says "need".
export function missingIngredients(mealIngs: Named[] | undefined, pantryNames: Set<string>, excludedStaples: Set<string>): string[] {
  if (!mealIngs) return []
  const missing: string[] = []
  for (const ing of mealIngs) {
    const n = ing.name.toLowerCase()
    // Salt, oil and the rest are assumed unless the user has opted out of one (staples_excluded,
    // or a diet that rules it out) — then it flips back into NEED.
    if (isAssumedStaple(ing.name, excludedStaples)) continue
    // Two-way substring: pantry "chicken breast" covers meal "chicken", and the reverse.
    let have = false
    for (const p of pantryNames) {
      if (p === n || p.includes(n) || n.includes(p)) { have = true; break }
    }
    if (!have) missing.push(ing.name)
  }
  return missing
}

// Only a STRUCTURAL gap is a trip to the store. The server splits the gaps (structural_missing /
// garnish_missing) because only it knows which is which; each is re-checked here against the live
// pantry. Meals cached before the split carry no list and fall back to any gap, as before.
export function structuralMissing(meal: { ingredients?: Named[]; structural_missing?: unknown }, pantryNames: Set<string>, excludedStaples: Set<string>): string[] {
  const s = meal.structural_missing
  return Array.isArray(s)
    ? missingIngredients(s.map((name: string) => ({ name })), pantryNames, excludedStaples)
    : missingIngredients(meal.ingredients, pantryNames, excludedStaples)
}
