import { useEffect, useState } from 'react'
import { View, LogBox } from 'react-native'
import { Stack, router, usePathname } from 'expo-router'

// Known 3rd-party noise — library hasn't migrated yet. Our code is clean.
// Remove these when upstream updates.
LogBox.ignoreLogs([
  'InteractionManager has been deprecated', // react-native-draggable-flatlist@4.0.3
])
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, ThemeProvider } from '@react-navigation/native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { AIConsentProvider } from '../context/AIConsentContext'
import { useNotifications } from '../hooks/useNotifications'
import { SuperwallProvider, useUser } from 'expo-superwall'
import { SuperwallContextProvider } from '../context/SuperwallContext'
import { ShareIntentProvider, useShareIntent } from 'expo-share-intent'
import { supabase } from '../lib/supabase'

const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#FFFFFF',
  },
}

function RootLayoutNav() {
  const { session, loading } = useAuth()
  const [checking, setChecking] = useState(true)
  const pathname = usePathname()
  useNotifications(session?.user?.id ?? null)
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent()
  const { identify: superwallIdentify, signOut: superwallSignOut, update: superwallUpdate } = useUser()

  // Identify user in Superwall on sign-in so subscription status is linked to the correct account.
  // Applies to all auth methods: Apple, Google, and email.
  // Also fetches the user's referral_code_used and attaches it as a Superwall attribute
  // so per-creator conversion analytics work in the Superwall dashboard. Fires on every
  // session change to handle reinstalls / new device logins where AsyncStorage is empty
  // but the code lives in the Supabase profile.
  useEffect(() => {
    if (loading) return
    if (session?.user?.id) {
      superwallIdentify(session.user.id).catch(() => {})
      supabase
        .from('profiles')
        .select('referral_code_used')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data?.referral_code_used) {
            superwallUpdate({ referralCode: data.referral_code_used }).catch(() => {})
          }
        })
    } else {
      superwallSignOut()
    }
  }, [session?.user?.id, loading])

  // Handle incoming share intent (URL shared from TikTok/YouTube)
  useEffect(() => {
    if (hasShareIntent && shareIntent?.webUrl && session && !checking) {
      const url = shareIntent.webUrl
      if (/youtu\.?be|tiktok\.com/.test(url)) {
        router.push({ pathname: '/(tabs)/saved', params: { sharedUrl: url } })
      }
      resetShareIntent()
    }
  }, [hasShareIntent, shareIntent, session, checking])

  useEffect(() => {
    if (loading) return

    // Don't redirect while user is resetting their password
    if (pathname === '/onboarding/reset-password') {
      setChecking(false)
      return
    }

    // Don't interfere with the onboarding flow mid-session.
    // Each onboarding screen (createaccount, verify-email, signin) handles
    // its own routing after sign-in. _layout.tsx only needs to run on cold
    // start (checking=true) — after that, let the onboarding screens drive.
    if (!checking && pathname.startsWith('/onboarding')) {
      return
    }

    Promise.all([
      AsyncStorage.getItem('onboarding_complete'),
      AsyncStorage.getItem('otp_verified'),
    ]).then(([onboardingValue, otpValue]) => {
      if (session) {
        const provider = session.user?.app_metadata?.provider
        const isOAuthUser = provider === 'google' || provider === 'apple'
        const emailConfirmed = !!session.user?.email_confirmed_at
        const otpVerified = otpValue === 'true' || isOAuthUser || emailConfirmed

        if (!otpVerified) {
          // First-time sign-up only — email not yet confirmed
          router.replace({ pathname: '/onboarding/verify-email', params: { email: session.user.email ?? '' } })
        } else if (onboardingValue === 'true') {
          router.replace('/(tabs)')
        } else {
          router.replace('/onboarding')
        }
      } else {
        router.replace('/onboarding')
      }
      setChecking(false)
    })
  }, [session, loading])

  return (
    <>
      <StatusBar style="light" />
      {checking && <View style={{ flex: 1, backgroundColor: '#000000' }} />}
      <Stack screenOptions={{ headerShown: false, tintColor: '#FFFFFF' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="onboarding/signin" />
        <Stack.Screen name="onboarding/createaccount" />
        <Stack.Screen name="onboarding/verify-email" />
        <Stack.Screen name="onboarding/reset-password" />
        <Stack.Screen name="meal/[id]" />
        <Stack.Screen name="delivery-webview" />
        <Stack.Screen name="food-preferences" />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={AppTheme}>
        <ShareIntentProvider>
          <AuthProvider>
            <SuperwallProvider
              apiKeys={{ ios: process.env.EXPO_PUBLIC_SUPERWALL_API_KEY! }}
            >
              <SuperwallContextProvider>
                <AIConsentProvider>
                  <RootLayoutNav />
                </AIConsentProvider>
              </SuperwallContextProvider>
            </SuperwallProvider>
          </AuthProvider>
        </ShareIntentProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
