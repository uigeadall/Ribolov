import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from '../../../components/ScalePressable';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import { useHomeTheme } from '../useHomeTheme';

/** Three pill shortcuts to screens buried two-or-more taps deep
    (Tournaments / TripPlanner / Classics) — not bottom-tab duplicates. */
export function ShortcutRow() {
  const navigation = useAppNavigation();
  const { cardBg, cardBorder, primary, textColor } = useHomeTheme();
  const items = [
    { icon: 'trophy-outline' as const, label: 'Турнири', onPress: () => navigation.navigate('ProfileTab', { screen: 'Tournaments' }) },
    { icon: 'calendar-outline' as const, label: 'План', onPress: () => navigation.navigate('ProfileTab', { screen: 'TripPlanner' }) },
    { icon: 'ribbon-outline' as const, label: 'Класики', onPress: () => navigation.navigate('ProfileTab', { screen: 'Classics' }) },
  ];
  return (
    <View style={S.pillRow}>
      {items.map((p) => (
        <ScalePressable
          key={p.label}
          style={[S.pillBtn, { backgroundColor: cardBg, borderColor: cardBorder }]}
          onPress={p.onPress}
        >
          <Ionicons name={p.icon} size={24} color={primary} />
          <Text style={[S.pillBtnText, { color: textColor }]}>{p.label}</Text>
        </ScalePressable>
      ))}
    </View>
  );
}

const S = StyleSheet.create({
  pillRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
  },
  pillBtn: {
    flex: 1, height: 76,
    borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  pillBtnText: { fontSize: 12, fontFamily: 'Nunito_700Bold' },
});
