import React, { useMemo } from 'react';
import {
  StatusBar,
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

type Props = ViewProps & {
  scroll?: boolean;
  padded?: boolean;
  scrollProps?: ScrollViewProps;
  /** По подразбиране true — целият екран се измества над клавиатурата (iOS padding; Android + resize в app.json). */
  avoidKeyboard?: boolean;
  /** Кои safe area ръбове да се прилагат (виж react-native-safe-area-context). По подразбиране само top. */
  safeAreaEdges?: Edge[];
  /** Override the background gradient (3-stop tuple). */
  gradient?: [string, string, string];
};

export function Screen({
  children,
  scroll,
  padded = true,
  style,
  scrollProps,
  avoidKeyboard = true,
  safeAreaEdges = ['top'],
  gradient,
  ...rest
}: Props) {
  const { colors, mode } = useTheme();

  const gradientColors: [string, string, string] = gradient ?? (
    mode === 'dark'
      ? ['#030810', '#050C1A', '#0A1628']
      : ['#D6EEFF', '#EBF5FF', '#FFFFFF']
  );

  const gradientFirst = gradient?.[0];
  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: gradientFirst ?? (mode === 'dark' ? '#030810' : '#EBF5FF') },
        fill: { flex: 1 },
        padded: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg },
        scroll: { flexGrow: 1, paddingBottom: spacing.xxl },
      }),
    [gradientFirst, mode]
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {scrollBody}
    </KeyboardAvoidingView>
  ) : (
    scrollBody
  );

  return (
    <SafeAreaView style={styles.safe} edges={safeAreaEdges}>
      {/* Match status-bar icon color to the current theme so a dark→light
          flip doesn't leave white icons on a white bar (and vice versa).
          On Android this also sets translucent so the gradient bleeds under
          the bar correctly with edgeToEdgeEnabled in app.json. */}
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0.25, y: 0 }}
        end={{ x: 0.75, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      {body}
    </SafeAreaView>
  );
}
