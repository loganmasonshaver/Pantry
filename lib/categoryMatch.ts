// Pure grocery-category matching. Split out of categories.ts, which imports the Supabase client
// and therefore cannot be unit-tested — and this is keyword matching over user- and model-written
// food names, exactly the kind of code that needs tests.

// Ordered like a grocery store walkthrough
export const STORE_CATEGORIES = [
  'Produce', 'Bakery', 'Meat & Fish', 'Dairy & Eggs', 'Frozen',
  'Grains & Pasta', 'Legumes', 'Canned & Jarred', 'Nuts & Seeds',
  'Snacks', 'Sauces & Condiments', 'Spices & Seasonings',
  'Oils & Vinegars', 'Baking', 'Beverages', 'Other',
]

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Produce': ['apple', 'banana', 'orange', 'lemon', 'lime', 'avocado', 'tomato', 'potato', 'onion', 'garlic', 'ginger', 'pepper', 'jalapeño', 'habanero', 'serrano', 'poblano', 'lettuce', 'spinach', 'kale', 'arugula', 'broccoli', 'cauliflower', 'carrot', 'celery', 'cucumber', 'zucchini', 'squash', 'corn', 'mushroom', 'asparagus', 'green bean', 'pea', 'edamame', 'cabbage', 'beet', 'radish', 'sweet potato', 'yam', 'eggplant', 'artichoke', 'berry', 'blueberry', 'strawberry', 'raspberry', 'grape', 'melon', 'watermelon', 'mango', 'pineapple', 'peach', 'pear', 'plum', 'kiwi', 'papaya', 'coconut', 'fig', 'date', 'basil', 'cilantro', 'parsley', 'mint', 'rosemary', 'thyme', 'dill', 'scallion', 'green onion', 'chive', 'salad', 'fruit', 'vegetable', 'fennel', 'leek', 'shallot', 'turnip', 'bok choy', 'watercress'],
  'Bakery': ['bread', 'bagel', 'roll', 'bun', 'croissant', 'muffin', 'tortilla', 'pita', 'naan', 'wrap', 'english muffin', 'baguette', 'sourdough', 'ciabatta', 'flatbread', 'pancake mix', 'waffle mix'],
  'Meat & Fish': ['chicken', 'beef', 'steak', 'pork', 'turkey', 'lamb', 'ground beef', 'ground turkey', 'ground chicken', 'sausage', 'bacon', 'ham', 'salmon', 'tuna', 'shrimp', 'fish', 'tilapia', 'cod', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'anchovy', 'sardine', 'brisket', 'rib', 'wing', 'thigh', 'breast', 'drumstick', 'tenderloin', 'filet', 'chorizo', 'prosciutto', 'pepperoni', 'deli meat', 'hot dog', 'duck', 'bison', 'tofu', 'tempeh', 'sirloin', 'ribeye', 'rib-eye', 'flank', 'skirt', 'chuck', 'porterhouse', 't-bone', 'meatball', 'patty', 'hamburger', 'veal', 'venison', 'gyro', 'kebab', 'kabob'],
  'Dairy & Eggs': ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'sour cream', 'cottage cheese', 'cream cheese', 'ricotta', 'mozzarella', 'parmesan', 'cheddar', 'feta', 'gouda', 'brie', 'swiss', 'provolone', 'half and half', 'whipping cream', 'heavy cream', 'ghee', 'kefir', 'goat cheese'],
  'Frozen': ['frozen', 'ice cream', 'pizza roll', 'frozen fruit', 'frozen vegetable', 'frozen meal', 'popsicle', 'tater tot', 'french fry'],
  'Grains & Pasta': ['rice', 'brown rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'macaroni', 'fettuccine', 'linguine', 'orzo', 'couscous', 'quinoa', 'oat', 'oatmeal', 'granola', 'cereal', 'cornmeal', 'barley', 'bulgur', 'farro', 'breadcrumb', 'panko'],
  'Legumes': ['lentil', 'bean', 'chickpea', 'black bean', 'kidney bean', 'pinto bean', 'white bean', 'navy bean', 'lima bean', 'split pea', 'black-eyed pea', 'garbanzo'],
  'Canned & Jarred': ['canned', 'can of', 'tomato sauce', 'tomato paste', 'diced tomato', 'crushed tomato', 'broth', 'stock', 'soup', 'coconut milk', 'salsa', 'pickle', 'jam', 'jelly', 'peanut butter', 'almond butter', 'nutella', 'applesauce', 'olives', 'capers', 'sundried tomato', 'roasted red pepper'],
  'Nuts & Seeds': ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'macadamia', 'pine nut', 'peanut', 'sunflower seed', 'pumpkin seed', 'chia seed', 'flax seed', 'sesame seed', 'hemp seed', 'trail mix'],
  'Snacks': ['chip', 'cracker', 'pretzel', 'popcorn', 'granola bar', 'protein bar', 'dried fruit', 'jerky', 'cookie', 'chocolate', 'candy', 'rice cake'],
  'Sauces & Condiments': ['ketchup', 'mustard', 'mayo', 'mayonnaise', 'hot sauce', 'soy sauce', 'teriyaki', 'bbq sauce', 'barbecue', 'sriracha', 'dressing', 'ranch', 'marinade', 'worcestershire', 'fish sauce', 'hoisin', 'tahini', 'hummus', 'guacamole', 'salad dressing', 'salsa verde', 'pesto', 'buffalo sauce'],
  'Spices & Seasonings': ['salt', 'pepper', 'black pepper', 'cumin', 'paprika', 'turmeric', 'cinnamon', 'oregano', 'chili powder', 'curry powder', 'garam masala', 'cayenne', 'nutmeg', 'garlic powder', 'onion powder', 'italian seasoning', 'bay leaf', 'coriander', 'cardamom', 'cloves', 'star anise', 'saffron', 'red pepper flakes', 'everything bagel seasoning', 'taco seasoning', 'spice', 'seasoning'],
  'Oils & Vinegars': ['oil', 'olive oil', 'coconut oil', 'sesame oil', 'vegetable oil', 'avocado oil', 'canola oil', 'vinegar', 'balsamic vinegar', 'apple cider vinegar', 'rice vinegar', 'red wine vinegar', 'white vinegar', 'cooking spray'],
  'Baking': ['flour', 'sugar', 'brown sugar', 'powdered sugar', 'baking soda', 'baking powder', 'vanilla', 'vanilla extract', 'cocoa powder', 'chocolate chip', 'cornstarch', 'yeast', 'gelatin', 'honey', 'maple syrup', 'agave', 'molasses', 'extract'],
  'Beverages': ['water', 'juice', 'soda', 'coffee', 'tea', 'kombucha', 'beer', 'wine', 'seltzer', 'sparkling', 'lemonade', 'smoothie', 'protein shake', 'almond milk', 'oat milk', 'soy milk', 'coconut water', 'energy drink', 'gatorade', 'electrolyte', 'protein powder'],
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
