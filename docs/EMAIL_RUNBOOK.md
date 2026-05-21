# Email Marketing Runbook

Everything you need to set up the email program. The code-side infra is shipped; this doc walks you through the Loops dashboard work + sequence copy + the launch email send.

---

## Part 1 — Loops dashboard setup (~30 min)

### 1.1 Create the account
1. Sign up at https://loops.so → free tier (1,000 contacts, 4,000 sends/month, all features)
2. Add `heypantry.app` as your sending domain — Loops will give you SPF/DKIM/DMARC records to add via Cloudflare DNS. Add them, then click "Verify" in Loops.
3. Set your "From" name and reply-to:
   - From name: `Pantry`
   - From email: `team@heypantry.app` (or `hello@heypantry.app`)
   - Reply-to: `team@heypantry.app` — you'll want a Cloudflare email forwarder for this if you don't already have one

### 1.2 Get the API key
1. Loops dashboard → Settings → API
2. Generate an API key
3. Add to Supabase secrets:
   ```bash
   npx supabase secrets set LOOPS_API_KEY=<your-key>
   ```
4. Also generate one admin token for the bulk waitlist import:
   ```bash
   npx supabase secrets set IMPORT_ADMIN_TOKEN=$(openssl rand -hex 32)
   ```
   Save that token — you'll need it once to trigger the waitlist import.

### 1.3 Create contact properties in Loops
Loops auto-creates properties when our `loops-sync` function fires them, but you can pre-create them in Settings → Contact Properties:

| Property name | Type | Used by |
|---|---|---|
| `pantry_marketing_opt_in` | Boolean | All sequence conditions |
| `pantry_is_apple_private_relay` | Boolean | Filter out marketing sends |
| `pantry_is_engaged` | Boolean | "Skip if engaged" condition |
| `pantry_cook_tonight_used_count` | Number | Engagement tracking |
| `pantry_meals_saved_count` | Number | Engagement tracking |
| `pantry_goals_customized` | Boolean | Engagement tracking |
| `pantry_last_active_at` | Date | Re-engagement detection |
| `pantry_trial_started_at` | Date | Trial sequence trigger |
| `pantry_trial_ended_at` | Date | Win-back sequence trigger |
| `pantry_subscribed_at` | Date | Stop trial sequences |
| `pantry_is_waitlist` | Boolean | Filter the launch email audience |

### 1.4 Enable time-of-day optimization
Loops → Settings → Send Time Optimization → toggle ON. Loops will learn each contact's open patterns and send when they're most likely to read. Free tier supported.

---

## Part 2 — Build the 4 email sequences

For each sequence, create in Loops dashboard: **Loops → Loops** → New Loop → choose trigger.

### 2.1 Trial Conversion Sequence (HIGHEST PRIORITY)

**Trigger event:** `trial_started`
**Audience filter:** `pantry_marketing_opt_in = true` AND `pantry_is_apple_private_relay = false`

| Day | Email key | Subject (≤50 chars) | Skip condition |
|---|---|---|---|
| 0 (immediate) | `trial_welcome` | Welcome to Pantry — start here | none |
| 3 | `trial_day_3_value` | 3 ways our top users get more from Pantry | `pantry_is_engaged = true` (skip if user already cooking) |
| 6 | `trial_annual_pitch` | Save 68% — Pantry annual is $30/yr | none |
| 7 (fires only if `subscribed_at` is null on day 7) | `trial_expired_winback` | Trial ended — here's 50% off | none |

**Reverse-fail safety:** add an exit rule on every loop — if `subscribed_at` is set, exit the loop immediately. Prevents emails to converted users.

### 2.2 Welcome Series (for non-trial sign-ups)

**Trigger event:** `user_signed_up`
**Wait 24h then check** `trial_started_at` — if not set, enter this sequence.
**Audience filter:** `pantry_marketing_opt_in = true` AND `pantry_is_apple_private_relay = false`

| Day | Email key | Subject |
|---|---|---|
| 0 | `welcome_value` | Welcome — your first action inside |
| 7 | `welcome_recipe_drop` | 3 high-protein dinners under 600 cal |
| 14 | `welcome_soft_trial_pitch` | Ready to stop guessing what's for dinner? |

### 2.3 Re-engagement (for users who go quiet)

**Trigger event:** `user_reengaged` (fires automatically when a user opens the app after >3 days silence — the engagement.ts helper does this)
**Audience filter:** `pantry_marketing_opt_in = true` AND `pantry_is_apple_private_relay = false` AND `pantry_subscribed_at = null` (don't re-engage paying users)

Single email, send immediately:
| Email key | Subject |
|---|---|
| `reengage_welcome_back` | Noticed you came back — here's the one thing to try |

### 2.4 Launch Email (one-time campaign — NOT a sequence)

For the existing waitlist + future use:
- Build as a **Campaign** in Loops, not a Loop
- Audience filter: `pantry_is_waitlist = true`
- Send manually when the app is live on the App Store

---

## Part 3 — Email copy (paste into Loops drafts)

All emails are designed plain-text-style (no big graphics, no marketing template chrome) per the higher open-rate research. Each ≤120 words, single CTA, mobile-first.

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

### `trial_day_3_value` (Day 3, SKIP if engaged)

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

### `trial_annual_pitch` (Day 6, all)

**Subject:** Save 68% — Pantry annual is $30/yr
**Preview text:** Same Pantry, locked in for the year.

```
Hey {{firstName}},

Your trial ends tomorrow. Quick math:

Monthly: $7.88/mo = $94.56/year
Annual:  $30/year

If you're going to keep using Pantry past 4 months (which is what most members do), annual saves you $64/year.

Open the app to switch to annual before the trial converts. Same Pantry, just locked in for the year.

— Logan

P.S. If you've decided Pantry isn't for you, no worries — just cancel from your iPhone Settings → Apple ID → Subscriptions before midnight tomorrow.

(Unsubscribe: {{unsubscribeUrl}})
```

### `trial_expired_winback` (Day 7, only fires if not subscribed)

**Subject:** Trial ended — here's 50% off
**Preview text:** Want to come back? One-time offer inside.

```
Hey {{firstName}},

Your free trial just ended, and I noticed you didn't keep going.

Totally fair if Pantry isn't right for you. But if life just got busy and you didn't get a chance to really try it — here's a one-time offer:

50% off your first month. $3.94 instead of $7.88.

Tap to redeem: pantry://redeem/winback50

The offer expires in 7 days. After that, the regular price kicks back in.

Either way, thanks for trying Pantry. Reply if you have feedback — I want to know what didn't click.

— Logan

(Unsubscribe: {{unsubscribeUrl}})
```

### `welcome_value` (Day 0, non-trial sign-up)

**Subject:** Welcome — your first action inside
**Preview text:** One quick thing while everything's fresh.

```
Hey {{firstName}},

Welcome to Pantry.

Even without a subscription, you've got the basics: pantry tracking, meal logging, macro tracking.

The one thing I'd recommend doing right now while it's fresh: open the app and add 5-10 items to your pantry. Even if you don't try Cook Tonight today, those items make every future suggestion sharper.

I'll send a few recipe ideas next week. Until then.

— Logan

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

7-day free trial, then $7.88/mo or $30/yr. Cancel anytime from iPhone Settings.

Try it: pantry://trial

— Logan

(Unsubscribe: {{unsubscribeUrl}})
```

### `reengage_welcome_back` (Re-engagement)

**Subject:** Noticed you came back — here's the one thing to try
**Preview text:** Pick up where you left off.

```
Hey {{firstName}},

Noticed you opened Pantry today after a bit of a gap.

If you're not sure where to pick back up, here's the one thing to try: tap "Cook Tonight" on the home screen. It generates a meal you can make right now with what's in your pantry.

Takes 5 seconds. Solves dinner in 30.

— Logan

(Unsubscribe: {{unsubscribeUrl}})
```

### `launch_email` (Launch campaign, sent to waitlist)

**Subject:** Pantry is live — your early access link inside
**Preview text:** The wait's over. Download below.

```
Hey there,

A few weeks ago you joined the waitlist for Pantry.

It's live. Download here: https://apps.apple.com/app/pantry-food-tracker/id...

Quick recap of what it does:
- AI generates 3 meals every morning from what's in your pantry
- High-protein, macro-aware, no diet-food clichés
- Cook from what you have OR plan ahead with a grocery list

Free 7-day trial, then $7.88/mo or $30/yr.

If you have any issues or feedback, just hit reply.

— Logan
Founder, Pantry

(Unsubscribe: {{unsubscribeUrl}})
```

---

## Part 4 — Trigger the waitlist import + launch email

When the app is live and you're ready to send:

```bash
# Make sure both secrets are set:
npx supabase secrets list

# Run the import. Replace <TOKEN> with the IMPORT_ADMIN_TOKEN you set earlier.
curl -X POST 'https://fdafjnkqqtpsjtddbfdz.supabase.co/functions/v1/loops-import-waitlist' \
  -H "x-admin-token: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

You'll get back `{ ok: true, imported: N, skipped: 0 }`. All waitlist contacts now live in Loops with `pantry_is_waitlist = true`.

Then in Loops dashboard:
1. Campaigns → New Campaign → use the `launch_email` copy
2. Audience filter: `pantry_is_waitlist = true`
3. Send. Track open rate + click-through over the next 48h.

---

## Part 5 — Deploy

```bash
# Deploy all 3 new edge functions
npx supabase functions deploy loops-sync
npx supabase functions deploy loops-import-waitlist

# Apply the migration to production
npx supabase db push

# Redeploy heypantry.app with updated privacy policy
cd /Users/loganshaver/pantry-landing && npx wrangler pages deploy . --project-name=heypantry
```

---

## Part 6 — Verify everything works

Sandbox test (5 min):
1. Create a new account in the app with the marketing opt-in box CHECKED
2. Check Loops → Contacts — your test email should appear within 30 sec with `pantry_marketing_opt_in = true`
3. Check `profiles` table in Supabase — `marketing_email_opt_in = true`, `marketing_consent_at` set
4. Start a trial via paywall — `pantry_trial_started_at` should populate in Loops
5. Verify the trial_welcome email arrives

If anything fails, check edge function logs:
```bash
npx supabase functions logs loops-sync
```

---

## What's NOT in this MVP (deferred)

- **Refer-a-friend program** — needs App Store Connect API integration (~15-20 hrs). V2.
- **A/B testing different subject lines** — Loops supports natively, set up after 200+ trial-end events accumulate.
- **PostHog dashboards for email funnel** — added to V2 todos. Events are firing today; dashboards built post-launch.
- **Behavioral-trigger sequences** beyond engagement-skip and re-engagement — defer until conversion data shows where users drop off.
