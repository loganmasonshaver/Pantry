// Pantries and profiles Cook Tonight was never tuned on.
//
// Every rule in generate-meals was calibrated against ONE pantry — Logan's 55 items, protein-heavy,
// two savory carbs — and several were written as direct reactions to its shape (the carb rule, the
// base ban, the egg exemption). A vegetarian's shelf, a student's twelve items and a keto fridge
// fail differently, and none of them has ever run.
//
// Item names are written the way a SCAN produces them (title case, brands, the odd duplicate), not
// the way a recipe writer would.

export const PANTRIES = {
  // The one everything was tuned on. The control.
  logan: ['Barbecue Sauce', 'Brown Sugar', 'Bulgarian Yogurt', 'Butter', 'Cauliflower', 'Chicken',
    'Chicken Salad', 'Chocolate Protein Bars', 'Chocolate Protein Powder', 'Cinnamon Granola Butter',
    'Coffee Beans', 'Coffee Creamer', 'Cooked Rice', 'Cookies', 'Cottage Cheese', 'Cream Cheese',
    'Eggs', 'Garlic', 'Granola', 'Ground Beef', 'Ground Pepper', 'Hot Sauce', 'Juice', 'Leafy Greens',
    'Lime', 'Liquid Egg Whites', 'Maple Syrup', 'Mayonnaise', 'Milk', 'Milk Chocolate Ice Cream Bars',
    'Non-Fat Plain Greek Yogurt', 'Oat Milk', 'Orange', 'Orange Juice', 'Pad Thai Sauce', 'Peanut Butter',
    'Pecans', 'Pesto', 'Pickles', 'Pineapple', 'Plantain Chips', 'Protein Cereal', 'Protein Powder',
    'Ranch Dressing', 'Red Potatoes', 'Salsa', 'Shredded Cheese', 'Soy Sauce', 'Sweet Relish', 'Syrup',
    'Tomato Sauce', 'Whipped Cream', 'Whole Milk Plain Yogurt', 'Yellow Onions', 'Yellow Potatoes', 'Yogurt'],

  // Twelve items. The shape of a first scan, and the one most likely to starve every gate at once.
  thin: ['Eggs', 'Cooked Rice', 'Yellow Onion', 'Garlic', 'Soy Sauce', 'Chicken Thighs',
    'Frozen Mixed Vegetables', 'Butter', 'Cheddar Cheese', 'Milk', 'Bread', 'Hot Sauce'],

  vegetarian: ['Eggs', 'Greek Yogurt', 'Cheddar Cheese', 'Feta', 'Milk', 'Black Beans', 'Chickpeas',
    'Red Lentils', 'Firm Tofu', 'Basmati Rice', 'Whole Wheat Pasta', 'Sourdough Bread', 'Spinach',
    'Bell Peppers', 'Zucchini', 'Cherry Tomatoes', 'Yellow Onion', 'Garlic', 'Lemon', 'Olive Oil',
    'Tahini', 'Cumin', 'Smoked Paprika', 'Tomato Paste', 'Frozen Peas'],

  vegan: ['Firm Tofu', 'Tempeh', 'Black Beans', 'Chickpeas', 'Red Lentils', 'Oat Milk',
    'Nutritional Yeast', 'Tahini', 'Peanut Butter', 'Jasmine Rice', 'Rice Noodles', 'Corn Tortillas',
    'Spinach', 'Broccoli', 'Carrots', 'Yellow Onion', 'Garlic', 'Ginger', 'Lime', 'Soy Sauce',
    'Sriracha', 'Coconut Milk', 'Curry Powder', 'Frozen Edamame', 'Avocado'],

  // No carb base at all. The `carbRequired` false branch has never run in production.
  keto: ['Ribeye Steak', 'Ground Beef', 'Chicken Thighs', 'Bacon', 'Eggs', 'Heavy Cream',
    'Cheddar Cheese', 'Cream Cheese', 'Butter', 'Olive Oil', 'Avocado', 'Cauliflower', 'Broccoli',
    'Spinach', 'Zucchini', 'Mushrooms', 'Yellow Onion', 'Garlic', 'Almonds', 'Pecans'],

  // Can it hit 40g+ honestly, or does it overload one ingredient until the numbers work?
  carbHeavy: ['White Rice', 'Spaghetti', 'White Bread', 'Bagels', 'Russet Potatoes', 'Corn Flakes',
    'Peanut Butter', 'Strawberry Jam', 'Milk', 'Sliced Cheese', 'Frozen Mixed Vegetables',
    'Canned Black Beans', 'Yellow Onion', 'Ketchup', 'Vegetable Oil', 'Bananas'],

  // Ready-to-eat only: nothing here may be "seared" or cooked from raw.
  prepped: ['Rotisserie Chicken', 'Deli Turkey', 'Canned Tuna', 'Hard-Boiled Eggs', 'Bagged Caesar Salad',
    'Hummus', 'Microwave Rice Pouches', 'Flour Tortillas', 'Shredded Cheese', 'Cherry Tomatoes',
    'Cucumber', 'Avocado', 'Greek Yogurt', 'Salsa', 'Pita Bread'],

  // Brands, typos, duplicates, a bare "Juice" — what a real scan returns on a bad day.
  messy: ['Kirkland Chicken Breast', 'chickn brst', 'Eggs', 'eggs (dozen)', 'Juice', 'Great Value Rice',
    'MINCED GARLIC', 'onion', 'Onions', "Trader Joe's Everything Bagel Seasoning", 'shredded chz',
    'Tomatos', 'olive oil spray', 'Frozen Brocolli', 'Soy Suace', 'Pasta (penne)', 'blk beans'],

  // 100+ items across cuisines. Does it still commit to ONE cuisine per dish?
  bigMixed: ['Chicken Breast', 'Chicken Thighs', 'Ground Beef', 'Ground Turkey', 'Pork Chops', 'Bacon',
    'Salmon Fillets', 'Shrimp', 'Canned Tuna', 'Eggs', 'Liquid Egg Whites', 'Greek Yogurt', 'Cottage Cheese',
    'Cheddar Cheese', 'Mozzarella', 'Parmesan', 'Feta', 'Cream Cheese', 'Heavy Cream', 'Milk', 'Butter',
    'Jasmine Rice', 'Brown Rice', 'Spaghetti', 'Penne', 'Rice Noodles', 'Soba Noodles', 'Corn Tortillas',
    'Flour Tortillas', 'Sourdough Bread', 'Naan', 'Pita', 'Quinoa', 'Couscous', 'Rolled Oats', 'Russet Potatoes',
    'Sweet Potatoes', 'Black Beans', 'Chickpeas', 'Red Lentils', 'Firm Tofu', 'Edamame', 'Spinach', 'Kale',
    'Romaine', 'Broccoli', 'Cauliflower', 'Carrots', 'Celery', 'Bell Peppers', 'Jalapeños', 'Zucchini',
    'Mushrooms', 'Cherry Tomatoes', 'Roma Tomatoes', 'Yellow Onion', 'Red Onion', 'Scallions', 'Garlic',
    'Ginger', 'Lemon', 'Lime', 'Cilantro', 'Parsley', 'Basil', 'Avocado', 'Frozen Peas', 'Frozen Corn',
    'Olive Oil', 'Sesame Oil', 'Vegetable Oil', 'Soy Sauce', 'Fish Sauce', 'Oyster Sauce', 'Hoisin',
    'Sriracha', 'Gochujang', 'Salsa', 'Tomato Paste', 'Canned Crushed Tomatoes', 'Marinara', 'Pesto',
    'Dijon Mustard', 'Mayonnaise', 'Ketchup', 'BBQ Sauce', 'Ranch Dressing', 'Balsamic Vinegar',
    'Rice Vinegar', 'Honey', 'Maple Syrup', 'Peanut Butter', 'Tahini', 'Coconut Milk', 'Chicken Stock',
    'Beef Stock', 'Curry Powder', 'Garam Masala', 'Cumin', 'Smoked Paprika', 'Chili Powder', 'Oregano',
    'Thyme', 'Rosemary', 'Bay Leaves', 'Cinnamon', 'Nutritional Yeast', 'Walnuts', 'Almonds', 'Sesame Seeds'],

  // Rice, noodles, aromatics. A cuisine with its own grammar.
  asian: ['Jasmine Rice', 'Rice Noodles', 'Udon', 'Firm Tofu', 'Chicken Thighs', 'Shrimp', 'Eggs',
    'Bok Choy', 'Napa Cabbage', 'Carrots', 'Scallions', 'Garlic', 'Ginger', 'Soy Sauce', 'Oyster Sauce',
    'Sesame Oil', 'Rice Vinegar', 'Sriracha', 'Miso Paste', 'Nori', 'Frozen Edamame', 'Shiitake Mushrooms'],
}

export const PROFILES = {
  standard: { calorieGoal: 2000, proteinGoal: 150, mealsPerDay: 3, cookingSkill: 'intermediate', maxPrepMinutes: 30 },
  // 467 kcal and 47g protein per meal. The tightest honest box.
  cutting: { calorieGoal: 1400, proteinGoal: 140, mealsPerDay: 3, cookingSkill: 'intermediate', maxPrepMinutes: 30 },
  // 800 kcal per meal — and 4 meals a day trips the multi-serving batch path.
  bulking: { calorieGoal: 3200, proteinGoal: 180, mealsPerDay: 4, cookingSkill: 'intermediate', maxPrepMinutes: 45 },
  // 50g protein inside 550 kcal, four times a day.
  highProtein: { calorieGoal: 2200, proteinGoal: 200, mealsPerDay: 4, cookingSkill: 'intermediate', maxPrepMinutes: 30 },
  // Beginner, 15 minutes, on a weeknight.
  beginner: { calorieGoal: 2000, proteinGoal: 130, mealsPerDay: 3, cookingSkill: 'minimal', maxPrepMinutes: 15 },
}

export const DIETS = {
  none: [],
  vegetarian: ['vegetarian'],
  vegan: ['vegan'],
  keto: ['keto'],
  glutenDairyFree: ['gluten-free', 'dairy-free'],
  nutAllergy: ['nut-free'],
}

// Foods a restriction forbids. Scored against the SHOWN ingredients: a violation here is a meal the
// user cannot eat, which is the most serious failure this feature can produce.
export const FORBIDDEN = {
  vegetarian: /\b(chicken|beef|pork|bacon|ham|turkey|lamb|steak|mince|sausage|salmon|tuna|cod|shrimp|prawn|anchov|fish sauce|oyster sauce|gelatin|lard|tallow)\b/i,
  vegan: /\b(chicken|beef|pork|bacon|ham|turkey|lamb|steak|sausage|salmon|tuna|cod|shrimp|prawn|anchov|fish sauce|oyster sauce|gelatin|lard|tallow|eggs?|egg whites?|milk|cheese|butter|yogurt|yoghurt|cream|honey|whey|ghee)\b/i,
  keto: /\b(rice|pasta|spaghetti|penne|noodles?|bread|toast|tortillas?|bagels?|potatoes?|oats|oatmeal|granola|cereal|quinoa|couscous|sugar|honey|maple syrup|banana|corn flakes)\b/i,
  'gluten-free': /\b(bread|toast|sourdough|bagels?|pasta|spaghetti|penne|noodles?|udon|soba|couscous|flour tortillas?|all-purpose flour|barley|bulgur|farro|naan|pita|breadcrumbs|soy sauce)\b/i,
  'dairy-free': /\b(milk|cheese|cheddar|mozzarella|parmesan|feta|butter|yogurt|yoghurt|cream|ghee|whey)\b/i,
  'nut-free': /\b(almonds?|pecans?|walnuts?|cashews?|pistachios?|hazelnuts?|peanuts?|peanut butter|almond butter|nut butter|tahini)\b/i,
}

// pantry × profile × diet × dislikes × mode. Each runs `runs` times, because one deck proves nothing
// about a stochastic model.
export const CASES = [
  { id: 'logan-standard', pantry: 'logan', profile: 'standard', diet: 'none' },
  { id: 'thin-standard', pantry: 'thin', profile: 'standard', diet: 'none' },
  { id: 'thin-beginner15', pantry: 'thin', profile: 'beginner', diet: 'none' },
  { id: 'vegetarian', pantry: 'vegetarian', profile: 'standard', diet: 'vegetarian' },
  { id: 'vegan', pantry: 'vegan', profile: 'standard', diet: 'vegan' },
  { id: 'keto-declared', pantry: 'keto', profile: 'standard', diet: 'keto' },
  { id: 'keto-undeclared', pantry: 'keto', profile: 'standard', diet: 'none' },
  { id: 'carbheavy-highprotein', pantry: 'carbHeavy', profile: 'highProtein', diet: 'none' },
  { id: 'carbheavy-cutting', pantry: 'carbHeavy', profile: 'cutting', diet: 'none' },
  { id: 'prepped', pantry: 'prepped', profile: 'standard', diet: 'none' },
  { id: 'messy-names', pantry: 'messy', profile: 'standard', diet: 'none' },
  { id: 'bigmixed-bulking', pantry: 'bigMixed', profile: 'bulking', diet: 'none' },
  { id: 'bigmixed-glutendairy', pantry: 'bigMixed', profile: 'standard', diet: 'glutenDairyFree' },
  { id: 'bigmixed-dislikes', pantry: 'bigMixed', profile: 'standard', diet: 'none',
    foodDislikes: ['cilantro', 'mushrooms', 'cottage cheese'] },
  { id: 'asian-cutting', pantry: 'asian', profile: 'cutting', diet: 'none' },
  { id: 'logan-nutallergy', pantry: 'logan', profile: 'standard', diet: 'nutAllergy' },
  { id: 'bigmixed-mealplan', pantry: 'bigMixed', profile: 'standard', diet: 'none', mode: 'mealPlan' },
]
