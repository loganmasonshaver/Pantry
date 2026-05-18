import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

// AsyncStorage keys for tracking trial lifecycle across app restarts
const TRIAL_STARTED_KEY = 'pantry_trial_started_at'
const TRIAL_EXPIRED_KEY = 'pantry_trial_expired'

// Flip to TRUE in dev to test the real Superwall paywall flow.
// Bypasses the __DEV__ "always premium" shortcut below so registerPlacement
// actually presents the paywall modal. Must be FALSE for normal dev work or
// every screen will throw paywalls at you. Has no effect in release builds.
const DEV_FORCE_PAYWALL = true

type SuperwallContextType = {
  isPremium: boolean
  loading: boolean
  trialExpired: boolean
  promoActive: boolean
  /** Dev-safe wrapper around registerPlacement — no-ops in __DEV__ builds. */
  registerPlacement: (placement: string) => Promise<void>
  /** Use instead of registerPlacement for upgrade gates — auto-routes to trial_expired paywall when appropriate. */
  triggerUpgrade: (placement: string) => Promise<void>
}

const SuperwallContext = createContext<SuperwallContextType>({
  isPremium: false,
  loading: true,
  trialExpired: false,
  promoActive: false,
  registerPlacement: async () => {},
  triggerUpgrade: async () => {},
})

export function SuperwallContextProvider({ children }: { children: React.ReactNode }) {
  // In dev, always premium — skip all Superwall checks. Flip DEV_FORCE_PAYWALL
  // above to TRUE to bypass this shortcut and exercise the real paywall flow.
  if (__DEV__ && !DEV_FORCE_PAYWALL) {
    return (
      <SuperwallContext.Provider value={{ isPremium: true, loading: false, trialExpired: false, promoActive: true, registerPlacement: async () => {}, triggerUpgrade: async () => {} }}>
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
  const [promoActive, setPromoActive] = useState(false)
  const { session } = useAuth()
  const { subscriptionStatus, registerPlacement: _registerPlacement } = useSuperwall()

  useEffect(() => {
    if (!session?.user?.id) return
    supabase
      .from('profiles')
      .select('promo_active')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => { if (data?.promo_active) setPromoActive(true) })
  }, [session?.user?.id])
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
    setIsPremium(status === 'ACTIVE' || promoActive)
    setLoading(false)
  }, [subscriptionStatus, promoActive])

  useSuperwallEvents({
    onSubscriptionStatusChange: async (status) => {
      const newStatus = status?.status
      const prevStatus = prevStatusRef.current
      prevStatusRef.current = newStatus

      setIsPremium(newStatus === 'ACTIVE')

      // Transition INACTIVE → ACTIVE means the user just started a trial (or purchased)
      if (newStatus === 'ACTIVE' && prevStatus !== 'ACTIVE') {
        // Guard with AsyncStorage so re-installs / app restarts don't re-schedule notifications
        const alreadyStarted = await AsyncStorage.getItem(TRIAL_STARTED_KEY)
        if (!alreadyStarted) {
          const now = Date.now()
          await AsyncStorage.setItem(TRIAL_STARTED_KEY, String(now))

          // Day-5 reminder for a 7-day trial — gives user 2 days to opt out
          // without surprise charge, AND time to reconsider and convert.
          const triggerDate = new Date(now + 5 * 24 * 60 * 60 * 1000)
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Your free trial ends in 2 days',
              body: 'Lock in unlimited scans, saved meals, and AI suggestions before you get charged.',
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

  const registerPlacement = async (placement: string) => {
    if (promoActive) return
    try { await _registerPlacement(placement) } catch {}
  }

  const triggerUpgrade = async (placement: string) => {
    const target = trialExpired ? 'trial_expired' : placement
    await registerPlacement(target)
  }

  return (
    <SuperwallContext.Provider value={{ isPremium, loading, trialExpired, promoActive, registerPlacement, triggerUpgrade }}>
      {children}
    </SuperwallContext.Provider>
  )
}

export const usePremium = () => useContext(SuperwallContext)
