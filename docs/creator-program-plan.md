# Pantry: Creator Program Plan

*Latest revision 2026-05-18 after deep deliberation on commission structure, attribution stack, and stage-aware optimization.*

---

## TL;DR

**Stage 1 (current — pre-launch / first 6 months):** 50% of first payment, one-time, paid to affiliate when their referred user converts post-trial. Attribution via Supabase `referral_codes` table + Superwall `referralCode` user attribute. No Apple Offer Codes, no webhook to Supabase, no admin UI yet.

**Stage 2 (12+ months out, held in reserve):** graduate proven creators (100+ paid conversions/quarter) to $500/mo flat retainer + 15% recurring on their referrals for 6 months.

**Trial structure:** Default 7-day trial stays. Codes are attribution-only (don't change user experience).

---

## Final commission decision: 50% first-conversion

### What it is

| | Amount |
|---|---|
| Monthly conversion ($8/mo) | $4 once per converted user |
| Annual conversion ($30/yr) | $15 once per converted user |
| Triggers on | First paid charge AFTER 7-day trial completes |
| Renewals | $0 — creator earns nothing on renewals |
| Cap per creator | Unlimited (Stage 1 is about finding golden geese) |

### Why this beat 20% recurring

The math was actually close — 20% recurring is cheaper for failures (most relationships end in 1-3 months), while 50% one-time caps the cost of golden geese. Portfolio totals over 6 months are within ~$400 of each other.

**The deciding factor: STAGE.** At pre-launch the bottleneck is creator yes-rate, not unit economics. 50% one-time:
1. Pitches better — "50%" anchors as the bigger headline number to newbie creators
2. Bounded liability — no compounding risk on the rare golden goose
3. Simpler operationally — one payment per user, no monthly accounting per creator
4. Cleaner pitch — "50% of what each user pays me, once when they finish their trial"

### Why NOT recurring at Stage 1

Even though recurring is technically more profitable per creator on average:
- **Adverse selection risk** if we ever offered choice between models
- **Compounding cost on golden geese** could blow past the first-conversion cap
- **Operational drag** of monthly per-creator accounting on a solo dev
- **Newbie creators don't fully understand recurring math** — the "passive income" framing leads to mismatched expectations when reality is 1-3 month tenure

---

## Stage 2 graduation path (held in reserve)

Don't build the Stage 2 mechanics until a golden goose actually emerges.

**Criteria:** creator drives 100+ paid conversions in any rolling 90-day window

**Offered upgrade:** transition to "$500/mo flat retainer + 15% recurring on referred users for 6 months" — capped at 6 months recurring to avoid permanent commitment

This gives every creator a coherent story:
- New creator: "Join our 50% affiliate program"
- Proven creator: "Welcome to our Top Tier — here's your retainer deal"

---

## Attribution stack

**Codes:** Stored in existing Supabase `referral_codes` table with `grants_premium=false` for affiliate-tracking codes.

**Tracking:** Superwall `identify(userId, { referralCode: 'JOHN' })` tags every event from that user. Implementation needs ~10 lines of code added to:
- [app/_layout.tsx](app/_layout.tsx) — fetch `profiles.referral_code_used` on session change, call `superwallUpdate({ referralCode })`
- [app/onboarding/index.tsx](app/onboarding/index.tsx) — call `superwallUpdate` right after `finish()` upsert so paywall in same session is tagged

**Dashboard:** Superwall dashboard → Analytics → filter/group by `referralCode` attribute. Per-creator conversion + revenue visible natively, no custom UI needed.

**Why NOT Apple Offer Codes:** 10-active-per-SKU limit forces tiered structure. Not worth the complexity at current scale.

**Why NOT Supabase webhook:** Superwall analytics already shows per-attribute conversion + revenue. Webhook would only add value for cross-joining with pantry/meal data (future ML / cohort analysis — Year 2 problem).

---

## Trial structure (no change)

- **Default:** 7-day free trial → $8/mo or $30/yr
- **Code-redeemed:** same 7-day trial (codes are attribution-only, no extra value unlock)
- **Why not 3-day:** Apple's trial-eligibility-once-per-app rule creates a one-way door. Going 7→3 forecloses options for users who already triggered the 7-day trial. The "cohort quality" advantage of 3-day only matters at scale with retention data we don't have yet.

---

## Unit economics at $8/$30 pricing

Assuming realistic API cost of ~$0.30/mo per active user (NOT the older $1.20 estimate — Gemini Flash Lite migration killed the meal-gen cost):

| Plan | User pays | Apple (15%) | Your net | API cost | First-period profit |
|---|---|---|---|---|---|
| Monthly $8 | $8.00 | −$1.20 | $6.80 | −$0.30/mo | **$6.50/mo** |
| Annual $30 | $30.00 | −$4.50 | $25.50 | −$3.60 (12mo) | **$21.90/year** |

After 50% first-conversion commission:
- Monthly conversion: +$2.50 month 1 (then $6.50/mo pure margin every renewal)
- Annual conversion: +$6.90 year 1 (then pure margin if they renew Y2)

**Verify with real numbers:** check OpenAI + Replicate billing dashboards for actual cost-per-active-user before scaling. The $0.30 estimate could be off in either direction.

---

## Implementation status

| Component | Status |
|---|---|
| `referral_codes` table + RPC | ✅ Already built |
| Onboarding code entry (`SReferralCode`) | ✅ Already built |
| `referral_code_used` stored on profile | ✅ Already wired |
| Superwall `referralCode` user attribute | ⏳ Not yet wired (~10 min of work) |
| Test code in DB | ⏳ Need to insert one for testing |
| Affiliate pitch script | ⏳ Not yet drafted |
| First creator signed | ⏳ Pre-launch |

---

## Implementation checklist when ready to ship Stage 1

1. **Insert test code** in Supabase (`grants_premium=false` for attribution-only)
2. **Wire Superwall attribute** — modify [app/_layout.tsx](app/_layout.tsx) + [app/onboarding/index.tsx](app/onboarding/index.tsx) to pass `referralCode` via `superwallUpdate`
3. **Test end-to-end:** sign up with test code → complete trial → verify in Superwall dashboard that user is tagged
4. **Draft pitch DM:** "50% per converted user + free lifetime account + founding creator badge"
5. **Send 10 DMs** to creators (food/macro/fitness, 10K-50K followers, 2%+ engagement)
6. **Pay monthly** based on Superwall analytics count × $4 (monthly) or × $15 (annual)

---

## Affiliate pitch template

> "Hey [creator] — launching Pantry soon, an AI cooking app that builds meals from what's already in your pantry. Want to join the founding affiliate program?
>
> - **50% commission** on every paid user from your code (paid once they finish their 7-day trial)
> - **Free lifetime premium account** for you
> - **Founding Creator badge** in the app
>
> No contracts. If your audience converts, you earn. If not, no hard feelings. Interested?"

That's the entire pitch. Don't customize per creator until they prove they're a golden goose.

---

## Risks to plan for

1. **Multi-account fraud** — users cycle Apple IDs to re-trial. Cap codes at lower max redemptions, fingerprint via expo-device.
2. **Creator code typos** — "MRJOHN" vs "MR JOHN" loses attribution. Keep codes short, all caps, no punctuation. Define aliases for popular codes.
3. **Promo cohorts churn harder than organic** — track promo vs organic LTV separately in Superwall.
4. **Operational complexity creep** — if creators start asking for custom terms, point them to Stage 2 graduation criteria. Don't customize per creator until 100+ conversions/quarter.

---

## What I'd verify before scaling Stage 1 to 20+ creators

1. **First creator's trial→paid conversion rate.** Industry median is 6.9% (RevenueCat 2026 fitness). Yours could be 3% or 18%. Measure before scaling.
2. **Actual API cost per active user.** Check OpenAI + Replicate dashboards. The $0.30 estimate could be off.
3. **Pitch yield.** If <5% of DM'd creators say yes, the pitch needs work before scaling outreach.

---

## Sources

Same set as the original research:
- [RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- [Cal AI growth playbook (Growthcurve)](https://growthcurve.co/three-engines-and-an-exit-the-cal-ai-growth-playbook)
- [AG1 affiliate commissions](https://uppromote.com/affiliate-directory/ag1/)
- [Apple Offer Codes docs](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes/)
- [MacroFactor 2025 Annual Report](https://macrofactorapp.com/annual-report-2025/)
