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

// A gap the dish does not need: one the SERVER listed as a garnish. Exact name only — the server
// copies the ingredient's own name into garnish_missing — and anything it did not list (a meal
// cached before the split, or an item that ran out after generation) counts as needed. Fail safe:
// wrongly calling something optional tells a user to cook without an ingredient they need.
export function isOptionalGap(name: string, meal: { garnish_missing?: unknown }): boolean {
  const g = meal.garnish_missing
  if (!Array.isArray(g)) return false
  const n = name.trim().toLowerCase()
  return !!n && g.some(x => String(x).trim().toLowerCase() === n)
}

// The gaps a meal cannot be cooked without — Home's "Need:" and the meal screen's YOU'LL NEED read
// this one definition, so Home cannot say Ready while the detail says You'll need.
export function neededMissing(meal: { ingredients?: Named[]; garnish_missing?: unknown }, pantryNames: Set<string>, excludedStaples: Set<string>): string[] {
  return missingIngredients(meal.ingredients, pantryNames, excludedStaples).filter(n => !isOptionalGap(n, meal))
}
