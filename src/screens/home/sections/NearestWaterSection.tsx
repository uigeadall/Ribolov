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

/** Closest dams / rivers to the user as one grouped card with hairline row
    dividers. Falls back to a "grant location" hint when no coordinate yet. */
export function NearestWaterSection({ waters, onRequestLocation }: Props) {
  const navigation = useAppNavigation();
  const { surface, hairline, textColor, mutedColor, accent, accentSoft } = useHomeTheme();
  return (
    <>
      <HomeSectionHeader
        label="Най-близки водоеми"
        link={waters.length > 0 ? { text: 'Виж карта →', onPress: () => navigation.navigate('MapTab') } : undefined}
      />
      {waters.length > 0 ? (
        <View style={[S.nearbyGroup, { backgroundColor: surface, borderColor: hairline }]}>
          {waters.map((w, i) => (
            <ScalePressable
              key={`${w.kind}-${w.id}`}
              style={[S.nearbyRow, i < waters.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hairline }]}
              onPress={() => navigation.navigate('WaterDetail', { kind: w.kind, id: w.id })}
            >
              <View style={[S.nearbyIconWrap, { backgroundColor: accentSoft }]}>
                <Ionicons name={w.kind === 'dam' ? 'layers-outline' : 'git-branch-outline'} size={18} color={accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[S.nearbyName, { color: textColor }]} numberOfLines={1}>{w.name}</Text>
                <Text style={[S.nearbyMeta, { color: mutedColor }]} numberOfLines={1}>
                  {w.kind === 'dam' ? 'Язовир' : 'Река'} · {w.region}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[S.nearbyDistance, { color: textColor }]}>{Math.round(w.km)} км</Text>
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
  nearbyGroup: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  nearbyIconWrap: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  nearbyName: { fontSize: 14, fontFamily: 'Nunito_700Bold' },
  nearbyMeta: { fontSize: 11, fontFamily: 'Nunito_400Regular', marginTop: 1 },
  nearbyDistance: { fontSize: 14, fontFamily: 'Nunito_800ExtraBold' },
});
