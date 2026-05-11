import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { handleError } from '../utils/handleError';
import { GoogleSignInSection } from '../components/GoogleSignInButton';
import { AppleSignInSection } from '../components/AppleSignInSection';
import { FacebookSignInSection } from '../components/FacebookSignInButton';

export default function AuthScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { signIn, signUp, signInWithGoogleIdToken, signInWithApple, signInWithFacebook, resetPassword, configured, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  const styles = useMemo(
    () =>
      StyleSheet.create({
        brandWrap: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.xl },
        brandIconWrap: {
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        },
        brandTitle: { ...typography.h2, color: colors.text, textAlign: 'center' },
        brandSub: {
          ...typography.body,
          color: colors.textMuted,
          textAlign: 'center',
          marginTop: spacing.xs,
          lineHeight: 22,
        },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
          fontSize: 16,
          color: colors.text,
          backgroundColor: colors.surfaceAlt,
          marginBottom: spacing.xs,
        },
        inputError: {
          borderColor: colors.danger,
        },
        fieldError: {
          ...typography.small,
          color: colors.danger,
          marginBottom: spacing.sm,
          marginTop: 2,
        },
        fieldLabel: {
          ...typography.small,
          fontWeight: '700',
          color: colors.textMuted,
          letterSpacing: 0.4,
          marginBottom: spacing.xs,
          marginTop: spacing.sm,
        },
        row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
        divider: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginVertical: spacing.lg,
        },
        dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
        dividerText: { ...typography.caption, color: colors.textMuted },
      }),
    [colors]
  );

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (mode === 'register' && !name.trim()) {
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
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email, password);
      else await signUp(email, password, name);
      navigation.goBack();
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setErrors({});
  };

  if (loading) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Зареждане…</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll avoidKeyboard>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.brandWrap}>
          <View style={styles.brandIconWrap}>
            <Ionicons name="fish" size={36} color={colors.white} />
          </View>
          <Text style={styles.brandTitle}>Риболов</Text>
          <Text style={styles.brandSub}>Следи уловите, разгледай общността</Text>
        </View>

        <View style={styles.row}>
          <Button
            title="Вход"
            variant={mode === 'login' ? 'primary' : 'secondary'}
            onPress={() => switchMode('login')}
            style={{ flex: 1 }}
          />
          <Button
            title="Регистрация"
            variant={mode === 'register' ? 'primary' : 'secondary'}
            onPress={() => switchMode('register')}
            style={{ flex: 1 }}
          />
        </View>

        <Card>
          {mode === 'register' ? (
            <>
              <Text style={styles.fieldLabel}>ИМЕ</Text>
              <TextInput
                placeholder="Показвано пред другите"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={(v) => { setName(v); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
                style={[styles.input, errors.name && styles.inputError]}
              />
              {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}
            </>
          ) : null}
          <Text style={styles.fieldLabel}>ИМЕЙЛ</Text>
          <TextInput
            placeholder="твоят@имейл.bg"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={(v) => { setEmail(v); if (errors.email) setErrors((p) => ({ ...p, email: undefined })); }}
            style={[styles.input, errors.email && styles.inputError]}
          />
          {errors.email ? <Text style={styles.fieldError}>{errors.email}</Text> : null}
          <Text style={styles.fieldLabel}>ПАРОЛА</Text>
          <TextInput
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={(v) => { setPassword(v); if (errors.password) setErrors((p) => ({ ...p, password: undefined })); }}
            style={[styles.input, errors.password && styles.inputError]}
          />
          {errors.password ? <Text style={styles.fieldError}>{errors.password}</Text> : null}
          <Button
            title={mode === 'login' ? 'Влез' : 'Създай акаунт'}
            onPress={submit}
            loading={busy}
            style={{ marginTop: spacing.sm }}
          />
          {mode === 'login' ? (
            <Pressable
              onPress={() => {
                const target = email.trim();
                if (!target) {
                  Alert.alert('Забравена парола', 'Въведи имейл адреса си в полето по-горе, след което натисни тук.');
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
                        try {
                          await resetPassword(target);
                          Alert.alert('Изпратено', 'Провери пощата си за линк за нулиране на паролата.');
                        } catch (e: unknown) {
                          handleError(e);
                        }
                      },
                    },
                  ]
                );
              }}
              style={{ alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs }}
              hitSlop={8}
            >
              <Text style={{ ...typography.caption, color: colors.primary }}>Забравена парола?</Text>
            </Pressable>
          ) : null}
        </Card>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>или</Text>
          <View style={styles.dividerLine} />
        </View>

        <GoogleSignInSection
          disabled={busy || !configured}
          onIdToken={async (idToken) => {
            setBusy(true);
            try {
              await signInWithGoogleIdToken(idToken);
              navigation.goBack();
            } catch (e: unknown) {
              handleError(e);
            } finally {
              setBusy(false);
            }
          }}
        />

        <AppleSignInSection
          disabled={busy || !configured}
          onAppleTokens={async (idToken, rawNonce) => {
            setBusy(true);
            try {
              await signInWithApple(idToken, rawNonce);
              navigation.goBack();
            } catch (e: unknown) {
              handleError(e);
            } finally {
              setBusy(false);
            }
          }}
        />

        <FacebookSignInSection
          disabled={busy || !configured}
          onAccessToken={async (accessToken) => {
            setBusy(true);
            try {
              await signInWithFacebook(accessToken);
              navigation.goBack();
            } catch (e: unknown) {
              handleError(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
