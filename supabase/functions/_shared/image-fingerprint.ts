// The foods a PHOTO of a recipe would show, reduced to a cache-key fragment.
//
// The image cache was keyed by the meal NAME alone, and Cook Tonight produces the same generic
// names from every pantry that holds the same staples. "Egg White and Vegetable Scramble" was
// generated on 2026-09-02 with potatoes, cauliflower, cheese and paprika, and again on 09-13 with
// greens and onion — the second was served the first one's photo, paprika visible and no greens.
// 19 of the 141 meals generated in that window were served an image older than the meal itself,
// and the collision rate rises with users, not falls: every pantry with egg whites names the
// scramble the same way.
//
// The fingerprint is the first three ingredients a photo would show, normalised so wording alone
// never buys a second image: quantities, units, prep words, cooking methods and colours are
// stripped, plurals folded, and anything a photo cannot show is dropped — the assumed staples
// (salt, oil, butter, spices), liquids that dissolve (broth, vinegar, juices, soy sauce) and the
// flavourings image-colour.ts already treats as invisible. Every caller sends names only, so it is
// the FIRST three in recipe order rather than the heaviest three: the model lists the mains first
// (row 601: egg whites, greens, onion, then butter, salt, pepper) and the trending pipeline sends
// the creator's list, which opens the same way. Sorted, so two orderings of the same mains match.
//
// Deliberately lossy in the same direction as the name key: "yellow potatoes" and "red potatoes"
// are one photo, "chicken salad" and "chicken" are two.

import { INVISIBLE_INGREDIENT } from './image-colour.ts'

// Same rules as the meal-name cache key in generate-meal-image, which imports this so the two
// cannot drift. Guarded against words that merely end in s (hummus, couscous, swiss).
export function singularize(w: string): string {
  // NOT guarding on -os: tacos/burritos are real plurals. Only ss/us/is are the false friends.
  if (w.length < 4 || /(?:ss|us|is)$/.test(w)) return w
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/oes$/.test(w)) return w.slice(0, -2)          // potatoes -> potato
  if (/(?:ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2)
  return w.endsWith('s') ? w.slice(0, -1) : w
}

// Words that change nothing about WHICH food is on the plate. "ground" and "smoked" are kept on
// purpose: ground beef and a steak, smoked salmon and a fillet, are different photographs.
// "sweet" too — a sweet potato is not a potato.
const DROP_WORDS = new Set([
  // measures and containers
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons', 'g', 'gram',
  'grams', 'kg', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'ml', 'l', 'liter',
  'liters', 'litre', 'litres', 'slice', 'slices', 'piece', 'pieces', 'clove', 'cloves', 'scoop',
  'scoops', 'handful', 'handfuls', 'pinch', 'pinches', 'dash', 'can', 'cans', 'pack', 'packs',
  'packet', 'packets', 'bag', 'bags', 'container', 'stalk', 'stalks', 'sprig', 'sprigs', 'head',
  'heads', 'bunch', 'fillet', 'fillets', 'breast', 'breasts', 'thigh', 'thighs', 'patty', 'patties',
  // sizes and eyeball units
  'large', 'medium', 'small', 'whole', 'half', 'quarter', 'fist', 'palm', 'thumb', 'sized', 'size',
  'x', 'mini', 'jumbo', 'baby',
  // filler
  'of', 'to', 'taste', 'and', 'or', 'the', 'a', 'an', 'with', 'plus', 'about', 'approx',
  'approximately', 'optional', 'for', 'serving',
  // state and grade
  'fresh', 'raw', 'cooked', 'dry', 'dried', 'uncooked', 'liquid', 'plain', 'nonfat', 'non', 'fat',
  'free', 'low', 'reduced', 'skim', 'boneless', 'skinless', 'lean', 'organic', 'unsalted', 'salted',
  'light', 'lite', 'extra', 'virgin', 'ripe', 'frozen', 'canned', 'jarred', 'thawed', 'precooked',
  'pre', 'leftover', 'leftovers', 'hot', 'cold', 'warm', 'room', 'temperature', 'greek',
  'unsweetened', 'sweetened', 'vanilla', 'sparkling', 'instant', 'quick',
  // knife work and cooking methods — the NAME key keeps methods, the fingerprint asks only which food
  'diced', 'chopped', 'sliced', 'minced', 'grated', 'shredded', 'cubed', 'crushed', 'julienned',
  'mashed', 'melted', 'softened', 'beaten', 'whisked', 'peeled', 'trimmed', 'halved', 'quartered',
  'smashed', 'blended', 'pureed', 'torn', 'cut', 'caramelized', 'caramelised', 'glazed', 'seasoned',
  'grilled', 'roasted', 'baked', 'fried', 'seared', 'toasted', 'scrambled', 'poached', 'steamed',
  'sauteed', 'sautéed', 'braised', 'brewed',
  // colours — "orange" is a fruit and stays
  'red', 'green', 'yellow', 'white', 'brown', 'black', 'purple', 'golden',
])

// An item made ONLY of these words is not in the photo: the assumed kitchen staples, spices, and
// the liquids and condiments that dissolve into a dish.
const STAPLE_WORDS = new Set([
  'salt', 'pepper', 'oil', 'butter', 'flour', 'sugar', 'water', 'ice', 'cube', 'cubes', 'seasoning',
  'spice', 'spices', 'flake', 'paprika', 'cumin', 'oregano', 'basil', 'cinnamon', 'thyme',
  'rosemary', 'turmeric', 'nutmeg', 'coriander', 'garlic', 'ginger', 'vinegar', 'broth', 'stock',
  'bouillon', 'honey', 'syrup', 'cornstarch', 'starch', 'juice', 'zest', 'lemon', 'lime', 'mustard',
  'ketchup', 'mayo', 'mayonnaise', 'sriracha', 'tamari', 'miso', 'worcestershire', 'soy', 'spray',
  'cooking',
])
// Multi-word staples whose parts are real foods elsewhere ("olive" in a salad, "fish" on a plate).
const STAPLE_ITEMS = new Set([
  'olive oil', 'vegetable oil', 'canola oil', 'coconut oil', 'sesame oil', 'avocado oil',
  'cooking oil', 'cooking spray', 'sea salt', 'kosher salt', 'table salt', 'garlic powder',
  'onion powder', 'chili powder', 'chilli powder', 'curry powder', 'baking powder', 'baking soda',
  'soy sauce', 'fish sauce', 'oyster sauce', 'hot sauce', 'worcestershire sauce', 'hoisin sauce',
  'italian seasoning', 'taco seasoning', 'maple syrup', 'peanut oil',
])
// Whatever it is made from, it ends up a liquid or a dusting: "chicken broth", "apple cider
// vinegar", "orange juice", "everything bagel seasoning".
const INVISIBLE_LAST_WORD = new Set(['broth', 'stock', 'bouillon', 'vinegar', 'juice', 'zest', 'seasoning', 'spice'])

function photoItem(raw: unknown): string | null {
  const text = String(raw ?? '')
  if (!text.trim() || INVISIBLE_INGREDIENT.test(text)) return null
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w && !/\d/.test(w) && !DROP_WORDS.has(w))   // a token with a digit is a quantity
    .map(singularize)
  if (words.length === 0) return null
  const item = words.join(' ')
  if (STAPLE_ITEMS.has(item)) return null
  if (words.every(w => STAPLE_WORDS.has(w))) return null
  if (INVISIBLE_LAST_WORD.has(words[words.length - 1])) return null
  return item
}

// Accepts the shapes every caller already sends: bare strings ("3 eggs", "1 slice American
// cheese") or {name} objects. Empty when nothing in the list would show in a photo — the caller
// then falls back to the name-only key, which is also what a request with no ingredients gets.
export function imageFingerprint(ingredients: readonly unknown[] | undefined, take = 3): string {
  const mains: string[] = []
  for (const ing of Array.isArray(ingredients) ? ingredients : []) {
    const item = photoItem(typeof ing === 'object' && ing !== null ? (ing as any).name : ing)
    if (item && !mains.includes(item)) mains.push(item)
    if (mains.length === take) break
  }
  return mains.sort().join('+')
}
