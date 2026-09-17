import { supabase } from './supabase'
import { escapeLike } from './sqlLike'
import { normalizeCategory } from './categoryMatch'

export type PantryInsertRow = { name: string; category: string }

// Single deduped path for adding items to the pantry. Every scan/import surface (photo scan,
// receipt scan, grocery check-off) MUST route through this instead of a raw .insert — otherwise
// scanning an item you already own creates an exact duplicate row (the "two Cooked Rice" bug).
// Mirrors the grocery→pantry behavior: skip names already present, and re-stock any that were
// previously toggled out so a fresh scan of a depleted item brings it back in stock.
export async function addPantryItemsDeduped(userId: string, rows: PantryInsertRow[]): Promise<{ error: Error | null }> {
  if (rows.length === 0) return { error: null }

  const { data: existing } = await supabase
    .from('pantry_items')
    .select('name')
    .eq('user_id', userId)
  const existingNames = new Set((existing ?? []).map(e => e.name.toLowerCase().trim()))

  // Split incoming rows into genuinely-new vs already-owned. Also dedupe WITHIN the batch itself
  // (a scan can detect the same item twice) so one scan can't seed a duplicate on its own.
  const seen = new Set<string>()
  const newRows: PantryInsertRow[] = []
  const restockNames: string[] = []
  for (const row of rows) {
    const key = row.name.toLowerCase().trim()
    if (seen.has(key)) continue
    seen.add(key)
    if (existingNames.has(key)) restockNames.push(row.name)
    else newRows.push(row)
  }

  if (newRows.length > 0) {
    const { error } = await supabase
      .from('pantry_items')
      // Category coerced to the canonical list HERE, at the one write path every surface routes
      // through, rather than trusting each caller. The scan model invented its own vocabulary
      // ("Dairy", "Carbs", "Protein"), none of which exists in STORE_CATEGORIES, so the icon and
      // colour maps missed and the pantry rendered as identical grey boxes.
      .insert(newRows.map(r => ({ user_id: userId, name: r.name, category: normalizeCategory(r.category, r.name), in_stock: true })))
    if (error) return { error }
  }

  // Re-stock existing rows that may have been out. Matched case-insensitively — historical rows
  // have inconsistent casing, so exact equality would miss them. Seeing an item in a scan or on a
  // receipt is also the strongest "still here" evidence the app ever gets, so it resets the
  // stale clock — without this a user who rescans every fortnight was still asked "still have
  // them?" about everything that was already on the shelf.
  // ONE request for all of them (restock_pantry_items). A stocked kitchen is mostly restocks — 49 of
  // a 57-item scan — and as one PATCH each, eight at a time, they kept the Add-all spinner up for
  // 8.1 s when the API answered each in ~370 ms. The server matches lower(trim(name)), the same key
  // as existingNames above.
  const tRestock = Date.now()
  if (restockNames.length > 0) {
    const { error: rpcError } = await supabase.rpc('restock_pantry_items', { p_names: restockNames })
    if (rpcError) {
      // The old per-row path, so a failed call never leaves a scanned item marked out of stock.
      __DEV__ && console.log('[pantry save] restock_pantry_items failed, per-row fallback:', rpcError.message)
      const now = new Date().toISOString()
      const RESTOCK_CONCURRENCY = 8
      for (let i = 0; i < restockNames.length; i += RESTOCK_CONCURRENCY) {
        await Promise.all(restockNames.slice(i, i + RESTOCK_CONCURRENCY).map(name =>
          // escapeLike: a raw "2% Milk" here is a wildcard pattern that also re-stocks other rows.
          supabase.from('pantry_items').update({ in_stock: true, last_confirmed_at: now }).eq('user_id', userId).ilike('name', escapeLike(name))
        ))
      }
    }
  }
  __DEV__ && restockNames.length > 0 && console.log(`[perf] pantry save: ${newRows.length} new, ${restockNames.length} restocked in ${Date.now() - tRestock}ms`)

  return { error: null }
}
