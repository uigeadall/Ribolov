import React, { useCallback } from 'react';
import { Platform, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ActionSheet } from './ActionSheet';
import { useAuth } from '../services/authContext';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { useTheme } from '../services/themeContext';
import { spacing } from '../theme/typography';

/**
 * Floating compose button. Surfaced on Home, Feed, and Logbook so users can
 * reach the share-a-catch / write-a-post flow from any high-traffic surface
 * without backtracking to a different tab.
 *
 * Hidden when the user isn't signed in. The Pressable sits at fixed bottom
 * offset that clears the tab bar (~50pt) plus the iOS home indicator (~34pt).
 */
export function ComposeFab() {
  const { user, configured } = useAuth();
  const { colors, mode } = useTheme();
  const navigation = useAppNavigation();

  const openSheet = useCallback(() => {
    if (!user || !configured) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheet.show({
      title: 'Какво искаш да споделиш?',
      options: [
        {
          label: 'Сподели улов',
          icon: 'fish-outline',
          onPress: () =>
            (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} }),
        },
        {
          label: 'Напиши пост',
          icon: 'create-outline',
          onPress: () =>
            (navigation as any).navigate('FeedTab', { screen: 'CreatePost' }),
        },
      ],
    });
  }, [user, configured, navigation]);

  if (!user || !configured) return null;
  return (
    <Pressable
      onPress={openSheet}
      accessibilityRole="button"
      accessibilityLabel="Сподели"
      // Material ripple for Android. `borderless: true` clips to the FAB's
      // 28pt radius so the ripple stays inside the circle.
      android_ripple={{ color: 'rgba(255,255,255,0.30)', borderless: true, radius: 28 }}
      style={({ pressed }) => ({
        position: 'absolute',
        right: spacing.lg,
        bottom: 100,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
        elevation: 8,
        // iOS press feedback — Android relies on the ripple above.
        opacity: pressed && Platform.OS === 'ios' ? 0.85 : 1,
      })}
    >
      {/* Light accents (teal #2DD4BF) need dark ink for contrast in dark mode. */}
      <Ionicons name="add" size={30} color={mode === 'dark' ? '#04201C' : '#fff'} />
    </Pressable>
  );
}
