import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing, radius } from '../../../theme/typography';
import { useHomeTheme } from '../useHomeTheme';
import { HomeSectionHeader } from './HomeSectionHeader';

/** iOS-Settings-style grouped link rows to screens buried two-or-more taps
    deep. Replaces the old three-pill ShortcutRow. */
export function MoreLinksSection() {
  const navigation = useAppNavigation();
  const { surface, hairline, textColor, mutedColor, accent, accentSoft } = useHomeTheme();

  const items = [
    { icon: 'trophy-outline' as const, label: 'Турнири', onPress: () => navigation.navigate('ProfileTab', { screen: 'Tournaments' }) },
    { icon: 'calendar-outline' as const, label: 'План за риболов', onPress: () => navigation.navigate('ProfileTab', { screen: 'TripPlanner' }) },
    { icon: 'ribbon-outline' as const, label: 'Класики', onPress: () => navigation.navigate('ProfileTab', { screen: 'Classics' }) },
    { icon: 'map-outline' as const, label: 'Карта на водоемите', onPress: () => (navigation as any).navigate('MapTab') },
  ];

  return (
    <View style={S.wrap}>
      <HomeSectionHeader label="Още" />
      <View style={[S.group, { backgroundColor: surface, borderColor: hairline }]}>
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [S.linkRow, pressed && { opacity: 0.6 }]}
          >
            <View style={[S.icon, { backgroundColor: accentSoft }]}>
              <Ionicons name={item.icon} size={16} color={accent} />
            </View>
            <View style={[S.rowBody, i < items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hairline }]}>
              <Text style={[S.linkText, { color: textColor }]}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={mutedColor} />
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  group: { borderRadius: radius.lg, borderWidth: 1, paddingLeft: spacing.md },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 30, height: 30, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14, paddingRight: spacing.md,
  },
  linkText: { fontSize: 14, fontFamily: 'Manrope_700Bold' },
});
