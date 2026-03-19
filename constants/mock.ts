export type Ingredient = {
  id: string
  visual: string
  grams: string
  name: string
  inPantry: boolean
}

export type MealDetail = {
  id: string
  name: string
  prepTime: number
  calories: number
  protein: number
  carbs: number
  fat: number
  image: string | null
  ingredients: Ingredient[]
  steps: string[]
}

export const MOCK_MEAL_DETAILS: Record<string, MealDetail> = {
  '1': {
    id: '1',
    name: 'Steak & Rice Bowl',
    prepTime: 15,
    calories: 550,
    protein: 45,
    carbs: 42,
    fat: 18,
    image: null,
    ingredients: [
      { id: 'i1', visual: '1 palm', grams: '120g', name: 'Sirloin steak', inPantry: true },
      { id: 'i2', visual: '1 fist', grams: '185g', name: 'White rice (cooked)', inPantry: true },
      { id: 'i3', visual: '½ cup', grams: '75g', name: 'Broccoli florets', inPantry: false },
      { id: 'i4', visual: '1 tbsp', grams: '15ml', name: 'Soy sauce', inPantry: false },
    ],
    steps: [
      'Season **steak** with salt, pepper, and garlic powder on both sides.',
      'Cook **rice** according to package directions until fluffy.',
      'Sear **steak** in a hot pan for 3–4 min per side for medium. Rest 5 min, then slice.',
      'Steam **broccoli** for 3 min. Assemble bowl and drizzle with **soy sauce**.',
    ],
  },
  '2': {
    id: '2',
    name: 'Chicken Pesto Pasta',
    prepTime: 20,
    calories: 620,
    protein: 52,
    carbs: 55,
    fat: 14,
    image: null,
    ingredients: [
      { id: 'i1', visual: '1 palm', grams: '120g', name: 'Chicken breast', inPantry: true },
      { id: 'i2', visual: '1 fist', grams: '170g', name: 'Penne pasta (cooked)', inPantry: true },
      { id: 'i3', visual: '2 tbsp', grams: '30g', name: 'Pesto sauce', inPantry: false },
      { id: 'i4', visual: '¼ cup', grams: '40g', name: 'Cherry tomatoes', inPantry: false },
    ],
    steps: [
      'Cook **pasta** in salted boiling water until al dente. Drain and set aside.',
      'Slice **chicken** and pan-fry in olive oil for 5–6 min until cooked through.',
      'Toss **pasta** with **pesto** and **cherry tomatoes**.',
      'Top with sliced **chicken** and serve immediately.',
    ],
  },
  '3': {
    id: '3',
    name: 'Salmon & Quinoa',
    prepTime: 18,
    calories: 490,
    protein: 44,
    carbs: 38,
    fat: 16,
    image: null,
    ingredients: [
      { id: 'i1', visual: '1 palm', grams: '130g', name: 'Salmon fillet', inPantry: true },
      { id: 'i2', visual: '1 fist', grams: '160g', name: 'Quinoa (cooked)', inPantry: false },
      { id: 'i3', visual: '½ cup', grams: '60g', name: 'Baby spinach', inPantry: true },
      { id: 'i4', visual: '1 tbsp', grams: '15ml', name: 'Lemon juice', inPantry: false },
    ],
    steps: [
      'Cook **quinoa** in water (2:1 ratio) for 15 min until fluffy.',
      'Season **salmon** with salt, pepper, and **lemon juice**.',
      'Pan-sear **salmon** skin-side down for 4 min, flip and cook 3 min more.',
      'Serve **salmon** over **quinoa** with wilted **spinach**.',
    ],
  },
}

export const MOCK_USER = {
  name: 'Marcus',
  greeting: 'Good Morning',
  avatar: 'https://i.pravatar.cc/150?img=52',
}

export const MOCK_MACROS = {
  calories: { consumed: 1200, goal: 2400 },
  protein: { consumed: 80, goal: 180 },
}

export const MOCK_MEALS = [
  {
    id: '1',
    name: 'Steak & Rice Bowl',
    prepTime: 15,
    calories: 550,
    protein: 45,
    image: null as string | null,
  },
  {
    id: '2',
    name: 'Chicken Pesto Pasta',
    prepTime: 20,
    calories: 620,
    protein: 52,
    image: null as string | null,
  },
  {
    id: '3',
    name: 'Salmon & Quinoa',
    prepTime: 18,
    calories: 490,
    protein: 44,
    image: null as string | null,
  },
]
