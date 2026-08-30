import { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { identifyUser, resetUser } from '../lib/analytics';
import { touchLastActive } from '../lib/engagement';
import { syncProfileToLoops, fireLoopsEvent } from '../lib/loops';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

const PENDING_OPT_IN_KEY = 'pending_email_marketing_opt_in'

// Apply the marketing opt-in choice stashed by the createaccount screen,
// write it to the profile, and fire the Loops "user_signed_up" event.
// Idempotent — safe to call multiple times; clears the AsyncStorage flag
// after first successful application.
async function applyPendingMarketingOptIn(userId: string, userEmail: string | null) {
  try {
    const stash = await AsyncStorage.getItem(PENDING_OPT_IN_KEY)
    if (stash === null) return // user signed in via existing account, no pending opt-in to apply

    const optIn = stash === '1'
    const consentAt = new Date().toISOString()

    // Apple Hide-My-Email private relays never receive marketing — force-off
    // regardless of what the user clicked. Transactional emails still work.
    const isPrivateRelay = !!userEmail?.toLowerCase().endsWith('@privaterelay.appleid.com')
    const finalOptIn = optIn && !isPrivateRelay

    await supabase
      .from('profiles')
      .update({
        marketing_email_opt_in: finalOptIn,
        marketing_consent_at: consentAt,
      })
      .eq('id', userId)

    await AsyncStorage.removeItem(PENDING_OPT_IN_KEY)

    // Mirror to Loops + fire signup event (transactional — fires regardless of opt-in)
    await syncProfileToLoops(userId)
    await fireLoopsEvent(userId, 'user_signed_up')
  } catch (e) {
    console.log('[auth] applyPendingMarketingOptIn failed (non-fatal):', e)
  }
}

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  appleSignInAvailable: boolean;
  signUp: (email: string, password: string, metadata?: Record<string, string>, captchaToken?: string) => Promise<void>;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);

  useEffect(() => {
    // Apple Sign-In is only available on real iOS devices with iOS 13+; always false in simulators
    AppleAuthentication.isAvailableAsync().then(setAppleSignInAvailable);
  }, []);

  useEffect(() => {
    // webClientId is what Supabase verifies the Google ID token against — must match the
    // OAuth client registered in Supabase Auth → Providers → Google. iosClientId drives the
    // native sign-in sheet (its URL scheme is wired up by the google-signin Expo plugin in app.json).
    GoogleSignin.configure({
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID!,
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
    });
  }, []);

  useEffect(() => {
    // Hydrate session from Supabase's persisted token on app cold-start
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      // Stamp activity on cold start. Fire-and-forget: it swallows its own errors and must never
      // delay the session resolving. Naturally idempotent — the re-engagement event only fires
      // when the STORED timestamp is >3 days old, so a second call in the same session sees the
      // fresh one and stays quiet.
      if (session?.user) touchLastActive(session.user.id);
    });

    // Subscribe to all future auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Sync user identity to PostHog so events are attributed to this user
        identifyUser(session.user.id, { email: session.user.email });
        // Also on sign-in and token refresh — a refresh means the app is open and in use, which is
        // the signal Loops needs to tell an active user from one who should get a win-back email.
        touchLastActive(session.user.id);
        // On the initial sign-in event, apply any pending email marketing opt-in
        // stashed by the createaccount screen and fire the Loops signup event.
        if (event === 'SIGNED_IN') {
          applyPendingMarketingOptIn(session.user.id, session.user.email ?? null);
        }
      } else {
        // Clear PostHog identity on sign-out so subsequent events aren't mis-attributed
        resetUser();
      }
    });

    // Tear down the realtime subscription when AuthProvider unmounts
    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, metadata?: Record<string, string>, captchaToken?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Optional user metadata (e.g. full_name) stored in auth.users.raw_user_meta_data
        ...(metadata ? { data: metadata } : {}),
        // Cloudflare Turnstile token — Supabase validates this server-side before creating the account
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    if (error) throw error;
  };

  const signIn = async (email: string, password: string, captchaToken?: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      // Cloudflare Turnstile token passed only when the sign-in form includes the captcha widget
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) throw error;
  };

  const signInWithApple = async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('No identityToken from Apple');
    // Exchange Apple's signed JWT for a Supabase session
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) throw error;
    // Apple only provides the user's full name on the FIRST sign-in ever; persist it immediately
    if (credential.fullName) {
      const fullName = [credential.fullName.givenName, credential.fullName.familyName]
        .filter(Boolean).join(' ');
      if (fullName) {
        await supabase.auth.updateUser({ data: { full_name: fullName } });
      }
    }
  };

  const signInWithGoogle = async () => {
    // Standard OIDC nonce dance: client generates raw nonce, sends SHA256(rawNonce) in the
    // OAuth request, Google embeds that hashed value as the id_token's `nonce` claim. Supabase
    // re-hashes our rawNonce and compares — match means the token wasn't replayed.
    // Both sides MUST present a nonce (or both must omit one) — GIDSignIn 9.x always emits one
    // on iOS, so we control it here.
    const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    // Native iOS sign-in sheet — no WebView, no Supabase project URL exposed to the user.
    // `nonce` param is forwarded to GIDSignIn.signInWithPresentingViewController:hint:additionalScopes:nonce:
    // via the patch-package patch in patches/@react-native-google-signin+google-signin+*.patch
    // (the upstream lib's TS types don't expose nonce yet, hence the `as any`).
    const response = await GoogleSignin.signIn({ nonce: hashedNonce } as any);
    if (response.type === 'cancelled') {
      // Re-throw with legacy '12501' code so existing user-cancel checks in signin.tsx
      // and createaccount.tsx don't need to be updated.
      throw { code: '12501', message: 'Google sign-in cancelled' };
    }

    const { idToken, user: googleUser } = response.data;
    if (!idToken) throw new Error('No idToken from Google');

    // Exchange Google's signed ID token for a Supabase session — Supabase hashes our rawNonce
    // and matches against the claim baked into the id_token by Google.
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    // Mirror name + avatar from the Google profile into Supabase user metadata
    const fullName = googleUser.name || '';
    const avatarUrl = googleUser.photo || '';
    if (fullName || avatarUrl) {
      await supabase.auth.updateUser({
        data: {
          ...(fullName ? { full_name: fullName } : {}),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        },
      });
    }
  };

  const signOut = async () => {
    // Clear the local flag that gates post-OTP screens before ending the Supabase session.
    // NOTE: the daily meal cache is deliberately NOT wiped here — doing so lost the user's own
    // meals on every sign-out, forcing a regenerate that burned their daily server cap. The cache
    // is now stamped with userId and ownership is checked on read (see useMealSuggestions), so a
    // different account on a shared device regenerates instead of seeing the prior user's meals.
    // Image URLs + recent-name lists are still cleared: they're a shared/global cache and a tiny
    // dedupe list, not the user's meals, so clearing them costs nothing and avoids cross-user bleed.
    // 'onboarding_complete' MUST be cleared too: it's device-scoped, so leaving it set meant the
    // NEXT account created on this device was routed straight to /(tabs) — skipping onboarding and,
    // critically, the paywall. Safe to clear because _layout.tsx falls back to the server profile
    // (onboarding_completed / calorie_goal) and re-sets the flag, so a returning user is never sent
    // back through onboarding over their own data.
    await AsyncStorage.multiRemove([
      'otp_verified',
      'onboarding_complete',
      'pantry_image_urls_v1',
      'pantry_recent_meal_names_cookNow',
      'pantry_recent_meal_names_mealPlan',
    ]);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, appleSignInAvailable, signUp, signIn, signInWithApple, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
