import React from 'react';
import { View } from 'react-native';
import { spacing } from '../../../theme/typography';
import { SolunarCard } from '../../../components/SolunarCard';
import { HomeSectionHeader } from './HomeSectionHeader';

type Props = { coord: { latitude: number; longitude: number } | null };

/** Solunar / moon-phase prediction for the resolved location (real or the
    Sofia fallback). Renders nothing until a coordinate is available. */
export function SolunarSection({ coord }: Props) {
  if (!coord) return null;
  return (
    <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
      <HomeSectionHeader label="Лунен прогноз" accentColor="#7B5BBE" />
      <SolunarCard latitude={coord.latitude} longitude={coord.longitude} />
    </View>
  );
}
