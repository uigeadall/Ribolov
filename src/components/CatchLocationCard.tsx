import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { fetchForecast, type ForecastDay } from '../services/weather';
import type { Catch } from '../types';

type Props = {
  location: NonNullable<Catch['location']>;
};

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.md,
      overflow: 'hidden',
    },
    map: { width: '100%', height: 160 },
    body: { padding: spacing.md, gap: spacing.sm },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    accent: { width: 4, height: 18, borderRadius: 2, backgroundColor: colors.primary },
    title: { ...typography.bodyBold, color: colors.text },
    locName: { ...typography.body, color: colors.text, fontWeight: '600' },
    coords: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
    openBtn: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySurface,
    },
    openBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 11 },

    forecastSection: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    forecastRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    forecastTitle: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '700', fontSize: 10, letterSpacing: 0.4 },
    bestDayCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: 'rgba(46,155,90,0.10)',
      borderRadius: radius.md,
      padding: spacing.sm + 2,
    },
    bestDayIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(46,155,90,0.18)',
    },
    bestDayLabel: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    bestDayMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 11 },
    bestDayStars: { ...typography.bodyBold, color: '#2E9B5A', fontSize: 13 },
    forecastEmpty: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },
  });
}

/** Opens the device's preferred maps app at the catch's coordinates. */
function openInMaps(lat: number, lng: number, label?: string) {
  const q = encodeURIComponent(label ?? `${lat},${lng}`);
  const url = Platform.select({
    ios: `maps://?q=${q}&ll=${lat},${lng}`,
    android: `geo:${lat},${lng}?q=${lat},${lng}(${q})`,
    default: `https://maps.google.com/?q=${lat},${lng}`,
  });
  if (url) Linking.openURL(url).catch(() => {});
}

/** Shows a non-interactive map snippet of the catch location plus a "next good
    day to fish here" panel using the same forecast service the rest of the app
    uses. The forecast call is best-effort — failures hide that subsection
    rather than blocking the whole card. */
export function CatchLocationCard({ location }: Props) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const hasCoords = location.latitude != null && location.longitude != null;
  const [forecast, setForecast] = useState<ForecastDay[] | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  useEffect(() => {
    if (!hasCoords) return;
    let cancelled = false;
    setForecastLoading(true);
    fetchForecast(location.latitude!, location.longitude!)
      .then((days) => { if (!cancelled) setForecast(days); })
      .catch(() => { /* best-effort */ })
      .finally(() => { if (!cancelled) setForecastLoading(false); });
    return () => { cancelled = true; };
  }, [hasCoords, location.latitude, location.longitude]);

  // Pick the best upcoming day in the next 7. Skip "today" so this answers the
  // implicit question "when should I come back?". Tie-break by earliest date.
  const bestDay = useMemo<ForecastDay | null>(() => {
    if (!forecast || forecast.length === 0) return null;
    const upcoming = forecast.slice(1, 8);
    if (upcoming.length === 0) return null;
    return upcoming.reduce<ForecastDay>(
      (best, d) => (d.fishingRating > best.fishingRating ? d : best),
      upcoming[0],
    );
  }, [forecast]);

  if (!hasCoords && !location.name) return null;

  return (
    <View style={styles.card}>
      {hasCoords ? (
        <MapView
          style={styles.map}
          // Non-interactive — purely visual preview. Disable everything that
          // would compete with the parent ScrollView.
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          // Pre-set region rather than animating; the user can't pan anyway.
          initialRegion={{
            latitude: location.latitude!,
            longitude: location.longitude!,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          }}
          userInterfaceStyle={mode}
        >
          <Marker
            coordinate={{ latitude: location.latitude!, longitude: location.longitude! }}
            pinColor={colors.primary}
          />
        </MapView>
      ) : null}

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.accent} />
          <Text style={styles.title}>Място</Text>
          {hasCoords ? (
            <Pressable
              style={styles.openBtn}
              onPress={() => openInMaps(location.latitude!, location.longitude!, location.name)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Отвори в карти"
            >
              <Ionicons name="navigate-outline" size={12} color={colors.primary} />
              <Text style={styles.openBtnText}>Навигирай</Text>
            </Pressable>
          ) : null}
        </View>

        {location.name ? <Text style={styles.locName}>{location.name}</Text> : null}
        {hasCoords ? (
          <Text style={styles.coords}>
            {location.latitude!.toFixed(5)}, {location.longitude!.toFixed(5)}
          </Text>
        ) : null}

        {hasCoords ? (
          <View style={styles.forecastSection}>
            <View style={styles.forecastRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.forecastTitle}>Следващ добър ден тук</Text>
            </View>

            {forecastLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : bestDay ? (
              <View style={styles.bestDayCard}>
                <View style={styles.bestDayIcon}>
                  <Ionicons name="fish" size={20} color="#2E9B5A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bestDayLabel}>{bestDay.dayLabel}</Text>
                  <Text style={styles.bestDayMeta} numberOfLines={1}>
                    {bestDay.maxTempC != null ? `${bestDay.maxTempC}°` : ''}
                    {bestDay.precipProbability > 0 ? ` · 💧 ${bestDay.precipProbability}%` : ''}
                  </Text>
                </View>
                <Text style={styles.bestDayStars}>{'★'.repeat(bestDay.fishingRating)}</Text>
              </View>
            ) : (
              <Text style={styles.forecastEmpty}>Прогнозата не е достъпна.</Text>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}
