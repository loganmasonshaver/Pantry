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

  useEffect(() => {
    if (loading) return

    AsyncStorage.getItem('onboarding_complete').then(value => {
      if (session && value === 'true') {
        router.replace('/(tabs)')
      } else if (session && value !== 'true') {
        router.replace({ pathname: '/onboarding', params: { step: '8' } })
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
        <AuthProvider>
          <SuperwallProvider
            apiKeys={{ ios: process.env.EXPO_PUBLIC_SUPERWALL_API_KEY! }}
          >
            <SuperwallContextProvider>
              <RootLayoutNav />
            </SuperwallContextProvider>
          </SuperwallProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
