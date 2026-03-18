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
    image: 'https://images.unsplash.com/photo-1555949258-eb67b1ef0ceb?w=300&q=80',
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
