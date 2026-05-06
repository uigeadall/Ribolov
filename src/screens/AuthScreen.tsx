import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { GoogleSignInSection } from '../components/GoogleSignInButton';
import { AppleSignInSection } from '../components/AppleSignInSection';

export default function AuthScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { signIn, signUp, signInWithGoogleIdToken, signInWithApple, configured, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          fontSize: 16,
          color: colors.text,
          marginBottom: spacing.sm,
          backgroundColor: colors.card,
        },
        hint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
        row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
        tab: {
          flex: 1,
          paddingVertical: spacing.sm,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
        },
        tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
        tabText: { ...typography.bodyBold, color: colors.textMuted },
        divider: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginVertical: spacing.lg,
        },
        dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
        dividerText: { ...typography.caption, color: colors.textMuted },
        tabTextOn: { color: colors.white },
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
        <Text style={styles.title}>{mode === 'login' ? 'Вход' : 'Регистрация'}</Text>
        <Text style={styles.hint}>
          Firebase Auth: имейл и парола, Google (OAuth client IDs) или Apple на iOS (Sign In with Apple + Firebase).
        </Text>

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
            <TextInput
              placeholder="Показвано име"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              style={styles.input}
            />
          ) : null}
          <TextInput
            placeholder="Имейл"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <TextInput
            placeholder="Парола"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          <Button title={mode === 'login' ? 'Влез' : 'Създай акаунт'} onPress={submit} loading={busy} />
        </Card>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>или</Text>
          <View style={styles.dividerLine} />
        </View>

        <GoogleSignInSection
          disabled={busy || !configured}
          onIdToken={async (idToken) => {
            try {
              await signInWithGoogleIdToken(idToken);
              navigation.goBack();
            } catch (e: unknown) {
              Alert.alert('Грешка', formatFirebaseError(e));
            }
          }}
        />

        <AppleSignInSection
          disabled={busy || !configured}
          onAppleTokens={async (idToken, rawNonce) => {
            try {
              await signInWithApple(idToken, rawNonce);
              navigation.goBack();
            } catch (e: unknown) {
              Alert.alert('Грешка', formatFirebaseError(e));
            }
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
