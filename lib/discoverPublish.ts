// Whether a trending recipe may appear in Discover yet.
//
// The pipeline inserts a day's recipes with the creator's YouTube thumbnail as a placeholder and
// swaps in the AI photo a few seconds later — or, on a day the image service is slow, at the
// separate 08:05 UTC photo step, or at the next run if that fails too. Until then the row is real
// but unfinished, and Logan's rule is that nothing shows before its photo does. The AI photo is the
// only image stored in our own bucket, so its URL is the signal; no new column is needed.
//
// Creator recipes are uploaded with their own photo and never go through the AI step, so they are
// judged only on having one.

export const AI_PHOTO_PATH = '/storage/v1/object/public/'

export function isReadyToShow(meal: { image?: string | null; trend_source?: string | null }): boolean {
  const image = meal?.image ?? ''
  if (!image) return false
  if (meal?.trend_source === 'creator') return true
  return image.includes(AI_PHOTO_PATH)
}
