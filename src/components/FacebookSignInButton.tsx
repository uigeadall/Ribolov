import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useAuthRequest, makeRedirectUri, ResponseType } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Button } from './Button';
import { useTheme } from '../services/themeContext';
import { getFacebookAppId, isFacebookSignInConfigured } from '../services/firebaseConfig';
import { spacing, typography } from '../theme/typography';
import { formatFirebaseError } from '../services/firebaseErrors';

WebBrowser.maybeCompleteAuthSession();

const FACEBOOK_DISCOVERY = {
  authorizationEndpoint: 'https://www.facebook.com/v19.0/dialog/oauth',
};

type Props = {
  onAccessToken: (accessToken: string) => Promise<void>;
  disabled?: boolean;
};

/** Показва инструкции, докато lipsvat Facebook App ID в app.json extra / env. */
export function FacebookSignInSection({ onAccessToken, disabled }: Props) {
  const { colors } = useTheme();
  const hintStyle = useMemo(
    () =>
      StyleSheet.create({
        box: { marginTop: spacing.md },
        text: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
      }),
    [colors.textMuted]
  );

  if (!isFacebookSignInConfigured()) {
    return (
      <View style={hintStyle.box}>
        <Text style={hintStyle.text}>
          За „Вход с Facebook" добави facebookAppId в app.json → extra или EXPO_PUBLIC_FACEBOOK_APP_ID
          (от Meta for Developers → Your Apps → Settings → Basic → App ID).
        </Text>
      </View>
    );
  }

  return <FacebookSignInInner onAccessToken={onAccessToken} disabled={disabled} />;
}

function FacebookSignInInner({ onAccessToken, disabled }: Props) {
  const appId = getFacebookAppId();
  const [busy, setBusy] = useState(false);

  // In a dev build this resolves to com.ribolov.app:// which Facebook accepts.
  // Add this URI to: Meta Developer → App → Facebook Login → Valid OAuth Redirect URIs.
  const redirectUri = makeRedirectUri({ scheme: 'ribolov-app' });

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: appId,
      responseType: ResponseType.Token,
      scopes: ['public_profile', 'email'],
      redirectUri,
    },
    FACEBOOK_DISCOVERY
  );

  useEffect(() => {
    if (response?.type === 'error') {
      const msg =
        (response.error && 'message' in response.error
          ? String((response.error as { message?: unknown }).message)
          : null) ||
        response.params?.error_description ||
        response.params?.error ||
        'Неуспешен вход с Facebook';
      Alert.alert('Facebook', msg);
      return;
    }
    if (response?.type !== 'success') return;

    const accessToken = response.params?.access_token;
    if (!accessToken) {
      Alert.alert('Facebook', 'Не е получен access token от Facebook.');
      return;
    }

    (async () => {
      setBusy(true);
      try {
        await onAccessToken(accessToken);
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
      title="Продължи с Facebook"
      variant="secondary"
      loading={busy}
      disabled={disabled || !request}
      onPress={() => promptAsync()}
    />
  );
}
