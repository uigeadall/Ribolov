import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

type Props = {
  title: string;
  /** Малък ред под заглавието (брояч, контекст). */
  subtitle?: string;
  /** Скрива стрелката назад (за tab-root екрани). */
  hideBack?: boolean;
  /** Икони/бутони вдясно. */
  actions?: ReactNode;
  /** Съдържание под титулния ред (chips, търсачка) — пак върху navy. */
  children?: ReactNode;
};

/**
 * Navy header лента — единственият header на редизайна. Екраните, които я
 * ползват, подават statusBarStyle="light-content" на <Screen>.
 */
export function NavBand({ title, subtitle, hideBack, actions, children }: Props) {
  const { colors } = useTheme();
  const navigation = useNavigation();

  return (
    <View style={[styles.band, { backgroundColor: colors.navy }]}>
      <View style={styles.row}>
        {!hideBack && navigation.canGoBack() ? (
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); navigation.goBack(); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Назад"
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={24} color={colors.onNavy} />
          </Pressable>
        ) : null}
        <View style={styles.titleWrap}>
          <Text style={[typography.h3, { color: colors.onNavy }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[typography.small, { color: colors.onNavyMuted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  back: { marginRight: spacing.sm, marginLeft: -spacing.xs },
  titleWrap: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
