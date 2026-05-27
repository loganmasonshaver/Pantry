# Email Marketing Runbook — V1 (pre-launch)

Everything you need to set up the email program for launch. Code-side infra is shipped; this doc walks you through the Loops dashboard work + sequence copy + the launch email send.

**Scope:** lean V1. The fancier features (engagement-based email skipping, re-engagement loop, winback discount email) are intentionally deferred to V2 because at sub-1K users you can't measure if they actually move conversion. See `~/my-briefing/todos/active.md` V2 section for the deferred details.

---

## Part 1 — Loops dashboard setup (~30 min)

### 1.1 Create the account
1. Sign up at https://loops.so → free tier (1,000 contacts, 4,000 sends/month, all features)
2. Add `heypantry.app` as your sending domain — Loops will give you SPF/DKIM/DMARC records to add via Cloudflare DNS. Add them, then click "Verify" in Loops.
3. Set your "From" name and reply-to:
   - From name: `Pantry`
   - From email: `team@heypantry.app` (or `hello@heypantry.app`)
   - Reply-to: `team@heypantry.app` — set up a Cloudflare email forwarder for this if you don't already have one (same flow you used for `dmca@` and `privacy@`)

### 1.2 Get the API key
1. Loops dashboard → Settings → API
2. Generate an API key
3. Add to Supabase secrets:
   ```bash
   npx supabase secrets set LOOPS_API_KEY=<your-key>
   ```
4. Also generate an admin token for the bulk waitlist import:
   ```bash
   npx supabase secrets set IMPORT_ADMIN_TOKEN=$(openssl rand -hex 32)
   ```
   Save that token somewhere safe — you'll need it once to trigger the waitlist import.

### 1.3 Create contact properties in Loops
Loops auto-creates properties when our `loops-sync` function fires them, but you can pre-create them in Settings → Contact Properties:

| Property name | Type | Used by |
|---|---|---|
| `pantry_marketing_opt_in` | Boolean | All marketing sequence audience filters |
| `pantry_is_apple_private_relay` | Boolean | Hard-block on marketing for these addresses |
| `pantry_trial_started_at` | Date | Trial conversion sequence trigger |
| `pantry_trial_ended_at` | Date | (V2: winback sequence) |
| `pantry_subscribed_at` | Date | Sequence exit condition |
| `pantry_churned_at` | Date | (V2: re-engagement) |
| `pantry_is_waitlist` | Boolean | Launch campaign audience filter |

### 1.4 Enable time-of-day optimization
Loops → Settings → Send Time Optimization → toggle ON. Loops will learn each contact's open patterns and send when they're most likely to read. Free tier supported. **No code change needed — just flip the switch.**

---

## Part 2 — Build the 3 email sequences

For each sequence, create in Loops dashboard: **Loops → Loops** → New Loop → choose trigger.

### 2.1 Trial Conversion Sequence (HIGHEST PRIORITY)

**Trigger event:** `trial_started`
**Audience filter:** `pantry_marketing_opt_in = true` AND `pantry_is_apple_private_relay = false`
**Exit condition (set on every loop):** if `pantry_subscribed_at` becomes set, exit immediately. Prevents emails to users who already converted.

| Day | Email key | Subject (≤50 chars) |
|---|---|---|
| 0 (immediate) | `trial_welcome` | Welcome to Pantry — start here |
| 3 | `trial_day_3_value` | 3 ways our top users get more from Pantry |
| 6 | `trial_annual_pitch` | Save 68% — Pantry annual is $30/yr |

That's it for V1 — 3 emails over 7 days. Day 5 "your trial ends in 2 days" is handled by the push notification already wired in `SuperwallContext.tsx`.

### 2.2 Welcome Series (for non-trial signups)

**Trigger event:** `user_signed_up`
**Audience filter (CRITICAL — gates this sequence away from trial users):**
- `pantry_marketing_opt_in = true`
- `pantry_is_apple_private_relay = false`
- **`pantry_trial_started_at = NULL`** (do NOT send to users who started a trial — they get the trial sequence instead)
- `pantry_subscribed_at = NULL`

**Wait condition:** add a 24-hour delay step at the top of the loop before sending the first email — this gives the trial-conversion path time to fire if the user is going to start a trial. Avoids the welcome series racing the trial sequence.

| Day | Email key | Subject |
|---|---|---|
| 0 (+24h delay) | `welcome_value` | Welcome — your first action inside |
| 7 | `welcome_recipe_drop` | 3 high-protein dinners under 600 cal |
| 14 | `welcome_soft_trial_pitch` | Ready to stop guessing what's for dinner? |

**Exit condition:** if `pantry_trial_started_at` becomes set OR `pantry_subscribed_at` becomes set, exit immediately. Stops emails to users who decide to start a trial mid-series.

### 2.3 Launch Email (one-time campaign — NOT a sequence)

For the existing waitlist + future use:
- Build as a **Campaign** in Loops (not a Loop)
- Audience filter: `pantry_is_waitlist = true`
- Send manually when the app is live on the App Store

---

## Part 3 — Email copy (paste into Loops drafts)

All emails are designed plain-text-style (no big graphics, no marketing template chrome) per the research showing 2-3× higher open rates vs branded templates. Each ≤120 words, single CTA, mobile-first. Subject lines all under 50 chars so they don't truncate on iPhone notification preview.

### `trial_welcome` (Day 0, all trial users)

**Subject:** Welcome to Pantry — start here
**Preview text:** A quick first thing to try while everything's fresh.

```
Hey {{firstName}},

Welcome to your free trial.

The fastest way to feel what Pantry does: open the app and tap "Cook Tonight" on the home screen. It'll find a meal you can make with what's already in your pantry, in under 30 seconds.

After that, scan your pantry once (camera button) to make every future suggestion more accurate.

That's it for today — explore at your own pace.

I'll check in in a few days.

— Logan
Founder, Pantry

P.S. If anything's broken or confusing, just hit reply. I read every email.

(You can unsubscribe anytime, no hard feelings: {{unsubscribeUrl}})
```

### `trial_day_3_value` (Day 3, all trial users still in window)

**Subject:** 3 ways our top users get more from Pantry
**Preview text:** Quick wins — under 30 sec each.

```
Hey {{firstName}},

Day 3 of your trial. Quick check-in.

Three things people who get the most out of Pantry have done in their first week:

1. Scanned their pantry once. Makes every meal suggestion match what you actually have.

2. Set custom macro goals. Default is fine, but personalized targets unlock the macro-distribution magic.

3. Saved 2-3 meals they cooked. The saved-meals tab becomes your personal cookbook over time.

Each takes under 30 seconds. The combo is what makes Pantry stop feeling like "another app" and start feeling like a tool.

— Logan

(Unsubscribe: {{unsubscribeUrl}})
```

### `trial_annual_pitch` (Day 6, all trial users still in window)

**Subject:** Save 68% — Pantry annual is $30/yr
**Preview text:** Same Pantry, locked in for the year.

```
Hey {{firstName}},

Your trial ends tomorrow. Quick math:

Monthly: $7.99/mo = $95.88/year
Annual:  $30/year

If you're going to keep using Pantry past 4 months (which is what most members do), annual saves you $66/year.

Open the app to switch to annual before the trial converts. Same Pantry, just locked in for the year.

— Logan

P.S. If you've decided Pantry isn't for you, no worries — just cancel from your iPhone Settings → Apple ID → Subscriptions before midnight tomorrow.

(Unsubscribe: {{unsubscribeUrl}})
```

### `welcome_value` (Day 0 +24h delay, non-trial sign-up)

**Subject:** Welcome — try Pantry free for 7 days
**Preview text:** Here's the one tap that solves dinner.

```
Hey {{firstName}},

Welcome to Pantry.

Heads up — Pantry's a paid app ($7.99/mo or $30/yr). Every new account gets a 7-day free trial before any charge. Cancel anytime from iPhone Settings before day 7 and you pay nothing.

If you're on the fence: open the app, tap "Cook Tonight" once. It generates 3 meals you can make right now with what's in your pantry. That's the whole product, in one tap.

If that solves "what's for dinner" for you, the trial gives you a week to keep using it before any charge.

— Logan
Founder, Pantry

(Unsubscribe: {{unsubscribeUrl}})
```

### `welcome_recipe_drop` (Day 7, non-trial sign-up)

**Subject:** 3 high-protein dinners under 600 cal
**Preview text:** Steal these for tonight or this week.

```
Hey {{firstName}},

Three high-protein dinners under 600 cal that take less than 30 minutes:

1. Miso-Glazed Salmon Rice Bowl — 520 cal, 42g protein
   Pan-sear salmon 4 min/side, glaze with miso + soy + ginger. Serve over rice with steamed broccoli.

2. Thai Basil Ground Chicken — 480 cal, 38g protein
   Sauté garlic + chili, brown ground chicken, finish with fish sauce + Thai basil. Eat over jasmine rice.

3. Chipotle Lime Chicken Bowl — 540 cal, 45g protein
   Marinate chicken thighs in lime + chipotle, grill 5 min/side. Top with black beans, corn, salsa, lime.

Want the full recipes — ingredients, atomic step-by-step, macros per serving? Pantry generates 30 of these every morning based on what's in your pantry.

Try it free for 7 days: pantry://trial

— Logan

(Unsubscribe: {{unsubscribeUrl}})
```

### `welcome_soft_trial_pitch` (Day 14, non-trial sign-up)

**Subject:** Ready to stop guessing what's for dinner?
**Preview text:** Try Pantry premium free for 7 days.

```
Hey {{firstName}},

You signed up for Pantry two weeks ago. If you're still here, you probably get the value but haven't committed yet.

Premium unlocks the part that actually solves the "what's for dinner" problem: AI meal generation that uses YOUR pantry, your macros, your cooking skill, your dislikes — and produces 3 meals every morning you can actually make tonight.

7-day free trial, then $7.99/mo or $30/yr. Cancel anytime from iPhone Settings.

Try it: pantry://trial

— Logan

(Unsubscribe: {{unsubscribeUrl}})
```

### `launch_email` (Launch campaign, sent to waitlist)

**Subject:** Pantry is live — your early access link inside
**Preview text:** The wait's over. Download below.

```
Hey there,

A few weeks ago you joined the waitlist for Pantry.

It's live. Download here: https://apps.apple.com/app/pantry-food-tracker/id<APP_ID>

Quick recap of what it does:
- AI generates 3 meals every morning from what's in your pantry
- High-protein, macro-aware, no diet-food clichés
- Cook from what you have OR plan ahead with a grocery list

Free 7-day trial, then $7.99/mo or $30/yr.

If you have any issues or feedback, just hit reply.

— Logan
Founder, Pantry

(Unsubscribe: {{unsubscribeUrl}})
```

**⚠️ Before sending: replace `<APP_ID>` with your actual App Store ID** (found in App Store Connect → App Information → Apple ID).

---

## Part 4 — Trigger the waitlist import + launch email

When the app is live and you're ready to send:

```bash
# Verify both secrets are set:
npx supabase secrets list

# Run the import. Replace <TOKEN> with the IMPORT_ADMIN_TOKEN you set earlier.
curl -X POST 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/loops-import-waitlist' \
  -H "x-admin-token: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

You'll get back `{ ok: true, imported: N, skipped: 0 }`. All waitlist contacts now live in Loops with `pantry_is_waitlist = true`.

> **Note:** the import is sequential at ~120ms per contact. If your waitlist has >500 emails, this may approach the 60s edge function timeout. If it fails partway, the response will show which contacts succeeded and you can re-run for the remainder (uniqueness on email prevents dupes).

Then in Loops dashboard:
1. Campaigns → New Campaign → use the `launch_email` copy above
2. Audience filter: `pantry_is_waitlist = true`
3. Send. Track open rate + click-through over the next 48h.

---

## Part 5 — Deploy

```bash
# Deploy all 3 new edge functions (loops-sync, loops-import-waitlist, delete-account refresh)
npx supabase functions deploy loops-sync
npx supabase functions deploy loops-import-waitlist
npx supabase functions deploy delete-account

# Apply the email-marketing schema migration to production
npx supabase db push

# Redeploy heypantry.app with updated privacy policy (Loops sub-processor disclosure)
cd /Users/loganshaver/pantry-landing && npx wrangler pages deploy . --project-name=heypantry
```

---

## Part 6 — Verify everything works (~5 min sandbox test)

1. Create a new account in the app with the marketing opt-in box CHECKED
2. Check Loops → Contacts — your test email should appear within 30 sec with `pantry_marketing_opt_in = true`
3. Check `profiles` table in Supabase — `marketing_email_opt_in = true`, `marketing_consent_at` set to a timestamp
4. Verify the `welcome_value` email (after 24h delay) OR start a trial via paywall to verify `trial_welcome` fires
5. Delete the test account → verify the contact is gone from Loops (Contacts list)

If anything fails, check edge function logs:
```bash
npx supabase functions logs loops-sync
npx supabase functions logs delete-account
```

---

## What's NOT in V1 (everything deferred to V2)

The full V2 plan is in `~/my-briefing/todos/active.md` under "V2 Features (post-launch)". Quick summary of what's deferred and why:

- **Engagement-based email skipping** (skip day 3 if user already engaged) — needs wiring 4 UI trigger points; 5-10% conversion optimization not worth measuring at <1K users
- **Re-engagement loop** (auto-fire on 3-day silence) — same reason; small cohort at pre-launch
- **Trial-expired winback discount email** — requires App Store Connect API integration for offer codes (~4-6 hrs)
- **Email-link attribution funnel** — Loops natively tracks opens/clicks; full in-app attribution is V2 polish
- **Refer-a-friend program** — needs Apple-compliant offer code system + fraud detection (~15-20 hrs)
- **Loops unsubscribe webhook → app** — only matters when you add in-app marketing prompts
- **Subscription renewed event** — edge case; sequences exit on `subscribed_at` so this is non-blocking
