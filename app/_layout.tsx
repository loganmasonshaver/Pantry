import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, ThemeProvider } from '@react-navigation/native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#FFFFFF',
  },
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={AppTheme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, tintColor: '#FFFFFF' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="meal/[id]" />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
