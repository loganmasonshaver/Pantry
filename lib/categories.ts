import { supabase } from './supabase'
import { STORE_CATEGORIES, autoCategoryMatches } from './categoryMatch'

export { STORE_CATEGORIES, autoCategoryMatches }

// Async categorization with LLM fallback for items where keyword matching fails.
// Common case: typo'd names like "avacodo" or rare items not in the keyword list.
// Returns the best category; falls back to 'Other' if even the LLM fails.
//
// Always returns synchronously fast when keyword matching wins (no await on edge function).
// Edge function call only happens when keywords produce no match — typically misspellings or
// exotic items. ~400ms latency for those cases, negligible cost ($0.00002/call via Gemini).
export async function categorizeItem(name: string): Promise<string> {
  const matches = autoCategoryMatches(name)
  if (matches.length > 0) return matches[0]

  try {
    const { data, error } = await supabase.functions.invoke('categorize-item', {
      body: { name, categories: STORE_CATEGORIES },
    })
    if (error || !data?.category) return 'Other'
    return STORE_CATEGORIES.includes(data.category) ? data.category : 'Other'
  } catch {
    return 'Other'
  }
}
