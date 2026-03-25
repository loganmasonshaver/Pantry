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
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Check, TrendingDown, Dumbbell, Scale, Zap, ChefHat, Flame } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useSuperwall } from 'expo-superwall'
import { trackOnboardingStep, trackPaywallViewed, trackSubscriptionPurchased } from '../../lib/analytics'
import { DISLIKE_CHIPS } from '../food-preferences'

const { width } = Dimensions.get('window')
const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'

const PROGRESS: Record<number, number> = {
  2: 12, 3: 25, 4: 37, 5: 50, 6: 62, 7: 75, 8: 87,
}

type OnboardingData = {
  goal: string
  calories: string
  protein: string
  ft: string
  inches: string
  weight: string
  meals: string
  prep: string
  diet: string[]
  cookingSkill: string
  foodDislikes: string[]
  foodDislikesText: string
  age: string
  gender: string
  activityLevel: string
  fitnessGoal: string
}

const DEFAULT_DATA: OnboardingData = {
  goal: '', calories: '', protein: '', ft: '', inches: '', weight: '',
  meals: '3', prep: '30 min', diet: ['None'], cookingSkill: '',
  foodDislikes: [], foodDislikesText: '',
  age: '', gender: '', activityLevel: '', fitnessGoal: '',
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${pct}%` }]} />
    </View>
  )
}

function PillButton({ label, onPress, variant = 'white', disabled }: { label: string; onPress: () => void; variant?: 'white' | 'dark'; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[s.pill, variant === 'dark' && s.pillDark, disabled && { opacity: 0.4 }]} onPress={onPress} activeOpacity={0.85} disabled={disabled}>
      <Text style={[s.pillText, variant === 'dark' && s.pillTextDark]}>{label}</Text>
    </TouchableOpacity>
  )
}

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

const GOALS = [
  { id: 'lose', Icon: TrendingDown, iconColor: '#EF4444', label: 'Lose Weight', sub: 'Burn fat while hitting your protein goals' },
  { id: 'build', Icon: Dumbbell, iconColor: TEAL, label: 'Build Muscle', sub: 'High protein meals to support your gains' },
  { id: 'maintain', Icon: Scale, iconColor: '#60A5FA', label: 'Maintain Weight', sub: 'Balanced meals to keep you on track' },
]

function S2Goal({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[2]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>What's your main goal?</Text>
        <Text style={s.subtitle}>This helps us tailor your meal suggestions</Text>
        <View style={s.cardList}>
          {GOALS.map(g => (
            <TouchableOpacity key={g.id} style={[s.selectCard, value === g.id && s.selectCardActive]} onPress={() => onChange(g.id)} activeOpacity={0.8}>
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <g.Icon size={28} stroke={g.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{g.label}</Text>
                <Text style={s.selectCardSub}>{g.sub}</Text>
              </View>
              {value === g.id && <View style={s.checkCircle}><Check size={12} stroke="#000000" strokeWidth={3} /></View>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const ACTIVITY_OPTIONS = [
  { key: 'sedentary', label: 'Sedentary', sub: 'Desk job, little exercise', mult: 1.2 },
  { key: 'light', label: 'Lightly Active', sub: 'Light exercise 1-3x/week', mult: 1.375 },
  { key: 'moderate', label: 'Moderately Active', sub: 'Exercise 3-5x/week', mult: 1.55 },
  { key: 'very', label: 'Very Active', sub: 'Hard exercise 6-7x/week', mult: 1.725 },
  { key: 'athlete', label: 'Athlete', sub: '2x/day or physical job', mult: 1.9 },
]

const FITNESS_GOAL_OPTIONS = [
  { key: 'lose', label: 'Lose Weight', adj: -500 },
  { key: 'maintain', label: 'Maintain', adj: 0 },
  { key: 'gain', label: 'Gain Muscle', adj: 300 },
]

function calculateGoals(age: number, gender: string, heightCm: number, weightKg: number, activityLevel: string, fitnessGoal: string) {
  // Mifflin-St Jeor BMR
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === 'male' ? 5 : -161)
  const activity = ACTIVITY_OPTIONS.find(a => a.key === activityLevel)
  const tdee = bmr * (activity?.mult ?? 1.55)
  const goalAdj = FITNESS_GOAL_OPTIONS.find(g => g.key === fitnessGoal)?.adj ?? 0
  const calories = Math.round(tdee + goalAdj)
  const weightLbs = weightKg / 0.453592
  const protein = Math.round(fitnessGoal === 'gain' ? weightLbs * 1.0 : weightLbs * 0.8)
  return { calories, protein }
}

function S3Numbers({
  calories, protein, onCalories, onProtein, onNext, onBack,
  age, gender, activityLevel, fitnessGoal, ft, inches, weight,
  onAge, onGender, onActivityLevel, onFitnessGoal,
}: {
  calories: string; protein: string; onCalories: (v: string) => void; onProtein: (v: string) => void
  onNext: () => void; onBack: () => void
  age: string; gender: string; activityLevel: string; fitnessGoal: string
  ft: string; inches: string; weight: string
  onAge: (v: string) => void; onGender: (v: string) => void
  onActivityLevel: (v: string) => void; onFitnessGoal: (v: string) => void
}) {
  const [showCalc, setShowCalc] = useState(false)
  const [calcResult, setCalcResult] = useState<{ calories: number; protein: number } | null>(null)

  const canCalculate = age && gender && activityLevel && fitnessGoal && ft && weight

  const handleCalculate = () => {
    const heightCm = (parseInt(ft || '0') * 12 + parseInt(inches || '0')) * 2.54
    const weightKg = parseFloat(weight || '0') * 0.453592
    const result = calculateGoals(parseInt(age), gender, heightCm, weightKg, activityLevel, fitnessGoal)
    setCalcResult(result)
  }

  const applyResult = () => {
    if (calcResult) {
      onCalories(String(calcResult.calories))
      onProtein(String(calcResult.protein))
      setShowCalc(false)
    }
  }

  if (showCalc && !calcResult) {
    return (
      <SafeAreaView style={s.safe}>
        <ProgressBar pct={PROGRESS[3]} />
        <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>Calculate your goals</Text>
          <Text style={s.subtitle}>We'll use science to find your ideal targets</Text>

          <View style={s.inputCard}>
            <Text style={s.inputLabel}>Age</Text>
            <TextInput style={s.input} placeholder="25" placeholderTextColor={MUTED} keyboardType="number-pad" value={age} onChangeText={onAge} />
          </View>

          <Text style={s.prefSection}>Gender</Text>
          <View style={s.pillRow}>
            {['male', 'female'].map(g => (
              <TouchableOpacity key={g} style={[s.prefPill, gender === g && s.prefPillActive]} onPress={() => onGender(g)} activeOpacity={0.8}>
                <Text style={[s.prefPillText, gender === g && s.prefPillTextActive]}>{g === 'male' ? 'Male' : 'Female'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.prefSection}>Activity Level</Text>
          <View style={s.cardList}>
            {ACTIVITY_OPTIONS.map(a => (
              <TouchableOpacity key={a.key} style={[s.selectCard, activityLevel === a.key && s.selectCardActive]} onPress={() => onActivityLevel(a.key)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={s.selectCardLabel}>{a.label}</Text>
                  <Text style={s.selectCardSub}>{a.sub}</Text>
                </View>
                {activityLevel === a.key && <View style={s.checkCircle}><Check size={13} stroke="#000" strokeWidth={3} /></View>}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.prefSection}>Fitness Goal</Text>
          <View style={s.pillRow}>
            {FITNESS_GOAL_OPTIONS.map(g => (
              <TouchableOpacity key={g.key} style={[s.prefPill, fitnessGoal === g.key && s.prefPillActive]} onPress={() => onFitnessGoal(g.key)} activeOpacity={0.8}>
                <Text style={[s.prefPillText, fitnessGoal === g.key && s.prefPillTextActive]}>{g.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {!ft && !weight && (
            <Text style={[s.subtitle, { marginTop: 20, color: '#FF6B6B' }]}>
              Go back to step 4 to enter your height and weight first
            </Text>
          )}
        </ScrollView>
        <View style={s.bottomActions}>
          <PillButton label="Calculate" onPress={handleCalculate} disabled={!canCalculate} />
          <TouchableOpacity style={s.textLink} onPress={() => setShowCalc(false)} activeOpacity={0.7}>
            <Text style={s.textLinkText}>Back to manual entry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (showCalc && calcResult) {
    return (
      <SafeAreaView style={s.safe}>
        <ProgressBar pct={PROGRESS[3]} />
        <View style={s.centerFlex}>
          <Text style={s.paywallTitle}>Your recommended goals</Text>
          <Text style={[s.subtitle, { textAlign: 'center', marginBottom: 32 }]}>Based on your profile using the Mifflin-St Jeor formula</Text>
          <View style={[s.inputCard, { width: '100%', marginBottom: 16 }]}>
            <Text style={s.inputLabel}>Daily Calories</Text>
            <Text style={[s.input, { paddingVertical: 4 }]}>{calcResult.calories.toLocaleString()} kcal</Text>
          </View>
          <View style={[s.inputCard, { width: '100%', marginBottom: 16 }]}>
            <Text style={s.inputLabel}>Daily Protein</Text>
            <Text style={[s.input, { paddingVertical: 4 }]}>{calcResult.protein}g</Text>
          </View>
        </View>
        <View style={s.bottomActions}>
          <PillButton label="Use these goals" onPress={applyResult} />
          <TouchableOpacity style={s.textLink} onPress={() => setCalcResult(null)} activeOpacity={0.7}>
            <Text style={s.textLinkText}>Recalculate</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

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
              <TextInput style={s.input} placeholder="2,400" placeholderTextColor={MUTED} keyboardType="number-pad" value={calories} onChangeText={onCalories} />
            </View>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Daily Protein</Text>
              <TextInput style={s.input} placeholder="180g" placeholderTextColor={MUTED} keyboardType="number-pad" value={protein} onChangeText={onProtein} />
            </View>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={() => setShowCalc(true)}>
            <Text style={s.calcLink}>Not sure? Calculate for me</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function S4AboutYou({ ft, inches, weight, onFt, onInches, onWeight, onNext, onBack }: { ft: string; inches: string; weight: string; onFt: (v: string) => void; onInches: (v: string) => void; onWeight: (v: string) => void; onNext: () => void; onBack: () => void }) {
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
                  <TextInput style={s.input} placeholder="5" placeholderTextColor={MUTED} keyboardType="number-pad" value={ft} onChangeText={onFt} />
                  <Text style={s.heightUnit}>ft</Text>
                </View>
                <View style={s.heightInputWrap}>
                  <TextInput style={s.input} placeholder="10" placeholderTextColor={MUTED} keyboardType="number-pad" value={inches} onChangeText={onInches} />
                  <Text style={s.heightUnit}>in</Text>
                </View>
              </View>
            </View>
            <View style={s.inputCard}>
              <Text style={s.inputLabel}>Weight</Text>
              <View style={s.heightInputWrap}>
                <TextInput style={s.input} placeholder="175" placeholderTextColor={MUTED} keyboardType="number-pad" value={weight} onChangeText={onWeight} />
                <Text style={s.heightUnit}>lbs</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const MEALS_OPTIONS = ['1', '2', '3', '4', '5', '6']
const PREP_OPTIONS = ['5 min', '15 min', '30 min']
const DIET_OPTIONS = ['None', 'Vegetarian', 'Dairy-free', 'Gluten-free', 'Nut-free']

function S5Preferences({ meals, prep, diet, onMeals, onPrep, onDiet, onNext, onBack }: { meals: string; prep: string; diet: string[]; onMeals: (v: string) => void; onPrep: (v: string) => void; onDiet: (v: string[]) => void; onNext: () => void; onBack: () => void }) {
  const toggleDiet = (opt: string) => {
    if (opt === 'None') { onDiet(['None']); return }
    const without = diet.filter(d => d !== 'None')
    onDiet(without.includes(opt) ? without.filter(d => d !== opt) || ['None'] : [...without, opt])
  }
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[5]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Your preferences</Text>
        <Text style={s.prefSection}>Meals per day</Text>
        <View style={s.pillRow}>
          {MEALS_OPTIONS.map(o => (
            <TouchableOpacity key={o} style={[s.prefPill, meals === o && s.prefPillActive]} onPress={() => onMeals(o)} activeOpacity={0.8}>
              <Text style={[s.prefPillText, meals === o && s.prefPillTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.prefSection}>Max prep time per meal</Text>
        <View style={s.pillRow}>
          {PREP_OPTIONS.map(o => (
            <TouchableOpacity key={o} style={[s.prefPill, prep === o && s.prefPillActive]} onPress={() => onPrep(o)} activeOpacity={0.8}>
              <Text style={[s.prefPillText, prep === o && s.prefPillTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.prefSection}>Dietary restrictions</Text>
        <View style={s.dietGrid}>
          {DIET_OPTIONS.map(o => {
            const active = diet.includes(o)
            return (
              <TouchableOpacity key={o} style={[s.dietPill, active && s.dietPillActive]} onPress={() => toggleDiet(o)} activeOpacity={0.8}>
                <Text style={[s.dietPillText, active && s.dietPillTextActive]}>{o}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const SKILL_OPTIONS = [
  { id: 'minimal', Icon: Zap, iconColor: TEAL, label: 'Minimal', sub: 'I keep it simple — quick and easy' },
  { id: 'moderate', Icon: ChefHat, iconColor: '#F59E0B', label: 'Moderate', sub: 'I can follow a recipe no problem' },
  { id: 'adventurous', Icon: Flame, iconColor: '#EF4444', label: 'Adventurous', sub: 'I love trying new dishes' },
]

function S6CookingSkill({ value, onChange, onNext, onBack }: { value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[6]} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>How comfortable are you cooking?</Text>
        <View style={s.cardList}>
          {SKILL_OPTIONS.map(o => (
            <TouchableOpacity key={o.id} style={[s.selectCard, value === o.id && s.selectCardActive]} onPress={() => onChange(o.id)} activeOpacity={0.8}>
              <View style={[s.goalIconCircle, { backgroundColor: '#2A2A2A' }]}>
                <o.Icon size={28} stroke={o.iconColor} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.selectCardLabel}>{o.label}</Text>
                <Text style={s.selectCardSub}>{o.sub}</Text>
              </View>
              {value === o.id && <View style={s.checkCircle}><Check size={12} stroke="#000000" strokeWidth={3} /></View>}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function S7FoodPreferences({
  dislikes,
  customText,
  onDislikes,
  onCustomText,
  onNext,
  onBack,
}: {
  dislikes: string[]
  customText: string
  onDislikes: (v: string[]) => void
  onCustomText: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  const TEAL_OB = '#4ADE80'

  const toggleChip = (chip: string) => {
    onDislikes(
      dislikes.includes(chip)
        ? dislikes.filter(c => c !== chip)
        : [...dislikes, chip]
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[7]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>Any foods to avoid?</Text>
          <Text style={s.subtitle}>We'll never suggest meals with these ingredients</Text>
          <View style={s.dietGrid}>
            {DISLIKE_CHIPS.map(chip => {
              const active = dislikes.includes(chip)
              return (
                <TouchableOpacity
                  key={chip}
                  style={[s.dietPill, active && s.dietPillActive]}
                  onPress={() => toggleChip(chip)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.dietPillText, active && s.dietPillTextActive]}>{chip}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={s.prefSection}>Anything else?</Text>
          <View style={s.inputCard}>
            <TextInput
              style={[s.input, { fontSize: 16 }]}
              placeholder="e.g. Mushrooms, Cilantro"
              placeholderTextColor="#888888"
              value={customText}
              onChangeText={onCustomText}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.bottomActions}>
        <PillButton label="Continue" onPress={onNext} />
        <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const FEATURES = [
  'Unlimited AI meal suggestions daily',
  'Log meals with AI photo scan',
  'AI pantry scan (Premium only)',
  'Auto-generate grocery lists',
  'Meal history — no repeats',
  'Unlimited saved meals',
]

function S7Paywall({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { registerPlacement } = useSuperwall()

  useEffect(() => { trackPaywallViewed('onboarding') }, [])

  useEffect(() => {
    const present = async () => {
      await registerPlacement('onboarding_paywall')
      onNext()
    }
    present()
  }, [])

  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={PROGRESS[8]} />
      <View style={s.centerFlex}>
        <TouchableOpacity style={s.textLink} onPress={onNext} activeOpacity={0.7}>
          <Text style={s.textLinkText}>Continue with limited free access</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function S8Complete({ onFinish }: { onFinish: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.centerFlex}>
        <View style={s.completionCircle}><Check size={40} stroke="#000000" strokeWidth={3} /></View>
        <Text style={s.completeTitle}>You are all set!</Text>
        <Text style={s.completeSub}>Your pantry is ready.{'\n'}Let us find your first meal.</Text>
      </View>
      <View style={s.bottomActions}>
        <PillButton label="Lets Go" onPress={onFinish} />
      </View>
    </SafeAreaView>
  )
}

export default function Onboarding() {
  const router = useRouter()
  const { user } = useAuth()
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>()
  const [step, setStep] = useState(stepParam ? parseInt(stepParam) : 1)
  const fadeAnim = useRef(new Animated.Value(1)).current
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA)

  useEffect(() => {
    AsyncStorage.getItem('onboarding_data').then(saved => {
      if (saved) setData(JSON.parse(saved))
    })
  }, [])

  const update = (key: keyof OnboardingData) => (val: any) => {
    setData(prev => {
      const next = { ...prev, [key]: val }
      AsyncStorage.setItem('onboarding_data', JSON.stringify(next))
      return next
    })
  }

  const navigate = (newStep: number) => {
    trackOnboardingStep(newStep)
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setStep(newStep)
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    })
  }

  const next = () => navigate(step + 1)
  const back = () => navigate(step - 1)

  const prepToMinutes = (prep: string) => {
    if (prep === '5 min') return 5
    if (prep === '15 min') return 15
    return 30
  }

  const finish = async () => {
    try {
      const saved = await AsyncStorage.getItem('onboarding_data')
      const finalData: OnboardingData = saved ? JSON.parse(saved) : data

      if (user) {
        const heightCm = Math.round((parseInt(finalData.ft || '0') * 12 + parseInt(finalData.inches || '0')) * 2.54)
        const weightKg = Math.round(parseFloat(finalData.weight || '0') * 0.453592 * 10) / 10

        const customDislikes = finalData.foodDislikesText
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
        const allDislikes = [...(finalData.foodDislikes || []), ...customDislikes]

        const { error } = await supabase.from('profiles').update({
          calorie_goal: parseInt(finalData.calories) || null,
          protein_goal: parseInt(finalData.protein) || null,
          height_cm: heightCm || null,
          weight_kg: weightKg || null,
          dietary_restrictions: finalData.diet,
          meals_per_day: parseInt(finalData.meals),
          cooking_skill: finalData.cookingSkill || null,
          max_prep_minutes: prepToMinutes(finalData.prep),
          last_active: new Date().toISOString().split('T')[0],
          food_dislikes: allDislikes,
          food_prefs_banner_dismissed: allDislikes.length > 0,
          age: parseInt(finalData.age) || null,
          gender: finalData.gender || null,
          activity_level: finalData.activityLevel || null,
          fitness_goal: finalData.fitnessGoal || null,
        }).eq('id', user.id)

        if (error) {
          Alert.alert('Save Error', error.message)
          return
        }
      }

      await AsyncStorage.removeItem('onboarding_data')
      await AsyncStorage.setItem('onboarding_complete', 'true')
      router.replace('/(tabs)')
    } catch (error: any) {
      Alert.alert('Error', error.message)
    }
  }

  const screens: Record<number, React.ReactNode> = {
    1: <S1Welcome onNext={next} onSignIn={() => router.push('/onboarding/signin')} />,
    2: <S2Goal value={data.goal} onChange={update('goal')} onNext={next} onBack={back} />,
    3: <S4AboutYou ft={data.ft} inches={data.inches} weight={data.weight} onFt={update('ft')} onInches={update('inches')} onWeight={update('weight')} onNext={next} onBack={back} />,
    4: <S3Numbers
          calories={data.calories} protein={data.protein}
          onCalories={update('calories')} onProtein={update('protein')}
          age={data.age} gender={data.gender} activityLevel={data.activityLevel} fitnessGoal={data.fitnessGoal}
          ft={data.ft} inches={data.inches} weight={data.weight}
          onAge={update('age')} onGender={update('gender')}
          onActivityLevel={update('activityLevel')} onFitnessGoal={update('fitnessGoal')}
          onNext={next} onBack={back}
        />,
    5: <S5Preferences meals={data.meals} prep={data.prep} diet={data.diet} onMeals={update('meals')} onPrep={update('prep')} onDiet={update('diet')} onNext={next} onBack={back} />,
    6: <S6CookingSkill value={data.cookingSkill} onChange={update('cookingSkill')} onNext={next} onBack={back} />,
    7: <S7FoodPreferences
        dislikes={data.foodDislikes}
        customText={data.foodDislikesText}
        onDislikes={update('foodDislikes')}
        onCustomText={update('foodDislikesText')}
        onNext={() => router.push('/onboarding/createaccount')}
        onBack={back}
      />,
    8: <S7Paywall onNext={next} onBack={back} />,
    9: <S8Complete onFinish={finish} />,
  }

  return (
    <View style={s.root}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {screens[step]}
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  safe: { flex: 1, backgroundColor: '#000000' },
  progressTrack: { height: 3, backgroundColor: '#1A1A1A', marginHorizontal: 24, marginTop: 12, marginBottom: 4, borderRadius: 2 },
  progressFill: { height: '100%', backgroundColor: TEAL, borderRadius: 2 },
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  scrollBody: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 16 },
  bottomActions: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8, gap: 4 },
  pill: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingVertical: 18, alignItems: 'center' },
  pillDark: { backgroundColor: '#1A1A1A' },
  pillText: { fontSize: 16, fontWeight: '700', color: '#000000' },
  pillTextDark: { color: '#FFFFFF' },
  textLink: { alignItems: 'center', paddingVertical: 10 },
  textLinkText: { fontSize: 14, color: MUTED, fontWeight: '500' },
  wordmark: { fontSize: 52, fontWeight: '800', color: '#FFFFFF', letterSpacing: -2, marginBottom: 16 },
  tagline: { fontSize: 17, color: MUTED, textAlign: 'center', lineHeight: 26 },
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: MUTED, marginBottom: 28, lineHeight: 22 },
  cardList: { gap: 12 },
  selectCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: '#2A2A2A', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectCardActive: { borderColor: TEAL },
  selectCardLabel: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', flex: 1 },
  selectCardSub: { fontSize: 13, color: MUTED, marginTop: 3 },
  goalIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  inputCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, gap: 10 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: MUTED },
  input: { flex: 1, fontSize: 20, fontWeight: '700', color: '#FFFFFF', padding: 0 },
  heightRow: { flexDirection: 'row', gap: 16 },
  heightInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heightUnit: { fontSize: 14, color: MUTED, fontWeight: '500' },
  calcLink: { fontSize: 14, color: TEAL, fontWeight: '600', marginTop: 16 },
  prefSection: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginTop: 24, marginBottom: 12 },
  pillRow: { flexDirection: 'row', gap: 10 },
  prefPill: { flex: 1, paddingVertical: 12, borderRadius: 30, backgroundColor: CARD, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  prefPillActive: { backgroundColor: '#FFFFFF' },
  prefPillText: { fontSize: 14, fontWeight: '600', color: MUTED },
  prefPillTextActive: { color: '#000000' },
  dietGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dietPill: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 30, backgroundColor: CARD, borderWidth: 1, borderColor: '#2A2A2A' },
  dietPillActive: { borderColor: TEAL },
  dietPillText: { fontSize: 14, fontWeight: '500', color: MUTED },
  dietPillTextActive: { color: TEAL, fontWeight: '600' },
  paywallTitle: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6, marginBottom: 8 },
  paywallSub: { fontSize: 16, color: MUTED, marginBottom: 28 },
  featureList: { gap: 14, marginBottom: 28 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  featureText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500', flex: 1 },
  planRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: { flex: 1, backgroundColor: CARD, borderRadius: 16, borderWidth: 1.5, borderColor: '#2A2A2A', padding: 16, gap: 6 },
  planCardActive: { borderColor: TEAL },
  planBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planLabel: { fontSize: 14, fontWeight: '600', color: MUTED },
  planPrice: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  planBadge: { backgroundColor: 'rgba(74,222,128,0.15)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { fontSize: 10, fontWeight: '700', color: TEAL },
  paywallActions: { marginTop: 24, gap: 4 },
  trialLimits: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  legal: { fontSize: 11, color: '#444444', textAlign: 'center', marginTop: 4 },
  completionCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  completeTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center', marginBottom: 12 },
  completeSub: { fontSize: 16, color: MUTED, textAlign: 'center', lineHeight: 24 },
})
