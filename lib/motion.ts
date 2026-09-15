import { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'

// The app's motion vocabulary, in one place so every list moves the same way. Rules for adding to it
// are in docs/PLAN-motion.md §2: transform/opacity only, UI thread only, no renders caused by motion.
//
// Built once at module scope, not inside components: a builder created during render is a new
// object every render, and Reanimated re-registers the animation config each time it changes.

// A list's neighbours closing the gap (or opening it) when a row leaves, arrives or changes height.
// Reanimated layout transitions are PER COMPONENT — every element whose own box moves needs this,
// a parent carrying it does not move its children. React Native's LayoutAnimation cannot do this
// job here: Reanimated disables it on the New Architecture (see CLAUDE.md).
export const LIST_LAYOUT = LinearTransition.duration(220).easing(Easing.out(Easing.cubic))

// The row that leaves. Shorter than the gap-close so it is gone before the neighbours settle.
export const ROW_EXIT = FadeOut.duration(160)

// A row the USER just added. Only ever passed to that one row — an `entering` on every row would
// also play on first load, on a day switch and as a virtualized list scrolls rows in.
export const ROW_ENTER = FadeIn.duration(200)

// A state change shown in place (in/out of stock, checked). A Reanimated CSS transition: the
// render that flips the state already happens, so the fade costs no extra render and no worklet.
export const STATE_FADE = {
  transitionProperty: 'opacity',
  // A string, not 180: Reanimated's style types for Text accept only the unit form.
  transitionDuration: '180ms',
  transitionTimingFunction: 'ease-out',
} as const
