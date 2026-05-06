import React, { useEffect, useMemo, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { tripsStore } from '../storage/storage';
import type { ProfileStackParamList } from '../navigation/types';
import type { TripPlan } from '../types';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

type R = RouteProp<ProfileStackParamList, 'TripDetail'>;

export default function TripDetailScreen() {
  const route = useRoute<R>();
  const { colors } = useTheme();
  const [trip, setTrip] = useState<TripPlan | null | undefined>(undefined);

  useEffect(() => {
    tripsStore.get(route.params.id).then(setTrip);
  }, [route.params.id]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        body: { ...typography.body, color: colors.text, marginTop: spacing.md, lineHeight: 22 },
      }),
    [colors]
  );

  if (trip === undefined) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Зареждане…</Text>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Излетът не е намерен.</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>{trip.title}</Text>
      <Text style={{ ...typography.caption, color: colors.textMuted }}>{trip.dateIso}</Text>
      <Card style={{ marginTop: spacing.lg }}>
        <Text style={styles.body}>{trip.notes?.trim() ? trip.notes : 'Няма бележки за този излет.'}</Text>
      </Card>
    </Screen>
  );
}
