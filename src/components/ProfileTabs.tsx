import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import type { AppColors } from '../theme/palette';

export type ProfileTabKey = 'posts' | 'photos' | 'info' | 'friends';

type Tab = {
  key: ProfileTabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** When falsy, the tab is hidden — useful for hiding "Приятели" on the
      public profile if we can't read other users' follows. */
  visible?: boolean;
};

type Props = {
  active: ProfileTabKey;
  onChange: (next: ProfileTabKey) => void;
  /** Override defaults — pass `{ friends: false }` to hide a tab. */
  visibility?: Partial<Record<ProfileTabKey, boolean>>;
};

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    scrollContent: {
      paddingHorizontal: spacing.md,
      gap: 4,
      paddingVertical: spacing.sm,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: 999,
    },
    tabActive: { backgroundColor: colors.primary },
    tabInactive: { backgroundColor: 'transparent' },
    label: {
      ...typography.bodyBold,
      fontSize: 14,
    },
    labelActive: { color: '#fff' },
    labelInactive: { color: colors.textMuted },
  });
}

/** Horizontal segmented tabs for the profile screens. Active tab is a primary
    pill, inactive tabs are unstyled muted text + icon. Haptic on change. */
export function ProfileTabs({ active, onChange, visibility }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const tabs: Tab[] = useMemo(() => [
    { key: 'posts', label: 'Публикации', icon: 'grid-outline', visible: visibility?.posts !== false },
    { key: 'photos', label: 'Снимки', icon: 'images-outline', visible: visibility?.photos !== false },
    { key: 'info', label: 'Информация', icon: 'information-circle-outline', visible: visibility?.info !== false },
    { key: 'friends', label: 'Приятели', icon: 'people-outline', visible: visibility?.friends !== false },
  ], [visibility?.posts, visibility?.photos, visibility?.info, visibility?.friends]);

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {tabs.filter((t) => t.visible).map((t) => {
          const isActive = active === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                if (active !== t.key) {
                  void Haptics.selectionAsync();
                  onChange(t.key);
                }
              }}
              style={[styles.tab, isActive ? styles.tabActive : styles.tabInactive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t.label}
            >
              <Ionicons
                name={t.icon}
                size={16}
                color={isActive ? '#fff' : colors.textMuted}
              />
              <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
