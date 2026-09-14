// Which FatSecret search result to price an ingredient by.
//
// FatSecret's top hit for a bare meat name is the COOKED entry: "ground beef" matched "Ground Beef
// (Cooked)" at 276 kcal/100g and "chicken breast" a roasted-with-skin entry at 195, while a recipe
// lists RAW weights (the cook weighs raw). Water leaves in the pan, so cooked entries carry 40-80%
// more calories and protein per gram — a 140 g raw breast was priced as 273 kcal / 47 g protein
// when it is ~168 kcal / 32 g. Every downstream number inherited it: the calorie resize saw a
// 924 kcal plate, cut the beef to its floor to compensate, and the card read 696 kcal / 39 g on
// Logan's Barbecue Beef Potato Plate (run 759) — both figures wrong in opposite directions.
//
// Rule: for an ingredient that is a raw protein by name, take the first result whose name says
// raw; else the first whose name and description carry no cooked-state word; else the top hit.
// Generic entries beat brands at equal rank. An ingredient that names its cooked state ("cooked
// chicken", "rotisserie", "canned tuna", "bacon") keeps the top hit — it IS the cooked food.

export type FsResult = { food_id?: unknown; food_name?: unknown; food_description?: unknown; food_type?: unknown }

const RAW_PROTEIN = /\b(chicken|turkey|beef|steak|mince|pork|lamb|veal|duck|salmon|tuna|cod|tilapia|halibut|shrimps?|prawns?|fish|scallops?)\b/i
const NOT_RAW = /\b(cooked|pre-?cooked|rotisserie|roasted|grilled|smoked|canned|tinned|deli|shredded|pulled|leftover|salad|sausages?|bacon|ham|salami|pepperoni|jerky|nuggets?|tenders?|patt(?:y|ies)|meatballs?|broth|stock)\b/i
const COOKED_STATE = /\b(cooked|roasted|roast|grilled|fried|baked|broiled|braised|stewed|saut[ée]ed|smoked|rotisserie|canned|breaded|battered|barbecued|bbq)\b/i

export function wantsRawMatch(name: unknown): boolean {
  const n = String(name ?? '')
  return RAW_PROTEIN.test(n) && !NOT_RAW.test(n)
}

export function pickFatSecretMatch(name: unknown, results: readonly FsResult[]): FsResult | null {
  const list = results.filter(r => r && r.food_id != null)
  if (list.length === 0) return null
  if (!wantsRawMatch(name)) return list[0]
  const text = (r: FsResult) => `${String(r.food_name ?? '')} ${String(r.food_description ?? '')}`
  const rank = (r: FsResult) => {
    const nameHasRaw = /\braw\b/i.test(String(r.food_name ?? ''))
    const cooked = COOKED_STATE.test(text(r))
    const generic = String(r.food_type ?? '').toLowerCase() === 'generic'
    return (nameHasRaw ? 0 : cooked ? 2 : 1) * 2 + (generic ? 0 : 1)
  }
  return [...list].map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i)[0].r
}
