import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { COLORS } from '../constants/colors'
import { useAuth } from './AuthContext'

type AIConsentContextType = {
  hasConsent: boolean
  /** Ensures the user has consented before an AI call. Resolves true if consent is granted, false if declined. */
  requestConsent: () => Promise<boolean>
  /** Revoke consent — sets ai_consent_accepted_at back to null. */
  revokeConsent: () => Promise<void>
  /** Timestamp the user accepted (null if not accepted). */
  acceptedAt: string | null
}

const AIConsentContext = createContext<AIConsentContextType>({} as AIConsentContextType)

export function AIConsentProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [hasConsent, setHasConsent] = useState(false)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const pendingResolve = useRef<((v: boolean) => void) | null>(null)
  // Ref mirror so requestConsent (captured in a closure) can read the latest value.
  const hasConsentRef = useRef(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!user) {
      setHasConsent(false)
      hasConsentRef.current = false
      setAcceptedAt(null)
      setLoaded(false)
      loadedRef.current = false
      return
    }
    setLoaded(false)
    loadedRef.current = false
    supabase
      .from('profiles')
      .select('ai_consent_accepted_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const ts = data?.ai_consent_accepted_at ?? null
        setAcceptedAt(ts)
        setHasConsent(!!ts)
        hasConsentRef.current = !!ts
        setLoaded(true)
        loadedRef.current = true
      })
  }, [user?.id])

  const waitForLoad = () =>
    new Promise<void>((resolve) => {
      if (loadedRef.current) { resolve(); return }
      const start = Date.now()
      const poll = setInterval(() => {
        if (loadedRef.current || Date.now() - start > 5000) {
          clearInterval(poll)
          resolve()
        }
      }, 50)
    })

  const requestConsent = async () => {
    // Wait for the initial profile fetch so we don't prompt users who already accepted.
    await waitForLoad()
    if (hasConsentRef.current) return true
    return new Promise<boolean>((resolve) => {
      pendingResolve.current = resolve
      setModalVisible(true)
    })
  }

  const handleAccept = async () => {
    if (!user) { handleCancel(); return }
    setSaving(true)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('profiles')
      .update({ ai_consent_accepted_at: now })
      .eq('id', user.id)
    setSaving(false)
    if (error) { handleCancel(); return }
    setAcceptedAt(now)
    setHasConsent(true)
    hasConsentRef.current = true
    setModalVisible(false)
    pendingResolve.current?.(true)
    pendingResolve.current = null
  }

  const handleCancel = () => {
    setModalVisible(false)
    pendingResolve.current?.(false)
    pendingResolve.current = null
  }

  const revokeConsent = async () => {
    if (!user) return
    await supabase
      .from('profiles')
      .update({ ai_consent_accepted_at: null })
      .eq('id', user.id)
    setAcceptedAt(null)
    setHasConsent(false)
    hasConsentRef.current = false
  }

  return (
    <AIConsentContext.Provider value={{ hasConsent, requestConsent, revokeConsent, acceptedAt }}>
      {children}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={handleCancel}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Before we continue</Text>
            <Text style={styles.body}>
              Pantry uses AI to suggest meals, estimate macros, and scan photos. To do this, your text and images are sent securely to OpenAI, Google, and Groq for processing. They don't use your data for training.
            </Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://heypantry.app/privacy')}>
              <Text style={styles.link}>Privacy Policy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptBtn, saving && { opacity: 0.5 }]}
              onPress={handleAccept}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#000000" />
                : <Text style={styles.acceptBtnText}>Continue</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </AIConsentContext.Provider>
  )
}

export const useAIConsent = () => useContext(AIConsentContext)

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: '#111111',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginBottom: 12,
  },
  link: {
    fontSize: 14,
    color: COLORS.accent,
    fontWeight: '600',
    marginBottom: 24,
  },
  acceptBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  acceptBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
})
