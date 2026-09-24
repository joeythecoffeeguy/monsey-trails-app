import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import { type Href, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

export type PassengerAuthMode = 'sign-in' | 'sign-up';

type Props = {
  mode: PassengerAuthMode;
};

type SignInVerification = 'email_code' | 'phone_code' | 'totp' | 'backup_code';

function userFacingError(error: unknown): string {
  if (error && typeof error === 'object') {
    const clerkErrors = 'errors' in error ? error.errors : undefined;
    if (Array.isArray(clerkErrors)) {
      const first = clerkErrors[0] as { longMessage?: unknown; message?: unknown } | undefined;
      const message = first?.longMessage ?? first?.message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
    if ('message' in error && typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }
  }
  return 'We couldn’t complete that request. Check your details and try again.';
}

export function PassengerAuthScreen({ mode }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, fetchStatus: signUpFetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [signUpCodeStep, setSignUpCodeStep] = useState(false);
  const [signInVerification, setSignInVerification] = useState<SignInVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  const fetching = busy || signInFetchStatus === 'fetching' || signUpFetchStatus === 'fetching';
  const isSignUp = mode === 'sign-up';

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const redirectUrl = useMemo(() => {
    if (Platform.OS === 'web') return AuthSession.makeRedirectUri();
    const configuredScheme = Constants.expoConfig?.scheme;
    const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
    return AuthSession.makeRedirectUri({
      scheme: scheme || 'monsey-trails-passenger',
      path: 'sso-callback',
    });
  }, []);

  const finishSession = async (finalize: (options: {
    navigate: (params: { session?: { currentTask?: unknown } | null; decorateUrl: (url: string) => string }) => void;
  }) => Promise<unknown>) => {
    await finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          setNotice('Your account needs one more security step before it can open. Start sign-in again, or contact Monsey Trails support if this continues.');
          return;
        }
        router.replace(decorateUrl('/') as Href);
      },
    });
  };

  const handleGoogle = async () => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { createdSessionId, setActive, signIn: ssoSignIn, signUp: ssoSignUp } =
        await startSSOFlow({ strategy: 'oauth_google', redirectUrl });

      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) {
              setNotice('Google connected, but your account needs one more security step. Try email sign-in or contact Monsey Trails support.');
              return;
            }
            router.replace(decorateUrl('/') as Href);
          },
        });
        return;
      }

      const status = ssoSignIn?.status ?? ssoSignUp?.status;
      if (status === 'needs_second_factor' || status === 'needs_client_trust' || status === 'missing_requirements') {
        setErrorMessage('Google sign-in needs an additional account step that cannot be completed here. Try signing in with email, or contact Monsey Trails support.');
      } else {
        setErrorMessage('Google sign-in did not finish. Try again, use email and password, or contact Monsey Trails support.');
      }
    } catch {
      setErrorMessage('Google sign-in is unavailable or could not be completed. Use email and password, or contact Monsey Trails support.');
    } finally {
      setBusy(false);
    }
  };

  const finalizeSignUpIfComplete = async () => {
    if (signUp.status !== 'complete') {
      setErrorMessage('Your email is verified, but account setup is not complete. Start sign-up again or contact support for help.');
      return;
    }
    await finishSession(signUp.finalize);
  };

  const handleSignUp = async () => {
    if (!emailAddress.trim() || !password) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { error } = await signUp.password({
        emailAddress: emailAddress.trim(),
        password,
      });
      if (error) {
        setErrorMessage(userFacingError(error));
        return;
      }
      const sendResult = await signUp.verifications.sendEmailCode();
      if (sendResult.error) {
        setErrorMessage(userFacingError(sendResult.error));
        return;
      }
      setSignUpCodeStep(true);
      setNotice(`We sent a verification code to ${emailAddress.trim()}.`);
    } catch (error) {
      setErrorMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpVerify = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (error) {
        setErrorMessage(userFacingError(error));
        return;
      }
      await finalizeSignUpIfComplete();
    } catch (error) {
      setErrorMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  };

  const startSignInVerification = async (status: string) => {
    const factors = signIn.supportedSecondFactors ?? [];
    const available: SignInVerification[] = factors
      .map((factor) => factor.strategy)
      .filter((strategy): strategy is SignInVerification =>
        strategy === 'email_code' ||
        strategy === 'phone_code' ||
        strategy === 'totp' ||
        strategy === 'backup_code',
      );

    if (status === 'needs_client_trust') {
      if (!available.includes('email_code')) {
        setErrorMessage('This sign-in needs a trusted-device verification method that is not available. Start over and try again, or contact support.');
        return;
      }
      const { error } = await signIn.mfa.sendEmailCode();
      if (error) {
        setErrorMessage(userFacingError(error));
        return;
      }
      setSignInVerification('email_code');
      setNotice('We sent a security code to your email.');
      return;
    }

    const method = available[0];
    if (!method) {
      setErrorMessage('Your account requires an additional verification method that this screen cannot complete. Start over or contact Monsey Trails support.');
      return;
    }
    if (method === 'email_code') {
      const { error } = await signIn.mfa.sendEmailCode();
      if (error) {
        setErrorMessage(userFacingError(error));
        return;
      }
      setNotice('We sent a verification code to your email.');
    } else if (method === 'phone_code') {
      const { error } = await signIn.mfa.sendPhoneCode();
      if (error) {
        setErrorMessage(userFacingError(error));
        return;
      }
      setNotice('We sent a verification code to your phone.');
    }
    setSignInVerification(method);
  };

  const handleSignIn = async () => {
    if (!emailAddress.trim() || !password) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { error } = await signIn.password({
        emailAddress: emailAddress.trim(),
        password,
      });
      if (error) {
        setErrorMessage(userFacingError(error));
        return;
      }
      if (signIn.status === 'complete') {
        await finishSession(signIn.finalize);
      } else if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
        await startSignInVerification(signIn.status);
      } else {
        setErrorMessage('Sign-in needs another step that could not be identified. Start over or contact Monsey Trails support.');
      }
    } catch (error) {
      setErrorMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSignInVerify = async () => {
    if (!code.trim() || !signInVerification) return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      let result: { error: unknown };
      if (signInVerification === 'email_code') {
        result = await signIn.mfa.verifyEmailCode({ code: code.trim() });
      } else if (signInVerification === 'phone_code') {
        result = await signIn.mfa.verifyPhoneCode({ code: code.trim() });
      } else if (signInVerification === 'totp') {
        result = await signIn.mfa.verifyTOTP({ code: code.trim() });
      } else {
        result = await signIn.mfa.verifyBackupCode({ code: code.trim() });
      }
      if (result.error) {
        setErrorMessage(userFacingError(result.error));
        return;
      }
      if (signIn.status === 'complete') {
        await finishSession(signIn.finalize);
      } else {
        setErrorMessage('That code was accepted, but sign-in still needs another security step. Start over or contact support.');
      }
    } catch (error) {
      setErrorMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      if (isSignUp) {
        const { error } = await signUp.verifications.sendEmailCode();
        if (error) setErrorMessage(userFacingError(error));
        else setNotice('A new verification code is on its way.');
      } else if (signInVerification === 'email_code') {
        const { error } = await signIn.mfa.sendEmailCode();
        if (error) setErrorMessage(userFacingError(error));
        else setNotice('A new security code is on its way.');
      } else if (signInVerification === 'phone_code') {
        const { error } = await signIn.mfa.sendPhoneCode();
        if (error) setErrorMessage(userFacingError(error));
        else setNotice('A new security code is on its way.');
      }
    } catch (error) {
      setErrorMessage(userFacingError(error));
    } finally {
      setBusy(false);
    }
  };

  const restartSignIn = () => {
    signIn.reset();
    setSignInVerification(null);
    setCode('');
    setErrorMessage('');
    setNotice('');
  };

  const codeStep = isSignUp ? signUpCodeStep : signInVerification !== null;
  const title = codeStep ? 'Check your inbox' : isSignUp ? 'Create your account' : 'Welcome back';
  const subtitle = codeStep
    ? 'Enter the one-time code to keep your account secure.'
    : isSignUp
      ? 'Save your journeys and keep them with you across devices.'
      : 'Sign in to see your saved journeys on any device.';

  const webInsets = Platform.OS === 'web' ? { top: 67, bottom: 34 } : { top: 0, bottom: 0 };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, webInsets.top) + 20,
            paddingBottom: Math.max(insets.bottom, webInsets.bottom) + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.brandRow}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
              <Ionicons name="bus" size={23} color={colors.primaryForeground} />
            </View>
            <AppText style={[styles.brandName, { color: colors.foreground }]}>MONSEY TRAILS</AppText>
          </View>

          <View style={styles.heading}>
            <AppText accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
              {title}
            </AppText>
            <AppText style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</AppText>
          </View>

          {!codeStep ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
                testID="google-auth-button"
                disabled={fetching}
                onPress={handleGoogle}
                style={({ pressed }) => [
                  styles.googleButton,
                  { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
                  pressed && styles.pressed,
                  fetching && styles.disabled,
                ]}
              >
                {fetching ? (
                  <ActivityIndicator color={colors.foreground} />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={19} color={colors.foreground} />
                    <AppText style={[styles.googleButtonText, { color: colors.foreground }]}>
                      Continue with Google
                    </AppText>
                  </>
                )}
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <AppText style={[styles.dividerText, { color: colors.mutedForeground }]}>OR USE EMAIL</AppText>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              </View>

              <View style={styles.form}>
                <AppText style={[styles.label, { color: colors.foreground }]}>Email address</AppText>
                <TextInput
                  accessibilityLabel="Email address"
                  testID="auth-email-input"
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.input,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      color: colors.foreground,
                    },
                  ]}
                  value={emailAddress}
                  onChangeText={setEmailAddress}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  returnKeyType="next"
                />
                <AppText style={[styles.label, { color: colors.foreground }]}>Password</AppText>
                <TextInput
                  accessibilityLabel="Password"
                  testID="auth-password-input"
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.input,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      color: colors.foreground,
                    },
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={isSignUp ? 'Create a password' : 'Enter your password'}
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType={isSignUp ? 'newPassword' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  returnKeyType="go"
                  onSubmitEditing={isSignUp ? handleSignUp : handleSignIn}
                />
                <Pressable
                  accessibilityRole="button"
                  testID="auth-submit-button"
                  disabled={!emailAddress.trim() || !password || fetching}
                  onPress={isSignUp ? handleSignUp : handleSignIn}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: colors.primary, borderRadius: colors.radius },
                    pressed && styles.pressed,
                    (!emailAddress.trim() || !password || fetching) && styles.disabled,
                  ]}
                >
                  {fetching ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <AppText style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                      {isSignUp ? 'Create account' : 'Sign in'}
                    </AppText>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.form}>
              <AppText style={[styles.label, { color: colors.foreground }]}>
                {signInVerification === 'totp'
                  ? 'Authenticator code'
                  : signInVerification === 'backup_code'
                    ? 'Backup code'
                    : 'Verification code'}
              </AppText>
              <TextInput
                accessibilityLabel="Verification code"
                testID="auth-code-input"
                style={[
                  styles.input,
                  styles.codeInput,
                  {
                    backgroundColor: colors.input,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    color: colors.foreground,
                  },
                ]}
                value={code}
                onChangeText={setCode}
                placeholder="Enter your code"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={signInVerification === 'backup_code' ? 'default' : 'number-pad'}
                textContentType="oneTimeCode"
                returnKeyType="go"
                onSubmitEditing={isSignUp ? handleSignUpVerify : handleSignInVerify}
              />
              <Pressable
                accessibilityRole="button"
                testID="auth-verify-button"
                disabled={!code.trim() || fetching}
                onPress={isSignUp ? handleSignUpVerify : handleSignInVerify}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary, borderRadius: colors.radius },
                  pressed && styles.pressed,
                  (!code.trim() || fetching) && styles.disabled,
                ]}
              >
                {fetching ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <AppText style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                    Verify and continue
                  </AppText>
                )}
              </Pressable>
              {(isSignUp || signInVerification === 'email_code' || signInVerification === 'phone_code') && (
                <Pressable
                  accessibilityRole="button"
                  disabled={fetching}
                  onPress={resendCode}
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                >
                  <AppText style={[styles.textButtonText, { color: colors.secondary }]}>Send a new code</AppText>
                </Pressable>
              )}
              {!isSignUp && (
                <Pressable
                  accessibilityRole="button"
                  disabled={fetching}
                  onPress={restartSignIn}
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                >
                  <AppText style={[styles.textButtonText, { color: colors.mutedForeground }]}>Start over</AppText>
                </Pressable>
              )}
            </View>
          )}

          {!!errorMessage && (
            <View accessibilityRole="alert" style={[styles.messageBox, { backgroundColor: `${colors.destructive}12` }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
              <AppText style={[styles.messageText, { color: colors.destructive }]}>{errorMessage}</AppText>
            </View>
          )}
          {!!notice && (
            <View accessibilityRole="text" style={[styles.messageBox, { backgroundColor: colors.accent }]}>
              <Ionicons name="mail-outline" size={18} color={colors.accentForeground} />
              <AppText style={[styles.messageText, { color: colors.accentForeground }]}>{notice}</AppText>
            </View>
          )}

          {!codeStep && (
            <View style={styles.modeSwitch}>
              <AppText style={[styles.modeText, { color: colors.mutedForeground }]}>
                {isSignUp ? 'Already have an account? ' : 'New to Monsey Trails? '}
              </AppText>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.replace((isSignUp ? '/sign-in' : '/sign-up') as Href)}
                hitSlop={8}
              >
                <AppText style={[styles.modeLink, { color: colors.secondary }]}>
                  {isSignUp ? 'Sign in' : 'Create account'}
                </AppText>
              </Pressable>
            </View>
          )}

          <View style={[styles.benefitCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.benefitIcon, { backgroundColor: colors.primary }]}>
              <Ionicons name="bookmark-outline" size={18} color={colors.primaryForeground} />
            </View>
            <View style={styles.benefitCopy}>
              <AppText style={[styles.benefitTitle, { color: colors.foreground }]}>Browse as a guest</AppText>
              <AppText style={[styles.benefitBody, { color: colors.mutedForeground }]}>
                Schedules are available without an account. Sign in to save journeys across your devices. Ticket purchases and refills aren’t available yet.
              </AppText>
            </View>
          </View>

          <View nativeID="clerk-captcha" />
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 34 },
  brandMark: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  heading: { marginBottom: 26 },
  title: { fontSize: 29, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  googleButton: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  googleButtonText: { fontSize: 15, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 13, marginVertical: 23 },
  divider: { height: 1, flex: 1 },
  dividerText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  form: { gap: 10 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: -3 },
  input: { minHeight: 52, borderWidth: 1, paddingHorizontal: 15, fontSize: 15 },
  codeInput: { letterSpacing: 3, fontSize: 18 },
  primaryButton: {
    minHeight: 54,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
  textButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  textButtonText: { fontSize: 14, fontWeight: '600' },
  messageBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, borderRadius: 12, marginTop: 14 },
  messageText: { flex: 1, fontSize: 13, lineHeight: 19 },
  modeSwitch: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 21 },
  modeText: { fontSize: 13 },
  modeLink: { fontSize: 13, fontWeight: '700' },
  benefitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    padding: 15,
    borderRadius: 16,
    marginTop: 28,
  },
  benefitIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  benefitCopy: { flex: 1, gap: 4 },
  benefitTitle: { fontSize: 13, fontWeight: '700' },
  benefitBody: { fontSize: 12, lineHeight: 18 },
});