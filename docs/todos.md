# Pantry App — Active Todos

## 🔨 In Progress
- [x] RevenueCat → Superwall migration (SDK wired, placements configured, dashboard set up)
- [ ] Design Superwall paywall to match Pantry UI (after frontend redesign)
- [x] Freemium gates (1 suggestion/day, 5 saved meals on free tier)

### Payment Strategy (Stripe vs Apple IAP)
- [ ] Research Stripe mobile checkout UX — study apps using Stripe on iOS with native feel (in-app WebView, Apple Pay via Stripe, minimal friction). Conversion drops if checkout feels like a redirect.
- [ ] Decide: Stripe (~3% fee) vs Apple IAP (15-30% fee) — Stripe saves $1+/subscriber/mo but must feel seamless
- [ ] If Stripe: set up Stripe account, build web checkout on heypantry.app, handle subscriptions via webhooks → Supabase
- [ ] If Apple IAP: Configure App Store Connect products (pantry_monthly, pantry_annual, pantry_lifetime), keep Superwall

## 📋 Features Left to Build

### Monetization
- [x] PostHog analytics integration

### Google + Apple Sign-In
- [x] Enable Google provider in Supabase Auth dashboard
- [x] Enable Apple provider in Supabase Auth dashboard
- [x] Install packages (expo-apple-authentication, expo-web-browser, expo-auth-session)
- [x] Add Google + Apple Sign-In buttons to create account and sign-in screens
- [x] Wire up Apple Sign-In via signInWithIdToken
- [x] Wire up Google Sign-In via Supabase OAuth web flow
- [x] Configure Google Cloud OAuth (Web + iOS client IDs)
- [x] Test Google Sign-In end-to-end (fixed: redirect URL matched to pantry://callback)
- [ ] Test Apple Sign-In on real device (requires paid Apple Developer account $99/yr)
- [x] Ensure full_name + avatar_url pulled from profiles and saved

### Quick Wins
- [x] Log with AI on Home (describe/photo meal → GPT estimates macros)
- [x] Edit goals from Profile (tap goal rows → edit modal)
- [x] Add to Grocery List from Meal Detail screen
- [x] Fix Home avatar to use full_name initial (currently uses email initial)
- [x] Edit dietary restrictions from Profile settings row

### Macro Override Feature
- [x] Run Supabase migration: create `macro_overrides` table with RLS (user_id, food_key, food_name, calories, protein, carbs, fat)
- [x] Create `hooks/useMacroOverrides.ts` — `getFoodKey(barcode?, foodId?)`, hook with `applyOverride`, `saveOverride`, `deleteOverride`
- [x] Create `components/MacroEditModal.tsx` — pre-filled inputs, "Save Correction" + "Reset to original" + "Cancel" buttons, hint text
- [x] Wire into `FoodSearchModal` detail screen — track scanned barcode, apply override before rendering macros, "Something off? Fix it →" label that opens MacroEditModal

### Medium Features
- [x] Receipt scan → auto-populate pantry (camera → GPT-4o vision → pantry_items)
- [x] Meal rating — thumbs up/down on suggestions to improve future results
- [x] Weight goal — add target weight, show progress on weight card
- [x] Weekly nutrition summary on Profile (aggregate meal_logs by week)
- [x] Push notifications — daily meal log reminder at 7pm (expo-notifications)

### Grocery & Instacart
- [x] Fix grocery list page (Add to Pantry actually inserts, swipe-to-delete rows, toast shows count)
- [x] Auto-update pantry after ordering (prompt on return from Instacart, saves to order_history + pantry_items)
- [x] Meal prep timeline (shows tonight/tomorrow prep schedule after ordering)
- [x] One-tap reorder (empty state shows "Reorder Last" from order_history)
- [x] Progress bar (checked items progress with delivery CTA)
- [x] Contextual nudge on meal detail (missing ingredients banner with "Add all to grocery list")
- [x] Instacart promo card with store logos and time-aware messaging
- [x] Auto-categorization for grocery items (keyword-based, grocery store aisle order)
- [x] Disambiguation picker for ambiguous items (e.g. pepper → Produce or Condiments)
- [x] Duplicate detection (fuzzy matching prevents chicken + chicken breast)
- [x] Re-categorize items on fetch (fixes items stuck in "Other")
- [x] AI-generated meal images via Flux Schnell with shared DB cache (image_cache table)
- [x] Cook Now / Meal Plan mode toggle on home screen
- [x] Log Meal from meal detail with scroll wheel slot picker
- [x] Per-ingredient actions on meal detail (I have this / + Grocery list)
- [x] Pantry auto-categorization matches grocery system (shared lib/categories.ts)
- [x] Landing page deployed to pantryapp.org (Cloudflare Pages)
- [x] Instacart affiliate application submitted (Impact.com — declined, reapply post-launch with traffic)
- [ ] Full Instacart integration — use direct deep links for now, wire affiliate links after reapproval

### Camera UX Improvements
- [x] Pantry scan: replace system camera with inline camera viewfinder (Cal AI style with brackets/shutter)
- [x] Receipt scan: replace system camera with inline camera viewfinder (Cal AI style with brackets/shutter)

### V2 Features (post-launch)
- [x] User recipe uploads — create/edit recipes with AI auto-fill, "My Recipe" badge, filter tab
- [ ] Social media recipe import — YouTube/TikTok caption extraction built, needs Whisper for real transcripts (shelved for post-launch)
- [ ] Social media recipe import — add Instagram support (requires RapidAPI scraper ~$10/mo)
- [ ] "What are you in the mood for?" — mood chips + text input on home screen to generate custom meals
- [ ] Share extension — code built (expo-share-intent), ship post-launch after recipe import is polished

### Smart Goal Calculator (Onboarding "Not Sure" Flow)
- [x] Add age + gender fields to onboarding (collect before macro step)
- [x] Add activity level picker to onboarding: Sedentary, Lightly Active, Moderately Active, Very Active, Athlete
- [x] Add fitness goal picker: Lose Weight, Maintain, Gain Muscle
- [x] Add "Not sure — calculate for me" button on calorie goal step
- [x] Implement Mifflin-St Jeor BMR formula
- [x] Apply activity multiplier to get TDEE
- [x] Apply goal adjustment
- [x] Auto-calculate protein goal
- [x] Show calculated results preview before confirming
- [x] Save age, gender, activity_level, fitness_goal to profiles table (Supabase migration)
- [x] Add "Not sure — recalculate" button on Profile goal rows too (recalc if profile data exists)

### FatSecret + Barcode Scanner
- [x] Sign up for FatSecret Premier Free tier (requires startup eligibility: <$1M revenue, <$1M raised)
- [x] Generate FatSecret API Consumer Key + Consumer Secret from developer dashboard
- [x] Store FATSECRET_KEY and FATSECRET_SECRET in .env and Supabase secrets
- [x] Install expo-barcode-scanner: `npx expo install expo-barcode-scanner`
- [x] Add camera permissions to app.json (NSCameraUsageDescription for iOS)
- [x] Implement FatSecret OAuth 1.0 auth (HMAC-SHA1 signing) ⚠️ trickiest part — flag to Claude early
- [x] Build barcode scan screen: camera → food.find_id_for_barcode → macro data
- [x] Build manual food search screen: text input → foods.search → scrollable results
- [x] Build food detail result card: calories, protein, carbs, fat from food.get endpoint
- [x] Add "Powered by fatsecret" attribution badge to all food result screens (required for free tier)
- [x] Add scan/search entry point to Home or Meal Detail screen (TBD placement)
- [x] Test barcode scanning against real grocery products

## 🐛 Bugs to Fix
- [x] Google Sign-In redirect_uri_mismatch (fixed: OAuth web flow with pantry://callback redirect)
- [x] Apple Sign-In auto-popup on app launch (fixed: conditional render via isAvailableAsync check)
- [ ] Apple Sign-In requires paid Apple Developer account ($99/yr) for Sign in with Apple capability

### Pantry Scan Visual Review
- [x] After pantry scan completes, show the captured photo with detected ingredient names as removable chips. Users can remove items before final categorized review.

## 🧪 Testing
- [x] Test pantry scanning feature with actual iPhone (real device QA)
- [x] Pantry scan: real camera integration (was mock/placeholder)
- [x] Pantry scan: 4-layer AI detection (visual, brand/logo, barcode, nutrition label)
- [x] Pantry scan: zone-based review (items grouped by shelf/area)
- [x] Receipt scan: visual review step with removable chips
- [x] AI Estimate: inline camera viewfinder (Cal AI style)
- [x] AI Estimate: combined photo + describe on same screen after capture
- [x] AI Estimate: macro validation (must add up to calories, suggestion to fix)
- [x] AI Estimate: proportional macro scaling when adjusting calories
- [x] AI Estimate: reset macros button
- [x] Home screen: removed redundant Search/Manual buttons, "Estimate with AI" is prominent green CTA
- [x] Home screen: "Log" button inside expanded empty meal slots
- [x] Food dislikes popup auto-dismissed after onboarding

## 🔒 Security
- [x] Security audit completed (2026-03-25)
- [x] .env added to .gitignore, removed from git tracking
- [x] OpenAI key moved server-side via Supabase Edge Functions (generate-meals, parse-receipt, estimate-meal-macros)
- [x] Rotate OpenAI API key (old one revoked, new one set in Supabase secrets)
- [x] Move FatSecret secret server-side (Edge Function fatsecret-proxy deployed)
- [x] Audit all Supabase RLS policies (all 8 tables now have RLS + user-scoped policies)
- [x] Remove leaked .env.save from git, add .env* to .gitignore
- [x] Rate limiting on all 6 Edge Functions (10-30 req/min per IP)
- [x] Client-side rate limiting on signup (30s cooldown) and signin (progressive: 3s → 15s → 60s)
- [ ] Clean git history of leaked secrets (BFG Repo-Cleaner) — anon key still in old commits
- [x] Enable Cloudflare Turnstile CAPTCHA on Supabase Auth (blocks bots from hitting signup API directly)
- [x] Set Supabase Auth rate limits in dashboard (3 email signups/hour per IP)
- [x] Email OTP 2FA verification on signin and signup (8-digit code via Supabase signInWithOtp)
- [ ] Two-factor authentication with phone number (requires Twilio ~$1/mo + $0.008/SMS)
- [ ] OR: TOTP-based 2FA via authenticator apps (free, built into Supabase MFA)

## 🌐 Infrastructure
- [x] Domain purchased: pantryapp.org (Cloudflare Registrar, $7.50/yr)
- [x] Domain migrated to heypantry.app (Cloudflare Registrar, $12.98/yr)
- [x] Landing page live at https://heypantry.app (Cloudflare Pages)
- [x] Supabase Auth URLs updated to heypantry.app
- [x] Cloudflare Turnstile widget configured for heypantry.app
- [x] Email templates customized (Magic Link + Change Email Address) with Pantry branding

## 💰 Scaling Cost Planning
Current costs per user/month:
- Free user: ~$0.45 (GPT-4o-mini meals, Flux images, AI features)
- Premium user: ~$1.20 (unlimited regenerations)
- Revenue per premium: $6.79 after Apple's 15% cut

Supabase scaling milestones:
- [ ] Free tier: up to 500MB DB, 50k MAU, 500k Edge Function invocations — good until ~1,000 users
- [ ] Pro tier ($25/mo): 8GB DB, 100k MAU, 2M Edge Function invocations — good until ~10,000 users
- [ ] Beyond Pro: Supabase Team plan ($599/mo) or self-host for 10,000+ users
- [ ] Monitor Replicate spending ($5 cap set) — increase as users grow, enable auto-reload
- [ ] Monitor OpenAI spending — set billing alerts at $10, $25, $50
- [ ] Consider caching AI meal responses for common ingredient combos at scale
- [ ] Evaluate switching from Replicate to self-hosted Flux at 50,000+ image generations/month

## 🛠️ Dev Setup
- [x] Create notification chime on Claude terminal whenever it finishes a task

## 🎨 UI Redesign (Google Stitch + UI UX Pro Max + Frontend Design Skill)
Design stack: Google Stitch (mockups) → UI UX Pro Max (design system/palettes/typography) → frontend-design skill (production code)
- [ ] Generate design system with UI UX Pro Max — palette, typography, spacing, component styles for React Native
- [ ] Mock up all screens in Google Stitch — home, pantry, grocery, saved, profile, meal detail, onboarding
- [ ] Export Stitch designs and implement with `/newfeature` + frontend-design skill + UI UX Pro Max guidance
- [ ] Redesign Home screen — macro card, meal cards, today's log section
- [ ] Redesign Onboarding flow — all 9 steps
- [ ] Redesign Meal Detail screen
- [ ] Redesign Pantry + Grocery screens
- [ ] Redesign Saved Meals screen
- [ ] Redesign Profile/Stats screen
- [ ] Redesign modals — FoodSearchModal, AILogModal, MacroEditModal, ReceiptScanModal
- [ ] Compare designs with Figma AI feature — use for reference or iteration
- [ ] Update COLORS constants to match final design system
- [ ] QA all screens on real device after redesign

## 🏢 Business
- [x] Form LLC via Northwest Registered Agent — Koba Labs LLC, Texas, filed 2026-03-29
- [x] Get EIN from IRS — received 2026-03-30
- [x] Apple Developer enrollment reset from Individual — cleared by Apple support 2026-03-30, ready to enroll as Organization once D-U-N-S arrives
- [x] D-U-N-S number requested via Apple/D&B — submitted 2026-03-30
- [x] D&B docs sent — BIR form + EIN submitted 2026-03-30 (Case #10202968). Certificate of Formation pending from Texas (est. April 3)
- [ ] Enroll in Apple Developer Program as Organization ($99/yr — needs D-U-N-S + EIN)
- [ ] Open business bank account with Mercury (mercury.com — needs EIN + LLC docs)
- [ ] Start "build in public" content — share dev process on TikTok/Instagram/X (start before launch)
- [ ] Start influencer outreach once LLC is filed — pitch Pantry, open to pivoting app concept if creator has strong audience + better idea
- [ ] Find content lead partner — high IQ, hardworking, culturally in-tune, food/fitness niche, 20% equity starting point
- [ ] Content lead tests hooks and finds viral UGC format for Pantry
- [ ] Once viral format found, distribute to additional creators to scale UGC campaign

## 📱 Content Ideas (record 60s screen recordings)
- [ ] Show the new "Your plan is ready" onboarding preview step
- [ ] Show the press-and-hold commitment button in action
- [ ] Show missing kitchen staples nudge suggesting items to add
- [ ] Show food search with real macro data from FatSecret
- [ ] Show AI generating personalized meals based on pantry items
- [ ] Show pantry scan detecting items from a photo with AI
- [ ] Show receipt scan auto-populating the pantry
- [ ] Show barcode scanning pulling up nutrition data instantly
- [ ] Show the email OTP verification flow (security feature)
- [ ] Show "Estimate with AI" — snap a photo of food, get macros
- [ ] Show the macro tracking home screen filling up through the day
- [ ] Show importing a recipe from a YouTube/TikTok link
- [ ] "Building an AI meal app as a solo dev" — talk over the home screen
- [ ] Show the onboarding flow — goals, preferences, macro calculator

## 🔧 Pre-Launch Fixes
- [x] Wire up real Carbs/Fat tracking — goals auto-calculated, all 4 logging flows persist data, macro card uses real values
- [x] Fix food search — macros now fetched from actual servings, match detail screen exactly
- [x] Fix meal slot defaulting — tapping Log on Lunch defaults to Lunch, not Breakfast
- [x] Remove fake weight chart mock data — replaced with empty state "Log your weight to see progress"
- [x] Delete unused Instacart promo card styles (removed 6 dead style definitions from grocery.tsx)
- [x] Prioritize oldest pantry ingredients in meal generation prompt — sorted by created_at, GPT instructed to use oldest first
- [x] Fix AI meal images — fixed empty string check, reduced fetch delay from 5s to 2s, shimmer shows properly while loading
- [x] Verify pantry + grocery items persist across simulator sessions — confirmed working
- [x] Polish empty state copy on Saved Meals screen
- [x] Redesign onboarding — added "Your plan is ready" preview step, press-and-hold commitment button, removed completion screen, auto-mapped fitness goal from step 2, fixed calculator display

## 🚀 Pre-Launch Checklist
- [ ] Apple Developer account active (blocked on LLC + D-U-N-S)
- [ ] Configure App Store Connect products (pantry_monthly, pantry_annual, pantry_lifetime)
- [ ] End-to-end test AI meal generation
- [ ] App Store screenshots and description
- [ ] Influencer outreach (200K–1M fitness niche)
- [ ] TestFlight beta
- [ ] App Store submission

## ✅ Done
- [x] Home screen
- [x] Meal Detail screen
- [x] My Pantry screen — wired to Supabase (pantry_items), feeds AI meal suggestions
- [x] Grocery List screen — wired to Supabase (grocery_items), + add item modal
- [x] Saved Meals screen
- [x] Onboarding flow (goals, macros, height/weight, preferences, cooking skill, food prefs, paywall)
- [x] Supabase auth (sign up, sign in, AuthContext)
- [x] "Order for Delivery" button → in-app WebView (Instacart placeholder)
- [x] Food Preferences screen (chip grid + custom chips, comma/return to add)
- [x] Food dislikes injected into GPT-4o meal generation prompt
- [x] One-time food prefs banner + intro popup modal on Home screen
- [x] Food Preferences row in Profile settings
- [x] CLAUDE.md project context file
- [x] Profile/Stats screen — wired to Supabase (goals, weight, streak, saved/logged counts)
- [x] Weight logging — Alert.prompt → inserts to weight_logs, chart updates
- [x] Wire macro card on Home to real calorie/protein goals from Supabase
- [x] Today's Log — persists to meal_logs, feeds streak + macro card
- [x] Supabase migrations — food_dislikes, food_prefs_banner_dismissed, food_intro_popup_dismissed, weight_logs, meal_logs, grocery_items, pantry_items
- [x] Full name saved to user metadata on signup, shown on Profile
