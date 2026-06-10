import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ScalePressable } from '../../../components/ScalePressable';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing, radius, typography } from '../../../theme/typography';
import type { Catch } from '../../../types/index';
import { useHomeTheme } from '../useHomeTheme';

type Props = {
  catchCount: number;
  best: Catch | null;
};

/** Big-numeral stat tiles + the accent "+ Улов" action tile. Replaces the
    MonthlyBestPill and the old full-width orange AddCatchCta banner. */
export function StatTileRow({ catchCount, best }: Props) {
  const navigation = useAppNavigation();
  const { surface, hairline, textColor, mutedColor, accent, onAccent } = useHomeTheme();

  const addCatch = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  };

  return (
    <View style={S.row}>
      <ScalePressable
        style={[S.tile, { backgroundColor: surface, borderColor: hairline }]}
        onPress={() => navigation.navigate('LogbookTab', { screen: 'LogbookList' })}
      >
        <Text style={[S.num, { color: textColor }]} numberOfLines={1}>{catchCount}</Text>
        <Text style={[typography.overline, S.label, { color: mutedColor }]}>Улова</Text>
      </ScalePressable>

      <ScalePressable
        style={[S.tile, { backgroundColor: surface, borderColor: hairline }]}
        onPress={() => best
          ? navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: best.id } })
          : navigation.navigate('LogbookTab', { screen: 'LogbookList' })}
      >
        <Text style={[S.num, { color: textColor }]} numberOfLines={1}>
          {best?.weightKg != null ? `${best.weightKg}` : '—'}
          {best?.weightKg != null && <Text style={S.numUnit}>кг</Text>}
        </Text>
        <Text style={[typography.overline, S.label, { color: mutedColor }]} numberOfLines={1}>
          Рекорд за месеца
        </Text>
      </ScalePressable>

      <ScalePressable style={[S.tile, S.action, { backgroundColor: accent }]} onPress={addCatch}>
        <Ionicons name="add" size={26} color={onAccent} />
        <Text style={[typography.overline, S.label, { color: onAccent }]}>Улов</Text>
      </ScalePressable>
    </View>
  );
}

const S = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: spacing.sm,
    marginHorizontal: spacing.xl, marginBottom: spacing.lg,
  },
  tile: {
    flex: 1, borderRadius: radius.lg, borderWidth: 1,
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
    alignItems: 'center', justifyContent: 'center', gap: 2,
    minHeight: 76,
  },
  action: { borderWidth: 0 },
  num: {
    fontSize: 26, fontFamily: 'Nunito_800ExtraBold',
    letterSpacing: -0.8, lineHeight: 30,
  },
  numUnit: { fontSize: 13, letterSpacing: 0 },
  label: { fontSize: 9 },
});
