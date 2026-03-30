import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native'
import { useAuth } from '../../context/AuthContext'
import TurnstileWebView from '../../components/TurnstileWebView'

const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'

export default function SignInScreen() {
  const router = useRouter()
  const { signIn, signInWithApple, signInWithGoogle, appleSignInAvailable } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastAttempt, setLastAttempt] = useState(0)
  const [failCount, setFailCount] = useState(0)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields')
      return
    }
    const now = Date.now()
    const cooldown = failCount >= 5 ? 60000 : failCount >= 3 ? 15000 : 3000
    if (now - lastAttempt < cooldown) {
      Alert.alert('Too many attempts', `Please wait ${Math.ceil(cooldown / 1000)} seconds.`)
      return
    }
    setLastAttempt(now)
    try {
      setLoading(true)
      await signIn(email, password, captchaToken ?? undefined)
      setFailCount(0)
      router.replace({ pathname: '/onboarding/verify-email', params: { email } })
    } catch (error: any) {
      setFailCount(f => f + 1)
      Alert.alert('Sign In Failed', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <TurnstileWebView onToken={setCaptchaToken} />
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <ArrowLeft size={22} stroke="#FFFFFF" strokeWidth={2} />
      </TouchableOpacity>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>Sign in to your account</Text>

          <View style={s.cardList}>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Email</Text>
              <TextInput
                style={s.input}
                placeholder="you@example.com"
                placeholderTextColor={MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Password</Text>
              <View style={s.passwordRow}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  placeholder="••••••••"
                  placeholderTextColor={MUTED}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(p => !p)} activeOpacity={0.7}>
                  {showPassword
                    ? <EyeOff size={18} stroke={MUTED} strokeWidth={1.8} />
                    : <Eye size={18} stroke={MUTED} strokeWidth={1.8} />
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity style={s.forgotLink} activeOpacity={0.7}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <View style={s.orRow}>
            <View style={s.orLine} />
            <Text style={s.orText}>or</Text>
            <View style={s.orLine} />
          </View>

          {appleSignInAvailable && (
            <TouchableOpacity style={s.socialBtn} onPress={async () => {
              try {
                setLoading(true)
                await signInWithApple()
                router.replace('/(tabs)')
              } catch (e: any) {
                if (e.code !== 'ERR_REQUEST_CANCELED') Alert.alert('Apple Sign-In Failed', e.message)
              } finally { setLoading(false) }
            }} activeOpacity={0.8}>
              <Text style={s.appleIcon}>{'\uF8FF'}</Text>
              <Text style={s.socialBtnText}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[s.socialBtn, { marginTop: 10 }]} onPress={async () => {
            try {
              setLoading(true)
              await signInWithGoogle()
              // Google users skip OTP — already verified via Google
              router.replace('/(tabs)')
            } catch (e: any) {
              if (e.code !== '12501') Alert.alert('Google Sign-In Failed', e.message)
            } finally { setLoading(false) }
          }} activeOpacity={0.8}>
            <Text style={s.googleG}>G</Text>
            <Text style={s.socialBtnText}>Continue with Google</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.bottom}>
        <TouchableOpacity style={s.pill} activeOpacity={0.85} onPress={handleSignIn} disabled={loading}>
          <Text style={s.pillText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.switchLink}
          onPress={() => router.replace('/onboarding')}
          activeOpacity={0.7}
        >
          <Text style={s.switchText}>
            Don't have an account?{' '}
            <Text style={s.switchTeal}>Get Started</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  backBtn: { padding: 20, paddingBottom: 8, alignSelf: 'flex-start' },

  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: MUTED, marginBottom: 28, lineHeight: 22 },

  cardList: { gap: 12 },
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

  forgotLink: { alignItems: 'center', marginTop: 24 },
  forgotText: { fontSize: 14, color: TEAL, fontWeight: '600' },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  orLine: { flex: 1, height: 1, backgroundColor: '#2A2A2A' },
  orText: { fontSize: 13, color: MUTED, fontWeight: '500' },

  socialBtn: {
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  appleIcon: { fontSize: 20, color: '#FFFFFF', width: 22, textAlign: 'center' },
  googleG: { fontSize: 16, fontWeight: '800', color: '#4285F4', width: 22, textAlign: 'center' },
  socialBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

  bottom: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8, gap: 4 },
  pill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
  },
  pillText: { fontSize: 16, fontWeight: '700', color: '#000000' },

  switchLink: { alignItems: 'center', paddingVertical: 12 },
  switchText: { fontSize: 14, color: MUTED, fontWeight: '500' },
  switchTeal: { color: TEAL, fontWeight: '600' },
})
