import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  ViewProps,
  ScrollView,
  ScrollViewProps,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { spacing } from '../theme/typography';
import { OfflineBanner } from './OfflineBanner';

type Props = ViewProps & {
  scroll?: boolean;
  padded?: boolean;
  scrollProps?: ScrollViewProps;
  /** По подразбиране true — целият екран се измества над клавиатурата (iOS padding; Android + resize в app.json). */
  avoidKeyboard?: boolean;
  /** Кои safe area ръбове да се прилагат (виж react-native-safe-area-context). По подразбиране само top. */
  safeAreaEdges?: Edge[];
};

export function Screen({
  children,
  scroll,
  padded = true,
  style,
  scrollProps,
  avoidKeyboard = true,
  safeAreaEdges = ['top'],
  ...rest
}: Props) {
  const { colors, mode } = useTheme();

  const gradientColors = (
    mode === 'dark'
      ? ['#060D14', '#050F12', '#060F12']
      : ['#C8E7F5', '#DDF0F7', '#EEF5F7']
  ) as [string, string, string];

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: gradientColors[0] },
        fill: { flex: 1 },
        padded: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
        scroll: { flexGrow: 1, paddingBottom: spacing.xxl },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors.background, mode]
  );

  const inner = (
    <View style={[!scroll && styles.fill, padded && styles.padded, style]} {...rest}>
      {children}
    </View>
  );

  const scrollBody = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      {...scrollProps}
    >
      {inner}
    </ScrollView>
  ) : (
    inner
  );

  const body = avoidKeyboard ? (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {scrollBody}
    </KeyboardAvoidingView>
  ) : (
    scrollBody
  );

  return (
    <SafeAreaView style={styles.safe} edges={safeAreaEdges}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0.25, y: 0 }}
        end={{ x: 0.75, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <OfflineBanner />
      {body}
    </SafeAreaView>
  );
}
