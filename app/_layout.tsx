import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, ThemeProvider } from '@react-navigation/native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AuthProvider, useAuth } from '../context/AuthContext'

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

  useEffect(() => {
    if (loading) return

    AsyncStorage.getItem('onboarding_complete').then(value => {
      if (session && value === 'true') {
        router.replace('/(tabs)')
      } else if (session && value !== 'true') {
        router.replace({ pathname: '/onboarding', params: { step: '7' } })
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
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={AppTheme}>
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
