# Handoff — 2026-09-03 (evening)

Replaces the 2026-08-30 handoff (in git history, `06ce465`). `git log --since="2026-09-02"` carries
the reasoning for every commit; this file holds only what git does not.

**State:** everything committed, pushed, deployed. Working tree clean. **243 tests**
(`node --test lib/*.test.ts supabase/functions/_shared/*.test.ts`). **TS baseline 124 total / 17
app-code — both DROPPED today, see §4.** Preflight green except `SCAN_CAP_WEEK`, still held on
purpose.

---

## 0. READ FIRST — the next session is a design session

Logan is taking **Home + Pantry layout** to a fresh chat for an outside perspective. It is written
up as **`docs/PRELAUNCH.md` item 6c**, and it is a DECISION, not a bug list.

**Do not re-propose what was already rejected today.** Four options were put to him and all four
were turned down, for reasons that are better than the options were:

- *Cut the meal section from Pantry, link to Home instead* — a link that promises "2 meals ready"
  and delivers a tab you then have to scroll is worse than no link.
- *Hero + two compact rows on Home* — **Discover already opens on a big photo hero.** Give Home one
  too and both tabs lead with the same visual move, so neither has an identity. Any proposal must
  say what makes Home look DIFFERENT from Discover. This is the constraint that kills most ideas.
- *Turn Home's carousel into a plain list* — throws away the photography that makes the app look
  like a product.
- *Just stop the auto-advance* — only half-answers; you still see one meal at a time.

**His actual objection, which is sharper than anything offered back:** the old Pantry Cook Tonight
showed all three meals AT ONCE. Home shows one at a time on a 6250ms timer, so meals arrive
individually even on an idle device. `app/(tabs)/index.tsx:519` says the quiet part out loud —
*"every HERO_CYCLE_MS the hero crossfades to the next meal so all 3 are surfaced over time."* The
rotation is compensation for a layout with room for one meal, and ~44 references of loop/recentring
machinery exist to serve it.

**The layout was REVERTED to its working state on purpose** (`129fe3c`). Not because the changes
were wrong in isolation, but because they encoded a design opinion Logan does not share — and
leaving them in would hand the next session that opinion as its baseline without flagging it as one.

---

## 1. NEEDS LOGAN — verification, all of it on device

`docs/PRELAUNCH.md` **6b** is the canonical list. Two classes:

**Testable on any reload, today:**
- Category icons and colours (the grey-boxes bug — see §2)
- Pantry's `+` icon and the "Add an item" row at the end of the list
- Home's promoted "Cook from your pantry" heading
- The photo-gated meal swap — **use the refresh button, it does not need a new day.** The tell is
  the ABSENCE of a shimmer beat between the old meals and the new ones.

**Cannot be tested same-day, needs the first open of a NEW day:**
- "Yesterday's picks" carryover — its alignment fix and the live pulse dot
- Discover's hero being a dish never served before, and not swapping after first paint
- "Almost in your kitchen" no longer leading every day, and reordering inside itself

These read the DEVICE clock (`dayOfYearNow`, `todayStr`), **not the database — no SQL simulates a
new day.** Either wait, or set the iPhone forward a day and expect a token refresh.

**Needs DAYS, not a reload:** the repeat/variety work (§3). One generation proves nothing.

---

## 2. WHAT CHANGED TODAY, and the two bugs worth remembering

**The pantry was a column of grey boxes** (`750f4d6`). `CATEGORY_ICONS`/`CATEGORY_COLORS` are keyed
on `STORE_CATEGORIES`, but the scan prompt gave the model **no allowed-values list** — only two
examples using "Dairy" and "Carbs", neither of which exists in it. It invented its own vocabulary
and it went straight to the database: 97 in-stock items on off-list names, all falling through to
the `Package` icon and grey. "Condiments", "Condiments & Spices" and "Spices & Seasonings" rendered
as three rows for overlapping food. Fixed in three places — the prompt states the sixteen values,
`normalizeCategory` coerces at the one write path, and a migration backfilled the 97 rows (verified
zero off-list remaining).

**I deleted the only regen button in the app and did not notice** (`f874efb`, restored). It lived
inside Cook Tonight's header; Home imports `RefreshCw` but has never rendered it. Cutting a section
by its rendered height is how a five-line feature inside a 141-line block disappears. It came back
with the revert. **Lesson worth keeping: audit what LIVES in a block before removing it, not just
what it looks like.**

Also shipped and surviving the revert: Home's photo-gated meal swap and the `image: null` type fix
(§4), the carryover alignment + live pulse, and the promoted section heading.

---

## 3. THE REPEAT PROBLEM — three attempts, and why the third is different

Logan's complaint: generated meals feel like the same food renamed. Measured against his live data,
not guessed.

- **The window was half full of the model repeating itself.** 29 remembered names clustered to 14
  distinct dishes — seven names for one cottage cheese bowl. Shortening the window is the WRONG
  instinct and was explicitly considered and rejected: it was never too long, it was half empty.
  It now dedupes by sameness, so 30 slots hold ~30 real dishes.
- **A name ban does not work.** Handed a list headed "DO NOT SUGGEST", the model returned two
  entries VERBATIM. Better ban lists were the first two attempts and both failed.
- **So the third bans the FOOD** (`ef1c4b4`). "Do not use cottage cheese" cannot be satisfied by
  renaming. First run after: cottage cheese gone entirely, and beef — a base sitting unused in a
  55-item pantry — finally appeared.

**Two open items on this:**
- **Potato slipped through inside a "Vegetable Hash"** — the ban held on the name but not the
  ingredient list. If it recurs, the ban needs enforcing in code against the returned ingredients,
  not just requested in the prompt.
- **`INGREDIENT_RESCUE_MAX = 0.4` was never calibrated** — picked against two hand-built examples
  because `generated_meals` was empty when it was written. It logs every time it fires. Calibrate
  from those lines; do not re-guess.

---

## 4. TS BASELINE DROPPED — 134/27 → 124/17

`GeneratedMeal.image` was declared `image: null` — a field that can ONLY ever hold null — while the
client assigns URLs to it on every meal. All ten `Type 'string' is not assignable to type 'null'`
errors were the DECLARATION being wrong, not the code. Same lesson as the `MOCK_DETECTED` deletion
already in CLAUDE.md: **check whether the type is wrong before assuming a stubborn baseline is
load-bearing.** CLAUDE.md updated; 124/17 is the number to watch now.

---

## 5. NOT DONE, deliberately

- **`generated_meals` is written but nothing reads it.** The V2 "Made for you before" page is
  designed in `docs/todos.md` with the numbers that settle it. The WRITE shipped early on purpose —
  it is a one-way door, nothing else persists a generated meal. Verified live: 0 → 3 rows on a real
  generation, `meal_data` complete. **It carries no `image` key** (images are fetched client-side
  after generation) — the image cache is name-keyed, so the page re-resolves them free.
- **Two screens mount `useMealSuggestions`.** This is INTENDED — they share one generation through
  the daily cache, and the shared `regenCount` is what makes "one regen per day" hold across both.
  I wrongly called it an architecture problem in `f874efb`'s message; `62df0cb` corrects it. The
  real issue is narrow: on a cold day, opening Pantry during Home's ~10s generation window can have
  both see a cache miss and generate twice.
- **Meal swap can still happen mid-drag.** `heroDragging` lives in the screen, the swap in the hook.
  Not worth the coupling for a sub-second window — recorded rather than half-built.
- **Three ingredient defects logged, not started**, in `docs/TRENDING-OPEN.md`: Jello's macros
  contradicting themselves and its ingredients; duplicate coriander (⚠️ a dedupe is a MEASURED dead
  end — the fix is showing the creator's section headings); and `5g cooking oil spray`, which is an
  invented amount and belongs with the existing "Mark invented amounts" item.
- **Discover's first open** — black screen with a Safari glyph, then 3-6s, then a reorder. Logged
  with the three symptoms separated because they have three different causes and one may already be
  fixed. Verify before writing code.

---

## 6. THE PIPELINE RUN IS STILL THE BIGGEST GATE

Unchanged from the last handoff and still true. Eleven generation-side changes remain unverified;
`docs/TRENDING-OPEN.md` ends with a `⚠️ CONFIRM ON THE NEXT PIPELINE RUN` block — five checks, exact
SQL, and what a FALSE pass looks like. Six later items assume the pipeline is sound. Quota ~1,314
units per run of 10,000/day, resets midnight Pacific / 2am Logan's time. Run tests SEQUENTIALLY.

---

## 7. ENVIRONMENT

- **Metro must run from `/Users/loganshaver/pantry`.** A stale instance from days earlier was found
  running this session; kill and restart with `--clear` rather than trusting it.
- **The bundler address is solved permanently.** The app's Configure Bundler is set to
  `Logans-MacBook-Air-10.local:8081` — a Bonjour name, so it survives every network change and no
  longer needs the Mac's IP. `RCT_jsLocation` lives in user defaults: it survives rebuilds and
  upgrades but **a delete-and-reinstall wipes it.** If Metro is ever unreachable after a fresh
  install, that is why.
- The temporary `192.168.1.196` IP alias from the other house is **removed**; en0 holds a normal
  DHCP lease.
