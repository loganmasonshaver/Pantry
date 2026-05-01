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
  'Meat & Fish': ['chicken', 'beef', 'steak', 'pork', 'turkey', 'lamb', 'ground beef', 'ground turkey', 'sausage', 'bacon', 'ham', 'salmon', 'tuna', 'shrimp', 'fish', 'tilapia', 'cod', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'anchovy', 'sardine', 'brisket', 'rib', 'wing', 'thigh', 'breast', 'drumstick', 'tenderloin', 'filet', 'chorizo', 'prosciutto', 'pepperoni', 'deli meat', 'hot dog', 'duck', 'bison', 'tofu', 'tempeh'],
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

// returns an array because one item can match multiple categories (e.g. "peanut butter" hits both Canned & Nuts)
export function autoCategoryMatches(itemName: string): string[] {
  const lower = itemName.toLowerCase()
  const matches: string[] = []
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) matches.push(category) // substring match so "chicken breast" matches keyword "chicken"
  }
  return matches
}
