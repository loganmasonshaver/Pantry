---
name: metadata-audit
description: Review App Store metadata and Superwall paywall copy as a skeptical
  user who almost doesn't convert. Triggers on "audit my metadata", "review my
  screenshots", "why isn't the paywall converting", "check my App Store listing",
  "review this paywall copy".
---

# Metadata Audit — the skeptical-user pass

## When it triggers
Before every App Store submission, after any paywall copy/design change, or when
trial starts or conversion look soft in PostHog.

## The one rule
**Audit the moment of doubt, not the assets.** The user you're writing for has
one thumb on the close button: they found the app 10 seconds ago, they've gotten
zero value yet (premium-only — the paywall lands at onboarding step 8, before
any real payoff), and they've been burned by subscription apps before. Every
piece of copy is judged by whether it survives THAT person.

## The method
Walk the funnel in order, in character as that skeptic:
1. **Search card (icon + name + subtitle + first 2 screenshots).** Within 2
   seconds: do I know what this app does and why it beats the free notes app I'd
   otherwise use? The name is "Pantry" in UI, "Pantry: Food Tracker" official —
   flag any drift.
2. **Screenshots.** First screenshot must state the core promise in overlay text
   readable at thumbnail size. Each following one earns its slot: one benefit
   each, no two making the same point, no feature the skeptic wouldn't care
   about pre-purchase. (Assets are AI-generated, not Figma — critique content
   and order, and supply exact replacement overlay copy.)
3. **Description first 3 lines** (all that shows before "more"): benefit, not
   architecture. No jargon, no "AI-powered" without the payoff it buys.
4. **Paywall copy.** The three questions the skeptic asks, in order:
   - "What do I get RIGHT NOW?" — the value proposition above the fold
   - "What am I committing to?" — trial framing must be exactly the safe version:
     "try free for 7 days before any charge." Price is $7.99/mo; yearly is
     $29.99 in the IAP and may round to "$30" in marketing prose — flag any
     other number, and flag "$30" if it appears where the exact IAP price
     shows (paywall price labels, App Store Connect).
   - "Can I trust the cancel?" — is how-to-cancel visible or implied?
5. **Premium-only integrity sweep.** Nothing anywhere — screenshots, description,
   paywall, website copy — may imply a free tier, "basic features," or any access
   without subscribing. One leaked "free" promise creates refund tickets and
   review bombs.
6. **The close-button test.** End in character: "I almost closed the app at ___
   because ___" — the single highest-leverage fix, stated plainly.

## The standards
- Every finding names the exact asset + the exact words, and proposes replacement
  copy — critique without a rewrite is half a finding
- Ranked by conversion impact, max 5 findings; a wall of nitpicks buries the one
  that matters
- Consistency is part of the audit: price, trial length, and brand name must
  match across App Store, paywall, and heypantry.app
- Approval risk flagged separately: anything App Review could read as misleading
  (features not in build, prices that don't match App Store Connect)

## The output
Max 5 ranked findings (asset → quoted words → why the skeptic bounces → rewrite),
the close-button verdict, and an offer to apply the copy fixes worst-first.

## The honest limits
This is taste plus funnel logic, not data — a real A/B test in Superwall beats
any single opinion, and PostHog numbers overrule the skeptic every time. It can
only audit what's pasted in or in the repo: live Superwall variants and App
Store Connect state must be provided as screenshots, not assumed. And it judges
copy, not price strategy — "is $7.99 right" is an honest-advisor question.
