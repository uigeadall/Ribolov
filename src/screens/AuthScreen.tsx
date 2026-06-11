import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, Alert, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Screen } from '../components/Screen';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { handleError } from '../utils/handleError';
import { GoogleSignInSection } from '../components/GoogleSignInButton';
import { AppleSignInSection } from '../components/AppleSignInSection';
import { FacebookSignInSection } from '../components/FacebookSignInButton';
import Toast from 'react-native-toast-message';

/** Dawn-water palette used across the redesigned profile + AddCatch hero.
    Keeps the auth screen visually consistent with the rest of the app. */
function heroGradient(mode: 'dark' | 'light'): [string, string, string] {
  return mode === 'dark'
    ? ['#06121F', '#102C44', '#8C4F1F']
    : ['#0A3A57', '#1F6F92', '#E8902E'];
}

export default function AuthScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signUp, signInWithGoogleIdToken, signInWithApple, signInWithFacebook, resetPassword, configured, loading } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Synchronous lock shared across all auth entry points (email submit +
  // Google + Apple + Facebook + password reset). The `busy` state lags one
  // render so two rapid taps both see `busy=false` and both fire the
  // respective auth call. Without this ref, tapping Google then quickly
  // tapping Apple (during the post-OS-prompt callback window) sends both
  // credentials to Firebase; one wins, the second surfaces as a confusing
  // error toast right after sign-in succeeds.
  const submittingRef = useRef(false);
  // Refs for keyboard "Next" chaining between fields. The TextInputs all
  // already declare `returnKeyType="next"`, but without onSubmitEditing
  // wired to .focus() the Next button was a no-op — pressing it just
  // dismissed the keyboard instead of advancing focus.
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  // Separate from submittingRef so a stuck reset-email path (slow Firebase
  // response) doesn't block the user from trying to sign in. The Alert
  // confirmation button can fire its onPress twice on a hot device — both
  // would call resetPassword and the user sees a success toast followed by
  // a rate-limit error.
  const forgotInFlightRef = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  const gradient = useMemo(() => heroGradient(mode), [mode]);
  const waveColor = mode === 'dark' ? '#0E1628' : colors.background;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // ── Hero ──
        hero: {
          paddingTop: insets.top + spacing.xl,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.xxl + spacing.md,
          alignItems: 'center',
        },
        heroIconRing: {
          width: 92,
          height: 92,
          borderRadius: 46,
          backgroundColor: 'rgba(255,255,255,0.16)',
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.32)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        },
        heroTitle: {
          fontSize: 32,
          fontFamily: 'Manrope_800ExtraBold',
          color: '#fff',
          letterSpacing: -0.5,
        },
        heroSub: {
          ...typography.body,
          color: 'rgba(255,255,255,0.85)',
          textAlign: 'center',
          marginTop: spacing.xs,
          paddingHorizontal: spacing.lg,
          lineHeight: 22,
        },

        // ── Wave panel ──
        wave: {
          flex: 1,
          backgroundColor: waveColor,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          marginTop: -28,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xl,
          paddingBottom: spacing.xl,
        },

        // ── Segmented control ──
        segmented: {
          flexDirection: 'row',
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.pill,
          padding: 4,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: spacing.lg,
        },
        segmentedItem: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 10,
          borderRadius: radius.pill,
        },
        segmentedItemActive: {
          backgroundColor: colors.primary,
        },
        segmentedText: { ...typography.bodyBold, color: colors.textMuted, fontSize: 14 },
        segmentedTextActive: { color: '#fff' },

        // ── Form fields ──
        fieldGroup: { marginBottom: spacing.md },
        fieldLabel: {
          ...typography.small,
          fontWeight: '700',
          color: colors.textMuted,
          letterSpacing: 0.5,
          marginBottom: 6,
          textTransform: 'uppercase',
        },
        fieldWrap: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
        },
        fieldWrapError: { borderColor: colors.danger },
        fieldIcon: { marginRight: spacing.sm },
        input: {
          flex: 1,
          fontSize: 16,
          color: colors.text,
          paddingVertical: Platform.OS === 'ios' ? spacing.sm + 4 : spacing.sm,
        },
        eyeBtn: { padding: 6, marginLeft: 4 },
        fieldError: {
          ...typography.small,
          color: colors.danger,
          marginTop: 4,
          marginLeft: 2,
        },

        // ── Primary submit ──
        primaryBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: radius.pill,
          marginTop: spacing.md,
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.22,
          shadowRadius: 10,
          elevation: 3,
        },
        primaryBtnText: {
          ...typography.bodyBold,
          color: '#fff',
          fontSize: 16,
          letterSpacing: 0.2,
        },
        forgotBtn: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
        forgotText: { ...typography.caption, color: colors.primary, fontWeight: '600' },

        // ── Divider ──
        divider: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginVertical: spacing.lg,
        },
        dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
        dividerText: {
          ...typography.caption,
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontSize: 11,
        },

        // ── Social providers stack ──
        socialStack: { gap: spacing.sm },

        // ── Firebase warning banner ──
        warnBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: 'rgba(232,144,46,0.16)',
          borderRadius: radius.md,
          padding: spacing.md,
          marginBottom: spacing.lg,
        },
        warnText: { ...typography.caption, color: colors.text, flex: 1, fontSize: 12 },
      }),
    [colors, mode, insets.top, waveColor]
  );

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (authMode === 'register' && !name.trim()) {
      next.name = 'Въведи показвано пред другите.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Въведи валиден имейл адрес.';
    }
    if (password.length < 6) {
      next.password = 'Паролата трябва да е поне 6 символа.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!configured) {
      Alert.alert('Firebase', 'Добави ключове в app.json extra или EXPO_PUBLIC_FIREBASE_*.');
      return;
    }
    if (submittingRef.current) return;
    if (!validate()) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const cleanEmail = email.trim();
      const cleanName = name.trim();
      if (authMode === 'login') await signIn(cleanEmail, password);
      else await signUp(cleanEmail, password, cleanName);
      navigation.goBack();
    } catch (e: unknown) {
      handleError(e);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setAuthMode(next);
    setErrors({});
  };

  const onForgot = () => {
    const target = email.trim();
    if (!target) {
      Alert.alert('Забравена парола', 'Въведи имейл адреса си в полето по-горе, след което натисни тук.');
      return;
    }
    // Same regex the submit handler uses — catches malformed addresses
    // before they hit Firebase. Without this, an invalid email reaches
    // sendPasswordResetEmail and throws auth/invalid-email, which then
    // flows through handleError → captureException as a noisy error log.
    // Cleaner UX: surface the validation message inline as an alert
    // instead of treating user typo as an exception.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      Alert.alert('Невалиден имейл', 'Провери имейл адреса и опитай отново.');
      return;
    }
    Alert.alert(
      'Нулиране на парола',
      `Ще изпратим линк за нулиране на ${target}.`,
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Изпрати',
          onPress: async () => {
            if (forgotInFlightRef.current) return;
            forgotInFlightRef.current = true;
            try {
              await resetPassword(target);
              Toast.show({
                type: 'success',
                text1: 'Изпратено',
                text2: 'Провери пощата си за линк за нулиране на паролата.',
                visibilityTime: 3000,
              });
            } catch (e: unknown) {
              handleError(e);
            } finally {
              forgotInFlightRef.current = false;
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* ScrollView with keyboardShouldPersistTaps="handled" gives two
            wins at once: (1) tapping the background dismisses the keyboard,
            (2) when the keyboard covers the bottom buttons (Apple/Google
            sign-in, forgot password) the user can scroll to reach them.
            Without this, the form was bigger than the visible area on
            iPhone SE / older phones and the lower half was unreachable
            with the keyboard up. `keyboardShouldPersistTaps="handled"`
            keeps button taps working — only taps on non-interactive
            background dismiss the keyboard. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
        <View style={{ flex: 1 }}>
          {/* Outdoorsy hero — matches the dawn-water gradient used across the
              redesigned profile / AddCatch screens. */}
          <LinearGradient
            colors={gradient}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroIconRing}>
              <Ionicons name="fish" size={42} color="#fff" />
            </View>
            <Text style={styles.heroTitle}>Риболов</Text>
            <Text style={styles.heroSub}>
              {authMode === 'login'
                ? 'Влез и продължи дневника си.'
                : 'Започни дневника, ленти, рекорди и турнири.'}
            </Text>
          </LinearGradient>

          {/* Wave panel containing the form */}
          <View style={styles.wave}>
            {!configured ? (
              <View style={styles.warnBanner}>
                <Ionicons name="warning-outline" size={18} color="#E8902E" />
                <Text style={styles.warnText}>
                  Firebase не е конфигуриран. Добави ключове в app.json или EXPO_PUBLIC_FIREBASE_*.
                </Text>
              </View>
            ) : null}

            {/* Segmented control — cleaner than two side-by-side buttons.
                Disabled while a submit is in flight so the form layout
                can't flip out from under an in-progress sign-in. */}
            <View style={styles.segmented}>
              <Pressable
                style={[styles.segmentedItem, authMode === 'login' && styles.segmentedItemActive, busy && { opacity: 0.6 }]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  switchMode('login');
                }}
                disabled={busy}
              >
                <Text style={[styles.segmentedText, authMode === 'login' && styles.segmentedTextActive]}>
                  Вход
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segmentedItem, authMode === 'register' && styles.segmentedItemActive, busy && { opacity: 0.6 }]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  switchMode('register');
                }}
                disabled={busy}
              >
                <Text style={[styles.segmentedText, authMode === 'register' && styles.segmentedTextActive]}>
                  Регистрация
                </Text>
              </Pressable>
            </View>

            {/* Form */}
            {authMode === 'register' ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Име</Text>
                <View style={[styles.fieldWrap, errors.name && styles.fieldWrapError]}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} style={styles.fieldIcon} />
                  <TextInput
                    placeholder="Показвано пред другите"
                    placeholderTextColor={colors.textMuted}
                    value={name}
                    onChangeText={(v) => { setName(v); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
                    style={styles.input}
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                </View>
                {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Имейл</Text>
              <View style={[styles.fieldWrap, errors.email && styles.fieldWrapError]}>
                <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.fieldIcon} />
                <TextInput
                  ref={emailRef}
                  placeholder="твоят@имейл.bg"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={(v) => { setEmail(v); if (errors.email) setErrors((p) => ({ ...p, email: undefined })); }}
                  style={styles.input}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
              {errors.email ? <Text style={styles.fieldError}>{errors.email}</Text> : null}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Парола</Text>
              <View style={[styles.fieldWrap, errors.password && styles.fieldWrapError]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.fieldIcon} />
                <TextInput
                  ref={passwordRef}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  // Off, off, off — passwords are case-sensitive and Android
                  // can auto-capitalize after punctuation, producing a
                  // password the user didn't intend (and won't see when the
                  // field is masked). Mirror the email field's autofill
                  // hygiene.
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  value={password}
                  onChangeText={(v) => { setPassword(v); if (errors.password) setErrors((p) => ({ ...p, password: undefined })); }}
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Скрий паролата' : 'Покажи паролата'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
              {errors.password ? <Text style={styles.fieldError}>{errors.password}</Text> : null}
            </View>

            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                submit();
              }}
              disabled={busy}
              style={({ pressed }) => [styles.primaryBtn, (pressed || busy) && { opacity: 0.85 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name={authMode === 'login' ? 'log-in-outline' : 'person-add-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text style={styles.primaryBtnText}>
                    {authMode === 'login' ? 'Влез' : 'Създай акаунт'}
                  </Text>
                </>
              )}
            </Pressable>

            {authMode === 'login' ? (
              <Pressable onPress={onForgot} style={styles.forgotBtn} hitSlop={8}>
                <Text style={styles.forgotText}>Забравена парола?</Text>
              </Pressable>
            ) : null}

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>или продължи с</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Provider buttons — keep their own internal styling, just stack them */}
            <View style={styles.socialStack}>
              <GoogleSignInSection
                disabled={busy || !configured}
                onIdToken={async (idToken) => {
                  if (submittingRef.current) return;
                  submittingRef.current = true;
                  setBusy(true);
                  try {
                    await signInWithGoogleIdToken(idToken);
                    navigation.goBack();
                  } catch (e: unknown) {
                    handleError(e);
                  } finally {
                    submittingRef.current = false;
                    setBusy(false);
                  }
                }}
              />

              <AppleSignInSection
                disabled={busy || !configured}
                onAppleTokens={async (idToken, rawNonce) => {
                  if (submittingRef.current) return;
                  submittingRef.current = true;
                  setBusy(true);
                  try {
                    await signInWithApple(idToken, rawNonce);
                    navigation.goBack();
                  } catch (e: unknown) {
                    handleError(e);
                  } finally {
                    submittingRef.current = false;
                    setBusy(false);
                  }
                }}
              />

              <FacebookSignInSection
                disabled={busy || !configured}
                onAccessToken={async (accessToken) => {
                  if (submittingRef.current) return;
                  submittingRef.current = true;
                  setBusy(true);
                  try {
                    await signInWithFacebook(accessToken);
                    navigation.goBack();
                  } catch (e: unknown) {
                    handleError(e);
                  } finally {
                    submittingRef.current = false;
                    setBusy(false);
                  }
                }}
              />
            </View>
          </View>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
