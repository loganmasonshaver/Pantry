import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, ThemeProvider } from '@react-navigation/native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import AsyncStorage from '@react-native-async-storage/async-storage'

const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#FFFFFF',
  },
}

export default function RootLayout() {
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem('onboarding_complete').then(value => {
      if (value === 'true') {
        router.replace('/(tabs)')
      } else {
        router.replace('/onboarding')
      }
      setChecking(false)
    })
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={AppTheme}>
        <StatusBar style="light" />
        {checking && <View style={{ flex: 1, backgroundColor: '#000000' }} />}
        <Stack screenOptions={{ headerShown: false, tintColor: '#FFFFFF' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding/index" />
          <Stack.Screen name="onboarding/signin" />
          <Stack.Screen name="onboarding/createaccount" />
          <Stack.Screen name="meal/[id]" />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
