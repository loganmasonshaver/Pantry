import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../lib/supabase'
import TurnstileWebView from '../../components/TurnstileWebView'

const CODE_LENGTH = 8

export default function VerifyEmailScreen() {
  const router = useRouter()
  const { email, isSignIn } = useLocalSearchParams<{ email: string; isSignIn?: string }>()
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const pendingSendRef = useRef(true)
  const inputs = useRef<(TextInput | null)[]>([])

  // Start cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  const handleCaptchaToken = async (token: string) => {
    if (!email || !pendingSendRef.current) return
    pendingSendRef.current = false
    setResendCooldown(60)
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: token },
    })
  }

  const handleResend = () => {
    pendingSendRef.current = true
    setTurnstileKey(k => k + 1) // remount WebView to get fresh token
  }

  const handleChange = (text: string, index: number) => {
    if (text.length > 1) {
      // Paste handling — spread across all inputs
      const chars = text.replace(/[^0-9]/g, '').split('').slice(0, CODE_LENGTH)
      const newCode = [...code]
      chars.forEach((char, i) => {
        if (index + i < CODE_LENGTH) newCode[index + i] = char
      })
      setCode(newCode)
      const nextIndex = Math.min(index + chars.length, CODE_LENGTH - 1)
      inputs.current[nextIndex]?.focus()
      if (newCode.every(c => c !== '')) verifyCode(newCode.join(''))
      return
    }

    const newCode = [...code]
    newCode[index] = text
    setCode(newCode)

    if (text && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus()
    }

    if (newCode.every(c => c !== '')) {
      verifyCode(newCode.join(''))
    }
  }

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      const newCode = [...code]
      newCode[index - 1] = ''
      setCode(newCode)
      inputs.current[index - 1]?.focus()
    }
  }

  const verifyCode = async (fullCode: string) => {
    if (!email) return
    Keyboard.dismiss()
    setLoading(true)
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: fullCode,
        type: 'email',
      })
      if (error) {
        Alert.alert('Invalid Code', 'The code you entered is incorrect or expired.')
        setCode(Array(CODE_LENGTH).fill(''))
        inputs.current[0]?.focus()
      } else {
        await AsyncStorage.setItem('otp_verified', 'true')
        // Sign-in flow: always go to tabs (they've done onboarding before)
        if (isSignIn === 'true') {
          await AsyncStorage.setItem('onboarding_complete', 'true')
          router.replace('/(tabs)')
          return
        }
        // Sign-up flow: check if onboarding is complete
        const onboardingDone = await AsyncStorage.getItem('onboarding_complete')
        if (onboardingDone === 'true') {
          router.replace('/(tabs)')
        } else {
          router.replace({ pathname: '/onboarding', params: { step: '18' } })
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <TurnstileWebView key={turnstileKey} onToken={handleCaptchaToken} />
      <View style={styles.content}>
        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.subtitle}>
          We sent a code to{'\n'}
          <Text style={styles.email}>{email}</Text>
        </Text>

        <View style={styles.codeRow}>
          {code.map((digit, i) => (
            <TextInput
              key={i}
              ref={ref => inputs.current[i] = ref}
              style={[styles.codeInput, digit && styles.codeInputFilled]}
              value={digit}
              onChangeText={text => handleChange(text, i)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
              keyboardType="number-pad"
              maxLength={i === 0 ? CODE_LENGTH : 1}
              autoFocus={i === 0}
              selectTextOnFocus
            />
          ))}
        </View>

        {loading && <ActivityIndicator color="#4ADE80" style={{ marginTop: 24 }} />}

        <TouchableOpacity
          style={[styles.resendBtn, resendCooldown > 0 && { opacity: 0.4 }]}
          onPress={handleResend}
          disabled={resendCooldown > 0}
          activeOpacity={0.7}
        >
          <Text style={styles.resendText}>
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  email: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  codeInput: {
    width: 36,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  codeInputFilled: {
    borderColor: '#4ADE80',
    backgroundColor: 'rgba(74,222,128,0.08)',
  },
  resendBtn: {
    marginTop: 32,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  resendText: {
    fontSize: 14,
    color: '#4ADE80',
    fontWeight: '600',
  },
})
