import PostHog from 'posthog-react-native'

const posthog = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '', {
  host: 'https://us.i.posthog.com',
  disabled: !process.env.EXPO_PUBLIC_POSTHOG_API_KEY, // silently no-ops all capture calls when the key is missing (e.g. local dev without .env)
})

export default posthog

// ── Crash reporting ──────────────────────────────────────────────────────────
// PostHog doesn't auto-capture uncaught JS errors or unhandled promise rejections,
// so we wire React Native's global hooks ourselves. Without this, production JS
// errors are invisible — users hit white screens and we never know.
// Called once from app/_layout.tsx at the root.
let crashHandlersInstalled = false
export function setupCrashReporting() {
  if (crashHandlersInstalled) return
  crashHandlersInstalled = true

  // ErrorUtils is the React Native global error router. Wrapping it preserves
  // the default behavior (red box / app crash) while also reporting to PostHog.
  const globalAny = global as any
  const originalHandler = globalAny.ErrorUtils?.getGlobalHandler?.()
  globalAny.ErrorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
    try {
      posthog.capture('app_error', {
        message: error?.message ?? 'Unknown error',
        stack: error?.stack ?? '',
        is_fatal: !!isFatal,
      })
    } catch { /* never let the reporter itself crash the app */ }
    if (originalHandler) originalHandler(error, isFatal)
  })

  // Unhandled promise rejections — separate path from synchronous errors. Hermes
  // raises these on the `unhandledrejection` event in newer RN versions; we tap
  // both so it works across environments.
  if (typeof globalAny.addEventListener === 'function') {
    globalAny.addEventListener('unhandledrejection', (e: any) => {
      try {
        const reason = e?.reason
        posthog.capture('app_unhandled_rejection', {
          message: reason?.message ?? String(reason),
          stack: reason?.stack ?? '',
        })
      } catch { /* swallow */ }
    })
  }
}

// ── Identity ──────────────────────────────────────────────────────────────────

export function identifyUser(userId: string, traits?: { email?: string }) {
  posthog.identify(userId, traits)
}

// Called on sign-out — clears the distinct_id and assigns a new anonymous one
// so subsequent events from the same device aren't merged with the prior user.
export function resetUser() {
  posthog.reset()
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export function trackOnboardingStep(step: number) {
  posthog.capture('onboarding_step_viewed', { step })
}

export function trackAccountCreated(method: 'email' | 'apple' | 'google') {
  posthog.capture('account_created', { method })
}

export function trackMarketingOptIn(method: 'email' | 'apple' | 'google', optedIn: boolean) {
  posthog.capture('marketing_opt_in_decision', { method, opted_in: optedIn })
}

// ── Paywall / Subscription ────────────────────────────────────────────────────

export function trackPaywallViewed(source: 'onboarding' | 'meal_detail' | 'home') {
  posthog.capture('paywall_viewed', { source })
}

export function trackSubscriptionPurchased(plan: 'monthly' | 'lifetime', price?: number) {
  posthog.capture('subscription_purchased', { plan, ...(price != null ? { price } : {}) }) // omit the key entirely so PostHog filters work cleanly
}

export function trackUpgradePromptShown(source: 'meal_save_limit' | 'regen_limit' | 'scan_limit' | 'ai_log_limit' | 'meal_log_limit') {
  posthog.capture('upgrade_prompt_shown', { source })
}

// ── Meals ─────────────────────────────────────────────────────────────────────

export function trackMealsGenerated(count: number) {
  posthog.capture('meals_generated', { count })
}

export function trackMealRegenerated() {
  posthog.capture('meal_regenerated')
}

export function trackMealViewed(mealName: string) {
  posthog.capture('meal_viewed', { meal_name: mealName })
}

export function trackMealSaved(mealName: string, calories: number, protein: number) {
  posthog.capture('meal_saved', { meal_name: mealName, calories, protein })
}

export function trackMealSaveBlocked() {
  posthog.capture('meal_save_blocked_free_limit')
}

// ── Logging ───────────────────────────────────────────────────────────────────

export function trackMealLogged(slotLabel: string, calories: number, protein: number) {
  posthog.capture('meal_logged', { slot: slotLabel, calories, protein })
}

// ── Weight & Profile ──────────────────────────────────────────────────────────

export function trackWeightLogged(weightKg: number) {
  posthog.capture('weight_logged', { weight_kg: weightKg })
}

export function trackFoodPreferencesUpdated(dislikeCount: number) {
  posthog.capture('food_preferences_updated', { dislike_count: dislikeCount })
}

// ── Email funnel (Loops integration) ─────────────────────────────────────────
// Fired from in-app to mirror Loops events into PostHog for unified funnel
// analysis. Loops also tracks opens/clicks on its end — these are the
// app-side events that complete the loop.

export function trackEmailSequenceTriggered(eventName: string) {
  posthog.capture('email_sequence_triggered', { event_name: eventName })
}

export function trackEmailLinkOpened(source: string) {
  // Called when the app receives a deep-link from a marketing email.
  // `source` is the UTM source param from the link (e.g. 'trial_day_3').
  posthog.capture('email_link_opened', { source })
}

export function trackTrialConvertedFromEmail(source: string) {
  // Fired when a user converts to paid within 24h of clicking an email link.
  // PostHog will sequence-join this with email_link_opened for attribution.
  posthog.capture('trial_converted_from_email', { source })
}
