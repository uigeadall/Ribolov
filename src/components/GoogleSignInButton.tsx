import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import { exchangeCodeAsync, ResponseType } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Button } from './Button';
import { useTheme } from '../services/themeContext';
import { getGoogleSignInClientIds, isGoogleSignInConfigured } from '../services/firebaseConfig';
import { ensureFirebase } from '../services/firebase';
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

  // Web uses Firebase's signInWithPopup flow because the manual
  // exchangeCodeAsync path in GoogleSignInInner requires a client_secret
  // for Web OAuth clients, which we intentionally don't ship in the JS
  // bundle. signInWithPopup hands the OAuth handshake off to Firebase's
  // hosted handler (ribolov-4ef41.firebaseapp.com/__/auth/handler), which
  // already exists in the Authorized redirect URIs.
  if (Platform.OS === 'web') {
    return <GoogleSignInWeb disabled={disabled} />;
  }

  return <GoogleSignInInner onIdToken={onIdToken} disabled={disabled} />;
}

function GoogleSignInWeb({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fb = ensureFirebase();
      if (!fb) throw new Error('Firebase не е конфигуриран.');
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      await signInWithPopup(fb.auth, provider);
      // signInWithPopup updates fb.auth.currentUser; the authContext
      // onAuthStateChanged listener picks it up and re-renders.
    } catch (e: unknown) {
      Alert.alert('Грешка', formatFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

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

  // Dev-only: long-press to reveal the redirect URI the SDK actually resolves
  // to at runtime. Without this you have to guess what to paste into Google
  // Cloud Console → Credentials → Authorized redirect URIs. With it you copy
  // the exact string. Stripped in production by the __DEV__ check.
  const onLongPress = () => {
    if (!__DEV__) return;
    Alert.alert('Google redirect URI', request?.redirectUri ?? '(not ready)');
  };

  return (
    <Button
      title="Продължи с Google"
      variant="secondary"
      loading={busy}
      disabled={disabled || !request}
      onPress={() => promptAsync()}
      onLongPress={onLongPress}
    />
  );
}
