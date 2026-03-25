import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import { supabase } from '@/lib/supabase'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

async function requestPermissions(): Promise<boolean> {
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
  // Clear existing Pantry notifications
  const all = await Notifications.getAllScheduledNotificationsAsync()
  for (const n of all) {
    if (n.content.data?.app === 'pantry') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier)
    }
  }

  for (const day of WEEKLY_SCHEDULE) {
    const msg = randomPick(day.messages)
    await Notifications.scheduleNotificationAsync({
      content: {
        title: msg.title,
        body: msg.body,
        sound: 'default',
        data: { app: 'pantry', type: day.type },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: day.weekday,
        hour: day.hour,
        minute: 0,
      },
    })
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
        const tokenData = await Notifications.getExpoPushTokenAsync()
        await supabase
          .from('profiles')
          .update({ expo_push_token: tokenData.data })
          .eq('id', userId)
      } catch {
        // Token fails on simulator — non-critical
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
