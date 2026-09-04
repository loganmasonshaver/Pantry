# Handoff — 2026-09-04

Replaces the 2026-09-03 handoff (in git history). `git log --since="2026-09-04"` carries the
reasoning for every commit; this file holds only what git does not.

**State:** everything committed, pushed, deployed, and three migrations applied to PROD. Working
tree clean. **243 tests.** **TS baseline 124 total / 17 app-code — unchanged all day.**

---

## 0. READ FIRST — the rule Logan set today

**When he asks "what's next", the answer is the items HE raised most recently, from
`docs/PRELAUNCH.md` §6d.** Not item 1, not your own idea. Today he asked, got PRELAUNCH item 1 plus
a self-chosen security sweep, and had to point out that half a session's worth of issues he had
raised were living only in the chat. His words: *"if I forget, you better not be forgetting to
address this."*

Two process changes follow from that, and they are not optional:
- **Write each issue into `docs/PRELAUNCH.md` the moment he raises it**, not at session end. A
  decided-but-unbuilt approach counts — record the decision, or the next session re-litigates it.
- **Keep this file current during the session**, not only when a new chat is signalled.

§6d is new and holds everything from today. §6e holds what the security sweep left open.

---

## 1. SHIPPED TODAY

**Home layout compression** (`8a1f0d1`-ish, see log). The load-bearing find was NOT the ring: the
hero was sized `viewportH - cardTop - 12`, pinning its bottom edge 12pt above the fold BY
CONSTRUCTION. Every point trimmed above it was handed straight back to the photo — which is why the
three trims already in that file, each commented "toward fitting the meal hero above the fold",
bought nothing. `LOG_PEEK` is the reserve that makes upstream trims reach the log. Then ~82pt of
compression, then a second pass when Logan asked for more: of the 96pt reserved, 82 was going to
MARGIN (36pt section gap) rather than a log row. Reclaimed that for free before spending photo.

**Two cold-start defects.** Identified because two screenshots a minute apart disagreed about the
calorie goal. (a) `useState(2400)`/`useState(180)` meant the ring ran its full 1800ms animation
toward numbers belonging to nobody before the profile landed; goals now hydrate from AsyncStorage,
userId-stamped. **VERIFIED ON DEVICE.** (b) `HERO_IMAGE_WAIT_MS` was 8000, calibrated against the
CACHED image path (~50ms) — a novel dish needs a ~10s Flux render, so the gate always timed out and
swapped in the shimmer it existed to prevent. Raised to 22000. **NOT verified — needs a rollover.**

**An indeterminate sweep bar** under "Yesterday's picks". The 6pt dot was the only activity signal
and reads as punctuation; with the hold now up to 22s that was untenable. Inside the measured
header wrapper on purpose — `heroHeaderH` feeds the hero fit.

**Security: a published premium bypass, closed.** See §2.

---

## 2. THE SECURITY SWEEP — and the lesson that generalises

`PANTRY_CREATOR` was seeded with `grants_premium = TRUE`, active, no expiry, no cap, in a **PUBLIC**
repo. `_shared/premium.ts` gates every paid endpoint on `(is_premium OR promo_active)`, so the whole
paywall came off in three steps with no exploit. **Verified never exploited: `referral_redemptions`
holds 0 rows all time.** The 3 accounts with `promo_active` have `referral_code_used` NULL — granted
directly in the dashboard, nothing revoked.

**⚠️ THE FIRST FIX REPORTED SUCCESS AND CHANGED NOTHING.** It deactivated `code =
'PANTRY_CREATOR'`, taken from the seed. Prod holds **`PANTRY_CREATOR!`** — trailing exclamation
mark, edited in the dashboard, never written back. Zero rows matched; `db push` printed "Finished".
Caught only because the effect was QUERIED afterwards. **The repo is not the source of truth for
this database's data, and — see §6e — not reliably for its function signatures either.** Verify
against `pg_proc` and the live rows, never against the migration tree.

Also fixed: dropped the dead `validate_referral_code(text)` (still anon-executable), added
`max_redemptions`/`redemption_count` enforced as an atomic conditional UPDATE, pinned `search_path`
on every SECURITY DEFINER function. Two further corrections came from the pre-push hook and were
real — the repeat-call branch reported the code's advertised value instead of what the caller
actually held.

Full remaining list in §6e. The headline: **no replacement code exists yet, and it must be created
outside the repo.**

---

## 3. WHAT LOGAN CANNOT VERIFY, AND WHY IT MATTERS

`docs/PRELAUNCH.md` §6b is canonical. Two of today's three cold-start checks need a **new day's
first open** — they read the DEVICE clock, no SQL simulates it. The goal-flash one is already
ticked (verified). Do not let the other two quietly become "probably fine".

---

## 4. STILL THE BIGGEST GATE — unchanged

The trending pipeline run. Eleven generation-side changes unverified; `docs/TRENDING-OPEN.md` ends
with a `⚠️ CONFIRM ON THE NEXT PIPELINE RUN` block — five checks, exact SQL, and what a FALSE pass
looks like. Quota ~1,314 units of 10,000/day, resets midnight Pacific / 2am Logan's time, cron takes
one at 01:00 Pacific. **~6 test runs a day, SEQUENTIAL.** Logan has not authorised one; ask.

---

## 5. DESIGN DECISIONS MADE TODAY — do not re-open

- **Home vs Discover identity:** Discover is one poster, Home is a rhythm of three. Any Home meal
  layout must say what makes it different from Discover's photo hero. Rejected again today:
  auto-rotation as the answer to "show all three".
- **Scan is NOT demoted on Pantry.** Logan pushed back twice; he is right, and the fold problem is
  solved without touching it.
- **"Made from your pantry" is an archive, post-launch.** §6d carries the reasoning.

---

## 6. ENVIRONMENT

- **Metro must run from `/Users/loganshaver/pantry`**, never a worktree.
- Bundler address is solved permanently via the Bonjour name
  `Logans-MacBook-Air-10.local:8081`. A delete-and-reinstall wipes `RCT_jsLocation`; that is the
  only thing that breaks it.
- `npx supabase db query --linked --file <f>` is how to verify prod. `supabase db execute` is not a
  command; the subcommand is `query`.
