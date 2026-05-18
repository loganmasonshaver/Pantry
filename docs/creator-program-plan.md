# Pantry: Creator Program Plan (Day 1–90)

*Generated 2026-05-18. Based on Cal AI playbook + RevenueCat 2026 fitness benchmarks + your unit economics.*

---

## TL;DR

Run Cal AI's playbook, not a discount model.

- **Default paywall:** 3-day free trial → $7.99/mo
- **Creator code (Apple Offer Code):** 7-day free trial → $7.99/mo (adds 4 days as the value unlock)
- **Creator payment:** Flat fee per video ($50–150), not commissions
- **Attribution:** Apple Offer Code redemption events → Superwall webhook → Supabase `subscription_events` table
- **Tiered structure:** 1 shared Apple Offer slot for the long tail (50+ creators), up to 9 unique slots for top performers

This avoids the API cost drain of "free first month" promos and uses the Apple Offer Code 10-slot limit efficiently.

---

## Why this beats the alternatives

**My earlier recommendation was 50% off first month. The data says don't.**

| Strategy | 90-day GP per 1000 installs | Risk |
|---|---|---|
| Attribution-only (full price) | $1,487 | Low code redemption (~5%) |
| **7-day trial via code (Cal AI)** | **$1,684** ⭐ | Low; cleanest funnel |
| 50% off first month | $1,750–$2,490 | Worse retention (RevenueCat) + burns Apple slots |
| Free first month | $507 | Cash drag in month 1; ~6.9% conversion |

The 50% discount looks best on paper, but RevenueCat 2026 fitness data shows discount-first-month cohorts have 20-40% worse 90-day retention vs. organic. After you reprice for that, the trial-bonus strategy wins on margin AND cohort quality.

---

## Unit economics

| | Value |
|---|---|
| Subscription | $7.99/mo |
| Apple cut (SBP year 1) | 15% |
| Net per paying user | $6.79/mo |
| API cost per active premium user | $1.20/mo |
| **Contribution margin per paying user** | **$5.59/mo (~70%)** |
| Cost-to-revenue ratio | 18% (high — most SaaS is <5%) |

**Implication:** Every "free" user actively burns ~$1.20/mo. Free-month codes are real cash drain, not just "missed revenue."

---

## 90-day financial model (per 1000 creator-attributed installs)

### Strategy B — 7-day trial bonus via Apple Offer Code (recommended)

| | Month 1 | Month 2 | Month 3 | 90-day |
|---|---|---|---|---|
| Code redeems (trial) | 300 (30%) | — | — | — |
| Trial → paid (15%) | 45 | — | — | — |
| Organic paywall (70% remainder × 10%) | 70 | — | — | — |
| **Paying users** | **115** | **105** | **94** | — |
| Revenue | $780 | $713 | $638 | $2,131 |
| API cost | $208 | $126 | $113 | $447 |
| **Gross profit** | **$572** | **$587** | **$525** | **$1,684** |

### Growth scenarios — D90 MRR under Strategy B

Assumes each creator drives ~250 installs/month.

| Scenario | Creators | Installs (90d) | Paying D90 | MRR D90 |
|---|---|---|---|---|
| Slow | 5 | 3,750 | ~280 | $1,901 |
| **Expected (Cal AI early-days analog)** | **20** | **15,000** | **~1,120** | **$7,605** |
| Viral (1 hit + 20 creators) | 21 | 40,000 | ~3,000 | $20,370 |

---

## Case study validation

### Cal AI ($0 → $50M exit in 12 months)
- 3-day free trial as audience carrot
- Flat fees to creators (scaled to views, not followers)
- Funnel order: creators FIRST, then paid ads layered on at $7K/day once awareness existed, affiliates last
- Sources: [Growthcurve](https://growthcurve.co/three-engines-and-an-exit-the-cal-ai-growth-playbook), [Plutus](https://growwithplutus.com/blog/cal-ai-app-tiktok-strategy), [Shortimize](https://www.shortimize.com/blog/cal-ais-marketing-strategies-lessons-from-a-400k-mrr-success-story)

### MacroFactor ($500K MRR bootstrapped, NO promo codes ever)
- Stronger By Science + Jeff Nippard owned audience (10M+ combined)
- Doesn't apply to you — you don't have an owned audience; codes are the substitute
- Source: [MacroFactor 2025 Annual Report](https://macrofactorapp.com/annual-report-2025/)

### AG1 (commission benchmark — DO NOT COPY at your pricing)
- 20-30% commission + $20 customer discount on $79 sub
- Requires LTV > $700 (12+ month retention) to break even
- Your $7.99 sub can't support these commission rates
- Source: [UpPromote AG1](https://uppromote.com/affiliate-directory/ag1/)

### Industry benchmarks (RevenueCat 2026)
- Health & Fitness trial-to-paid: **6.9% median, 23% top quartile**
- 82.1% of trial starts happen on Day 0 — first-session quality determines everything
- 2-4 week trials convert best (45.7%); <4 day trials convert worst (<27%) — but 3-day filters HARDER for LTV
- Source: [RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps/)

---

## Apple Offer Codes — the hard constraint

- **10 active offers per SKU. Period.** ([Apple Dev docs](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes/))
- Apple reports offer NAME, not code → unique-per-creator attribution requires unique-per-creator offer
- Forces tiered structure:

| Tier | Mechanism | Apple slots used |
|---|---|---|
| Creator personal access | Supabase code (`grants_premium=true`) | 0 |
| Long-tail audience promo | 1 shared Apple Offer Code (7-day trial) | 1 |
| Top creator tier (up to 9) | Unique Apple Offer Code per creator | 9 |

---

## Implementation plan (90 days)

### Weeks 1-2: Infrastructure
- Wire Superwall webhook → `subscription_events` Supabase table (`{user_id, event_type, code, occurred_at}`)
- Extend `validate_referral_code_v2` RPC to handle three code types:
  - `creator_personal` (free forever, single-use)
  - `creator_promo` (attribution-only, multi-use)
  - `apple_offer_alias` (no-op locally, just tags the creator)
- Build `/admin/creators` route: per-creator redemptions, M1 conversions, M2 retention, computed CAC

### Week 3: First Apple Offer Code
- Set up `pantry_monthly` subscription product in App Store Connect
- Create ONE offer: "Long-tail creator pool" = 7 days free trial
- Generate ~50 codes from that offer
- Test redemption flow on TestFlight

### Week 4: First creator pilot
- Pick one creator (10K-100K followers, high engagement, food/fitness niche)
- Deal: $50 flat fee + 1 video + free personal access + their followers get 7-day trial code
- Vanity URL: `heypantry.app/c/[name]` → App Store with code preloaded
- Measure: views → app store visits → installs → redemptions → M1 conversions

### Weeks 5-8: Scale long tail
- Onboard 5-10 creators/week with same flat-fee deal
- All share the same Apple Offer Code
- Attribution via Supabase `referral_code_used`
- Daily review of admin dashboard; cut underperformers fast

### Weeks 9-12: Tier the program
- Top 3-5 creators by conversion: upgrade to unique Apple Offer Code with free first month (consume 3-5 of 10 slots)
- These become flagship partnerships; possibly add 20% rev-share for the very best
- Re-measure: are top-tier offers worth the extra cost vs. the pool?

### Day 90 decision point
- MRR > $5K → layer paid ads (Cal AI's step 2)
- MRR < $2K → cut creator program, revisit positioning
- MRR $2-5K → optimize same playbook for another 90 days

---

## Failure modes to plan for

1. **Multi-accounting fraud** — users cycle Apple IDs to re-claim trials. Mitigate via redemption caps per code + Supabase device fingerprinting via `expo-device`.
2. **Promo cohorts churn harder than organic** — track promo vs. organic LTV separately; never blend in dashboards.
3. **Creator code reuse confusion** — unique vanity URLs per creator solve this.
4. **Cash drag during ramp** — 7-day trials only cost ~$0.28/redemption (1/4 month of API). Absorbable at any scale.
5. **Operational complexity > revenue** — build the dashboard before creator #5, not after.

---

## What to verify before fully committing

1. **YOUR first creator cohort's trial→paid rate.** Industry median is 6.9%; your funnel could be 3% or 18%. Measure before scaling.
2. **Whether creators take $50 flat fees.** Mid-tier fitness creators increasingly want $200-500/video. If $50 doesn't get traction, you may need to barter heavier (rev share, equity, free product).
3. **Whether 7-day trial converts well enough.** If D90 trial conversion <10%, extend to 14-day (RevenueCat says 45.7% median conversion — at the cost of more API spend during the trial).

---

## Final recommendation in 3 sentences

Build Cal AI's exact funnel: pooled 7-day free trial Apple Offer Code for creator audiences (vs. 3-day default for organic), Supabase attribution per creator, flat-fee creator payments scaled to views. Reserve up to 9 Apple Offer Code slots for top creators only — don't waste them early. Wire the Superwall webhook + admin dashboard first; nothing else matters if you can't measure per-creator LTV.

---

## Sources

- [Cal AI growth playbook (Growthcurve)](https://growthcurve.co/three-engines-and-an-exit-the-cal-ai-growth-playbook)
- [Cal AI TikTok strategy (Plutus)](https://growwithplutus.com/blog/cal-ai-app-tiktok-strategy)
- [Cal AI marketing lessons (Shortimize)](https://www.shortimize.com/blog/cal-ais-marketing-strategies-lessons-from-a-400k-mrr-success-story)
- [Cal AI Micro Empires](https://www.microempires.cc/p/cal-ai)
- [Zach Yadegari exit profile (Yuanchang)](https://yuanchang.org/en/posts/zach-yadegari-cal-ai-50m-exit/)
- [MacroFactor 2025 Annual Report](https://macrofactorapp.com/annual-report-2025/)
- [AG1 affiliate commissions](https://uppromote.com/affiliate-directory/ag1/)
- [AG1 affiliate review (Creator Hero)](https://www.creator-hero.com/blog/ag1-affiliate-program-in-depth-review-pros-and-cons)
- [AG1 marketing strategy (Latterly)](https://www.latterly.org/ag1-marketing-strategy/)
- [RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- [RevenueCat 2026 benchmarks blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/)
- [RevenueCat trial conversion chart](https://www.revenuecat.com/docs/dashboard-and-metrics/charts/trial-conversion-chart)
- [Apple Offer Codes — subscriptions setup](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes/)
- [Apple Offer Codes for iOS Apps (Appbot)](https://appbot.co/blog/apple-offer-code/)
- [Apple custom codes for influencers (Purchasely)](https://www.purchasely.com/blog/apple-releases-custom-codes-and-unlocks-influencers-referral-capacity)
- [Promo abuse failure modes (Ravelin)](https://www.ravelin.com/insights/policy-abuse)
- [Promo code abuse risks (Hitprobe)](https://hitprobe.com/blog/promo-code-abuse)
