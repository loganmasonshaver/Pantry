// Ordered like a grocery store walkthrough
export const STORE_CATEGORIES = [
  'Produce', 'Bakery', 'Meat & Fish', 'Dairy & Eggs', 'Frozen',
  'Grains & Pasta', 'Canned & Jarred', 'Snacks', 'Condiments & Sauces', 'Beverages', 'Other',
]

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Produce': ['apple', 'banana', 'orange', 'lemon', 'lime', 'avocado', 'tomato', 'potato', 'onion', 'garlic', 'ginger', 'pepper', 'jalapeño', 'habanero', 'serrano', 'poblano', 'lettuce', 'spinach', 'kale', 'arugula', 'broccoli', 'cauliflower', 'carrot', 'celery', 'cucumber', 'zucchini', 'squash', 'corn', 'mushroom', 'asparagus', 'green bean', 'pea', 'edamame', 'cabbage', 'beet', 'radish', 'sweet potato', 'yam', 'eggplant', 'artichoke', 'berry', 'blueberry', 'strawberry', 'raspberry', 'grape', 'melon', 'watermelon', 'mango', 'pineapple', 'peach', 'pear', 'plum', 'kiwi', 'papaya', 'coconut', 'fig', 'date', 'herb', 'basil', 'cilantro', 'parsley', 'mint', 'rosemary', 'thyme', 'dill', 'scallion', 'green onion', 'chive', 'salad', 'fruit', 'vegetable'],
  'Bakery': ['bread', 'bagel', 'roll', 'bun', 'croissant', 'muffin', 'tortilla', 'pita', 'naan', 'wrap', 'english muffin', 'baguette', 'sourdough', 'ciabatta', 'flatbread'],
  'Meat & Fish': ['chicken', 'beef', 'steak', 'pork', 'turkey', 'lamb', 'ground', 'sausage', 'bacon', 'ham', 'salmon', 'tuna', 'shrimp', 'fish', 'tilapia', 'cod', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'anchovy', 'sardine', 'brisket', 'rib', 'wing', 'thigh', 'breast', 'drumstick', 'tenderloin', 'filet', 'chorizo', 'prosciutto', 'pepperoni', 'deli meat', 'hot dog'],
  'Dairy & Eggs': ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'sour cream', 'cottage cheese', 'cream cheese', 'ricotta', 'mozzarella', 'parmesan', 'cheddar', 'feta', 'gouda', 'brie', 'swiss', 'provolone', 'half and half', 'whipping cream', 'ghee', 'kefir'],
  'Frozen': ['frozen', 'ice cream', 'pizza roll', 'frozen fruit', 'frozen vegetable', 'frozen meal', 'popsicle', 'waffle', 'tater tot', 'french fry'],
  'Grains & Pasta': ['rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'macaroni', 'fettuccine', 'linguine', 'orzo', 'couscous', 'quinoa', 'oat', 'oatmeal', 'granola', 'cereal', 'flour', 'cornmeal', 'barley', 'bulgur', 'farro', 'lentil', 'bean', 'chickpea', 'black bean', 'kidney bean', 'pinto bean'],
  'Canned & Jarred': ['canned', 'can of', 'tomato sauce', 'tomato paste', 'diced tomato', 'crushed tomato', 'broth', 'stock', 'soup', 'coconut milk', 'salsa', 'pickle', 'jam', 'jelly', 'peanut butter', 'almond butter', 'nutella', 'honey', 'maple syrup', 'applesauce'],
  'Snacks': ['chip', 'cracker', 'pretzel', 'popcorn', 'nut', 'almond', 'walnut', 'cashew', 'peanut', 'pistachio', 'trail mix', 'granola bar', 'protein bar', 'dried fruit', 'jerky', 'cookie', 'chocolate'],
  'Condiments & Sauces': ['ketchup', 'mustard', 'mayo', 'mayonnaise', 'hot sauce', 'soy sauce', 'teriyaki', 'bbq sauce', 'barbecue', 'sriracha', 'vinegar', 'oil', 'olive oil', 'coconut oil', 'sesame oil', 'dressing', 'ranch', 'marinade', 'worcestershire', 'fish sauce', 'hoisin', 'tahini', 'hummus', 'guacamole', 'salad dressing', 'spice', 'seasoning', 'salt', 'pepper', 'cumin', 'paprika', 'turmeric', 'cinnamon', 'oregano', 'chili powder', 'curry', 'sugar', 'baking soda', 'baking powder', 'vanilla', 'extract'],
  'Beverages': ['water', 'juice', 'soda', 'coffee', 'tea', 'kombucha', 'beer', 'wine', 'seltzer', 'sparkling', 'lemonade', 'smoothie', 'protein shake', 'almond milk', 'oat milk', 'soy milk', 'coconut water', 'energy drink', 'gatorade', 'electrolyte'],
}

export function autoCategoryMatches(itemName: string): string[] {
  const lower = itemName.toLowerCase()
  const matches: string[] = []
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) matches.push(category)
  }
  return matches
}
