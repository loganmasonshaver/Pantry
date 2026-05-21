import { supabase } from './supabase'

// Client helper for the loops-sync edge function.
//
// Use cases:
//   syncProfileToLoops(userId)              — re-mirror profile to Loops (call after meaningful profile updates)
//   fireLoopsEvent(userId, "trial_started") — trigger a Loops sequence
//
// Fire-and-forget by default — failures don't block the UI. Loops sync is
// best-effort marketing infra, not critical-path.

type EventName =
  | 'user_signed_up'
  | 'trial_started'
  | 'trial_ended_no_paid'
  | 'subscribed'
  | 'churned'
  | 'trial_ending_in_2_days'
  | 'cook_tonight_used'
  | 'meal_saved'
  | 'goals_customized'
  | 'user_reengaged'

export async function syncProfileToLoops(userId: string): Promise<void> {
  try {
    await supabase.functions.invoke('loops-sync', {
      body: { action: 'sync_profile', userId },
    })
  } catch (e) {
    console.log('[loops] sync failed (non-fatal):', e)
  }
}

export async function fireLoopsEvent(
  userId: string,
  eventName: EventName,
  eventProperties: Record<string, any> = {}
): Promise<void> {
  try {
    await supabase.functions.invoke('loops-sync', {
      body: { action: 'event', userId, eventName, eventProperties },
    })
  } catch (e) {
    console.log(`[loops] event ${eventName} failed (non-fatal):`, e)
  }
}

// Delete a Loops contact entirely — call from the account-deletion flow for GDPR compliance.
export async function deleteLoopsContact(email: string): Promise<void> {
  try {
    await supabase.functions.invoke('loops-sync', {
      body: { action: 'delete', email },
    })
  } catch (e) {
    console.log('[loops] delete failed (non-fatal):', e)
  }
}
