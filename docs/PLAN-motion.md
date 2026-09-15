# PLAN — motion and haptics, performance first

**Status 2026-09-15: Phase 0 measured, Phase 1 built and measured, Phase 2 BUILT (approved by Logan: "move to phase 2"), unmeasured.** (Asked 2026-09-15: transitions between
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
  **Disk:** every recording spools ~5–6 GB of raw trace into `$TMPDIR` (`instruments*.ktrace`) and
  xctrace never deletes it. Eighteen of them (31 GB) filled the Mac on 2026-09-15 and crashed a save.
  `scripts/motion-trace.sh` now refuses to start under 12 GB free and removes its own spool.
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
written into §7 of this file. ~1 h, mostly the build.
*Status 2026-09-15: MEASURED — 0.99 ms/s (§7). Tooling `f2de9e8`. Rerun any phase with*
`bash scripts/motion-compare.sh <before> <after>` *with the before-build installed as Release.*

**Phase 1 — Fix what is already broken.** Expected to make the app lighter, not heavier.
*Status 2026-09-15: BUILT (`e0a0e41` Home, `462f6b0` Pantry, `15310d6` Grocery, `2e3e063` Saved) and
MEASURED — 1.24 ms/s, no frame cost (§7). Device tells in PRELAUNCH §6c still unchecked.*
- a. Replace the 10 dead `LayoutAnimation` calls. **Done:** Home's log (cards, rows, Add meal),
  Grocery (aisles, cards, rows, Add Item) and Saved's grid carry `LIST_LAYOUT` / `ROW_EXIT` from
  `lib/motion.ts`. Two of the ten were in code nothing rendered (`SlotCard`, `toggleSlot`) and were
  deleted with it. **Pantry: no reflow animation.** Reanimated's layout transitions do not reach
  SectionList cells, and a `CellRendererComponent` workaround would glide rows while the sticky
  section headers — wrapped by ScrollView in their own views — snap. So a Pantry toggle now fades
  in place and the Out row sinks on the next load (as `dbc6512` had it); delete still closes the
  gap in one frame.
- b. Pantry and Grocery toggles: a CSS transition on opacity. **Done** (`STATE_FADE`).
- c. Home calorie ring. **Done, and it was worse than planned:** a listener set a "remaining" count
  on nearly every frame for 1.8 s — about a hundred renders per Home load — for a value rendered
  nowhere. Now `useAnimatedProps` on the UI thread, no listener, no state.
- d. ~~Pause Home's ambient loops on blur.~~ **Dropped, nothing to fix.** Every loop is RN Animated
  with the native driver, so it runs natively with no JS round trips; each only runs in a transient
  state (generating, empty pantry, resting card); and an inactive tab is detached from the native
  hierarchy, so an off-screen loop is not composited. Revisit only if a trace shows hitches while
  another tab is in front.

**Phase 2 — Every action gets feedback.** First an audit table, every user action → its visual
response and haptic, for Logan's OK before any code. Today: 19 haptic call sites, 34
PressableScale, 245 TouchableOpacity (those already dim on press natively and stay). Known gaps:
Pantry toggle, add item, review Keep / Used up, grocery check, Log food / Save changes, New picks,
add to grocery, unsave, Discover save. Filled with PressableScale and `lib/haptics.ts` only.

### Phase 2 audit — APPROVED and BUILT 2026-09-15

*Built as proposed in ten commits, `b02670f`…`5932d3f` (Home, Pantry, Grocery, Saved, Discover, meal
detail, logging modals, scan modals, settings saves, cook reveal). The tab-bar tick stays — Logan did
not ask to remove it. Two additions the proposal implied: `lib/logSignal.ts` (+2 tests) carries "a log
just happened" from the logging screens to Home's goal tick; `saveDietType` now reads its write error,
since a tick for a refused save would be a lie. The scan flow's "Add all" ticks `light`, not `success`,
when the cook reveal follows, because the reveal's own Success peak lands a moment later. Also on
2026-09-15, separately: Home's "· N left today" count was removed at Logan's request (`9742a2f`).*

Every state-changing action in `app/` and `components/` was inventoried with its current feedback;
three findings were re-read in code before this proposal relied on them. The pattern: haptics are
concentrated on openers and deletes, and missing from the commits people do most — logging a food,
toggling a pantry item, checking a grocery item. Rule 8 decides every row: a haptic marks a commit,
fires after it succeeds when there is a network result, and never marks opening, navigating or a
view filter.

**A. Add a haptic** — commits with none today.

| Action | Where | Haptic |
|---|---|---|
| Log a food / Save changes | FoodSearchModal | `success`, after the write returns |
| Mark a pantry item in or out | Pantry | `selection` |
| Check or uncheck a grocery item | Grocery | `selection` |
| Stale review: Keep, Used up / Keep all | Pantry sheet | `selection` / `success` |
| Add an ingredient; inline-add a grocery item; add a meal slot | Pantry, Grocery, Home | `light`, after the insert |
| Insight "Add to grocery" | Pantry | `light` |
| Thumbs up / down | Meal detail | `selection` |
| Update Log; Save or Reset a nutrition correction | EditPortionModal, MacroEditModal | `success` |
| "Add N items to Pantry" (receipt) / "Add all N to Pantry" (scan) | Scan modals | `success` |
| Save a goal, pick a diet, log weight | Profile (no haptics today at all) | `success` |
| Save preferences; save a recipe | food-preferences, RecipeFormModal | `success` |
| Undo an unsave; undo a staple opt-out | Saved, Meal detail | `light` |
| Rename a grocery item (commit) | Grocery | `selection` |

**B. Move to after the result.**
- Meal detail **Save**: today PressableScale's `haptic` ticks on the tap — before the paywall opens
  for a non-subscriber and before the save RPC, even when it fails. → `success` when the save lands.
- Saved **Extract Recipe**: ticks before the link check, consent and network. → `success` when
  the recipe arrives.

**C. Remove** — haptics on things that are not commits.
- The openers: Scan pantry, Scan receipt, Home's scan hero, Browse trending, Show all recipes.
- Meal detail **Log Meal** only opens the slot picker, then the pick fires a second haptic. Keep
  one: the pick, upgraded from `medium` to `success`.
- **Today** when already on today.
- Cook reveal's tick on every card change, which also fires on auto-advance with no touch. Keep the
  peak `success`; tick only when the user swiped.
- Home's goal-crossed `success` can fire from a background refetch (focus, resume, another device).
  Fire it only when the crossing follows a log made in this session.
- **Tab bar tick — Logan's call.** It is navigation, so rule 8 says remove it; Apple's own tab bars
  do not tick. It has been there since July, so it stays unless Logan says otherwise.

**D. Add a visual** — the only three with no response at all.
- **New picks** is a nested `Text onPress`: no dim, nothing until the shimmer. → a touchable with the
  standard dim.
- A row the user adds appears in one frame: Grocery inline add, a new meal slot. → `FadeIn` entering,
  with the list's first load skipped (`LayoutAnimationConfig skipEntering` mounted with the first
  data). **Not Pantry:** in a virtualized SectionList an entering fade replays as rows scroll in.
- Grocery rename commit: the `selection` haptic in A is enough.

**E. Leave as they are.** Filter chips, search, servings stepper, Measured/Eyeball, unit pickers
(view state, not commits: spring or dim only). Alert-driven flows (sign out, delete account, restore
purchases): the system alert is the feedback.

Cost: haptics are single native calls with no render; D's two fades follow §2. About 30 call sites,
one commit per screen, measured like Phase 1.

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

| Run | Build | Recording | Hitches | Hitch time | Ratio | Worst |
|---|---|---|---|---|---|---|
| self-test, idle launch, no walkthrough | Release `4eceabd` | 21.1 s | 2 | 41.7 ms | 1.97 ms/s | 33.3 ms |
| baseline walkthrough | Release `4eceabd` | 151.1 s | 12 | 150.0 ms | 0.99 ms/s | 25.0 ms |
| phase1 walkthrough, first attempt | Release `2e3e063` | 23.1 s | — | — | — | — |
| phase1 walkthrough, redo | Release `2e3e063` | 151.3 s | 10 | 187.5 ms | 1.24 ms/s | 37.5 ms |

The self-test only proves the pipeline; both of its hitches were app launch. Compare the two
walkthrough rows, never a walkthrough against the self-test.

**Reading, 2026-09-15.** Both walkthroughs sit far inside Apple's good band (< 5 ms/s), and
the 0.25 ms/s difference is inside what two hand-paced walkthroughs vary by — one extra hitch of
37.5 ms accounts for it. Phase 1 neither made frame delivery worse nor measurably better, which is
what it should show: its real saving is JS-thread renders (the ring's ~100 per load), and hitches
do not measure the JS thread. The first phase1 attempt stuck on the splash on the first launch
after install and was stopped at 23 s (PRELAUNCH §6c, "a launch can stick on the splash").
The recurring "offscreen passes" hitches (13–22 passes) appear in BOTH builds — shadows or
rounded masks being re-rendered, most likely on Discover's scroll. A lead, not a Phase 1 effect.
