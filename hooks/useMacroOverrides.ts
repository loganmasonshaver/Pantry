import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────

export type MacroOverride = {
  food_key: string
  food_name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  // The portion the correction was made on — see lib/foodPortion.ts applyOverride. Null on rows
  // saved before corrections carried a basis.
  basis_amount: number | null
  basis_unit: 'g' | 'ml' | null
  serving_id: string | null
}

// ── Key helpers ────────────────────────────────────────────────────────────

// Prefixed keys keep barcode-based overrides separate from FatSecret-ID-based
// ones — same physical product could have different IDs across sources, so we
// never want them to collide on a single override row.
/** Build a stable lookup key from a barcode or FatSecret food ID. */
export function getFoodKey(opts: { barcode?: string; foodId?: string }): string {
  if (opts.barcode) return `barcode:${opts.barcode}`
  if (opts.foodId) return `fatsecret:${opts.foodId}`
  throw new Error('getFoodKey requires either barcode or foodId')
}

// ── CRUD helpers ───────────────────────────────────────────────────────────

/**
 * Fetch a single override for the current user.
 * Returns null if no override exists for this food_key.
 */
export async function getOverride(
  userId: string,
  foodKey: string
): Promise<MacroOverride | null> {
  const { data } = await supabase
    .from('macro_overrides')
    .select('food_key, food_name, calories, protein, carbs, fat, basis_amount, basis_unit, serving_id')
    .eq('user_id', userId)
    .eq('food_key', foodKey)
    .maybeSingle()
  return data ?? null
}

/**
 * Save (upsert) an override for the current user.
 */
export async function saveOverride(
  userId: string,
  override: MacroOverride
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('macro_overrides')
    .upsert(
      { user_id: userId, ...override },
      { onConflict: 'user_id,food_key' } // matches the compound unique index — one override per (user, food)
    )
  return { error: error?.message ?? null }
}

/**
 * Delete an override, reverting the food back to its original macro values.
 */
export async function deleteOverride(
  userId: string,
  foodKey: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('macro_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('food_key', foodKey)
  return { error: error?.message ?? null }
}
