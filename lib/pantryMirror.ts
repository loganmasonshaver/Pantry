import AsyncStorage from '@react-native-async-storage/async-storage'

// The Pantry tab writes its list here on every change so it can paint from disk on the next open.
// One key for every reader, or the meal screen ends up seeding from a key the tab stopped writing.
export const pantryMirrorKey = (uid: string) => `pantry_items:${uid}`

// In-stock names from the mirror, lower-cased and trimmed to match the network set — or null when
// there is no mirror yet (first launch, or the Pantry tab has never loaded for this account).
export async function readPantryMirrorNames(uid: string): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(pantryMirrorKey(uid))
    if (!raw) return null
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) return null
    const names = rows
      .filter((r: any) => r && r.in_stock !== false)
      .map((r: any) => String(r.name ?? '').toLowerCase().trim())
      .filter(Boolean)
    return new Set(names)
  } catch {
    return null
  }
}
