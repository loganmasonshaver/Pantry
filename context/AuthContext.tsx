import { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { identifyUser, resetUser } from '../lib/analytics';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

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
    // Hydrate session from Supabase's persisted token on app cold-start
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Subscribe to all future auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Sync user identity to PostHog so events are attributed to this user
        identifyUser(session.user.id, { email: session.user.email });
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
    // Deep-link scheme registered in app.json — Supabase redirects back here after Google consent
    const redirectUrl = 'pantry://callback';
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        // Don't let the Supabase client follow the redirect itself; we open it in a controlled browser session below
        skipBrowserRedirect: true,
        // Force the Google account picker even if a session is already cached in the system browser
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error || !data.url) throw error || new Error('No OAuth URL');
    // Opens Google consent in an in-app browser tab that auto-closes on redirect back to pantry://
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
    // Code '12501' mirrors Android's GoogleSignIn cancellation code; callers can detect user-cancel vs real error
    if (result.type !== 'success') throw { code: '12501', message: 'Google sign-in cancelled' };
    // Supabase returns tokens in the URL hash fragment (not query params) to avoid server logs
    const url = new URL(result.url);
    const params = new URLSearchParams(url.hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) throw new Error('Missing tokens from OAuth');
    // Manually hydrate the Supabase session since we bypassed its default redirect handler
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;

    // Save full_name + avatar_url from Google profile to user metadata
    const meta = sessionData.user?.user_metadata;
    if (meta) {
      const fullName = meta.full_name || meta.name || '';
      const avatarUrl = meta.avatar_url || meta.picture || '';
      if (fullName || avatarUrl) {
        await supabase.auth.updateUser({
          data: {
            ...(fullName ? { full_name: fullName } : {}),
            ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
          },
        });
      }
    }
  };

  const signOut = async () => {
    // Clear the local flag that gates post-OTP screens before ending the Supabase session
    await AsyncStorage.removeItem('otp_verified');
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
