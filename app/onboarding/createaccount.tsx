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
import { Eye, EyeOff, ArrowLeft, Check } from 'lucide-react-native'
import { useAuth } from '../../context/AuthContext'
import { trackAccountCreated, trackMarketingOptIn } from '../../lib/analytics'
import PressableScale from '../../components/PressableScale'
import TurnstileWebView, { type TurnstileRef } from '../../components/TurnstileWebView'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { generateMeals } from '../../lib/meals'
import { supabase } from '../../lib/supabase'

// Email marketing opt-in is captured on this screen for all 3 signup paths
// (email, Apple, Google). Because Apple/Google flows redirect through OAuth,
// the checkbox state is stashed in AsyncStorage BEFORE the OAuth call. The
// AuthContext reads + applies it after the auth callback completes, then
// clears the flag so it doesn't leak to subsequent signups.
const PENDING_OPT_IN_KEY = 'pending_email_marketing_opt_in'

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
  const [emailOptIn, setEmailOptIn] = useState(false) // GDPR: unchecked default
  const turnstileRef = useRef<TurnstileRef>(null)

  // Stash the opt-in choice in AsyncStorage so it survives the OAuth round-trip
  // for Apple/Google sign-in. Cleared after AuthContext applies it to the profile.
  const stashOptIn = async (method: 'email' | 'apple' | 'google') => {
    await AsyncStorage.setItem(PENDING_OPT_IN_KEY, emailOptIn ? '1' : '0')
    trackMarketingOptIn(method, emailOptIn)
  }

  const handleCreateAccount = async () => {
    if (!name || !email || !password) {
      Alert.alert('Almost there', 'Please fill in all fields to continue.')
      return
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.')
      return
    }
    const now = Date.now()
    // Cooldown between sign-up attempts — prevents Supabase rate-limit hits and
    // spam abuse if someone holds the button. Turnstile (above) is the real
    // bot defense; this is just a client-side guard. Show the actual remaining time.
    const remainingMs = 30000 - (now - lastAttempt)
    if (remainingMs > 0) {
      Alert.alert('Please wait', `You can try again in ${Math.ceil(remainingMs / 1000)} seconds.`)
      return
    }
    setLastAttempt(now)
    try {
      setLoading(true)
      await stashOptIn('email')
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
    if (await AsyncStorage.getItem('onboarding_complete') === 'true') return true
    // Local flag missing (fresh install / reset) — fall back to the server profile so an
    // already-onboarded user signing in via OAuth on a new device isn't sent back through
    // onboarding (which would re-run it over their existing data). Mirrors routeByProfile.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('onboarding_completed, calorie_goal')
          .eq('id', session.user.id)
          .maybeSingle()
        return !!(data?.onboarding_completed || data?.calorie_goal)
      }
    } catch {}
    return false
  }

  const handleAppleSignIn = async () => {
    try {
      setLoading(true)
      await stashOptIn('apple')
      await signInWithApple()
      if (await isReturningUser()) {
        await AsyncStorage.setItem('onboarding_complete', 'true')
        router.replace('/(tabs)')
        return
      }
      prefetchMeals()
      trackAccountCreated('apple')
      router.replace({ pathname: '/onboarding', params: { step: '20' } })
    } catch (e: any) {
      // ERR_REQUEST_CANCELED is the Apple-native code for the user dismissing
      // the sheet — not an error, swallow silently. Real failures fall through.
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
        await AsyncStorage.setItem('pantry_daily_meals_cookNow', JSON.stringify({ date: today, meals, dietStyle: d.dietStyle || 'Classic' }))
      } catch {}
    })()
  }

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true)
      await stashOptIn('google')
      await signInWithGoogle()
      if (await isReturningUser()) {
        await AsyncStorage.setItem('onboarding_complete', 'true')
        router.replace('/(tabs)')
        return
      }
      prefetchMeals()
      trackAccountCreated('google')
      router.replace({ pathname: '/onboarding', params: { step: '20' } })
    } catch (e: any) {
      // Google's native code 12501 = SIGN_IN_CANCELLED (user dismissed). Not an error.
      if (e.code !== '12501') {
        Alert.alert('Google Sign-In Failed', e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <TurnstileWebView
        ref={turnstileRef}
        onToken={setCaptchaToken}
        // On a failed challenge, reset to fetch a fresh token instead of stalling sign-up.
        onError={() => { setCaptchaToken(null); turnstileRef.current?.reset() }}
      />
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

          {/* Marketing consent — applies to ALL sign-up paths (email, Apple, Google).
              Wrapped in its own card so it visually separates from the email form
              above + clarifies via subtitle that it's a global preference. */}
          <TouchableOpacity
            style={s.consentCard}
            onPress={() => setEmailOptIn(v => !v)}
            activeOpacity={0.7}
          >
            <View style={[s.consentBox, emailOptIn && s.consentBoxChecked]}>
              {emailOptIn && <Check size={12} stroke="#000" strokeWidth={3} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.consentText}>
                Send me cooking tips and occasional offers
              </Text>
              <Text style={s.consentSubtext}>
                Applies to all sign-up methods · unsubscribe anytime
              </Text>
            </View>
          </TouchableOpacity>

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
        <PressableScale style={s.pill} onPress={handleCreateAccount} disabled={loading} haptic>
          <Text style={s.pillText}>{loading ? 'Creating account...' : 'Continue'}</Text>
        </PressableScale>
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

  // Email marketing consent — unchecked default to satisfy GDPR. Captured for
  // all 3 signup paths via AsyncStorage trampoline. Card-style to visually
  // separate from the email form above and read as a global preference.
  consentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#0F0F0F',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  consentBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  consentBoxChecked: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  consentText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    lineHeight: 18,
  },
  consentSubtext: {
    fontSize: 11,
    color: '#666666',
    marginTop: 3,
    lineHeight: 14,
  },

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
