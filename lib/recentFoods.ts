import AsyncStorage from '@react-native-async-storage/async-storage'

// Foods this account logged, newest first, with the portion they were logged at so a Recent reopens
// exactly as it was logged — the list and the screen it opens can no longer disagree on the numbers.
export type RecentFood = {
  food_id: string
  food_name: string
  brand_name?: string
  unit_key?: string   // lib/foodPortion unitKey; absent on entries saved by an older build
  amount?: number
  portion?: string    // "1 cup shredded", "150 g"
  cal: number         // for THAT portion
  prot: number
}

// Per ACCOUNT. The key used to be device-wide and survived sign-out, so a second account on the same
// phone — the App Review demo login on Logan's device — opened on the first account's foods.
export const recentFoodsKey = (userId: string) => `pantry_recent_foods:${userId}`
const LEGACY_KEY = 'pantry_recent_foods'
const CAP = 15

export async function loadRecentFoods(userId: string): Promise<RecentFood[]> {
  // The device-wide list cannot be attributed to an account, so it is dropped rather than inherited.
  AsyncStorage.removeItem(LEGACY_KEY).catch(() => {})
  try {
    const raw = await AsyncStorage.getItem(recentFoodsKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function pushRecentFood(userId: string, entry: RecentFood): Promise<RecentFood[]> {
  const current = await loadRecentFoods(userId)
  const next = [entry, ...current.filter(r => r.food_id !== entry.food_id)].slice(0, CAP)
  await AsyncStorage.setItem(recentFoodsKey(userId), JSON.stringify(next)).catch(() => {})
  return next
}
