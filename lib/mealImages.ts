import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const IMAGE_URL_CACHE_KEY = 'pantry_image_urls_v1'

// Single shared meal-image fetch, used by BOTH useMealSuggestions and the scan-time warm in
// mealPrefetch. Deliberately one implementation: generated images are globally cached across all
// users server-side, so a per-caller variation would break that cost model.
//
// Device cache is checked first — that's what makes a pre-warmed image resolve instantly (and for
// free) when the reveal later asks for it.
export async function fetchMealImage(name: string, ingredientNames: string[] = [], steps: any[] = []): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(IMAGE_URL_CACHE_KEY)
    if (raw) {
      const localCache: Record<string, string> = JSON.parse(raw)
      if (localCache[name]) return localCache[name]
    }
  } catch {}

  // 3 attempts with 3s gaps — Replicate/FAL occasionally returns transient 5xx or
  // queue timeouts; per-call retries are far cheaper than letting the meal
  // card render image-less. Sequential not parallel — bursting causes cascading throttles.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('generate-meal-image', { body: { mealName: name, ingredients: ingredientNames, steps } })
      console.log(`[MealImage] ${name}: data=`, JSON.stringify(data)?.substring(0, 100), 'error=', error)
      if (data?.image) {
        try {
          const raw = await AsyncStorage.getItem(IMAGE_URL_CACHE_KEY)
          let localCache: Record<string, string> = raw ? JSON.parse(raw) : {}
          localCache[name] = data.image
          // Cap the image-URL cache so it doesn't grow unbounded (synchronous Hermes
          // reads of a huge blob jank the JS thread). Keep the newest ~200 entries.
          const keys = Object.keys(localCache)
          if (keys.length > 200) {
            localCache = Object.fromEntries(keys.slice(keys.length - 200).map(k => [k, localCache[k]]))
          }
          await AsyncStorage.setItem(IMAGE_URL_CACHE_KEY, JSON.stringify(localCache))
        } catch {}
        return data.image
      }
    } catch (e) { console.log(`[MealImage] ${name} error:`, e) }
    await new Promise(r => setTimeout(r, 3000)) // 3s gap between retries
  }
  return null
}
