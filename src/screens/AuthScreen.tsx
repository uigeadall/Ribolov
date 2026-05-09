import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { GoogleSignInSection } from '../components/GoogleSignInButton';
import { AppleSignInSection } from '../components/AppleSignInSection';

export default function AuthScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { signIn, signUp, signInWithGoogleIdToken, signInWithApple, resetPassword, configured, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

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
          marginBottom: spacing.sm,
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

  const submit = async () => {
    if (!configured) {
      Alert.alert('Firebase', 'Добави ключове в app.json extra или EXPO_PUBLIC_FIREBASE_*.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email, password);
      else await signUp(email, password, name);
      navigation.goBack();
    } catch (e: unknown) {
      Alert.alert('Грешка', formatFirebaseError(e));
    } finally {
      setBusy(false);
    }
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
            onPress={() => setMode('login')}
            style={{ flex: 1 }}
          />
          <Button
            title="Регистрация"
            variant={mode === 'register' ? 'primary' : 'secondary'}
            onPress={() => setMode('register')}
            style={{ flex: 1 }}
          />
        </View>

        <Card>
          {mode === 'register' ? (
            <>
              <Text style={styles.fieldLabel}>ИМЕ</Text>
              <TextInput
                placeholder="Показвано ime"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                style={styles.input}
              />
            </>
          ) : null}
          <Text style={styles.fieldLabel}>ИМЕЙЛ</Text>
          <TextInput
            placeholder="твоят@имейл.bg"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>ПАРОЛА</Text>
          <TextInput
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
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
                          Alert.alert('Грешка', formatFirebaseError(e));
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
              Alert.alert('Грешка', formatFirebaseError(e));
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
              Alert.alert('Грешка', formatFirebaseError(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
