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
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../lib/supabase'
import TurnstileWebView from '../../components/TurnstileWebView'

const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'
const CODE_LENGTH = 8

type Step = 'email' | 'code' | 'password'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const { prefillEmail } = useLocalSearchParams<{ prefillEmail?: string }>()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(prefillEmail ?? '')
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const pendingSendRef = useRef(false)
  const inputs = useRef<(TextInput | null)[]>([])

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  const handleCaptchaToken = async (token: string) => {
    if (!email || !pendingSendRef.current) return
    pendingSendRef.current = false
    setResendCooldown(60)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: token },
    })
    if (error) {
      Alert.alert('Error', error.message)
    }
  }

  const handleSendCode = () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email')
      return
    }
    pendingSendRef.current = true
    setTurnstileKey(k => k + 1)
    setStep('code')
  }

  const handleResend = () => {
    pendingSendRef.current = true
    setTurnstileKey(k => k + 1)
  }

  const handleCodeChange = (text: string, index: number) => {
    if (text.length > 1) {
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
        // Mark OTP verified so _layout.tsx doesn't redirect us away
        await AsyncStorage.setItem('otp_verified', 'true')
        setStep('password')
      }
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        Alert.alert('Error', error.message)
      } else {
        await AsyncStorage.setItem('onboarding_complete', 'true')
        router.replace('/(tabs)')
      }
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  const title = step === 'email' ? 'Reset password' : step === 'code' ? 'Enter code' : 'New password'
  const subtitle =
    step === 'email'
      ? "Enter your email and we'll send a verification code"
      : step === 'code'
      ? `We sent a code to\n${email}`
      : 'Choose a new password for your account'

  return (
    <SafeAreaView style={s.safe}>
      <TurnstileWebView key={turnstileKey} onToken={handleCaptchaToken} />
      <View style={s.topBarRow}>
        <TouchableOpacity
          style={s.backArrowBtn}
          onPress={() => {
            if (step === 'code') {
              setStep('email')
              setCode(Array(CODE_LENGTH).fill(''))
            } else if (step === 'password') {
              router.back()
            } else {
              router.back()
            }
          }}
          activeOpacity={0.7}
        >
          <ArrowLeft size={18} stroke="#FFFFFF" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.content}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          {step === 'email' && (
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Email</Text>
              <TextInput
                style={s.input}
                placeholder="you@example.com"
                placeholderTextColor={MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
                value={email}
                onChangeText={setEmail}
              />
            </View>
          )}

          {step === 'code' && (
            <>
              <View style={s.codeRow}>
                {code.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={ref => (inputs.current[i] = ref)}
                    style={[s.codeInput, digit && s.codeInputFilled]}
                    value={digit}
                    onChangeText={text => handleCodeChange(text, i)}
                    onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                    keyboardType="number-pad"
                    maxLength={i === 0 ? CODE_LENGTH : 1}
                    autoFocus={i === 0}
                    selectTextOnFocus
                  />
                ))}
              </View>

              {loading && <ActivityIndicator color={TEAL} style={{ marginTop: 24 }} />}

              <TouchableOpacity
                style={[s.resendBtn, resendCooldown > 0 && { opacity: 0.4 }]}
                onPress={handleResend}
                disabled={resendCooldown > 0}
                activeOpacity={0.7}
              >
                <Text style={s.resendText}>
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'password' && (
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>New Password</Text>
              <View style={s.passwordRow}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  placeholder="At least 6 characters"
                  placeholderTextColor={MUTED}
                  secureTextEntry={!showPassword}
                  autoFocus
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(p => !p)} activeOpacity={0.7}>
                  {showPassword ? (
                    <EyeOff size={18} stroke={MUTED} strokeWidth={1.8} />
                  ) : (
                    <Eye size={18} stroke={MUTED} strokeWidth={1.8} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {(step === 'email' || step === 'password') && (
        <View style={s.bottom}>
          <TouchableOpacity
            style={s.pill}
            activeOpacity={0.85}
            onPress={step === 'email' ? handleSendCode : handleResetPassword}
            disabled={loading}
          >
            <Text style={s.pillText}>
              {loading
                ? step === 'email'
                  ? 'Sending...'
                  : 'Resetting...'
                : step === 'email'
                ? 'Send Code'
                : 'Reset Password'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  topBarRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  backArrowBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center',
  },

  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: MUTED,
    lineHeight: 22,
    marginBottom: 28,
  },

  inputCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  inputLabel: { fontSize: 13, fontWeight: '600', color: MUTED },
  input: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    padding: 0,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  codeRow: {
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'center',
  },
  codeInput: {
    width: 36,
    height: 48,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  codeInputFilled: {
    borderColor: TEAL,
    backgroundColor: 'rgba(74,222,128,0.08)',
  },
  resendBtn: {
    marginTop: 32,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'center',
  },
  resendText: {
    fontSize: 14,
    color: TEAL,
    fontWeight: '600',
  },

  bottom: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8 },
  pill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
  },
  pillText: { fontSize: 16, fontWeight: '700', color: '#000000' },
})
