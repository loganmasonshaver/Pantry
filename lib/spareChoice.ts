import { neededMissing } from './mealReadiness.ts'
import { dishArchetype, isSameDish } from '../supabase/functions/_shared/dish-key.ts'

type Meal = { id: string; name: string; ingredients?: { name: string }[]; garnish_missing?: unknown }

// The spare that replaces one shown meal, or null when none fits. Spares arrive in the server's rank
// order, so the first that passes wins. It must be cookable from the CORRECTED pantry — the same test
// as Home's "Ready to cook", so a swap never lands on a fresh "Need:" — and a different dish from the
// meals that stay, by name and by form: generate-meals shows three different dish forms, and a swap
// must not leave two bowls.
export function pickSpare<T extends Meal>(
  spares: T[],
  deck: Meal[],
  replacedId: string,
  pantryNames: Set<string>,
  excludedStaples: Set<string>,
): T | null {
  const staying = deck.filter(m => String(m.id) !== String(replacedId))
  // An unrecognised form reads as '' — two of those are not "the same form", only unknown.
  const stayingForms = new Set(staying.map(m => dishArchetype(m.name)).filter(Boolean))
  for (const spare of spares) {
    if (deck.some(m => String(m.id) === String(spare.id))) continue // already swapped in
    if (neededMissing(spare, pantryNames, excludedStaples).length > 0) continue
    if (staying.some(m => isSameDish(m.name, spare.name))) continue
    const form = dishArchetype(spare.name)
    if (form && stayingForms.has(form)) continue
    return spare
  }
  return null
}
