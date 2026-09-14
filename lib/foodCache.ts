import AsyncStorage from '@react-native-async-storage/async-storage'
import { getFoodById, type FoodDetail, type FoodSearchResult } from './fatsecret'

// FatSecret food records, kept in memory and on disk so opening a food is not a network round-trip.
// food.get goes through the fatsecret-proxy edge function and then to FatSecret, ~1s measured on
// device from tapping a logged entry to seeing the screen. A food is fetched once, when it is first
// opened; every later open — the edit of an entry above all, which is always a food already
// fetched to log it — reads the copy. FatSecret records are not per user, so the key is the id alone.
const memory = new Map<string, FoodDetail>()
const diskKey = (id: string) => `pantry_food:${id}`

export function rememberFood(food: FoodDetail) {
  memory.set(food.food_id, food)
  AsyncStorage.setItem(diskKey(food.food_id), JSON.stringify(food)).catch(() => {})
}

// A v3 search result carries the food's servings inline, so a tapped result can paint at once. It
// is NOT written to the cache: only food.get is trusted to be the complete serving list.
export function foodFromSearchResult(r: FoodSearchResult): FoodDetail | null {
  if (!r.servings || r.servings.length === 0) return null
  return { food_id: r.food_id, food_name: r.food_name, brand_name: r.brand_name, servings: r.servings }
}

export async function loadFood(id: string): Promise<FoodDetail> {
  const hit = memory.get(id)
  if (hit) return hit
  try {
    const raw = await AsyncStorage.getItem(diskKey(id))
    if (raw) {
      const food = JSON.parse(raw) as FoodDetail
      if (food?.food_id === id && Array.isArray(food.servings) && food.servings.length > 0) {
        memory.set(id, food)
        return food
      }
    }
  } catch {}
  const food = await getFoodById(id)
  rememberFood(food)
  return food
}
