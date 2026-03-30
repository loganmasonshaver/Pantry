import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, ThemeProvider } from '@react-navigation/native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { useNotifications } from '../hooks/useNotifications'
import { SuperwallProvider } from 'expo-superwall'
import { SuperwallContextProvider } from '../context/SuperwallContext'
import { ShareIntentProvider, useShareIntent } from 'expo-share-intent'

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
  useNotifications(session?.user?.id ?? null)
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent()

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

    Promise.all([
      AsyncStorage.getItem('onboarding_complete'),
      AsyncStorage.getItem('otp_verified'),
    ]).then(([onboardingValue, otpValue]) => {
      if (session) {
        // Check if email/password user needs OTP verification
        const provider = session.user?.app_metadata?.provider
        const isOAuthUser = provider === 'google' || provider === 'apple'
        const otpVerified = otpValue === 'true' || isOAuthUser

        if (!otpVerified) {
          // Needs email verification
          router.replace({ pathname: '/onboarding/verify-email', params: { email: session.user.email ?? '' } })
        } else if (onboardingValue === 'true') {
          router.replace('/(tabs)')
        } else {
          router.replace({ pathname: '/onboarding', params: { step: '8' } })
        }
      } else {
        // Clear OTP flag on sign out
        AsyncStorage.removeItem('otp_verified')
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
                <RootLayoutNav />
              </SuperwallContextProvider>
            </SuperwallProvider>
          </AuthProvider>
        </ShareIntentProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
