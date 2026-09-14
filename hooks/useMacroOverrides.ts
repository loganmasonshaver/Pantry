import AsyncStorage from '@react-native-async-storage/async-storage'
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

const COLUMNS = 'food_key, food_name, calories, protein, carbs, fat, basis_amount, basis_unit, serving_id'

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

// ── The user's corrections, all of them, in memory and on disk ─────────────
//
// A user has a handful of corrections at most, so the whole set is one small map. Looking one up
// per food was a network round-trip on every open of the food screen — the half-second spinner
// that survived caching the food itself. The map is read from memory, then disk, and only then
// the network; every write goes through here so the copies cannot drift.

type OverrideMap = Map<string, MacroOverride>
const memory = new Map<string, OverrideMap>() // userId -> food_key -> row
const diskKey = (userId: string) => `pantry_overrides:${userId}`

function persist(userId: string, map: OverrideMap) {
  memory.set(userId, map)
  AsyncStorage.setItem(diskKey(userId), JSON.stringify([...map.values()])).catch(() => {})
}

/** The map if it is already in memory — synchronous, so a cached open needs no await at all. */
export function peekOverrideMap(userId: string): OverrideMap | null {
  return memory.get(userId) ?? null
}

/** Fetch the user's corrections from the server and replace both copies. */
export async function refreshOverrideMap(userId: string): Promise<OverrideMap> {
  const { data, error } = await supabase.from('macro_overrides').select(COLUMNS).eq('user_id', userId)
  if (error) throw new Error(error.message)
  const map: OverrideMap = new Map((data ?? []).map(r => [r.food_key, r as MacroOverride]))
  persist(userId, map)
  return map
}

/** Memory, then disk, then network. A disk hit still refreshes from the network in the background. */
export async function loadOverrideMap(userId: string): Promise<OverrideMap> {
  const hit = memory.get(userId)
  if (hit) return hit
  try {
    const raw = await AsyncStorage.getItem(diskKey(userId))
    if (raw) {
      const rows = JSON.parse(raw) as MacroOverride[]
      if (Array.isArray(rows)) {
        const map: OverrideMap = new Map(rows.map(r => [r.food_key, r]))
        memory.set(userId, map)
        refreshOverrideMap(userId).catch(() => {})
        return map
      }
    }
  } catch {}
  return refreshOverrideMap(userId)
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
  const map = await loadOverrideMap(userId)
  return map.get(foodKey) ?? null
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
  if (error) return { error: error.message }
  const map = new Map(memory.get(userId) ?? [])
  map.set(override.food_key, override)
  persist(userId, map)
  return { error: null }
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
  if (error) return { error: error.message }
  const map = new Map(memory.get(userId) ?? [])
  map.delete(foodKey)
  persist(userId, map)
  return { error: null }
}
