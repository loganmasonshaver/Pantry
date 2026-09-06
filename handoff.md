# Handoff — 2026-09-05 (evening)

Replaces the 2026-09-05 midday handoff (in git history). **46 commits** since 12:20.
`git log --since="2026-09-05 12:20"` carries the reasoning; this file holds only what git does not.

**State:** everything committed, pushed, deployed. Tree clean. **278 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`).
**TS baseline 130 total / 16 app-code** — DOWN from 131/17, see §0.

---

## 0. READ FIRST — the lesson this session actually taught

**"Pre-existing" is not "not a bug."** I quoted the app-code baseline as 17 all session and twice
dismissed an error in `useNotifications.ts:17` as noise. It was the reason **no notification ever
appeared while the app was open** — `expo-notifications@55` requires `shouldShowBanner` and
`shouldShowList`, and the handler returned only the deprecated `shouldShowAlert`. It silently
affected all 7 daily reminders and the day-5 trial-end notification. Found only because a push
Logan was watching for never arrived.

That is the **third** time in this repo a stubborn baseline error was a live bug (MOCK_DETECTED and
`GeneratedMeal.image` are the other two, both already in CLAUDE.md). Baseline is now 130/16.

Second lesson, cheaper: **rule out the environment first.** Hours went into "slow Supabase queries"
that turned out to be Metro saturating the wifi — query time tracked bundle size almost perfectly
(3843 modules → 7.7s, 1 module → 1.5s). CLAUDE.md already says this.

---

## 1. ⚠️ THE BIG ONE — read `docs/PRELAUNCH.md` §2g before building anything

**Multi-serving generated meals.** Designed in detail, NOT built, and it touches macros — the
product's core promise. Logan explicitly asked the next session to **re-read it with fresh eyes,
check the logic is sound, and sharpen it** rather than implement it blind.

Summary: `displayCount = Math.min(mealsPerDay, 3)` but `calorieTarget = calorieGoal / mealsPerDay`
is not capped, so a 6-meal user gets three ~350 kcal "cooked" recipes. Logan's fix — keep
per-serving calories correct and give the recipe 2 servings, exactly as trending recipes already
do — is better than mine (which was to make the recipes bigger). Full reasoning, the servings rule,
and the three things to get right are in §2g.

**The one that would corrupt the product if missed:** the generator must emit `calories` PER
SERVING while `ingredients` describe the batch. Batch calories with `servings: 2` doubles every
log. The convention is already proven for trending meals — copy it, do not reinvent it.

**Genuinely unresolved and worth a fresh opinion:** does the pantry check run against the BATCH or
the SERVING? A 2-serving batch draws twice the pantry.

§2h is the sibling idea (scale existing meals instead of regenerating on a goal change) — also
designed, not built, lower risk.

---

## 2. WHAT THE REPEATED-MEALS BUG ACTUALLY WAS — two bugs, not one

Logan reported a chocolate shake and a frittata coming back. `generated_meals` is a permanent
timestamped record, so this was measured, not guessed:

1. **A lost update (FIXED, VERIFIED).** The effect's deps are `[userId, isPremium, mode, enabled]`;
   `enabled` flipped when the pantry landed and `isPremium` resolved ~23ms later, firing a SECOND
   generation. `cancelled` suppresses state updates, it never aborts an in-flight call. Both batches
   completed — six meals share one timestamp where a batch is three — and only ONE batch's names
   reached `recent_meal_names`, because both read the old window and the later write won. Half of
   every double generation was therefore invisible to the anti-repeat check.
   Now an **in-flight** lock (`generatingForRef`). Verified server-side: newest batch is 3, and all
   three names are in the window.
2. **The ingredient rescue overruling an identical name (FIXED, needs a few generations to judge).**
   `isSameDishDetailed` returned "not the same dish" whenever ingredient overlap fell below
   `INGREDIENT_RESCUE_MAX`, **even for a byte-identical name** — so "Protein-Boosted Chocolate
   Smoothie" was rescued and regenerated verbatim an hour after entering the window. Identical
   `dishKey` now short-circuits to true.

**Two placement mistakes were caught before shipping #1**, both of which would have traded one bug
for another: guarding at the top of `fetchAndGenerate` would have suppressed the regeneration
Profile deliberately triggers, and a per-DAY lock would have done the same. The guard belongs on the
expensive call, and it must be released when the generation settles.

**STILL OPEN:** "Chocolate Protein Smoothie" appeared TWICE inside one 11:51 response. Nothing
de-duplicates a batch against itself before storing. Separate from both fixes above.

**Do NOT lengthen `RECENT_MEMORY`.** It is 30 and was never too short.

---

## 3. THE UNEXPLAINED REGENERATIONS WERE NOT A BUG

Hours went into this. Changing **Meals Per Day** (or any `GoalField`, or diet type, or a macro
recalc) clears the meal cache **on purpose** — Profile's own comment says so. Logan had changed it.

Four theories died first, all by reading rather than shipping a fix: app killed mid-generation
(disproved by his own four-session trace — one session HIT the cache without generating and the next
still missed), the date key (`todayStr` is local), `maxPrepMinutes` undefined, `prepTime` stored as
a string, and `mealPrefetch` as a rogue writer.

**Instrumentation was kept, not reverted**, so the next real miss costs minutes not a session: every
miss branch in `useMealSuggestions` is named, every cache WRITE is marked, and all four Profile
wipes log their reason — a deliberate wipe and a cache lost to an app kill both read as
"no entry stored" otherwise.

**Also found here:** nothing re-runs meal loading on focus (deps are `[userId, isPremium, mode,
enabled]`; clearing AsyncStorage changes none of them), so a Profile change only appears to
regenerate on the NEXT launch. That is what made this look intermittent for hours.

---

## 4. NEGATIVE RESULTS — do not retry these

- **A canonical-list rotation for Discover shelves left `nearly` leading SEVEN days running**, and
  still mismatched on 8 of 14 days. `min(hash(key+day))` fails differently — a section that only
  exists in the big pool steals the lead. The shipped fix takes the offset modulo a FIXED window
  (the prefix both pool sizes share). All three were simulated before any was written; only the
  third survived.
- **A LAYERED DISHES build-order rule for image prompts does not work.** It is in the prompt, it
  reaches the model, and the description still lists coconut after the ganache on every run. Same
  shape as the merged-ingredient finding.
- **`InteractionManager` is deprecated** and the replacement needs `{ timeout }` — `requestIdleCallback`
  alone can wait forever on a thread that never idles, which is exactly the cold-start case.

---

## 5. THINGS SHIPPED THAT ARE STILL UNVERIFIED ON DEVICE

Per the standing rule, these must not be assumed working:

- **Discover shelf rotation + "Almost in your kitchen" contents** — day-keyed, so use
  `DEV_DAY_OFFSET` at the top of `app/(tabs)/discover.tsx` (bump 0→1→2→3, reload between, set back
  to 0). Simulated: leader cycles all 4 sections, contents give 3 distinct sets.
- **Profile now STALES the meal cache instead of deleting it**, so the carryover paints previous
  meals while new ones generate. Logan saw the bare "Let's cook" empty state before this.
- **The calorie card redesign + `LOG_PEEK` 190.** Judge the 40pt number, 84pt ring and LOG_PEEK on
  device — each is one value.
- **The week strip**: swipe between weeks, three-state day marks, `Log to <date>` on the meal
  detail button when it is not today.
- **A real generation still holding the skeleton until the hero photo paints** (`bf41c61`'s fix,
  which the Home skeleton work must not have thrown away). Needs a day with no cache.

---

## 6. THE 1,370 IMAGES ARE STILL THE BIGGEST UNRESOLVED PRODUCT RISK

Unchanged from this morning and still §2b. Every cached image predates the prompt fixes. Two for two
on the ones Logan happened to open were wrong. The tooling now exists (`replaceTrending`, cache-bust
by URL, a `describeOnly` path for stage 1) — what is missing is the call: spot-audit by eye, or bulk
regenerate at ~$4.

---

## 7. ENVIRONMENT

- **`EXPO_PUBLIC_EAS_PROJECT_ID` is in `.env`** (gitignored, not a secret — it is in committed
  `app.json` too). This is a BARE workflow, so `expo-constants` reads the config embedded at NATIVE
  BUILD time; `app.json` alone does not reach a JS reload. That is why the push-token warning
  survived three reloads and two of my "fixes".
- The health check now reports through TWO channels: a push (`alert: "sent"` proven) and a
  `pipeline_runs` row. It had been running on a cron since 2026-08-12 telling nobody anything.
  Read it with:
  `select created_at, funnel from pipeline_runs where provider='health-check' order by id desc limit 7;`
  Its cron is 08:20 UTC and it only fires a push when UNHEALTHY — silence is the healthy state.
  A row with `utc_hour` well below 8 is an off-window manual run; ignore its verdict.
- Metro must run from `/Users/loganshaver/pantry` with `npx expo start --dev-client`. Without
  `--dev-client` it comes up in Expo Go, which cannot run this app.
- `npx supabase db query --linked --file <f>` reads prod. The Vault holds `cron_service_role_key`
  and IS readable from SQL, which is how every manual edge-function call authenticates.
