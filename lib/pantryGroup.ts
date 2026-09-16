// Grouping the pantry rows into aisles, kept pure so the screen and its disk cache build the list
// the same way. The screen paints from the cache first and from the network a moment later; if the
// two grouped differently, the rows would visibly reshuffle under the reader.

export type PantryRow = {
  id: string
  name: string
  category: string | null
  in_stock: boolean
  created_at?: string | null
  last_confirmed_at?: string | null
}

export type GroupedItem = { id: string; name: string; inStock: boolean; since: string }
export type GroupedCategory = { name: string; ingredients: GroupedItem[] }

// `order` is the aisle order the screen wants (PANTRY_ORDER: Meat & Fish first, then store order).
// Anything with a category outside that list keeps its own name and lands after the known aisles,
// in the order it first appears — a category the app does not know about must still be reachable.
export function groupPantryRows(rows: PantryRow[], order: readonly string[]): GroupedCategory[] {
  const grouped = new Map<string, GroupedItem[]>()
  for (const row of rows) {
    const catName = row.category || 'Other'
    if (!grouped.has(catName)) grouped.set(catName, [])
    grouped.get(catName)!.push({
      id: row.id,
      name: row.name,
      inStock: row.in_stock,
      // last_confirmed_at is reset by every write that touches the item; created_at is the fallback
      // for rows added before that column existed.
      since: row.last_confirmed_at ?? row.created_at ?? new Date().toISOString(),
    })
  }

  // Out rows sink to the bottom of their aisle HERE, at load, never on the tap that marks them Out —
  // a row that jumps under the finger reads as a delete. Stable within each half, so the server's
  // created_at order still decides among the in-stock rows.
  for (const list of grouped.values()) list.sort((a, b) => Number(b.inStock) - Number(a.inStock))

  const result: GroupedCategory[] = []
  for (const name of order) {
    const ingredients = grouped.get(name)
    if (ingredients?.length) result.push({ name, ingredients })
  }
  for (const [name, ingredients] of grouped) {
    if (!order.includes(name) && ingredients.length) result.push({ name, ingredients })
  }
  return result
}
