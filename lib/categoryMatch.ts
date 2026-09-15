// Pure grocery-category matching. Split out of categories.ts, which imports the Supabase client
// and therefore cannot be unit-tested — and this is keyword matching over user- and model-written
// food names, exactly the kind of code that needs tests.

// A bare "pepper" is the spice: Produce lists only the qualified vegetable ("bell pepper", "red
// pepper" …), so the one-word name no longer ties between two aisles and falls to whichever was
// declared first. "red pepper flakes" still wins for Spices on keyword length.
// Ordered like a grocery store walkthrough
export const STORE_CATEGORIES = [
  'Produce', 'Bakery', 'Meat & Fish', 'Dairy & Eggs', 'Frozen',
  'Grains & Pasta', 'Legumes', 'Canned & Jarred', 'Nuts & Seeds',
  'Snacks', 'Sauces & Condiments', 'Spices & Seasonings',
  'Oils & Vinegars', 'Baking', 'Beverages', 'Other',
]

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Produce': ['apple', 'banana', 'orange', 'lemon', 'lime', 'avocado', 'tomato', 'potato', 'onion', 'garlic', 'ginger', 'bell pepper', 'red pepper', 'green pepper', 'yellow pepper', 'orange pepper', 'sweet pepper', 'banana pepper', 'chili pepper', 'hot pepper', 'jalapeño', 'habanero', 'serrano', 'poblano', 'lettuce', 'spinach', 'kale', 'arugula', 'broccoli', 'cauliflower', 'carrot', 'celery', 'cucumber', 'zucchini', 'squash', 'corn', 'mushroom', 'asparagus', 'green bean', 'pea', 'edamame', 'cabbage', 'beet', 'radish', 'sweet potato', 'yam', 'eggplant', 'artichoke', 'berry', 'blueberry', 'strawberry', 'raspberry', 'grape', 'melon', 'watermelon', 'mango', 'pineapple', 'peach', 'pear', 'plum', 'kiwi', 'papaya', 'coconut', 'fig', 'date', 'basil', 'cilantro', 'parsley', 'mint', 'rosemary', 'thyme', 'dill', 'scallion', 'green onion', 'chive', 'salad', 'fruit', 'vegetable', 'fennel', 'leek', 'shallot', 'turnip', 'bok choy', 'watercress'],
  'Bakery': ['bread', 'bagel', 'roll', 'bun', 'croissant', 'muffin', 'tortilla', 'pita', 'naan', 'wrap', 'english muffin', 'baguette', 'sourdough', 'ciabatta', 'flatbread', 'pancake mix', 'waffle mix'],
  'Meat & Fish': ['chicken', 'beef', 'steak', 'pork', 'turkey', 'lamb', 'ground beef', 'ground turkey', 'ground chicken', 'sausage', 'bacon', 'ham', 'salmon', 'tuna', 'shrimp', 'fish', 'tilapia', 'cod', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'anchovy', 'sardine', 'brisket', 'rib', 'wing', 'thigh', 'breast', 'drumstick', 'tenderloin', 'filet', 'chorizo', 'prosciutto', 'pepperoni', 'deli meat', 'hot dog', 'duck', 'bison', 'tofu', 'tempeh', 'sirloin', 'ribeye', 'rib-eye', 'flank', 'skirt', 'chuck', 'porterhouse', 't-bone', 'meatball', 'patty', 'hamburger', 'veal', 'venison', 'gyro', 'kebab', 'kabob'],
  'Dairy & Eggs': ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'creamer', 'egg', 'egg white', 'sour cream', 'cottage cheese', 'cream cheese', 'ricotta', 'mozzarella', 'parmesan', 'cheddar', 'feta', 'gouda', 'brie', 'swiss', 'provolone', 'half and half', 'whipping cream', 'heavy cream', 'ghee', 'kefir', 'goat cheese'],
  'Frozen': ['frozen', 'ice cream', 'pizza roll', 'frozen fruit', 'frozen vegetable', 'frozen meal', 'popsicle', 'tater tot', 'french fry'],
  'Grains & Pasta': ['rice', 'brown rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'macaroni', 'fettuccine', 'linguine', 'orzo', 'couscous', 'quinoa', 'oat', 'oatmeal', 'granola', 'cereal', 'cornmeal', 'barley', 'bulgur', 'farro', 'breadcrumb', 'panko'],
  'Legumes': ['lentil', 'bean', 'chickpea', 'black bean', 'kidney bean', 'pinto bean', 'white bean', 'navy bean', 'lima bean', 'split pea', 'black-eyed pea', 'garbanzo'],
  'Canned & Jarred': ['canned', 'can of', 'tomato sauce', 'tomato paste', 'diced tomato', 'crushed tomato', 'broth', 'stock', 'soup', 'coconut milk', 'salsa', 'pickle', 'jam', 'jelly', 'peanut butter', 'almond butter', 'cashew butter', 'sunflower butter', 'seed butter', 'granola butter', 'cookie butter', 'nutella', 'applesauce', 'olives', 'capers', 'sundried tomato', 'roasted red pepper'],
  'Nuts & Seeds': ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'macadamia', 'pine nut', 'peanut', 'sunflower seed', 'pumpkin seed', 'chia seed', 'flax seed', 'sesame seed', 'hemp seed', 'trail mix'],
  'Snacks': ['chip', 'cracker', 'pretzel', 'popcorn', 'granola bar', 'protein bar', 'dried fruit', 'jerky', 'cookie', 'chocolate', 'candy', 'rice cake', 'snack'],
  'Sauces & Condiments': ['ketchup', 'mustard', 'mayo', 'mayonnaise', 'hot sauce', 'soy sauce', 'teriyaki', 'bbq sauce', 'barbecue', 'sriracha', 'dressing', 'ranch', 'marinade', 'worcestershire', 'fish sauce', 'hoisin', 'tahini', 'hummus', 'guacamole', 'salad dressing', 'salsa verde', 'pesto', 'buffalo sauce', 'relish', 'chutney', 'sauce'],
  'Spices & Seasonings': ['salt', 'pepper', 'black pepper', 'ground pepper', 'peppercorn', 'cumin', 'paprika', 'turmeric', 'cinnamon', 'oregano', 'chili powder', 'curry powder', 'garam masala', 'cayenne', 'nutmeg', 'garlic powder', 'onion powder', 'italian seasoning', 'bay leaf', 'coriander', 'cardamom', 'cloves', 'star anise', 'saffron', 'red pepper flakes', 'everything bagel seasoning', 'taco seasoning', 'spice', 'seasoning'],
  'Oils & Vinegars': ['oil', 'olive oil', 'coconut oil', 'sesame oil', 'vegetable oil', 'avocado oil', 'canola oil', 'vinegar', 'balsamic vinegar', 'apple cider vinegar', 'rice vinegar', 'red wine vinegar', 'white vinegar', 'cooking spray'],
  'Baking': ['flour', 'sugar', 'brown sugar', 'powdered sugar', 'baking soda', 'baking powder', 'vanilla', 'vanilla extract', 'cocoa powder', 'chocolate chip', 'cornstarch', 'yeast', 'gelatin', 'honey', 'maple syrup', 'agave', 'molasses', 'extract'],
  'Beverages': ['water', 'juice', 'soda', 'coffee', 'coffee bean', 'ground coffee', 'espresso', 'tea', 'kombucha', 'beer', 'wine', 'seltzer', 'sparkling', 'lemonade', 'smoothie', 'protein shake', 'almond milk', 'oat milk', 'soy milk', 'coconut water', 'energy drink', 'gatorade', 'electrolyte', 'protein powder'],
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Precompile regexes once: word-boundary match with optional plural (s / es).
// Word boundaries prevent false positives like "cod" matching "avacodo".
// Plural support keeps "scallops" matching keyword "scallop", "tomatoes" matching "tomato", etc.
const CATEGORY_REGEXES: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([cat, kws]) => [
    cat,
    kws.map(kw => new RegExp(`\\b${escapeRegex(kw)}(s|es)?\\b`, 'i')),
  ])
)

// returns an array because one item can match multiple categories (e.g. "peanut butter" hits both Canned & Nuts)
// Ordered MOST SPECIFIC FIRST, so categorizeItem's matches[0] is the best answer rather than
// whichever category happens to be declared earliest.
//
// This used to return declaration order, and Produce / Meat / Dairy sit at the top with very
// generic keywords — so "black pepper" filed under Produce (matching "pepper"), "coconut oil" under
// Produce, "peanut butter" under Dairy (matching "butter") and "chicken broth" under Meat. On a
// list whose whole purpose is to be ordered like a store walkthrough, that sends you to the wrong
// aisle. 11 of 14 common items were wrong.
//
// Ranking: the match that ENDS LATEST in the name wins, ties broken by longer keyword. English
// compound food names put the head noun last — "rice vinegar" is a vinegar, "chicken broth" is a
// broth — so the rightmost match is the item's actual identity and the leftmost is a modifier.
export function autoCategoryMatches(itemName: string): string[] {
  const lower = itemName.toLowerCase()
  const scored: Array<{ cat: string; end: number; len: number }> = []
  for (const [category, regexes] of Object.entries(CATEGORY_REGEXES)) {
    let best: { end: number; len: number } | null = null
    for (const rx of regexes) {
      const m = lower.match(rx)
      if (!m || m.index === undefined) continue
      const end = m.index + m[0].length
      if (!best || end > best.end || (end === best.end && m[0].length > best.len)) {
        best = { end, len: m[0].length }
      }
    }
    if (best) scored.push({ cat: category, ...best })
  }
  scored.sort((a, b) => (b.end - a.end) || (b.len - a.len))
  return scored.map(s => s.cat)
}

// Off-list category names seen in production, mapped to the canonical bucket they meant. These
// came from the scan prompt, whose only guidance on categories was two EXAMPLES using "Dairy" and
// "Carbs" — neither in STORE_CATEGORIES — so the model extrapolated its own vocabulary and wrote
// it straight to the database. Measured 2026-09-03: 97 of one user's in-stock items carried a
// category that does not exist in this file.
//
// The cost was not just cosmetic. CATEGORY_ICONS and CATEGORY_COLORS are keyed on STORE_CATEGORIES,
// so every off-list name fell through to the Package icon and grey — which is why the pantry read
// as a column of identical boxes. And "Condiments", "Condiments & Spices" and "Spices & Seasonings"
// rendered as three separate rows for overlapping food.
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  'dairy': 'Dairy & Eggs',
  'eggs': 'Dairy & Eggs',
  'carbs': 'Grains & Pasta',
  'grains': 'Grains & Pasta',
  'protein': 'Meat & Fish',
  'meat': 'Meat & Fish',
  'condiments': 'Sauces & Condiments',
  'condiments & spices': 'Sauces & Condiments',
  'sauces': 'Sauces & Condiments',
  'spices': 'Spices & Seasonings',
  'seasonings': 'Spices & Seasonings',
  'pantry staples': 'Other',
  'staples': 'Other',
  'fruits': 'Produce',
  'vegetables': 'Produce',
  'fruits & vegetables': 'Produce',
  'drinks': 'Beverages',
  'oils': 'Oils & Vinegars',
  'canned': 'Canned & Jarred',
  'nuts': 'Nuts & Seeds',
  'bread': 'Bakery',
}

/**
 * Coerce any category to one that actually exists, so icons, colours and grouping can rely on it.
 *
 * THE NAME DECIDES whenever the keyword table can read it. The model's category is kept only when
 * it is one of the aisles the name itself allows — there it is a tiebreaker ("Frozen Chicken
 * Nuggets": the name allows Frozen and Meat & Fish, the model saw the freezer) — and it is the
 * answer only for a name the table cannot read at all ("Chutney" before that keyword existed).
 *
 * This used to accept ANY category that exists in the list before looking at the name, and
 * "Other" is in the list. So the scan model's punt on "Brown Sugar" was written as-is while the
 * table would have said Baking; 12 of one user's 56 items (21%) sat in Other that way, and a
 * model that put "Eggs" in Meat & Fish and "salt" in Sauces was believed on all of them. Measured
 * across every user on 2026-09-15: 158 rows, ~50 filed under an aisle the name contradicts.
 */
export function normalizeCategory(rawCategory: unknown, itemName: string): string {
  const raw = String(rawCategory ?? '').trim()
  const byName = autoCategoryMatches(itemName)
  if (byName.length > 0) {
    if (raw !== 'Other' && STORE_CATEGORIES.includes(raw) && byName.includes(raw)) return raw
    return byName[0]
  }
  if (STORE_CATEGORIES.includes(raw)) return raw
  const alias = LEGACY_CATEGORY_ALIASES[raw.toLowerCase()]
  if (alias) return alias
  return 'Other'
}
