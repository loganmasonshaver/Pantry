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
import { Check, TrendingDown, Dumbbell, Scale, Zap, ChefHat, Flame, Sparkles, Target, UtensilsCrossed, Clock } from 'lucide-react-native'
import { ActivityIndicator } from 'react-native'
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
  2: 12, 3: 22, 4: 33, 5: 44, 6: 55, 7: 66, 8: 82, 9: 92,
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
  const proteinPerLb = fitnessGoal === 'lose' ? 1.2 : fitnessGoal === 'maintain' ? 1.0 : 0.8
  const protein = Math.round(weightLbs * proteinPerLb)
  return { calories, protein }
}

function S3Numbers({
  calories, protein, onCalories, onProtein, onNext, onBack,
  age, gender, activityLevel, fitnessGoal, ft, inches, weight,
  onAge, onGender, onActivityLevel, onFitnessGoal, goal,
}: {
  calories: string; protein: string; onCalories: (v: string) => void; onProtein: (v: string) => void
  onNext: () => void; onBack: () => void
  age: string; gender: string; activityLevel: string; fitnessGoal: string
  ft: string; inches: string; weight: string
  onAge: (v: string) => void; onGender: (v: string) => void
  onActivityLevel: (v: string) => void; onFitnessGoal: (v: string) => void
  goal: string
}) {
  // Auto-map step 2 goal to fitness goal
  useEffect(() => {
    if (!fitnessGoal && goal) {
      const map: Record<string, string> = { lose: 'lose', build: 'gain', maintain: 'maintain' }
      if (map[goal]) onFitnessGoal(map[goal])
    }
  }, [goal])
  const [showCalc, setShowCalc] = useState(false)
  const [calcResult, setCalcResult] = useState<{ calories: number; protein: number } | null>(null)


  const canCalculate = age && gender && activityLevel && fitnessGoal && ft && weight

  const handleCalculate = () => {
    const heightCm = (parseInt(ft || '0') * 12 + parseInt(inches || '0')) * 2.54
    const weightKg = parseFloat(weight || '0') * 0.453592
    const parsedAge = parseInt(age) || 25
    if (!heightCm || !weightKg) {
      Alert.alert('Missing info', 'Please go back and enter your height and weight first.')
      return
    }
    const result = calculateGoals(parsedAge, gender || 'male', heightCm, weightKg, activityLevel || 'moderate', fitnessGoal || 'maintain')
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
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#FFFFFF', paddingVertical: 4 }}>{calcResult.calories.toLocaleString('en-US')} kcal</Text>
          </View>
          <View style={[s.inputCard, { width: '100%', marginBottom: 16 }]}>
            <Text style={s.inputLabel}>Daily Protein</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: TEAL, paddingVertical: 4 }}>{String(calcResult.protein)}g</Text>
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

function SPreview({ data, onNext, onBack }: { data: OnboardingData; onNext: () => void; onBack: () => void }) {
  const [loading, setLoading] = useState(true)
  const fadeIn = useRef(new Animated.Value(0)).current

  const cals = parseInt(data.calories) || 2400
  const prot = parseInt(data.protein) || 150
  const mealsPerDay = parseInt(data.meals) || 3
  const prepMin = data.prep === '5 min' ? 5 : data.prep === '15 min' ? 15 : 30
  const goalLabel = data.goal === 'lose' ? 'Lose Weight' : data.goal === 'gain' ? 'Build Muscle' : 'Maintain'

  // Simulate plan generation
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false)
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start()
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  const calPerMeal = Math.round(cals / mealsPerDay)
  const protPerMeal = Math.round(prot / mealsPerDay)

  return (
    <SafeAreaView style={s.safe}>
      <ProgressBar pct={82} />
      <ScrollView contentContainerStyle={s.scrollBody} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={{ alignItems: 'center', paddingTop: 80, gap: 20 }}>
            <ActivityIndicator color={TEAL} size="large" />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>Building your plan...</Text>
            <Text style={{ fontSize: 14, color: MUTED, textAlign: 'center' }}>Personalizing meals based on your goals and preferences</Text>
          </View>
        ) : (
          <Animated.View style={{ opacity: fadeIn, gap: 24 }}>
            <View>
              <Text style={{ fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 }}>Your plan is ready</Text>
              <Text style={{ fontSize: 15, color: MUTED, marginTop: 6 }}>Here's what we've built for you</Text>
            </View>

            {/* Goal card */}
            <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 18, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Target size={20} stroke={TEAL} strokeWidth={2} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Your Goal: {goalLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF' }}>{cals}</Text>
                  <Text style={{ fontSize: 12, color: MUTED }}>Daily Calories</Text>
                </View>
                <View style={{ width: 1, backgroundColor: '#2A2A2A' }} />
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: TEAL }}>{prot}g</Text>
                  <Text style={{ fontSize: 12, color: MUTED }}>Daily Protein</Text>
                </View>
              </View>
            </View>

            {/* Daily schedule */}
            <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 18, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <UtensilsCrossed size={20} stroke={TEAL} strokeWidth={2} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Your Daily Schedule</Text>
              </View>
              {Array.from({ length: mealsPerDay }, (_, i) => {
                const labels = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Snack 2', 'Snack 3']
                return (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>{labels[i] ?? `Meal ${i + 1}`}</Text>
                    <Text style={{ fontSize: 13, color: MUTED }}>~{calPerMeal} cal · {protPerMeal}g protein</Text>
                  </View>
                )
              })}
            </View>

            {/* What you get */}
            <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 18, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Sparkles size={20} stroke={TEAL} strokeWidth={2} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>What Pantry Does For You</Text>
              </View>
              {[
                'AI generates meals that hit your macros',
                'Scan your kitchen to update ingredients',
                'Log meals with a photo — AI estimates calories',
                `Recipes under ${prepMin} min prep time`,
                'Auto-build grocery lists from meals',
              ].map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Check size={16} stroke={TEAL} strokeWidth={2.5} />
                  <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{item}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        )}
      </ScrollView>
      {!loading && (
        <View style={s.bottomActions}>
          <CommitButton onComplete={onNext} />
          <TouchableOpacity style={s.textLink} onPress={onBack} activeOpacity={0.7}><Text style={s.textLinkText}>Back</Text></TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

function CommitButton({ onComplete }: { onComplete: () => void }) {
  const progress = useRef(new Animated.Value(0)).current
  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)
  const animRef = useRef<Animated.CompositeAnimation | null>(null)

  const startHold = () => {
    setHolding(true)
    animRef.current = Animated.timing(progress, { toValue: 1, duration: 2500, useNativeDriver: false })
    animRef.current.start(({ finished }) => {
      if (finished) {
        setDone(true)
        setTimeout(onComplete, 300)
      }
    })
  }

  const stopHold = () => {
    if (done) return
    animRef.current?.stop()
    setHolding(false)
    Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: false }).start()
  }

  const widthInterp = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={startHold}
      onPressOut={stopHold}
      style={{
        backgroundColor: '#1A1A1A',
        borderRadius: 30,
        paddingVertical: 18,
        alignItems: 'center',
        overflow: 'hidden',
        borderWidth: 1.5,
        borderColor: done ? TEAL : holding ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.15)',
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: widthInterp,
          backgroundColor: 'rgba(74,222,128,0.15)',
          borderRadius: 30,
        }}
      />
      <Text style={{ fontSize: 16, fontWeight: '700', color: done ? TEAL : '#FFFFFF' }}>
        {done ? "Let's go!" : holding ? 'Hold to commit...' : 'Hold to start your journey'}
      </Text>
    </TouchableOpacity>
  )
}

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
      <ProgressBar pct={PROGRESS[9]} />
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
          food_prefs_banner_dismissed: true,
          food_intro_popup_dismissed: true,
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
          goal={data.goal}
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
    8: <SPreview data={data} onNext={next} onBack={back} />,
    9: <S7Paywall onNext={finish} onBack={back} />,
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
