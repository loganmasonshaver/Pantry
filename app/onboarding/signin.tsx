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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native'

const TEAL = '#4ADE80'
const MUTED = '#888888'
const CARD = '#1A1A1A'

export default function SignInScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  return (
    <SafeAreaView style={s.safe}>
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
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.bottom}>
        <TouchableOpacity style={s.pill} activeOpacity={0.85}>
          <Text style={s.pillText}>Sign In</Text>
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
