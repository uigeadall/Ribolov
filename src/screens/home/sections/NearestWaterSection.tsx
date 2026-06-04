import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from '../../../components/ScalePressable';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import { useHomeTheme } from '../useHomeTheme';
import { HomeSectionHeader } from './HomeSectionHeader';
import { EmptyHint } from './EmptyHint';

export type NearestWater = {
  kind: 'dam' | 'river';
  id: string;
  name: string;
  region: string;
  km: number;
};

type Props = {
  waters: NearestWater[];
  /** Invoked from the empty-state hint — owns the Location permission flow
      (which lives in HomeScreen because it resets the fetch throttle). */
  onRequestLocation: () => void;
};

/** Closest dams / rivers to the user. Falls back to a "grant location" hint
    when no coordinate is available yet. */
export function NearestWaterSection({ waters, onRequestLocation }: Props) {
  const navigation = useAppNavigation();
  const { cardBg, cardBorder, textColor, mutedColor, primary, colors } = useHomeTheme();
  return (
    <>
      <HomeSectionHeader
        label="Най-близки водоеми"
        link={waters.length > 0 ? { text: 'Виж карта →', onPress: () => navigation.navigate('MapTab') } : undefined}
      />
      {waters.length > 0 ? (
        <View style={S.nearbyList}>
          {waters.map((w) => (
            <ScalePressable
              key={`${w.kind}-${w.id}`}
              style={[S.nearbyRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => navigation.navigate('WaterDetail', { kind: w.kind, id: w.id })}
            >
              <View style={[S.nearbyIconWrap, { backgroundColor: colors.primarySurface }]}>
                <Ionicons name={w.kind === 'dam' ? 'layers-outline' : 'git-branch-outline'} size={20} color={primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[S.nearbyName, { color: textColor }]} numberOfLines={1}>{w.name}</Text>
                <Text style={[S.nearbyMeta, { color: mutedColor }]} numberOfLines={1}>
                  {w.kind === 'dam' ? 'Язовир' : 'Река'} · {w.region}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[S.nearbyDistance, { color: primary }]}>{Math.round(w.km)} км</Text>
              </View>
            </ScalePressable>
          ))}
        </View>
      ) : (
        <EmptyHint
          icon="location-outline"
          text="Разреши локация, за да видиш близки язовири и реки"
          onPress={onRequestLocation}
        />
      )}
    </>
  );
}

const S = StyleSheet.create({
  nearbyList: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  nearbyIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  nearbyName: { fontSize: 14, fontFamily: 'Nunito_700Bold' },
  nearbyMeta: { fontSize: 11, fontFamily: 'Nunito_400Regular', marginTop: 1 },
  nearbyDistance: { fontSize: 14, fontFamily: 'Nunito_800ExtraBold' },
});
