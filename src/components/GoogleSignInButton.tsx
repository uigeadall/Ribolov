import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import { exchangeCodeAsync, ResponseType } from 'expo-auth-session';
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
          За „Вход с Google" добави OAuth Client IDs в app.json → extra: googleIosClientId,
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
  const [busy, setBusy] = useState(false);

  // Use the Google provider hook so it computes the correct proxy redirect URI
  // for Expo Go. Force response_type=code (PKCE) — Google deprecated the
  // implicit token/id_token flow and returns invalid_request for it.
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId,
    iosClientId,
    androidClientId,
    responseType: ResponseType.Code,
    usePKCE: true,
    scopes: ['openid', 'profile', 'email'],
  } as Google.GoogleAuthRequestConfig);

  useEffect(() => {
    if (response?.type === 'error') {
      const msg =
        (response.error && 'message' in response.error ? String((response.error as { message?: unknown }).message) : null) ||
        response.params?.error_description ||
        response.params?.error ||
        'Неуспешен вход с Google';
      Alert.alert('Google', msg);
      return;
    }
    if (response?.type !== 'success') return;

    const code = response.params?.code;
    if (!code || !request) return;

    (async () => {
      setBusy(true);
      try {
        const tokens = await exchangeCodeAsync(
          {
            clientId: webClientId,
            redirectUri: request.redirectUri,
            code,
            extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : {},
          },
          { tokenEndpoint: 'https://oauth2.googleapis.com/token' }
        );
        if (!tokens.idToken) {
          Alert.alert('Google', 'Не е получен ID token от Google.');
          return;
        }
        await onIdToken(tokens.idToken);
      } catch (e: unknown) {
        Alert.alert('Грешка', formatFirebaseError(e));
      } finally {
        setBusy(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <Button
      title="Продължи с Google"
      variant="secondary"
      loading={busy}
      disabled={disabled || !request}
      onPress={() => promptAsync()}
    />
  );
}
