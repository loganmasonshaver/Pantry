import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

// Bump this when the weekly schedule changes (times, days, or message content).
// Stale schedules from older app versions get nuked when the version mismatches —
// this fixes the "double notifications" bug where iOS persisted notifications
// scheduled by previous app versions alongside the current ones.
const SCHEDULE_VERSION = 'v2'
const SCHEDULE_VERSION_KEY = 'notifications_schedule_version'

// Foreground behavior: show banner + sound but never increment the badge.
// We don't use the badge anywhere in-app, and stale badge counts confuse users.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

async function requestPermissions(): Promise<boolean> {
  // Check first — iOS shows the system prompt at most once per install. Re-asking
  // after denial silently returns the existing 'denied' status with no UI.
  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === 'granted') return true
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  })
  return status === 'granted'
}

// ── Notification content ────────────────────────────────────────────────

const BREAKFAST_MESSAGES = [
  { title: 'Good morning', body: 'Start your day right — log your breakfast.' },
  { title: 'Pantry', body: "What'd you have for breakfast? Tap to log it." },
]

const LUNCH_MESSAGES = [
  { title: 'Lunchtime', body: "What's on the menu? Log your lunch to stay on track." },
  { title: 'Midday check-in', body: 'Tap to log your lunch and keep your streak going.' },
]

const DINNER_MESSAGES = [
  { title: 'Dinner time', body: 'Log your dinner before the day slips away.' },
  { title: 'Evening check-in', body: "How was dinner? Tap to log it and complete today's meals." },
]

const STREAK_MESSAGES = [
  { title: "Don't break your streak!", body: "You haven't logged today yet. Tap to stay on track." },
  { title: 'Pantry', body: 'Still time to log your meals — keep the momentum going.' },
]

const GROCERY_MESSAGES = [
  { title: 'Been to the store recently?', body: 'Scan your receipt to update your pantry — better meals start with fresh ingredients.' },
  { title: 'Pantry update', body: 'Picked up groceries? Snap a receipt to keep your pantry fresh.' },
]

const SUNDAY_MESSAGES = [
  { title: 'End of the week', body: "Stay consistent — log today's meals and finish the week strong." },
  { title: 'Pantry', body: "Don't let Sunday slip. One more day logged keeps your streak alive." },
]

// Picked once at schedule-time, so the same user sees the same variant for the
// week. Stays fresh because the schedule re-rolls on each version bump.
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Weekly schedule (1 notification per day) ────────────────────────────
// Sunday = 1, Monday = 2, ..., Saturday = 7

type DayConfig = {
  weekday: number
  hour: number
  messages: { title: string; body: string }[]
  type: string
}

const MONDAY_MESSAGES = [
  { title: 'New week, fresh start', body: 'Kick off the week strong — log your meals and stay on track.' },
  { title: 'Pantry', body: "Monday's here. Set the tone for the week — start logging." },
]

const WEEKLY_SCHEDULE: DayConfig[] = [
  { weekday: 2, hour: 8,  messages: MONDAY_MESSAGES,    type: 'streak_reminder' }, // Monday — start of week 8am
  { weekday: 3, hour: 19, messages: DINNER_MESSAGES,    type: 'meal_reminder' },   // Tuesday — dinner 7pm
  { weekday: 4, hour: 12, messages: LUNCH_MESSAGES,     type: 'meal_reminder' },   // Wednesday — lunch 12pm
  { weekday: 5, hour: 20, messages: STREAK_MESSAGES,    type: 'streak_reminder' }, // Thursday — streak 8pm
  { weekday: 6, hour: 12, messages: LUNCH_MESSAGES,     type: 'meal_reminder' },   // Friday — lunch 12pm
  { weekday: 7, hour: 10, messages: GROCERY_MESSAGES,   type: 'grocery_reminder' },// Saturday — grocery 10am
  { weekday: 1, hour: 9,  messages: BREAKFAST_MESSAGES,  type: 'meal_reminder' },   // Sunday — breakfast 9am
]

async function scheduleAllReminders(): Promise<void> {
  // Idempotency: if this app version's schedule is already laid down, skip the
  // whole dance. Prevents the schedule from being torn down + rebuilt every
  // time userId changes (sign in / out / back in cycles) — which previously
  // caused brief windows where multiple schedules could coexist.
  const existingVersion = await AsyncStorage.getItem(SCHEDULE_VERSION_KEY)
  if (existingVersion === SCHEDULE_VERSION) {
    if (__DEV__) {
      const all = await Notifications.getAllScheduledNotificationsAsync()
      console.log(`[notifications] schedule ${SCHEDULE_VERSION} already in place — ${all.length} scheduled`)
    }
    return
  }

  // Nuke ALL scheduled notifications belonging to this app. iOS persists local
  // notifications across app updates, so older app versions may have scheduled
  // notifications WITHOUT the `data.app === 'pantry'` tag (or with different
  // tags), which the prior tag-filtered cleanup missed — leaving stale
  // schedules to fire alongside the current ones. The one exception is
  // 'trial_expiry' (scheduled by SuperwallContext when the trial starts) which
  // we preserve so a schedule-version bump doesn't drop pending trial
  // notifications.
  const existing = await Notifications.getAllScheduledNotificationsAsync()
  for (const n of existing) {
    if (n.content.data?.type === 'trial_expiry') continue
    await Notifications.cancelScheduledNotificationAsync(n.identifier)
  }

  for (const day of WEEKLY_SCHEDULE) {
    const msg = randomPick(day.messages)
    await Notifications.scheduleNotificationAsync({
      content: {
        title: msg.title,
        body: msg.body,
        sound: 'default',
        data: { app: 'pantry', type: day.type, version: SCHEDULE_VERSION },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: day.weekday,
        hour: day.hour,
        minute: 0,
      },
    })
  }

  await AsyncStorage.setItem(SCHEDULE_VERSION_KEY, SCHEDULE_VERSION)

  if (__DEV__) {
    const all = await Notifications.getAllScheduledNotificationsAsync()
    console.log(`[notifications] scheduled ${SCHEDULE_VERSION} — ${all.length} total scheduled`)
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useNotifications(userId: string | null) {
  const responseListener = useRef<Notifications.EventSubscription>()

  useEffect(() => {
    if (!userId) return

    ;(async () => {
      const granted = await requestPermissions()
      if (!granted) return

      try {
        // Push tokens are only issued on physical devices; simulators throw here.
        // Stored on the profile so server-side jobs can target this device.
        // PASS projectId EXPLICITLY. This is a BARE workflow (ios/ is checked in), so
        // Constants cannot always infer it from app.json — which is precisely what the failure
        // said: 'No "projectId" found. If "projectId" can\'t be inferred from the manifest (for
        // instance, in bare workflow), you have to pass it in yourself.' Linking the EAS project
        // put the id in app.json but did NOT fix this on its own; without passing it, the token
        // would only resolve after a native rebuild, and silently break again on any workflow change.
        const projectId =
          (Constants.expoConfig?.extra as any)?.eas?.projectId ??
          (Constants as any)?.easConfig?.projectId
        const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
        await supabase
          .from('profiles')
          .update({ expo_push_token: tokenData.data })
          .eq('id', userId)
      } catch (e) {
        // Expected on simulator (Expo issues push tokens only on physical devices), so this stays
        // non-fatal. But an empty catch here hid a real bug for weeks: profiles.expo_push_token
        // did not exist, every write failed with 42703, and the health-check job that depends on
        // the token silently never alerted. Log it in dev so the next schema-shaped failure is
        // visible instead of looking identical to the simulator case.
        __DEV__ && console.log('[notifications] push token not stored:', (e as Error)?.message)
      }

      await scheduleAllReminders()
    })()

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data
        // Could navigate based on type:
        // meal_reminder → home screen
        // grocery_reminder → receipt scan
        // streak_reminder → home screen
      })

    return () => {
      responseListener.current?.remove()
    }
  }, [userId])
}
