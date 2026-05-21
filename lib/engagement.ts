import { supabase } from './supabase'
import { syncProfileToLoops, fireLoopsEvent } from './loops'

// Engagement signal tracker. These feed two systems:
//   1. profiles.* columns (cook_tonight_used_count, etc.) — used by Loops to
//      decide "skip day 3 email if user is engaged"
//   2. Loops events ("cook_tonight_used", "meal_saved") — for direct sequence
//      triggers + re-engagement detection
//
// All functions are fire-and-forget. Failures are non-blocking.

// Touched on every meaningful app interaction. The combination of
// last_active_at being stale (>3 days) and a fresh activity event firing
// triggers Loops' "user_reengaged" sequence.
export async function touchLastActive(userId: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    // Check if last_active_at was >3 days ago — that means this is a re-engagement event
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_active_at')
      .eq('id', userId)
      .single()

    const lastActive = profile?.last_active_at ? new Date(profile.last_active_at).getTime() : 0
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
    const wasInactive = lastActive > 0 && lastActive < threeDaysAgo

    await supabase.from('profiles').update({ last_active_at: now }).eq('id', userId)

    if (wasInactive) {
      // User came back after 3+ days silence — fire the re-engagement Loops event.
      // Loops sequence checks if user is still in trial and sends the personal-feeling email.
      await fireLoopsEvent(userId, 'user_reengaged', { days_inactive: Math.floor((Date.now() - lastActive) / (24 * 60 * 60 * 1000)) })
    }
  } catch (e) {
    // Non-fatal
  }
}

export async function trackCookTonightUsed(userId: string): Promise<void> {
  try {
    await supabase.rpc('increment_cook_tonight_count', { p_user_id: userId }).then(
      () => {},
      // Fallback if the RPC doesn't exist — use a direct update
      async () => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('cook_tonight_used_count')
          .eq('id', userId)
          .single()
        await supabase
          .from('profiles')
          .update({ cook_tonight_used_count: (profile?.cook_tonight_used_count ?? 0) + 1 })
          .eq('id', userId)
      }
    )
    await fireLoopsEvent(userId, 'cook_tonight_used')
    await syncProfileToLoops(userId)
  } catch (e) {
    // Non-fatal
  }
}

export async function trackMealSavedEngagement(userId: string): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('meals_saved_count')
      .eq('id', userId)
      .single()
    await supabase
      .from('profiles')
      .update({ meals_saved_count: (profile?.meals_saved_count ?? 0) + 1 })
      .eq('id', userId)
    await fireLoopsEvent(userId, 'meal_saved')
    await syncProfileToLoops(userId)
  } catch (e) {
    // Non-fatal
  }
}

export async function trackGoalsCustomized(userId: string): Promise<void> {
  try {
    await supabase.from('profiles').update({ goals_customized: true }).eq('id', userId)
    await fireLoopsEvent(userId, 'goals_customized')
    await syncProfileToLoops(userId)
  } catch (e) {
    // Non-fatal
  }
}

// Subscription lifecycle bridges — fire from SuperwallContext when subscription
// status changes. The Loops sync function reads the cached profile fields, so
// we update those first then fire the event.

export async function markTrialStarted(userId: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    await supabase.from('profiles').update({ trial_started_at: now }).eq('id', userId)
    await fireLoopsEvent(userId, 'trial_started')
  } catch (e) {
    // Non-fatal
  }
}

export async function markTrialEnded(userId: string, converted: boolean): Promise<void> {
  try {
    const now = new Date().toISOString()
    await supabase.from('profiles').update({ trial_ended_at: now }).eq('id', userId)
    await fireLoopsEvent(userId, converted ? 'subscribed' : 'trial_ended_no_paid')
  } catch (e) {
    // Non-fatal
  }
}

export async function markSubscribed(userId: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    await supabase.from('profiles').update({ subscribed_at: now, churned_at: null }).eq('id', userId)
    await fireLoopsEvent(userId, 'subscribed')
  } catch (e) {
    // Non-fatal
  }
}

export async function markChurned(userId: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    await supabase.from('profiles').update({ churned_at: now }).eq('id', userId)
    await fireLoopsEvent(userId, 'churned')
  } catch (e) {
    // Non-fatal
  }
}
