import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
  AppleAuthenticationScope,
  isAvailableAsync as appleIsAvailableAsync,
  signInAsync as appleSignInAsync,
} from 'expo-apple-authentication';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { formatFirebaseError } from '../services/firebaseErrors';

type Props = {
  onAppleTokens: (idToken: string, rawNonce: string) => Promise<void>;
  disabled?: boolean;
};

/** Sign in with Apple — само iOS; изисква capability в Xcode/EAS и „Apple“ провайдър в Firebase Auth. */
export function AppleSignInSection({ onAppleTokens, disabled }: Props) {
  const { colors } = useTheme();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const hintStyle = useMemo(
    () =>
      StyleSheet.create({
        box: { marginTop: spacing.sm },
        text: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
      }),
    [colors.textMuted]
  );

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'ios') {
      setAvailable(false);
      return;
    }
    (async () => {
      try {
        const ok = await appleIsAvailableAsync();
        if (!cancelled) setAvailable(ok);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onApplePress = useCallback(async () => {
    setBusy(true);
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );
      const credential = await appleSignInAsync({
        requestedScopes: [
          AppleAuthenticationScope.FULL_NAME,
          AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      const idToken = credential.identityToken?.trim();
      if (!idToken) {
        Alert.alert('Apple', 'Липсва identity token. Провери „Sign In with Apple“ в Apple Developer и Firebase.');
        return;
      }
      await onAppleTokens(idToken, rawNonce);
    } catch (e: unknown) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return;
      Alert.alert('Грешка', formatFirebaseError(e));
    } finally {
      setBusy(false);
    }
  }, [onAppleTokens]);

  if (Platform.OS !== 'ios') {
    return null;
  }

  if (available === null) {
    return (
      <View style={[hintStyle.box, { alignItems: 'center', paddingVertical: spacing.sm }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!available) {
    return (
      <View style={hintStyle.box}>
        <Text style={hintStyle.text}>
          Sign in with Apple не е наличен на това устройство или симулатор. На реален iPhone с iOS 13+
          включи capability „Sign In with Apple“ за bundle com.ribolov.app и провайдър „Apple“ в Firebase
          Authentication.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: spacing.sm }}>
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={{ width: '100%', height: 48, opacity: disabled || busy ? 0.55 : 1 }}
        onPress={() => {
          if (!disabled && !busy) void onApplePress();
        }}
      />
      {busy ? (
        <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} />
      ) : null}
    </View>
  );
}
