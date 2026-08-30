// Integrity checks for an extracted creator recipe, run before it is allowed into trending_meals.
//
// The retention gate next to these compares COUNTS — the model's ingredient count against the
// count parseIngredientBlock pulled out of the video description. That is blind in two directions
// this file closes:
//
//   * Junk counts. A section heading ("Składniki"), a macro line ("Kalorien: 504 kcal") or a
//     boilerplate line ("description tag") echoed into the ingredient list counts as an ingredient,
//     so a model that copies the raw description block passes the count check trivially. Five stored
//     meals had exactly this, all of them stamped source_verified.
//   * Identity. Three ingredients satisfy "three or more" whether or not they are the RIGHT three.
//     A real stored meal, "Blueberry-Lemon High-Protein Pancakes" (source video bp3sXQKLMqg,
//     "Fluffy High-protein Blueberry Pancakes🫐🍋"), kept Eggs, Greek yogurt and Maple syrup —
//     no blueberries, no lemon, no flour — and was stamped verified.
//
// Deliberately NOT done here: inferring drops from macros. Measured against the live pool of 168,
// the ratio of claimed calories to what the ingredients can produce puts known-bad meals at
// 0.98-2.03x, sitting inside the clean distribution (p50 1.07, p75 1.53). A threshold catching
// half of them rejects a third of the feed. The macro table is too approximate and a dropped
// berry too cheap for that signal to separate.

// ── Junk lines ───────────────────────────────────────────────────────────────────────────────
// Text that appears in a description's ingredient block but is not an ingredient. Kept narrow:
// anything matching here is DISCARDED, so a false positive silently shortens a real recipe.
const NON_INGREDIENT_PATTERNS: RegExp[] = [
  /\b\d+\s*(kcal|kj|calories|cals)\b/i,                                  // "504 kcal"
  /\b(protein|carbs?|carbohydrates?|fats?|kalorien|eiweiß|eiweiss|makro\w*)\s*[:=]/i, // "Protein: 51g"
  /^(zutaten|ingredienti|ingr[ée]dients?|ingredients?|składniki|makroskładniki|przepis|recept\w*)\b/i, // headings, incl. localized
  // No \b here: JS word boundaries are ASCII-only, so \b never matches before "Ł" or after "ś"
  // and the guard silently did nothing on the very rows it was written for.
  /(składniki|makroskładniki|łap\s+przepis|zutaten|przepis)/i,
  /https?:\/\/|www\.|\B@\w+/i,                                            // links and handles
  /\b(description tag|ingredients? label|full recipe|subscribe|follow me|link in bio|shop my|use code)\b/i,
  /^[\s\W\d]*$/,                                                          // punctuation/numbers only
  // Instruction text. Creators write steps inside the ingredient block ("Season with: salt, black
  // pepper, and garlic powder.", "Cook eggs") and the model carries them through as ingredients.
  /^\s*(season|mix|add|preheat|combine|stir|whisk|bake|cook|serve|top|garnish|blend|pour|heat|repeat|optional)\b/i,
]

/** True when a line is plainly not a food item — a heading, a macro summary, a link, boilerplate. */
export function isNonIngredientLine(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return true
  return NON_INGREDIENT_PATTERNS.some(re => re.test(t))
}

/** Ingredient entries with the junk removed. Accepts objects or bare strings. */
export function realIngredients<T>(ingredients: T[] | undefined): T[] {
  return (ingredients || []).filter(i => {
    const name = typeof i === 'string' ? i : String((i as any)?.name ?? '')
    return !isNonIngredientLine(name)
  })
}

// ── Name / ingredient coherence ──────────────────────────────────────────────────────────────
// A dish named for a food that appears nowhere in its ingredients is missing a defining component.
// This is the direct evidence of a drop, and unlike the macro route it needs no estimation.

// Singularise so blueberry/blueberries, potato/potatoes, oat/oats collapse to one token. Bespoke
// rather than a stemmer: it must never merge two different foods, so it only strips plurals.
function singular(w: string): string {
  const s = w.toLowerCase()
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y'   // blueberries -> blueberry
  // -oes is its own rule: without it "potatoes" stemmed to "potatoe" and three stored meals
  // reported a missing potato while listing potatoes.
  if (s.endsWith('oes') && s.length > 4) return s.slice(0, -2)         // potatoes -> potato
  if (/(?:s|x|z|ch|sh)es$/.test(s) && s.length > 4) return s.slice(0, -2) // dishes -> dish
  if (s.endsWith('ss')) return s                                        // glass stays glass
  if (s.endsWith('s') && s.length > 3) return s.slice(0, -1)           // oats -> oat, dates -> date
  return s
}

const tokens = (t: string): Set<string> =>
  new Set((t ?? '').toLowerCase().match(/[a-zÀ-ɏ]+/g)?.map(singular) ?? [])

// Foods distinctive enough that naming a dish after one is a promise about its contents. Excludes
// preparation words (baked, crispy), vessels (bowl, wrap) and vague ones (berry, veggie).
const DEFINING_FOODS = [
  'blueberry', 'strawberry', 'raspberry', 'blackberry', 'cranberry', 'banana', 'mango', 'pineapple',
  'apple', 'peach', 'cherry', 'lemon', 'lime', 'orange', 'avocado', 'pumpkin', 'zucchini',
  'spinach', 'broccoli', 'mushroom', 'carrot', 'tomato', 'cucumber', 'potato', 'corn',
  'chicken', 'beef', 'steak', 'pork', 'bacon', 'sausage', 'turkey', 'lamb', 'salmon', 'tuna',
  'shrimp', 'cod', 'tofu', 'tempeh', 'chickpea', 'lentil',
  'feta', 'mozzarella', 'cheddar', 'parmesan', 'ricotta', 'halloumi',
  'oat', 'rice', 'quinoa', 'pasta', 'noodle', 'tortilla', 'couscous',
  'chocolate', 'peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'coconut',
  'honey', 'maple', 'cinnamon', 'vanilla', 'matcha', 'coffee', 'espresso', 'caramel',
  'pesto', 'salsa', 'hummus', 'ranch', 'oreo', 'biscoff', 'nutella', 'date', 'fig', 'raisin',
]

// Words a creator legitimately uses for the same thing. Without these the check reports drops that
// are really synonyms — "cocoa powder" for chocolate, "curd"/"skyr" for yogurt, "fettuccine" for
// pasta. Each entry here is a false positive observed in the live pool.
const SYNONYMS: Record<string, string[]> = {
  chocolate: ['cocoa', 'cacao', 'choc', 'chocolat'],
  pasta: ['fettuccine', 'spaghetti', 'penne', 'macaroni', 'linguine', 'rigatoni', 'bowtie', 'farfalle', 'orzo', 'lasagna'],
  noodle: ['ramen', 'udon', 'soba', 'fettuccine', 'spaghetti'],
  oat: ['oatmeal', 'porridge', 'haferflocken', 'rolled'],
  coffee: ['espresso', 'mocha', 'flexpresso'],
  espresso: ['coffee', 'mocha'],
  steak: ['sirloin', 'ribeye', 'strip', 'flank', 'beef'],
  beef: ['steak', 'sirloin', 'ribeye', 'mince', 'ground'],
  chicken: ['poultry'],
  peanut: ['pb'],
  maple: ['syrup'],
  honey: ['syrup'],
  corn: ['mais', 'sweetcorn'],
  blueberry: ['borówki', 'borówka'],
  ranch: ['dressing'],
  date: ['medjool'],
}

/**
 * Foods promised by the dish name that appear nowhere in its ingredients.
 * Empty array means the name is supported by the list.
 */
export function nameIngredientGaps(name: string, ingredients: any[] | undefined): string[] {
  const nameTokens = tokens(name)
  if (nameTokens.size === 0) return []
  const ingText = realIngredients(ingredients)
    .map(i => (typeof i === 'string' ? i : String((i as any)?.name ?? '')))
    .join(' ')
  const ingTokens = tokens(ingText)
  if (ingTokens.size === 0) return [] // nothing to judge against; the count gate handles empties

  const gaps: string[] = []
  for (const food of DEFINING_FOODS) {
    const stem = singular(food)
    if (!nameTokens.has(stem)) continue
    if (ingTokens.has(stem)) continue
    if ((SYNONYMS[food] ?? []).some(alt => ingTokens.has(singular(alt)))) continue
    gaps.push(food)
  }
  return gaps
}

/**
 * The list used for the retention COUNT: junk removed and duplicates collapsed.
 *
 * Duplicates are not merely untidy here, they are mechanically load-bearing. The gate asks whether
 * the model kept at least as many ingredients as the parser found, so listing "olive oil spray" or
 * "garlic powder" twice buys a free point toward that threshold. Seven meals in the live pool carry
 * a repeated ingredient.
 *
 * Only the count is deduplicated. What gets STORED keeps its duplicates, because "1 egg for the
 * batter, 1 egg for the wash" is a real thing a recipe says and collapsing it would change the
 * quantities a cook follows.
 */
export function countedIngredients(ingredients: any[] | undefined): any[] {
  const seen = new Set<string>()
  const out: any[] = []
  for (const i of realIngredients(ingredients)) {
    const key = String((typeof i === 'string' ? i : i?.name) ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(i)
  }
  return out
}
