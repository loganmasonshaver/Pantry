import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { todayStr } from './localDate'
import type { GeneratedMeal } from './meals'

// Spare meals from the same generation as today's Cook Now deck (generate-meals `withSpares`), kept
// beside the meal cache. Tied to that deck by its meal ids: a later generation — or a deck rescued
// after a dropped connection, which carries no spares — leaves these stale, and readMealSpares then
// returns none rather than offering meals ranked against a different pantry.
const sparesKey = (mode: string) => `pantry_meal_spares_${mode}`
type SpareSet = { date: string; deckIds: string[]; spares: GeneratedMeal[] }

export async function saveMealSpares(mode: 'cookNow' | 'mealPlan', deck: GeneratedMeal[], spares: GeneratedMeal[]): Promise<void> {
  const entry: SpareSet = { date: todayStr(), deckIds: deck.map(m => String(m.id)), spares }
  try { await AsyncStorage.setItem(sparesKey(mode), JSON.stringify(entry)) } catch {}
}

export async function readMealSpares(mode: 'cookNow' | 'mealPlan', deck: { id: string }[]): Promise<GeneratedMeal[]> {
  try {
    const raw = await AsyncStorage.getItem(sparesKey(mode))
    if (!raw) return []
    const set: SpareSet = JSON.parse(raw)
    if (set.date !== todayStr()) return []
    // Overlap, not equality: after a swap the deck holds a spare's id, and its other meals still match.
    if (!deck.some(m => set.deckIds.includes(String(m.id)))) return []
    return Array.isArray(set.spares) ? set.spares : []
  } catch {
    return []
  }
}

// Tells the server a spare was swapped in, so it enters generation history and the anti-repeat window
// like any meal generate-meals shows. Fire-and-forget: the swap on screen never waits on it, and a
// record that fails costs at most a repeat of that dish on a later day.
export function recordSpareSwap(mealId: string, mode: 'cookNow' | 'mealPlan'): void {
  supabase.functions.invoke('swap-meal', { body: { mealId, mode } }).catch(() => {})
}
