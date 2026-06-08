import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from '../../../components/ScalePressable';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import type { Catch } from '../../../types/index';
import { useHomeTheme } from '../useHomeTheme';

type Props = { best: Catch | null };

/** Compact "your record this month" pill, between the onboarding checklist
    and the orange CTA. Renders nothing when there's no catch this month. */
export function MonthlyBestPill({ best }: Props) {
  const navigation = useAppNavigation();
  const { cardBg, cardBorder, accent, mutedColor, textColor } = useHomeTheme();
  if (!best) return null;
  return (
    <ScalePressable
      style={[S.pbPill, { backgroundColor: cardBg, borderColor: cardBorder }]}
      onPress={() => navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: best.id } })}
    >
      <View style={[S.pbPillIcon, { backgroundColor: accent + '22' }]}>
        <Text style={{ fontSize: 16 }}>🏆</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[S.pbPillLabel, { color: mutedColor }]}>Твоят рекорд за месеца</Text>
        <Text style={[S.pbPillTitle, { color: textColor }]} numberOfLines={1}>
          {best.speciesName}
          {best.weightKg != null ? ` · ${best.weightKg} кг` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={mutedColor} />
    </ScalePressable>
  );
}

const S = StyleSheet.create({
  pbPill: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    borderRadius: 16, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  pbPillIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  pbPillLabel: {
    fontSize: 9, fontFamily: 'Nunito_700Bold',
    letterSpacing: 1, textTransform: 'uppercase',
  },
  pbPillTitle: {
    fontSize: 14, fontFamily: 'Nunito_700Bold', marginTop: 1,
  },
});
