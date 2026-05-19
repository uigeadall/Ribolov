import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { useTheme } from '../services/themeContext';
import { radius, spacing } from '../theme/typography';
import type { WeatherSnapshot } from '../services/weather';

type Window = { key: 'dawn' | 'day' | 'dusk' | 'night'; label: string; range: string; rating: number };

function calcBiteWindows(w: WeatherSnapshot): Window[] {
  const hour = new Date().getHours();
  const base = w.fishingRating;

  const dawnBonus = (hour >= 5 && hour <= 9 ? 0.8 : 0) + (w.moonPhase < 0.1 || Math.abs(w.moonPhase - 0.5) < 0.08 ? 0.5 : 0);
  const midBonus = w.cloudCover > 60 ? 0.2 : -0.4;
  const duskBonus = (hour >= 17 && hour <= 21 ? 0.6 : 0) + (w.moonPhase < 0.1 || Math.abs(w.moonPhase - 0.5) < 0.08 ? 0.4 : 0);
  const nightBonus = (w.moonPhase < 0.1 || Math.abs(w.moonPhase - 0.5) < 0.08) ? 0.5 : -0.5;

  const clamp = (v: number) => Math.max(1, Math.min(5, Math.round(v)));
  const pressureBonus = w.pressureHpa >= 1013 && w.pressureHpa <= 1022 ? 0.3 : w.pressureHpa < 1000 ? -0.5 : 0;

  return [
    { key: 'dawn',  label: 'Сутрин', range: '05–09', rating: clamp(base + dawnBonus + pressureBonus) },
    { key: 'day',   label: 'Денем',  range: '10–16', rating: clamp(base + midBonus + pressureBonus) },
    { key: 'dusk',  label: 'Вечер',  range: '17–21', rating: clamp(base + duskBonus + pressureBonus) },
    { key: 'night', label: 'Нощем',  range: '22–04', rating: clamp(base + nightBonus + pressureBonus) },
  ];
}

function currentWindow(): Window['key'] {
  const h = new Date().getHours();
  if (h >= 5 && h <= 9) return 'dawn';
  if (h >= 10 && h <= 16) return 'day';
  if (h >= 17 && h <= 21) return 'dusk';
  return 'night';
}

type Props = { weather: WeatherSnapshot };

const BAR_HEIGHT = 64;

export function BiteForecast({ weather }: Props) {
  const { colors, mode } = useTheme();
  const windows = useMemo(() => calcBiteWindows(weather), [weather]);
  const peak = useMemo(() => windows.reduce((b, w) => (w.rating > b.rating ? w : b), windows[0]), [windows]);
  const nowKey = useMemo(() => currentWindow(), []);

  // Animate bars from 0 → rating on mount.
  const animRefs = useRef(windows.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const anims = windows.map((w, i) =>
      Animated.timing(animRefs[i], {
        toValue: w.rating / 5,
        duration: 720,
        delay: i * 80,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      })
    );
    Animated.parallel(anims).start();
  }, [windows, animRefs]);

  const trackColor = mode === 'dark' ? 'rgba(74,168,232,0.07)' : 'rgba(21,112,184,0.05)';
  const inactiveBar = mode === 'dark' ? 'rgba(74,168,232,0.32)' : 'rgba(21,112,184,0.28)';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: spacing.md + 2,
          paddingHorizontal: spacing.md + 2,
          marginTop: spacing.sm,
        },
        // Header
        headerRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        },
        headerLeft: {
          flex: 1,
        },
        kicker: {
          fontSize: 10,
          fontFamily: 'Nunito_700Bold',
          color: colors.textMuted,
          letterSpacing: 1.4,
          textTransform: 'uppercase' as const,
        },
        peakName: {
          fontSize: 22,
          fontFamily: 'Nunito_800ExtraBold',
          color: colors.text,
          marginTop: 4,
          letterSpacing: -0.3,
        },
        peakRange: {
          fontSize: 12,
          fontFamily: 'Nunito_600SemiBold',
          color: colors.textMuted,
          marginTop: 2,
          letterSpacing: 0.2,
        },
        peakRatingWrap: {
          alignItems: 'flex-end',
        },
        peakRatingNum: {
          fontSize: 28,
          fontFamily: 'Nunito_800ExtraBold',
          color: colors.primary,
          lineHeight: 30,
          letterSpacing: -1,
        },
        peakRatingMax: {
          fontSize: 11,
          fontFamily: 'Nunito_600SemiBold',
          color: colors.textMuted,
          letterSpacing: 0.4,
        },
        divider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginTop: spacing.md,
          marginBottom: spacing.md,
        },
        // Chart
        chartRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          height: BAR_HEIGHT,
          gap: 10,
        },
        barWrap: {
          flex: 1,
          height: BAR_HEIGHT,
        },
        barTrack: {
          width: '100%',
          height: '100%',
          borderRadius: 6,
          backgroundColor: trackColor,
          overflow: 'hidden',
          justifyContent: 'flex-end',
        },
        bar: {
          width: '100%',
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
        },
        // Labels
        labelsRow: {
          flexDirection: 'row',
          gap: 10,
          marginTop: 10,
        },
        labelCol: {
          flex: 1,
        },
        labelText: {
          fontSize: 10,
          fontFamily: 'Nunito_700Bold',
          color: colors.textMuted,
          letterSpacing: 1,
          textTransform: 'uppercase' as const,
        },
        labelTextActive: {
          color: colors.text,
        },
        labelRange: {
          fontSize: 10,
          fontFamily: 'Nunito_600SemiBold',
          color: colors.textMuted,
          marginTop: 2,
          opacity: 0.65,
        },
        nowMarker: {
          width: 14,
          height: 2,
          borderRadius: 1,
          backgroundColor: colors.primary,
          marginBottom: 5,
        },
      }),
    [colors, mode, trackColor]
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.kicker}>Пик днес</Text>
          <Text style={styles.peakName}>{peak.label}</Text>
          <Text style={styles.peakRange}>{peak.range}</Text>
        </View>
        <View style={styles.peakRatingWrap}>
          <Text style={styles.peakRatingNum}>{peak.rating}<Text style={styles.peakRatingMax}>/5</Text></Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.chartRow}>
        {windows.map((w, i) => {
          const isPeak = w.key === peak.key;
          return (
            <View key={w.key} style={styles.barWrap}>
              <View style={styles.barTrack}>
                <Animated.View
                  style={[
                    styles.bar,
                    {
                      height: animRefs[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                      backgroundColor: isPeak ? colors.primary : inactiveBar,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.labelsRow}>
        {windows.map((w) => {
          const isNow = w.key === nowKey;
          return (
            <View key={w.key} style={styles.labelCol}>
              {isNow ? <View style={styles.nowMarker} /> : <View style={{ height: 7 }} />}
              <Text style={[styles.labelText, isNow && styles.labelTextActive]}>{w.label}</Text>
              <Text style={styles.labelRange}>{w.range}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
