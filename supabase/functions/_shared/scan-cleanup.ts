// Deterministic safety net over whatever the vision model returns for a pantry scan.
//
// Split out of scan-pantry/index.ts so it can be unit-tested: index.ts reads Deno.env and calls
// Deno.serve at module scope, which makes it unloadable outside Deno. Nothing here touches the
// runtime — the confidence floor is passed in.

// Normalize whatever the model put in `confidence` to a 0-100 number. Tolerates the old
// string form ('high'/'low') and omission so a mixed/older response never crashes the floor.
export function confScore(c: unknown): number {
  if (typeof c === 'number' && isFinite(c)) return c
  if (c === 'low') return 30
  if (c === 'high') return 90
  return 100 // absent → treat as fully confident (never floor-drop an unscored item)
}

// Matched against the CANONICAL name (parentheticals already stripped) — these are whole-name
// detections, so an exact set avoids the false positives a substring list would cause
// ("pot roast", "cup noodles", "glass noodles", "sponge cake" are all real food).
const NONFOOD_EXACT = new Set([
  'plate', 'plates', 'dinner plate', 'dinner plates', 'bowl', 'bowls', 'cup', 'cups', 'mug', 'mugs',
  'glass', 'glasses', 'pot', 'pots', 'pan', 'pans', 'skillet', 'kettle', 'tray', 'trays', 'utensil',
  'utensils', 'fork', 'knife', 'spoon', 'spatula', 'container', 'containers', 'plastic container',
  'plastic food container', 'food container', 'prepared food container', 'toaster', 'blender',
  'coffee maker', 'appliance', 'sponge', 'sponges', 'napkin', 'napkins', 'foil', 'aluminum foil',
  'battery', 'batteries', 'cookbook', 'cookbooks',
])
// Substring matches — every entry must be specific enough that no food contains it. A bare word
// here is a trap: 'cotton' dropped cotton candy and cottonseed oil, so the cotton entries name the
// actual product. Entries are matched AFTER normName, which turns punctuation into spaces — so
// they must be written in that form ('q tip', never 'q-tip', which could never match).
const NONFOOD_CONTAINS = [
  'nail polish', 'dish soap', 'hand soap', 'paper towel', 'cutting board', 'trash bag', 'garbage bag',
  'dog food', 'dog biscuit', 'dog treat', 'cat food', 'cat treat', 'kibble', 'toothpaste', 'shampoo',
  'toiletr', 'dishware', 'cookware', 'kitchenware', 'plastic wrap', 'tissue', 'q tip', 'cotton ball',
  'cotton swab', 'cotton pad', 'cotton round',
]

export const normName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Strip parenthetical qualifiers: "Hot Sauce (Red Cap)" → "Hot Sauce". The model is prompted to
// disambiguate this way, so most names arrive with one.
export const canonicalName = (s: string) => s.replace(/\s*\([^)]*\)/g, '').trim()

// Takes a name that has ALREADY been through canonicalName. Checking the raw name instead let a
// qualifier smuggle dishware past the exact set — "Plate (white ceramic)" normalizes to
// "plate white ceramic", misses every entry, and then gets canonicalized to "Plate" and written
// into the user's pantry as food.
export function isNonFood(canon: string): boolean {
  const n = normName(canon)
  if (NONFOOD_EXACT.has(n)) return true
  return NONFOOD_CONTAINS.some((t) => n.includes(t))
}

// Drop hallucinated non-food, strip parenthetical qualifiers, and collapse exact dupes — across
// the WHOLE result, per zone. Mutates result.zones.
export function cleanupResult(result: any, confidenceFloor: number): void {
  const seen = new Set<string>()
  for (const zone of (result.zones || [])) {
    const kept: any[] = []
    for (const item of (zone.items || [])) {
      if (!item?.name || typeof item.name !== 'string') continue
      // Canonicalize FIRST — every downstream check is written against the canonical form.
      const canon = canonicalName(item.name)
      if (!canon) continue
      if (isNonFood(canon)) continue
      if (confScore(item.confidence) < confidenceFloor) continue // below the tunable quality floor
      const key = normName(canon)
      if (!key || seen.has(key)) continue
      seen.add(key)
      kept.push({ ...item, name: canon })
    }
    zone.items = kept
  }
  result.zones = (result.zones || []).filter((z: any) => (z.items?.length ?? 0) > 0)
}
