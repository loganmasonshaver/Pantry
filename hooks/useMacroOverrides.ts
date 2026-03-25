import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────

export type MacroOverride = {
  food_key: string
  food_name: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

// ── Key helpers ────────────────────────────────────────────────────────────

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
    .select('food_key, food_name, calories, protein, carbs, fat')
    .eq('user_id', userId)
    .eq('food_key', foodKey)
    .maybeSingle()
  return data ?? null
}

/**
 * Given a food's original macros and the current user, apply any saved
 * override on top. Returns the override values if one exists, otherwise
 * returns the originals unchanged.
 */
export async function applyOverride(
  userId: string,
  foodKey: string,
  original: Omit<MacroOverride, 'food_key'>
): Promise<Omit<MacroOverride, 'food_key'>> {
  const override = await getOverride(userId, foodKey)
  return override
    ? { food_name: override.food_name, calories: override.calories, protein: override.protein, carbs: override.carbs, fat: override.fat }
    : original
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
      { onConflict: 'user_id,food_key' }
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
