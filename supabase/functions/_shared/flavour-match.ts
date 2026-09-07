// Did the model reach for a FLAVOURED pantry item when a plain one was sitting right there?
//
// The live case: a pantry holding both "Protein Powder" and "Chocolate Protein Powder" produced a
// cottage cheese and PINEAPPLE bake made with the chocolate one. The macros are identical either
// way, so nothing downstream noticed — but chocolate and pineapple is not a pairing anyone eats.
//
// The failure is narrower than "the model does not understand flavour". A flavoured item is a
// FLAVOUR DECISION wearing an ingredient's clothes, and the model treats it as interchangeable
// with the plain version because nutritionally it is.
//
// Deliberately NOT a general flavour-pairing engine. A "what tastes good together" table is the
// same shape as the regex shelving this codebase tried twice and abandoned: properties overlap,
// rules fight, and results become unstable. This asks one mechanical question with a yes/no answer
// and no taste judgement anywhere in it.

// Flavour words that turn a staple into a flavoured product. "Unflavoured" variants are handled by
// PLAIN_MARKERS below rather than by absence, because "Plain Greek Yogurt" is explicitly plain.
const FLAVOUR_WORDS = [
  "chocolate", "double chocolate", "cocoa", "vanilla", "strawberry", "banana", "blueberry",
  "raspberry", "peach", "mango", "coconut", "mint", "mocha", "coffee", "espresso", "caramel",
  "salted caramel", "cookies and cream", "cookie dough", "birthday cake", "cinnamon roll",
  "peanut butter", "matcha", "pumpkin spice", "honey", "maple", "lemon", "key lime",
]

// An item carrying one of these is the plain version even if a flavour word appears elsewhere.
const PLAIN_MARKERS = ["plain", "unflavored", "unflavoured", "unsweetened", "natural", "original"]

// Staples that genuinely ship in both flavoured and plain form, and where the choice changes how
// the dish tastes. Narrow ON PURPOSE — a general "base word" match makes "chocolate chips" pair
// with "potato chips". Every entry here is a real supermarket pair.
const FLAVOURABLE_BASES = [
  "protein powder", "whey protein", "protein shake", "protein bar", "greek yogurt", "yogurt",
  "yoghurt", "cottage cheese", "kefir", "almond milk", "oat milk", "soy milk", "milk",
  "creamer", "oatmeal", "oats", "granola", "protein oats",
]

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()

function baseOf(name: string): string | null {
  // Longest match wins so "greek yogurt" beats "yogurt" and "almond milk" beats "milk" — otherwise
  // plain "Almond Milk" would read as the plain version of "Chocolate Milk".
  let best: string | null = null
  for (const b of FLAVOURABLE_BASES) {
    if (!name.includes(b)) continue
    if (!best || b.length > best.length) best = b
  }
  return best
}

function flavourOf(name: string): string | null {
  if (PLAIN_MARKERS.some(p => name.includes(p))) return null
  let best: string | null = null
  for (const f of FLAVOUR_WORDS) {
    if (!name.includes(f)) continue
    if (!best || f.length > best.length) best = f   // "salted caramel" over "caramel"
  }
  return best
}

export type FlavourMismatch = { ingredient: string; flavour: string; plainAlternative: string }

/**
 * Ingredients that took the flavoured option while an equivalent plain one was in the pantry AND
 * the dish is not actually about that flavour.
 *
 * The dish-name check is what keeps "Chocolate Protein Mousse" legal: reaching for chocolate powder
 * there is the entire point. Only a flavour the dish never claims is a mistake.
 */
export function flavourMismatches(
  mealName: unknown,
  ingredients: readonly unknown[],
  pantry: readonly unknown[],
): FlavourMismatch[] {
  const dish = norm(mealName)
  const pantryNorm = (pantry ?? []).map(p => norm((p as any)?.name ?? p)).filter(Boolean)
  const out: FlavourMismatch[] = []

  for (const raw of ingredients ?? []) {
    const original = String((raw as any)?.name ?? raw ?? "")
    const name = norm(original)
    if (!name) continue
    const base = baseOf(name)
    if (!base) continue
    const flavour = flavourOf(name)
    if (!flavour) continue
    // The dish is allowed to be about this flavour. Checked against the NAME, which is the only
    // place a dish declares its intent — the steps describe process, not identity.
    if (dish.includes(flavour)) continue
    // Is there a plain one on the shelf? Same base, no flavour of its own.
    const plain = pantryNorm.find(p => baseOf(p) === base && flavourOf(p) === null)
    if (!plain) continue
    out.push({ ingredient: original, flavour, plainAlternative: plain })
  }
  return out
}

/**
 * How many times the mismatch check COULD have fired.
 *
 * Counts ingredients whose base staple sits in the pantry in BOTH plain and flavoured form — the
 * only situation where the model had a choice it could get wrong. Without this a zero in
 * `flavourMismatches` is ambiguous: the prompt rule may have worked, or no dish may have reached
 * for a flavourable staple at all. Only a zero measured against a NON-ZERO opportunity count is
 * evidence the rule took. Mismatches are always a subset of opportunities.
 */
export function flavourOpportunities(
  ingredients: readonly unknown[],
  pantry: readonly unknown[],
): number {
  const pantryNorm = (pantry ?? []).map(p => norm((p as any)?.name ?? p)).filter(Boolean)
  let n = 0
  for (const raw of ingredients ?? []) {
    const base = baseOf(norm(String((raw as any)?.name ?? raw ?? "")))
    if (!base) continue
    const sameBase = pantryNorm.filter(p => baseOf(p) === base)
    // Both variants must actually be on the shelf, or there was no decision to make.
    if (sameBase.some(p => flavourOf(p) === null) && sameBase.some(p => flavourOf(p) !== null)) n++
  }
  return n
}
