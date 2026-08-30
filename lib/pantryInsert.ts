import { supabase } from './supabase'
import { escapeLike } from './sqlLike'

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
      .insert(newRows.map(r => ({ user_id: userId, name: r.name, category: r.category, in_stock: true })))
    if (error) return { error }
  }

  // Re-stock existing rows that may have been out. ilike is case-insensitive — historical rows
  // have inconsistent casing, so equality would miss them.
  for (const name of restockNames) {
    // escapeLike: a raw "2% Milk" here is a wildcard pattern that also re-stocks other rows.
    await supabase.from('pantry_items').update({ in_stock: true }).eq('user_id', userId).ilike('name', escapeLike(name))
  }

  return { error: null }
}
