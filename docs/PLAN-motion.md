# PLAN — motion and haptics, performance first

**Status: PLAN. Nothing built. Gated on Logan's "go"** (asked 2026-09-15: transitions between
screens and a small animation for every action, without making the app laggy — "I did try this
in the past and ultimately the app became too slow"). Open items live in `docs/PRELAUNCH.md` §6c;
this file is the reasoning and the method.

---

## 1. What actually slowed the app before

Read from git, not memory. The count of animations was never the cause. Where they ran and what
they triggered was.

| When | Commit | What was added | What actually went wrong | Rule it gives |
|---|---|---|---|---|
| 2026-07-18 | `5071400` | Motion pass: press springs, commit haptics, tab + screen transitions | The tab `shift` transition drove react-native-screens' `activityState`; tabs detached natively → intermittent black screen for six weeks, three sessions, fixed by `animation: 'none'` (`2bd6a62`) | Never animate navigator internals |
| 2026-08-29 | `6b751f3`…`9508d4b` | Macros card open/close animation, ~10 commits | 8 Home re-renders per tap (onLayout → setState loop on a 2,400-line screen); animating `height` stepped at ~20fps through shadow-tree commits; one row snapped inside a smooth glide. The UI thread never dropped a frame | Transform/opacity only; an animation may not cause renders |
| 2026-08-29 | `7785f81` | Hero tilt parallax | Interpolated on the gyro's clock, not the frame clock → stepped. Reverted | Drive motion from the frame clock |
| 2026-09-05 | `8e7d92c` | Splash progress bar + glow | `width`, `textShadowRadius` and a `setInterval` on the JS thread during boot | Nothing JS-driven during cold start |
| found 2026-09-15 | — | 10 `LayoutAnimation.configureNext` calls (Home, Pantry, Grocery, Saved) | **They do nothing.** Reanimated disables React Native's LayoutAnimation on the New Architecture ([reanimated#6751](https://github.com/software-mansion/react-native-reanimated/issues/6751), open). Every "gap-close" and today's Pantry "slide" snaps | Use Reanimated layout animations |

Haptics are a native call and cost effectively nothing. Their risk is noise, not lag.

## 2. The budget — every change passes all of these

1. **Transform and opacity only** (backgroundColor allowed). Never width, height, margin, top.
2. **UI thread only.** Reanimated CSS transitions, layout animations or shared values; or RN
   `Animated` with the native driver. No new `useNativeDriver: false`.
3. **Zero renders caused by motion.** No onLayout → setState while anything moves.
4. **Navigators untouched.** Tab bar stays `animation: 'none'`. No shared element transitions
   (experimental in Reanimated 4).
5. **Nothing animates during cold start.**
6. **Long lists:** animate the row that changed, not every row. No new per-row animated wrappers
   in the 54-row Pantry list or the meal log without a measurement.
7. **Feedback is short:** 150–250 ms, or PressableScale's existing spring. Reduce Motion is already
   global (`ReducedMotionConfig` in `app/_layout.tsx`).
8. **Haptics on commits only** — a state changed. Never on scroll, navigation or opening something.
   One vocabulary: `lib/haptics.ts`.
9. **No new animation library.**

## 3. How "does it bog down the app" gets answered with numbers

- **Release build on the phone.** A Metro dev build is much slower than what ships and is not a
  fair judge of lag. `npx expo run:ios --device --configuration Release` (replaces the dev build;
  rebuild the dev build afterwards).
- **Xcode Instruments, "Animation Hitches" template,** on the wired phone. Apple's bands for hitch
  time: under 5 ms per second good, 5–10 warning, over 10 critical.
- **One fixed walkthrough, identical every run:** cold start to Home painted · switch every tab ·
  open a meal and back · open Log food and close · log a food · swipe-delete a log entry · swipe
  the week · toggle a Pantry item in and out · delete a Pantry item · check a grocery item · scroll
  Discover to the bottom.
- **Dev probe per action:** render count and worst UI frame gap, `__DEV__` only — the pattern from
  `6b751f3`, with `e3e834e`'s fix (shared values, not refs, inside `useFrameCallback`).
- **Screen recording frame-diff** (`6793cd7`'s method) when something feels wrong but the numbers
  look fine — that is how the stepping height animation was finally caught.
- **Gate per phase:** hitch time no worse than baseline and under 5 ms/s; renders per action no
  higher than baseline; cold start no slower; Logan's feel check on device. A failing screen is
  reverted by itself — **one commit per screen.**

## 4. Phases

**Phase 0 — Baseline. No product code.** Release build, walkthrough, Instruments trace, numbers
written into §6 of this file. ~1 h, mostly the build.

**Phase 1 — Fix what is already broken.** Expected to make the app lighter, not heavier.
- a. Replace the 10 dead `LayoutAnimation` calls. A row that leaves gets `exiting={FadeOut}`; a
  small container that resizes gets `layout={LinearTransition}`. In the 54-row Pantry list,
  measure before giving rows a layout transition; fall back to fade-only. Where no motion is
  wanted, delete the call rather than keep one that lies.
- b. Pantry and Grocery toggles: a CSS transition on opacity for the Out/checked state. The state
  change already renders; the transition adds no render.
- c. Home calorie ring: `strokeDashoffset` runs 1.8 s on the JS thread right as Home loads
  (`app/(tabs)/index.tsx`, `useNativeDriver: false`). Move it to Reanimated `useAnimatedProps`.
- d. Home's ambient loops keep running while another tab is in front (tabs stay mounted). Pause on
  blur.

**Phase 2 — Every action gets feedback.** First an audit table, every user action → its visual
response and haptic, for Logan's OK before any code. Today: 19 haptic call sites, 34
PressableScale, 245 TouchableOpacity (those already dim on press natively and stay). Known gaps:
Pantry toggle, add item, review Keep / Used up, grocery check, Log food / Save changes, New picks,
add to grocery, unsave, Discover save. Filled with PressableScale and `lib/haptics.ts` only.

**Phase 3 — Swipe rows on the UI thread.** The legacy `Swipeable` (Home log rows, Pantry rows) is
deprecated and built on the old Animated API. `ReanimatedSwipeable` ships in the installed
gesture-handler as a documented drop-in, with small behaviour differences in `renderRightActions`.
Verify swipe, delete and the rounded last-row corner on device.

**Phase 4 — Screen transitions: consistency, not new motion.** The app already has native screen
transitions: iOS's push for the meal detail, slide-from-bottom for sheets, slide or fade on the 20
modals. Those run inside UIKit and are the cheapest motion the app can have. Audit that each
screen uses the right one (drill-in = push, sheet = from bottom, 15 slide vs 5 fade modals made
deliberate). Tab switches stay instant, as in Apple's own apps — and because animating them is
what caused the black screen.

**Phase 5 — Later, only if Phase 0 shows hitches there: onboarding.** ~15 JS-driven animations
(charts, progress, the card swipe). It is the conversion funnel, so it is worth fixing if it
hitches, and not worth touching if it does not.

## 5. Repos and skills considered

- **Software Mansion `react-native-best-practices` skill** (installed). Used for this plan:
  transform/opacity, release-build profiling, CSS transitions as the default for state changes,
  ReanimatedSwipeable, reduced motion.
- **[callstackincubator/agent-skills](https://github.com/callstackincubator/agent-skills)** —
  Callstack's React Native performance skill (FPS, re-renders, JS thread, profiling). Useful for
  Phase 0. It has the **same skill name** as the installed one, so a global install would collide;
  read its profiling references directly, or install under a different name after reviewing the
  source (CLAUDE.md plugin policy).
- **[AppAndFlow/react-native-ease](https://github.com/AppAndFlow/react-native-ease)** — fades,
  slides and scales on Core Animation, Fabric only, no layout animations. **Not adopting:** a second
  animation system beside Reanimated, and it cannot do the gap-close, which is the actual missing
  piece. Revisit only if Phase 0 shows Reanimated itself costing frames.

## 6. Not doing

Tab animations · shared element transitions · parallax or tilt · size/height animations ·
animating every list row · haptics on scroll or navigation · splash animations · a new animation
library · converting the 245 TouchableOpacity.

## 7. Baseline numbers

*(Phase 0 fills this in.)*
