// Dish FAMILIES for the Discover page, and the page-wide cap on each.
//
// dishArchetype (the last noun) spaces forms apart and caps them per shelf, but it never shows
// FEWER of anything: on 2026-09-16 the 238-meal pool carried 22 cheesecakes, 16 brownies and 31
// pasta dishes, and scrolling Discover walked through all of them. It also misses the name-level
// repeat a reader actually notices — "Blueberry Cheesecake Yogurt", "Cheesecake Dip" and "Blueberry
// Cheesecake Chia Pudding" end in yogurt, dip and pudding, and all three read as cheesecake again.
//
// So a family is any family word ANYWHERE in the name, a dish can belong to several ("Tuna Pasta
// Salad" is pasta and salad), and it is shown only while every one of its families has room.
// Pure and dependency-free so it runs under node --test against the real pool.

import { dishArchetype } from './dishArchetype.ts'

// word or phrase in the name -> family. Phrases are matched before single words so "ice cream"
// never also reads as a bare "cream", and "rice paper" never reads as rice.
const FAMILY_PHRASES: [RegExp, string][] = [
  [/\b(ice cream|nice cream|froyo|frozen yogh?urt|creami)\b/, 'ice cream'],
  [/\b(overnight oats|baked oats|blended oats)\b/, 'oats'],
  [/\b(fried rice)\b/, 'rice'],
  [/\b(mac (?:and|&|n) cheese)\b/, 'pasta'],
  [/\brice (?:paper|cooker|cake)s?\b/, ''],
]
const FAMILY_WORDS: Record<string, string> = {
  cheesecake: 'cheesecake',
  brownie: 'brownie', blondie: 'brownie',
  tiramisu: 'tiramisu',
  pancake: 'pancake', crepe: 'pancake', waffle: 'pancake',
  cookie: 'cookie',
  cake: 'cake', cupcake: 'cake',
  muffin: 'muffin',
  donut: 'donut', doughnut: 'donut',
  mousse: 'mousse',
  pudding: 'pudding',
  smoothie: 'smoothie', shake: 'smoothie',
  oat: 'oats', oatmeal: 'oats', porridge: 'oats',
  parfait: 'parfait',
  bite: 'bites', ball: 'bites', truffle: 'bites', ladoo: 'bites', laddu: 'bites',
  bar: 'bar',
  salad: 'salad',
  wrap: 'wrap', burrito: 'wrap', taco: 'wrap', quesadilla: 'wrap',
  pizza: 'pizza', flatbread: 'pizza',
  pasta: 'pasta', noodle: 'pasta', spaghetti: 'pasta', macaroni: 'pasta', lasagna: 'pasta', lasagne: 'pasta',
  gnocchi: 'pasta', cannelloni: 'pasta', ramen: 'pasta', penne: 'pasta', orzo: 'pasta', rigatoni: 'pasta',
  pulao: 'rice', biryani: 'rice', risotto: 'rice', rice: 'rice',
  curry: 'curry', masala: 'curry', korma: 'curry',
  soup: 'soup', stew: 'soup', chili: 'soup', chilli: 'soup',
  toast: 'toast', sandwich: 'toast', bagel: 'toast',
  dip: 'dip', spread: 'dip', hummus: 'dip',
  kebab: 'kebab', tikka: 'kebab',
  // The one INGREDIENT family, because it is the one Logan named: paneer reads as a repeat across
  // shelves (Paneer Pasta, Paneer Tiramisu, Paneer Pizza) in a way chicken or eggs do not.
  paneer: 'paneer',
}

const singular = (w: string) =>
  w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y'
    : w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w

export function dishFamilies(name: string | null | undefined): string[] {
  let text = String(name ?? '').toLowerCase().replace(/[^a-z&\s]/g, ' ')
  const out = new Set<string>()
  for (const [re, fam] of FAMILY_PHRASES) {
    const m = re.exec(text)
    if (!m) continue
    if (fam) out.add(fam)
    text = text.replace(re, ' ')
  }
  for (const raw of text.split(/\s+/)) {
    const fam = FAMILY_WORDS[singular(raw)] ?? FAMILY_WORDS[raw]
    if (fam) out.add(fam)
  }
  // The last noun only when no family word named the dish: "Salad Bowl" is a salad, "Kofta Style
  // Beef Bowl" is a bowl. Families inferred this way take the broad cap (see familyCap).
  if (out.size === 0) {
    const form = dishArchetype({ id: '', name })
    if (form) out.add(form)
  }
  return [...out]
}

// How many of one family the page shows. TWO tiers, because one number was measured and failed:
// capping every family at 4 hid 114 of the 238-meal pool, most of it pasta, salads and bowls — and
// bolognese, lasagna and mac and cheese are different dishes, where six chocolate cheesecakes are
// one dish photographed six times. A NARROW family is a single recognisable dish; a BROAD one is a
// category of distinct dishes, and a family inferred from the last noun alone is treated as broad
// because it is the less reliable read.
export const FAMILY_PAGE_CAP = 4
// 10, not 8: measured on the live pool, 4/8 showed 144 of 238 and 4/10 showed 149 with the same
// dessert share (36% -> 28%); the extra five were all pasta and salads, which are the broad ones.
export const BROAD_FAMILY_PAGE_CAP = 10
const BROAD_FAMILIES = new Set(['pasta', 'salad', 'rice', 'wrap', 'toast', 'soup', 'curry', 'pizza'])
export function familyCap(family: string, narrowCap = FAMILY_PAGE_CAP, broadCap = BROAD_FAMILY_PAGE_CAP): number {
  if (BROAD_FAMILIES.has(family)) return broadCap
  return Object.values(FAMILY_WORDS).includes(family) || family === 'ice cream' || family === 'oats' ? narrowCap : broadCap
}

export type FamilyMeal = { id: string; name?: string | null; created_at?: string | null }

// Which meals the page may show. Order of the INPUT is preserved in the output — this decides
// membership, not placement, so every shelf's own ordering, rotation and claim logic is untouched.
//
// Who gets a family's slots: `pinned` first (the hero, which is already on screen), then NEW TODAY
// (fresh, and badged), then the rest by hash(id + day) so the visible cheesecakes change daily
// rather than the same four sitting there for a month. A meal not shown is still in the pool and
// still reachable through search.
export function capFamiliesOnPage<T extends FamilyMeal>(
  meals: readonly T[],
  opts: { cap?: number; broadCap?: number; day: number; isNew: (m: T) => boolean; pinnedIds?: readonly string[] },
): { shown: T[]; hidden: T[] } {
  const capOf = (f: string) => familyCap(f, opts.cap ?? FAMILY_PAGE_CAP, opts.broadCap ?? BROAD_FAMILY_PAGE_CAP)
  const pinned = new Set(opts.pinnedIds ?? [])
  const hash = (k: string) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
  const priority = [...meals].sort((a, b) =>
    Number(pinned.has(b.id)) - Number(pinned.has(a.id))
    || Number(opts.isNew(b)) - Number(opts.isNew(a))
    || hash(`${a.id}:${opts.day}`) - hash(`${b.id}:${opts.day}`))
  const used = new Map<string, number>()
  const admitted = new Set<string>()
  for (const m of priority) {
    const fams = dishFamilies(m.name)
    // Pinned meals are admitted regardless and still count, so the hero cheesecake is one of four.
    if (!pinned.has(m.id) && fams.some(f => (used.get(f) ?? 0) >= capOf(f))) continue
    for (const f of fams) used.set(f, (used.get(f) ?? 0) + 1)
    admitted.add(m.id)
  }
  return {
    shown: meals.filter(m => admitted.has(m.id)),
    hidden: meals.filter(m => !admitted.has(m.id)),
  }
}
