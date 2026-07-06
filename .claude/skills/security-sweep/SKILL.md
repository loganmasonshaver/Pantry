---
name: security-sweep
description: Review everything about to ship the way an attacker would read it —
  tuned to Supabase RLS, Edge Functions, client-trusted writes, and IAP/Superwall
  entitlements. Triggers on "is this safe to ship?", "security check", "sweep
  this before launch", "could someone abuse this?".
---

# Security Sweep — Expo + Supabase + Superwall edition

## When it triggers
Before launch, before submitting to App Review, or after any change touching
auth, entitlements, payments, or Edge Functions.

## The one rule
**The client is an attacker with a valid JWT.** Anything the app can write, a
script with that user's token can write too — with any value it likes.

## The method
Work through these in order; each has already produced a real finding here:
1. **Entitlement writes.** Grep every client-side write to `profiles` and any
   table gating access (`promo_active`, subscription flags). Each must be either
   RLS-blocked or moved behind a SECURITY DEFINER RPC that validates server-side.
   (History: `promo_active` was once written straight from an AsyncStorage flag.)
2. **RLS on every table.** For each table: is RLS enabled, and does each policy
   scope to `auth.uid()`? Try the ID-swap: could user A pass user B's row id?
3. **Edge Functions.** Does each function verify the JWT and derive the user from
   it (never from the request body)? Are service-role keys only in function env,
   never in app code?
4. **Server-side limits.** The 5/day scan cap and any cost ceilings must be
   enforced in the Edge Function, not the client — the client counter is UX only.
5. **Secrets in the bundle.** Anything `EXPO_PUBLIC_*` or hardcoded ships in the
   IPA and is readable. Only the anon key and truly public config belong there.
6. **Payment truth.** Premium status must trace to Superwall/Apple receipt
   verification, not a client-set boolean. Check the webhook/entitlement path.
7. **SECURITY DEFINER audit.** Each such function: what can a hostile caller make
   it do? Validate inputs inside the function, not before the call.

## The standards
- Every finding is one plain-English sentence: "an attacker could ___", with file:line
- Ranked worst-first by what an attacker actually gains, not by theoretical severity
- Reachable vs theoretical explicitly separated — a past review produced 87 findings
  and one false positive that each cost triage time; fewer, verified findings win
- Zero findings is a valid result if genuinely checked — say what was checked

## The output
A ranked list (worst first) of real attacker capabilities with exact locations,
each with a proposed fix, and an offer to fix worst-first.

## The honest limits
This is a careful read, not a penetration test — before handling other people's
money at scale, get a professional. It also can't see Superwall dashboard
config, App Store Connect settings, or Supabase dashboard policies not in the
repo — list those as "verify manually in dashboard" items rather than guessing.
