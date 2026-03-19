import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Dimensions,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Check, TrendingDown, Dumbbell, Scale, Zap, ChefHat, Flame } from 'lucide-react-native'

const { width } = Dimensions.get('window')

const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'

const PROGRESS: Record<number, number> = {
  2: 14, 3: 28, 4: 42, 5: 57, 6: 71, 7: 85,
}

// ── Shared UI pieces ─────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${pct}%` }]} />
    </View>
  )
}

function PillButton({ label, onPress, variant = 'white' }: { label: string; onPress: () => void; variant?: 'white' | 'dark' }) {
  return (
    <TouchableOpacity
      style={[s.pill, variant === 'dark' && s.pillDark]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[s.pillText, variant === 'dark' && s.pillTextDark]}>{label}</Text>
    </TouchableOpacity>
  )
}

// ── Screen 1 — Welcome ───────────────────────────────────────────────

function S1Welcome({ onNext, onSignIn }: { onNext: () => void; onSignIn: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.centerFlex}>
        <Text style={s.wordmark}>Pantry</Text>
        <Text style={s.tagline}>Your kitchen. Your goals.{'\n'}No scale required.</Text>
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Get Started" onPress={onNext} />
        <TouchableOpacity activeOpacity={0.7} style={s.textLink} onPress={onSignIn}>
          <Text style={s.textLinkText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ── Screen 2 — Goal ──────────────────────────────────────────────────

const GOALS = [
  {
    id: 'lose',
    Icon: TrendingDown,
    iconColor: '#EF4444',
    label: 'Lose Weight',
    sub: 'Burn fat while hitting your protein goals',
  },
  {
    id: 'build',
    Icon: Dumbbell,
    iconColor: TEAL,
    label: 'Build Muscle',
    sub: 'High protein meals to support your gains',
  },
  {
    id: 'maintain',
    Icon: Scale,
    iconColor: '#60A5FA',
    label: 'Maintain Weight',
    sub: 'Balanced meals to keep you on track',
  },
]

function S2Goal({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[2]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>What's your main goal?</Text>
        <Text style={s.subtitle}>This helps us tailor your meal suggestions</Text>
        <View style={s.cardList}>
          {GOALS.map(g => (
            <TouchableOpacity
              key={g.id}
              style={[s.selectCard, selected === g.id && s.selectCardActive]}
              onPress={() => setSelected(g.id)}
              activeOpacity={0.8}
            >
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <g.Icon size={28} stroke={g.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{g.label}</Text>
                <Text style={s.selectCardSub}>{g.sub}</Text>
              </View>
              {selected === g.id && (
                <View style={s.checkCircle}>
                  <Check size={12} stroke="#000000" strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ── Screen 3 — Your Numbers ──────────────────────────────────────────

function S3Numbers({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[3]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>Set your daily targets</Text>
          <Text style={s.subtitle}>You can always change these later</Text>
          <View style={s.cardList}>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Daily Calories</Text>
              <TextInput
                style={s.input}
                placeholder="2,400"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                value={calories}
                onChangeText={setCalories}
              />
            </View>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Daily Protein</Text>
              <TextInput
                style={s.input}
                placeholder="180g"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                value={protein}
                onChangeText={setProtein}
              />
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { setCalories('2400'); setProtein('180') }}
          >
            <Text style={s.calcLink}>Not sure? Calculate for me →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ── Screen 4 — About You ─────────────────────────────────────────────

function S4AboutYou({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [ft, setFt] = useState('')
  const [inches, setInches] = useState('')
  const [weight, setWeight] = useState('')
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[4]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>Tell us about yourself</Text>
          <Text style={s.subtitle}>Used to estimate your ideal targets</Text>
          <View style={s.cardList}>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Height</Text>
              <View style={s.heightRow}>
                <View style={s.heightInputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder="5"
                    placeholderTextColor={MUTED}
                    keyboardType="number-pad"
                    value={ft}
                    onChangeText={setFt}
                  />
                  <Text style={s.heightUnit}>ft</Text>
                </View>
                <View style={s.heightInputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder="10"
                    placeholderTextColor={MUTED}
                    keyboardType="number-pad"
                    value={inches}
                    onChangeText={setInches}
                  />
                  <Text style={s.heightUnit}>in</Text>
                </View>
              </View>
            </View>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Weight</Text>
              <View style={s.heightInputWrap}>
                <TextInput
                  style={s.input}
                  placeholder="175"
                  placeholderTextColor={MUTED}
                  keyboardType="number-pad"
                  value={weight}
                  onChangeText={setWeight}
                />
                <Text style={s.heightUnit}>lbs</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ── Screen 5 — Preferences ───────────────────────────────────────────

const MEALS_OPTIONS = ['1', '2', '3', '4', '5', '6']
const PREP_OPTIONS  = ['5 min', '15 min', '30 min']
const DIET_OPTIONS  = ['None', 'Vegetarian', 'Dairy-free', 'Gluten-free', 'Nut-free']

function S5Preferences({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [meals, setMeals] = useState('3')
  const [prep, setPrep]   = useState('30 min')
  const [diet, setDiet]   = useState<string[]>(['None'])

  const toggleDiet = (opt: string) => {
    if (opt === 'None') { setDiet(['None']); return }
    setDiet(prev => {
      const without = prev.filter(d => d !== 'None')
      return without.includes(opt)
        ? without.filter(d => d !== opt) || ['None']
        : [...without, opt]
    })
  }

  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[5]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Your preferences</Text>

        <Text style={s.prefSection}>Meals per day</Text>
        <View style={s.pillRow}>
          {MEALS_OPTIONS.map(o => (
            <TouchableOpacity
              key={o}
              style={[s.prefPill, meals === o && s.prefPillActive]}
              onPress={() => setMeals(o)}
              activeOpacity={0.8}
            >
              <Text style={[s.prefPillText, meals === o && s.prefPillTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.prefSection}>Max prep time per meal</Text>
        <View style={s.pillRow}>
          {PREP_OPTIONS.map(o => (
            <TouchableOpacity
              key={o}
              style={[s.prefPill, prep === o && s.prefPillActive]}
              onPress={() => setPrep(o)}
              activeOpacity={0.8}
            >
              <Text style={[s.prefPillText, prep === o && s.prefPillTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.prefSection}>Dietary restrictions</Text>
        <View style={s.dietGrid}>
          {DIET_OPTIONS.map(o => {
            const active = diet.includes(o)
            return (
              <TouchableOpacity
                key={o}
                style={[s.dietPill, active && s.dietPillActive]}
                onPress={() => toggleDiet(o)}
                activeOpacity={0.8}
              >
                <Text style={[s.dietPillText, active && s.dietPillTextActive]}>{o}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ── Screen 6 — Cooking Skill ─────────────────────────────────────────

const SKILL_OPTIONS = [
  { id: 'minimal',     Icon: Zap,     iconColor: TEAL,      label: 'Minimal',     sub: 'I keep it simple — quick and easy' },
  { id: 'moderate',    Icon: ChefHat, iconColor: '#F59E0B', label: 'Moderate',    sub: 'I can follow a recipe no problem' },
  { id: 'adventurous', Icon: Flame,   iconColor: '#EF4444', label: 'Adventurous', sub: 'I love trying new dishes' },
]

function S6CookingSkill({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[6]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>How comfortable are you cooking?</Text>
        <View style={s.cardList}>
          {SKILL_OPTIONS.map(o => (
            <TouchableOpacity
              key={o.id}
              style={[s.selectCard, selected === o.id && s.selectCardActive]}
              onPress={() => setSelected(o.id)}
              activeOpacity={0.8}
            >
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <o.Icon size={28} stroke={o.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{o.label}</Text>
                <Text style={s.selectCardSub}>{o.sub}</Text>
              </View>
              {selected === o.id && (
                <View style={s.checkCircle}>
                  <Check size={12} stroke="#000000" strokeWidth={3} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

// ── Screen 7 — Paywall ───────────────────────────────────────────────

const FEATURES = [
  'Unlimited AI meal suggestions daily',
  'Log meals with AI photo scan',
  'AI pantry scan (Premium only)',
  'Auto-generate grocery lists',
  'Meal history — no repeats',
  'Unlimited saved meals',
]

function S7Paywall({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [plan, setPlan] = useState<'monthly' | 'annual'>('annual')
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[7]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.paywallTitle}>Start eating smarter</Text>
        <Text style={s.paywallSub}>7 days free, then $9.99/month</Text>

        <View style={s.featureList}>
          {FEATURES.map(f => (
            <View key={f} style={s.featureRow}>
              <View style={s.featureCheck}>
                <Check size={12} stroke="#000000" strokeWidth={3} />
              </View>
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={s.planRow}>
          <TouchableOpacity
            style={[s.planCard, plan === 'monthly' && s.planCardActive]}
            onPress={() => setPlan('monthly')}
            activeOpacity={0.8}
          >
            <Text style={s.planLabel}>Monthly</Text>
            <Text style={s.planPrice}>$9.99/mo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.planCard, plan === 'annual' && s.planCardActive]}
            onPress={() => setPlan('annual')}
            activeOpacity={0.8}
          >
            <View style={s.planBadgeRow}>
              <Text style={s.planLabel}>Annual</Text>
              <View style={s.planBadge}><Text style={s.planBadgeText}>Save 50%</Text></View>
            </View>
            <Text style={s.planPrice}>$59.99/yr</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.trialLimits}>Trial includes 2 daily suggestions and 5 photo scans</Text>
        <Text style={s.legal}>Free for 7 days. Cancel anytime.</Text>

        <View style={s.paywallActions}>
          <PillButton label="Start Free Trial" onPress={onNext} />
          <TouchableOpacity style={s.textLink} onPress={onNext} activeOpacity={0.7}>
            <Text style={s.textLinkText}>Continue with limited free access →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ── Screen 8 — Complete ──────────────────────────────────────────────

function S8Complete({ onFinish }: { onFinish: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.centerFlex}>
        <View style={s.completionCircle}>
          <Check size={40} stroke="#000000" strokeWidth={3} />
        </View>
        <Text style={s.completeTitle}>You're all set, Marcus!</Text>
        <Text style={s.completeSub}>
          Your pantry is ready.{'\n'}Let's find your first meal.
        </Text>
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Let's Go" onPress={onFinish} />
      </View>
    </SafeAreaView>
  )
}

// ── Root onboarding container ─────────────────────────────────────────

export default function Onboarding() {
  const router = useRouter()
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>()
  const [step, setStep] = useState(stepParam ? parseInt(stepParam) : 1)
  const fadeAnim = useRef(new Animated.Value(1)).current

  const navigate = (newStep: number) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setStep(newStep)
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    })
  }

  const next = () => navigate(step + 1)
  const back = () => navigate(step - 1)

  const finish = async () => {
    await AsyncStorage.setItem('onboarding_complete', 'true')
    router.replace('/(tabs)')
  }

  const screens: Record<number, React.ReactNode> = {
    1: <S1Welcome onNext={next} onSignIn={() => router.push('/onboarding/signin')} />,
    2: <S2Goal onNext={next} onBack={back} />,
    3: <S3Numbers onNext={next} onBack={back} />,
    4: <S4AboutYou onNext={next} onBack={back} />,
    5: <S5Preferences onNext={next} onBack={back} />,
    6: <S6CookingSkill onNext={() => router.push('/onboarding/createaccount')} onBack={back} />,
    7: <S7Paywall onNext={next} onBack={back} />,
    8: <S8Complete onFinish={finish} />,
  }

  return (
    <View style={s.root}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {screens[step]}
      </Animated.View>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  safe: { flex: 1, backgroundColor: '#000000' },

  // Progress bar
  progressTrack: {
    height: 3,
    backgroundColor: '#1A1A1A',
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: TEAL,
    borderRadius: 2,
  },

  // Layout
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  scrollBody: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 16 },
  bottomActions: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8, gap: 4 },

  // Pill buttons
  pill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
  },
  pillDark: { backgroundColor: '#1A1A1A' },
  pillText: { fontSize: 16, fontWeight: '700', color: '#000000' },
  pillTextDark: { color: '#FFFFFF' },

  // Text links
  textLink: { alignItems: 'center', paddingVertical: 10 },
  textLinkText: { fontSize: 14, color: MUTED, fontWeight: '500' },

  // Screen 1
  wordmark: { fontSize: 52, fontWeight: '800', color: '#FFFFFF', letterSpacing: -2, marginBottom: 16 },
  tagline: { fontSize: 17, color: MUTED, textAlign: 'center', lineHeight: 26 },

  // Titles
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: MUTED, marginBottom: 28, lineHeight: 22 },

  // Select cards (goals / cooking skill)
  cardList: { gap: 12 },
  selectCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  selectCardActive: { borderColor: TEAL },
  selectCardEmoji: { fontSize: 24 },
  selectCardLabel: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', flex: 1 },
  selectCardSub: { fontSize: 13, color: MUTED, marginTop: 3 },
  goalIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Input cards
  inputCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  inputLabel: { fontSize: 13, fontWeight: '600', color: MUTED },
  input: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    padding: 0,
  },
  heightRow: { flexDirection: 'row', gap: 16 },
  heightInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heightUnit: { fontSize: 14, color: MUTED, fontWeight: '500' },
  calcLink: { fontSize: 14, color: TEAL, fontWeight: '600', marginTop: 16 },

  // Preferences
  prefSection: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 24,
    marginBottom: 12,
  },
  pillRow: { flexDirection: 'row', gap: 10 },
  prefPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 30,
    backgroundColor: CARD,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  prefPillActive: { backgroundColor: '#FFFFFF' },
  prefPillText: { fontSize: 14, fontWeight: '600', color: MUTED },
  prefPillTextActive: { color: '#000000' },
  dietGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dietPill: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 30,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  dietPillActive: { borderColor: TEAL },
  dietPillText: { fontSize: 14, fontWeight: '500', color: MUTED },
  dietPillTextActive: { color: TEAL, fontWeight: '600' },

  // Paywall
  paywallTitle: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6, marginBottom: 8 },
  paywallSub: { fontSize: 16, color: MUTED, marginBottom: 28 },
  featureList: { gap: 14, marginBottom: 28 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500', flex: 1 },
  planRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    padding: 16,
    gap: 6,
  },
  planCardActive: { borderColor: TEAL },
  planBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planLabel: { fontSize: 14, fontWeight: '600', color: MUTED },
  planPrice: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  planBadge: {
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  planBadgeText: { fontSize: 10, fontWeight: '700', color: TEAL },
  paywallActions: { marginTop: 24, gap: 4 },
  trialLimits: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  legal: { fontSize: 11, color: '#444444', textAlign: 'center', marginTop: 4 },

  // Complete
  completionCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  completeTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 12,
  },
  completeSub: {
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 24,
  },
})
