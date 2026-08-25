import { Image, type ImageStyle } from 'expo-image'
import type { StyleProp } from 'react-native'

// One wrapper around expo-image for every meal photo across the app (Discover, Saved, Home,
// cook-reveal, meal detail). expo-image disk+memory caches, so a photo downloads ONCE ever and
// then paints instantly on every future visit/launch — fixing the multi-second re-download that
// React Native's <Image> caused. Tune cache/fade/placeholder here once for all surfaces.
export function MealImage({
  uri,
  style,
  recyclingKey,
  priority = 'normal',
  transition = 200,
}: {
  uri: string
  style: StyleProp<ImageStyle>
  // Pass a stable id in lists/carousels (rail, deck) so a recycled view never flashes the
  // previous card's photo before the new one decodes.
  recyclingKey?: string
  priority?: 'low' | 'normal' | 'high'
  // Fade duration. 200 is right for a photo arriving over the NETWORK — it hides the pop and
  // makes a slow load look deliberate. On a disk-cache hit it is pure cost: the bytes are already
  // local, so the fade adds 200ms of visible ramp to something that could have painted instantly.
  // Pass 0 on surfaces where a cache hit is the overwhelmingly common case (Home).
  transition?: number
}) {
  return (
    <Image
      source={uri}
      // Dark bg on the image element itself so a loading photo never flashes white before it
      // decodes (expo-image's `placeholder` only takes a blurhash/uri, not a color).
      style={[{ backgroundColor: '#1A1A1A' }, style]}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={transition}
      recyclingKey={recyclingKey}
      priority={priority}
    />
  )
}

// Warm the cache for the first few visible photos before the user scrolls, so the rail feels
// "already loaded." Safe to call with junk/empty — expo-image ignores non-strings.
export function prefetchMealImages(urls: (string | null | undefined)[]) {
  const valid = urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
  if (valid.length) Image.prefetch(valid, { cachePolicy: 'memory-disk' })
}
