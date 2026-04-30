import PostHog from 'posthog-react-native'

const posthog = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '', {
  host: 'https://us.i.posthog.com',
  disabled: !process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
})

export default posthog

// ── Identity ──────────────────────────────────────────────────────────────────

export function identifyUser(userId: string, traits?: { email?: string }) {
  posthog.identify(userId, traits)
}

export function resetUser() {
  posthog.reset()
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export function trackOnboardingStep(step: number) {
  posthog.capture('onboarding_step_viewed', { step })
}

export function trackAccountCreated(method: 'email') {
  posthog.capture('account_created', { method })
}

// ── Paywall / Subscription ────────────────────────────────────────────────────

export function trackPaywallViewed(source: 'onboarding' | 'meal_detail' | 'home') {
  posthog.capture('paywall_viewed', { source })
}

export function trackSubscriptionPurchased(plan: 'monthly' | 'lifetime', price?: number) {
  posthog.capture('subscription_purchased', { plan, ...(price != null ? { price } : {}) })
}

export function trackUpgradePromptShown(source: 'meal_save_limit' | 'regen_limit' | 'scan_limit' | 'ai_log_limit') {
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
