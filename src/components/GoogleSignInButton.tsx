import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Button } from './Button';
import { useTheme } from '../services/themeContext';
import { getGoogleSignInClientIds, isGoogleSignInConfigured } from '../services/firebaseConfig';
import { spacing, typography } from '../theme/typography';
import { formatFirebaseError } from '../services/firebaseErrors';

WebBrowser.maybeCompleteAuthSession();

type Props = {
  onIdToken: (idToken: string) => Promise<void>;
  disabled?: boolean;
};

/** Показва инструкции, докато липсват OAuth client IDs в extra / env. */
export function GoogleSignInSection({ onIdToken, disabled }: Props) {
  const { colors } = useTheme();
  const hintStyle = useMemo(
    () =>
      StyleSheet.create({
        box: { marginTop: spacing.md },
        text: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
      }),
    [colors.textMuted]
  );

  if (!isGoogleSignInConfigured()) {
    return (
      <View style={hintStyle.box}>
        <Text style={hintStyle.text}>
          За „Вход с Google“ добави OAuth Client IDs в app.json → extra: googleIosClientId,
          googleAndroidClientId и googleWebClientId (от Google Cloud Console → Credentials), или
          EXPO_PUBLIC_GOOGLE_* env променливи. За Expo Go добави и redirect URI в Web клиента:
          https://auth.expo.io/@tonyjobs97/ribolov-app
        </Text>
      </View>
    );
  }

  return <GoogleSignInInner onIdToken={onIdToken} disabled={disabled} />;
}

function GoogleSignInInner({ onIdToken, disabled }: Props) {
  const { webClientId, iosClientId, androidClientId } = getGoogleSignInClientIds();
  const [, , promptAsync] = Google.useIdTokenAuthRequest({
    webClientId,
    iosClientId,
    androidClientId,
  });
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    setBusy(true);
    try {
      const result = await promptAsync();
      if (result.type === 'success') {
        const idToken = (result.params?.id_token ?? '').trim();
        if (!idToken) {
          Alert.alert(
            'Google',
            'Няма ID token. Провери OAuth клиентите и разрешения redirect URI в Google Cloud Console.'
          );
          return;
        }
        await onIdToken(idToken);
        return;
      }
      if (result.type === 'error') {
        const msg =
          (typeof result.error === 'object' && result.error && 'message' in result.error
            ? String((result.error as { message?: string }).message)
            : null) ||
          result.params?.error_description ||
          result.params?.error ||
          'Неуспешен вход с Google';
        Alert.alert('Google', msg);
      }
    } catch (e: unknown) {
      Alert.alert('Грешка', formatFirebaseError(e));
    } finally {
      setBusy(false);
    }
  }, [onIdToken, promptAsync]);

  return (
    <Button
      title="Продължи с Google"
      variant="secondary"
      loading={busy}
      disabled={disabled}
      onPress={onPress}
    />
  );
}
