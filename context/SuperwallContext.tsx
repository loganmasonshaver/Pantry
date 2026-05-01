import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'

// AsyncStorage keys for tracking trial lifecycle across app restarts
const TRIAL_STARTED_KEY = 'pantry_trial_started_at'
const TRIAL_EXPIRED_KEY = 'pantry_trial_expired'

type SuperwallContextType = {
  isPremium: boolean
  loading: boolean
  trialExpired: boolean
  /** Use instead of registerPlacement for upgrade gates — auto-routes to trial_expired paywall when appropriate. */
  triggerUpgrade: (placement: string) => Promise<void>
}

const SuperwallContext = createContext<SuperwallContextType>({
  isPremium: false,
  loading: true,
  trialExpired: false,
  triggerUpgrade: async () => {},
})

export function SuperwallContextProvider({ children }: { children: React.ReactNode }) {
  // In dev, always premium — skip all Superwall checks
  if (__DEV__) {
    return (
      <SuperwallContext.Provider value={{ isPremium: true, loading: false, trialExpired: false, triggerUpgrade: async () => {} }}>
        {children}
      </SuperwallContext.Provider>
    )
  }
  return <SuperwallContextProviderProd>{children}</SuperwallContextProviderProd>
}

function SuperwallContextProviderProd({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(true)
  const [trialExpired, setTrialExpired] = useState(false)
  const { subscriptionStatus, registerPlacement } = useSuperwall()
  // Seed with the current status so the very first onSubscriptionStatusChange event doesn't
  // treat an already-ACTIVE user as a brand-new trial start (prevStatus would otherwise be undefined)
  const prevStatusRef = useRef<string | undefined>(subscriptionStatus?.status)

  // Load persisted trial_expired flag
  useEffect(() => {
    AsyncStorage.getItem(TRIAL_EXPIRED_KEY).then(val => {
      if (val === 'true') setTrialExpired(true)
    })
  }, [])

  useEffect(() => {
    const status = subscriptionStatus?.status
    // Superwall uses 'ACTIVE' to mean the user has a valid entitlement (trial or paid)
    setIsPremium(status === 'ACTIVE')
    setLoading(false)
  }, [subscriptionStatus])

  useSuperwallEvents({
    onSubscriptionStatusChange: async (status) => {
      const newStatus = status?.status
      const prevStatus = prevStatusRef.current
      prevStatusRef.current = newStatus

      setIsPremium(newStatus === 'ACTIVE')

      // Transition INACTIVE → ACTIVE means the user just started a trial (or purchased)
      if (newStatus === 'ACTIVE' && prevStatus !== 'ACTIVE') {
        // Guard with AsyncStorage so re-installs / app restarts don't re-schedule the notification
        const alreadyStarted = await AsyncStorage.getItem(TRIAL_STARTED_KEY)
        if (!alreadyStarted) {
          const now = Date.now()
          await AsyncStorage.setItem(TRIAL_STARTED_KEY, String(now))
          // 71 hours = 3-day trial minus 1 hour — nudge the user before it lapses
          const triggerDate = new Date(now + 71 * 60 * 60 * 1000)
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Your free trial ends today',
              body: 'Upgrade now to keep unlimited scans, saves, and meal suggestions.',
              sound: 'default',
              data: { app: 'pantry', type: 'trial_expiry' },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: triggerDate,
            },
          }).catch(() => {}) // Non-fatal if notification permission not granted
        }
      }

      // Transition ACTIVE → INACTIVE means trial lapsed without a paid conversion
      if (prevStatus === 'ACTIVE' && newStatus !== 'ACTIVE') {
        // Only flag as expired if we know a trial actually started (not a user who never trialled)
        const trialStarted = await AsyncStorage.getItem(TRIAL_STARTED_KEY)
        if (trialStarted) {
          await AsyncStorage.setItem(TRIAL_EXPIRED_KEY, 'true')
          setTrialExpired(true)
        }
      }
    },
  })

  const triggerUpgrade = async (placement: string) => {
    // Route trial-expired users to a dedicated win-back paywall
    const target = trialExpired ? 'trial_expired' : placement
    try {
      await registerPlacement(target)
    } catch {}
  }

  return (
    <SuperwallContext.Provider value={{ isPremium, loading, trialExpired, triggerUpgrade }}>
      {children}
    </SuperwallContext.Provider>
  )
}

export const usePremium = () => useContext(SuperwallContext)
