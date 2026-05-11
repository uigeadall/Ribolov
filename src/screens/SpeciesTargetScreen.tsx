import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StarRatingBar } from '../components/StarRatingBar';
import { useTheme } from '../services/themeContext';
import { spacing, typography, radius } from '../theme/typography';
import { speciesList } from '../data/species';
import { catchesStore, spotsStore } from '../storage/storage';
import { checkBanPeriod } from '../services/notifications';
import { fetchForecast, type ForecastDay } from '../services/weather';
import { useAppNavigation } from '../navigation/useAppNavigation';
import type { SpeciesStackParamList } from '../navigation/types';
import type { Catch, Spot } from '../types';
import * as Location from 'expo-location';

type R = RouteProp<SpeciesStackParamList, 'SpeciesTarget'>;

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function SpeciesTargetScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { speciesId } = route.params;

  const species = useMemo(() => speciesList.find((s) => s.id === speciesId), [speciesId]);
  const banInfo = useMemo(() => checkBanPeriod(species?.banPeriod), [species]);

  const [catches, setCatches] = useState<Catch[]>([]);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [userCoord, setUserCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [allCatches, allSpots] = await Promise.all([catchesStore.list(), spotsStore.list()]);
      if (cancelled) return;
      setCatches(allCatches.filter((c) => c.speciesId === speciesId));
      setSpots(allSpots);

      // Get location for forecast
      let lat = 42.6977, lon = 23.3219;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          if (!cancelled) setUserCoord({ latitude: lat, longitude: lon });
        }
      } catch { /* use fallback */ }

      const days = await fetchForecast(lat, lon).catch(() => [] as ForecastDay[]);
      if (!cancelled) { setForecast(days); setLoading(false); }
    };
    void run();
    return () => { cancelled = true; };
  }, [speciesId]);

  // Best baits from own catch history — normalise to lowercase so "Царевица"/"царевица" merge
  const topBaits = useMemo(() => {
    const baitMap = new Map<string, number>();
    catches.forEach((c) => {
      const key = c.bait?.trim().toLowerCase();
      if (key) baitMap.set(key, (baitMap.get(key) ?? 0) + 1);
    });
    return [...baitMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [catches]);

  // Best forecast day
  const bestDay = useMemo(() => forecast.reduce<ForecastDay | null>(
    (best, d) => (!best || d.fishingRating > best.fishingRating ? d : best), null
  ), [forecast]);

  // Nearest spots sorted by distance
  const nearbySpots = useMemo(() => {
    if (!userCoord) return spots.slice(0, 3);
    return [...spots]
      .sort((a, b) => haversineKm(userCoord, a) - haversineKm(userCoord, b))
      .slice(0, 3);
  }, [spots, userCoord]);

  const styles = useMemo(() => StyleSheet.create({
    title: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textMuted, fontStyle: 'italic' },
    sectionTitle: { ...typography.h3, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    banCard: {
      backgroundColor: banInfo.active ? colors.danger + '15' : colors.primarySurface,
      borderColor: banInfo.active ? colors.danger + '44' : colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    banTitle: { ...typography.bodyBold, color: banInfo.active ? colors.danger : colors.primary },
    banText: { ...typography.caption, color: banInfo.active ? colors.danger : colors.textMuted, marginTop: 2 },
    baitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    baitName: { ...typography.body, color: colors.text, flex: 1 },
    baitCount: { ...typography.caption, color: colors.textMuted },
    forecastCard: {
      backgroundColor: colors.primarySurface,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.primary + '55',
    },
    dayLabel: { ...typography.bodyBold, color: colors.primary },
    spotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    spotName: { ...typography.body, color: colors.text, flex: 1 },
    spotDist: { ...typography.caption, color: colors.textMuted },
  }), [colors, banInfo.active]);

  if (!species) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Видът не е намерен.</Text>
        <Button title="Назад" variant="secondary" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Pressable onPress={() => navigation.goBack()} style={{ marginBottom: spacing.md }} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </Pressable>

        <Text style={styles.title}>{species.nameBg}</Text>
        <Text style={styles.subtitle}>{species.nameLatin}</Text>

        {/* Ban status */}
        <Text style={styles.sectionTitle}>Статус на забрана</Text>
        <View style={styles.banCard}>
          <Text style={styles.banTitle}>
            {banInfo.active ? `🚫 Забранен период: ${banInfo.from} – ${banInfo.to}` : '✅ Без активна забрана'}
          </Text>
          {banInfo.active && banInfo.note ? <Text style={styles.banText}>{banInfo.note}</Text> : null}
          {species.minSizeCm ? (
            <Text style={styles.banText}>Минимален размер: {species.minSizeCm} см</Text>
          ) : null}
        </View>

        {/* Best forecast day */}
        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : bestDay ? (
          <>
            <Text style={styles.sectionTitle}>Най-добър ден тази седмица</Text>
            <View style={styles.forecastCard}>
              <Text style={styles.dayLabel}>{bestDay.dayLabel} — {bestDay.dateIso}</Text>
              <StarRatingBar rating={bestDay.fishingRating} color={colors.accent} emptyColor={colors.border} size={16} />
              <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: 4 }}>
                {bestDay.maxTempC}°C · {bestDay.precipProbability > 0 ? `💧 ${bestDay.precipProbability}%` : 'без дъжд'} · {bestDay.moonPhaseName}
              </Text>
            </View>
          </>
        ) : null}

        {/* Best baits from history */}
        <Text style={styles.sectionTitle}>
          {catches.length === 0 ? 'Нямаш улов от ' + species.nameBg : `Твои най-добри стръви (${catches.length} улова)`}
        </Text>
        {topBaits.length > 0 ? (
          <Card>
            {topBaits.map(([bait, count]) => (
              <View key={bait} style={styles.baitRow}>
                <Ionicons name="fish-outline" size={16} color={colors.primary} />
                <Text style={styles.baitName}>{bait}</Text>
                <Text style={styles.baitCount}>{count}×</Text>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Text style={{ ...typography.body, color: colors.textMuted }}>
              {catches.length === 0
                ? 'Запиши улови с тази риба, за да виждаш кои стръви работят при теб.'
                : 'Добави стръв при следващ улов.'}
            </Text>
            {species.baitsAndLures ? (
              <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 }}>
                Препоръчано: {species.baitsAndLures}
              </Text>
            ) : null}
          </Card>
        )}

        {/* Nearest spots */}
        {nearbySpots.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Близки спотове</Text>
            <Card>
              {nearbySpots.map((s) => {
                const dist = userCoord ? haversineKm(userCoord, s) : null;
                return (
                  <View key={s.id} style={styles.spotRow}>
                    <Ionicons name="location-outline" size={16} color={colors.primary} />
                    <Text style={styles.spotName} numberOfLines={1}>{s.name}</Text>
                    {dist !== null ? (
                      <Text style={styles.spotDist}>
                        {dist < 1 ? `${Math.round(dist * 1000)} м` : `${dist.toFixed(1)} км`}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        {/* Record this species */}
        <Button
          title={`Запиши улов на ${species.nameBg}`}
          onPress={() => navigation.navigate('LogbookTab', { screen: 'AddCatch' })}
          style={{ marginTop: spacing.xl }}
        />
        <Button
          title="Назад"
          variant="secondary"
          onPress={() => navigation.goBack()}
          style={{ marginTop: spacing.sm }}
        />
      </ScrollView>
    </Screen>
  );
}
