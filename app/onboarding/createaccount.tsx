import { useState, useRef } from 'react'
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
import { Eye, EyeOff, ArrowLeft } from 'lucide-react-native'
import { useAuth } from '../../context/AuthContext'
import { trackAccountCreated } from '../../lib/analytics'
import TurnstileWebView, { type TurnstileRef } from '../../components/TurnstileWebView'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { generateMeals } from '../../lib/meals'

const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'

export default function CreateAccountScreen() {
  const router = useRouter()
  const { signUp, signInWithApple, signInWithGoogle, appleSignInAvailable } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastAttempt, setLastAttempt] = useState(0)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileRef>(null)

  const handleCreateAccount = async () => {
    if (!name || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields')
      return
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters')
      return
    }
    const now = Date.now()
    if (now - lastAttempt < 30000) {
      Alert.alert('Please wait', 'You can try again in a few seconds.')
      return
    }
    setLastAttempt(now)
    try {
      setLoading(true)
      await signUp(email, password, { full_name: name }, captchaToken ?? undefined)
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      trackAccountCreated('email')
      router.replace({ pathname: '/onboarding/verify-email', params: { email } })
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message)
      setCaptchaToken(null)
      turnstileRef.current?.reset()
    } finally {
      setLoading(false)
    }
  }

  // Returns true only if this device has already completed onboarding.
  // Account age is NOT used — a reset clears the flag, enabling new-user testing
  // with an existing account.
  const isReturningUser = async () => {
    const done = await AsyncStorage.getItem('onboarding_complete')
    return done === 'true'
  }

  const handleAppleSignIn = async () => {
    try {
      setLoading(true)
      await signInWithApple()
      if (await isReturningUser()) {
        await AsyncStorage.setItem('onboarding_complete', 'true')
        router.replace('/(tabs)')
        return
      }
      prefetchMeals()
      trackAccountCreated('apple')
      router.replace({ pathname: '/onboarding', params: { step: '18' } })
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign-In Failed', e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  // Fire-and-forget: start generating meals the moment the user has a session
  // so the paywall wait time doubles as generation time.
  const prefetchMeals = () => {
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem('onboarding_data')
        const d = raw ? JSON.parse(raw) : {}
        const meals = await generateMeals({
          ingredients: [
            'chicken breast', 'ground beef', 'eggs', 'rice', 'pasta',
            'olive oil', 'butter', 'garlic', 'onion', 'salt', 'black pepper',
            'soy sauce', 'hot sauce', 'lemon', 'lime', 'Italian seasoning',
            'garlic powder', 'onion powder', 'paprika', 'cumin', 'chili flakes',
            'tomato sauce', 'chicken broth', 'parmesan cheese', 'broccoli', 'spinach',
          ],
          calorieGoal: parseInt(d.calories) || 2400,
          proteinGoal: parseInt(d.protein) || 150,
          mealsPerDay: parseInt(d.meals) || 3,
          cookingSkill: d.cookingSkill || 'moderate',
          maxPrepMinutes: d.prep === '15 min' ? 15 : d.prep === '45 min' ? 45 : d.prep === '60+ min' ? 75 : 30,
          dietaryRestrictions: d.dietStyle && d.dietStyle !== 'Classic' ? [d.dietStyle] : [],
          foodDislikes: [...(d.foodDislikes || []), ...(d.foodDislikesText || '').split(',').map((s: string) => s.trim()).filter(Boolean)],
          mode: 'cookNow',
        })
        const today = new Date().toISOString().slice(0, 10)
        await AsyncStorage.setItem('pantry_daily_meals_cookNow', JSON.stringify({ date: today, meals }))
      } catch {}
    })()
  }

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true)
      await signInWithGoogle()
      if (await isReturningUser()) {
        await AsyncStorage.setItem('onboarding_complete', 'true')
        router.replace('/(tabs)')
        return
      }
      prefetchMeals()
      trackAccountCreated('google')
      router.replace({ pathname: '/onboarding', params: { step: '18' } })
    } catch (e: any) {
      if (e.code !== '12501') { // SIGN_IN_CANCELLED
        Alert.alert('Google Sign-In Failed', e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <TurnstileWebView ref={turnstileRef} onToken={setCaptchaToken} />
      <View style={s.topBarRow}>
        <TouchableOpacity style={s.backArrowBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={18} stroke="#FFFFFF" strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginRight: 36 }}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: '90%' }]} />
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>Save your progress</Text>
          <Text style={s.subtitle}>Your custom plan is ready — create a free account to save it</Text>

          <View style={s.cardList}>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Full Name</Text>
              <TextInput
                style={s.input}
                placeholder="Marcus Johnson"
                placeholderTextColor={MUTED}
                autoCapitalize="words"
                value={name}
                onChangeText={setName}
              />
            </View>
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

          <View style={s.orRow}>
            <View style={s.orLine} />
            <Text style={s.orText}>or</Text>
            <View style={s.orLine} />
          </View>

          {appleSignInAvailable && (
            <TouchableOpacity style={s.socialBtn} onPress={handleAppleSignIn} activeOpacity={0.8}>
              <Text style={s.appleIcon}>{'\uF8FF'}</Text>
              <Text style={s.socialBtnText}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[s.socialBtn, { marginTop: 10 }]} onPress={handleGoogleSignIn} activeOpacity={0.8}>
            <Text style={s.googleG}>G</Text>
            <Text style={s.socialBtnText}>
              {'Continue with '}
              <Text style={{ color: '#4285F4' }}>G</Text>
              <Text style={{ color: '#EA4335' }}>o</Text>
              <Text style={{ color: '#FBBC05' }}>o</Text>
              <Text style={{ color: '#34A853' }}>g</Text>
              <Text style={{ color: '#EA4335' }}>l</Text>
              <Text style={{ color: '#4285F4' }}>e</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.bottom}>
        <TouchableOpacity style={s.pill} onPress={handleCreateAccount} activeOpacity={0.85} disabled={loading}>
          <Text style={s.pillText}>{loading ? 'Creating account...' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  topBarRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 },
  backArrowBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center', marginRight: 16,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#1A1A1A',
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: TEAL,
    borderRadius: 2,
  },

  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 16 },
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
  backLink: { alignItems: 'center', paddingVertical: 10 },
  backLinkText: { fontSize: 14, color: MUTED, fontWeight: '500' },
})
