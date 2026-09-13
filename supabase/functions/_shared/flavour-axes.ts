// Which of the prompt's four flavour axes a meal reaches, read from its ingredients (and, for a
// technique like browned butter, its steps).
//
// MEASURED, NOT ENFORCED. generate-meals has asked for "at least TWO of the four flavor axes" as a
// prompt line, and Cook Tonight run 48 shipped three meals reaching 0, 0 and 1 — no salt in any of
// them, while the pantry held lime, pickles, salsa, hot sauce, soy sauce, garlic and pesto. Every
// gate in that file started as a counter first, so this does too; ranking on it waits for numbers.
//
// The word lists follow the prompt's own examples so the count means what the model was asked for,
// plus the blends and cooked-tomato sauces creators actually list: the first measurement read Chicken
// Fajita Bowls and a Pepperoni Pizza Skillet from the Discover pool as zero-axis dishes.
// Black pepper is a heat axis because the prompt says so — which is why "salt and pepper alone"
// reaches exactly one.

export type Axis = 'acid' | 'heat' | 'umami' | 'aromatic'

const ACID = /\b(lemons?|limes?|vinegar|pickles?|pickled|relish|salsa|pico de gallo|citrus|capers?|kimchi|sauerkraut|sumac|tamarind|bbq|barbecue|mustard)\b/i
// Bell and roasted red peppers are sweet, so "pepper" only counts in its black/ground/flaked forms.
const HEAT = /\b(chil(?:i|e|li)|chillies|chilis|hot sauce|sriracha|jalape[nñ]os?|cayenne|chipotle|gochujang|harissa|black pepper|ground pepper|white pepper|peppercorns?|pepper flakes|crushed red pepper|ginger|wasabi|horseradish|buffalo|cajun|creole|jerk|fajita|taco seasoning|curry (?:powder|paste)|garam masala|peri[- ]?peri|piri[- ]?piri|sambal)\b/i
const BARE_PEPPER = /^(salt\s*(and|&)\s*)?pepper$/i
const UMAMI = /\b(soy sauce|soya sauce|tamari|fish sauce|oyster sauce|worcestershire|miso|parmesan|parmigiano|pecorino|mushrooms?|nutritional yeast|tomato (?:paste|sauce|pur[ée]e)|passata|marinara|pizza sauce|bolognese|(?:crushed|chopped|diced|canned|sun-dried) tomatoes|anchov(y|ies)|pad thai sauce|teriyaki|hoisin|coconut aminos|pesto|dashi|bacon|pepperoni|salami|chorizo|prosciutto|smoked salmon)\b/i
// Aromatic fat: a fat that carries an aromatic, or a product/technique that already is one.
const AROMATIC_FAT = /\b(sesame oil|chil(?:i|li) oil|pesto|garlic butter|ghee)\b/i
const AROMATIC_TECHNIQUE = /\bbrown(?:ed)?\s+(?:the\s+)?butter\b/i
const FAT = /\b(oil|butter|ghee|lard|tallow)\b/i
const AROMATIC = /\b(garlic|ginger|shallots?|scallions?|green onions?|onions?|leeks?|rosemary|thyme|sage|basil|cilantro|coriander leaves|parsley|dill|chives|lemongrass|curry leaves|cumin seeds?|mustard seeds?)\b/i
// A dried powder is not bloomed in the fat the way the prompt's "garlic in oil" means.
const POWDER = /\b(powder|granules|dried)\b/i

export function flavourAxes(meal: { ingredients?: unknown; steps?: unknown } | null | undefined): Axis[] {
  const lines = (Array.isArray(meal?.ingredients) ? meal!.ingredients as unknown[] : [])
    .map(i => String((i as any)?.name ?? i ?? '').toLowerCase().trim())
    .filter(Boolean)
  const steps = (Array.isArray(meal?.steps) ? meal!.steps as unknown[] : [])
    .map(s => (typeof s === 'string' ? s : `${(s as any)?.title ?? ''} ${(s as any)?.detail ?? ''}`))
    .join(' ')
  const has = (re: RegExp) => lines.some(l => re.test(l))
  const out: Axis[] = []
  if (has(ACID)) out.push('acid')
  if (has(HEAT) || lines.some(l => BARE_PEPPER.test(l))) out.push('heat')
  if (has(UMAMI)) out.push('umami')
  const aromaticInFat = has(FAT) && lines.some(l => AROMATIC.test(l) && !POWDER.test(l))
  if (has(AROMATIC_FAT) || AROMATIC_TECHNIQUE.test(steps) || aromaticInFat) out.push('aromatic')
  return out
}

// A dish that is sweet by nature owes no acid, heat or umami. Ranking it on savory axes would sink
// every shake and parfait below every dinner for reasons the prompt never asked of them. The same
// list step-checks uses to excuse a dessert from salt — one list, so the two cannot disagree.
export const SWEET_DISH = /\b(parfait|smoothie|shake|oats|oatmeal|porridge|pudding|dessert|cereal|granola|yogurt bowl|cottage cheese bowl|fruit bowl|pancakes?|waffles?|crepes?|muffins?|cookies?|bites?|clusters?|brownies?|french toast|ice cream|bars?)\b/i
// A bowl or plate named for a fruit or a nut with no meat, fish or egg in the title is a sweet dish
// too — "Bulgarian Yogurt and Pineapple Protein Bowl" is not on the list above, and it was ranked
// as a savory dish with no seasoning. "Pineapple Chicken Rice Bowl" keeps its savory obligations.
const SWEET_MARKER = /\b(pineapple|berr(?:y|ies)|banana|mango|apple|peach|strawberr(?:y|ies)|blueberr(?:y|ies)|raspberr(?:y|ies)|orange|fruit|pecans?|almonds?|walnuts?|honey|maple|chocolate|cocoa|vanilla)\b/i
const SAVORY_MARKER = /\b(chicken|beef|pork|turkey|salmon|tuna|shrimp|fish|eggs?|omelet(?:te)?|scramble|frittata|tofu|bacon|sausage|ham|steak|lentils?|chickpeas?|beans?)\b/i
export function isSweetDish(name: unknown): boolean {
  const n = String(name ?? '')
  return SWEET_DISH.test(n) || (SWEET_MARKER.test(n) && !SAVORY_MARKER.test(n))
}

// The axes a single PANTRY ITEM can supply, so the prompt can tell the model what it has to season
// with — in the same vocabulary the ranker measures, so the shelf it is shown and the count it is
// judged by agree. "fat" is not an axis: it is the other half of the aromatic one ("garlic in oil",
// "browned butter"), listed so the model pairs an aromatic with something to cook it in.
export type ShelfSlot = Axis | 'fat'
// Nut and seed butters are spreads, not cooking fats. FAT matches "butter" inside them.
const SPREAD_BUTTER = /\b(peanut|almond|cashew|nut|seed|sunflower|cookie|granola|apple|cocoa)\s+butter\b/i
export function itemAxes(name: unknown): ShelfSlot[] {
  const n = String(name ?? '').toLowerCase().trim()
  if (!n) return []
  const out: ShelfSlot[] = []
  if (ACID.test(n)) out.push('acid')
  if (HEAT.test(n) || BARE_PEPPER.test(n)) out.push('heat')
  if (UMAMI.test(n)) out.push('umami')
  if (AROMATIC_FAT.test(n) || (AROMATIC.test(n) && !POWDER.test(n))) out.push('aromatic')
  if (FAT.test(n) && !AROMATIC_FAT.test(n) && !SPREAD_BUTTER.test(n)) out.push('fat')
  return out
}

/** The pantry's own seasoning shelf, grouped by what each item can do. Names kept as the user wrote them. */
export function flavourShelf(items: readonly unknown[]): Record<ShelfSlot, string[]> {
  const shelf: Record<ShelfSlot, string[]> = { acid: [], heat: [], umami: [], aromatic: [], fat: [] }
  const seen = new Set<string>()
  for (const raw of items) {
    const name = String((raw as any)?.name ?? raw ?? '').trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    for (const slot of itemAxes(name)) shelf[slot].push(name)
  }
  return shelf
}
