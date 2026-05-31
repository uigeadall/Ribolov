import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { fetchWeather, windDirectionLabel } from '../services/weather';

type Props = {
  /** Map center coordinates. Wind is fetched for this point and treated
      as the regional reading — wind direction varies slowly over short
      distances so a single fetch covers ~50 km of viewport reasonably. */
  latitude: number;
  longitude: number;
  /** Optional tap handler — host screen can open a detailed weather sheet. */
  onPress?: () => void;
};

/**
 * Floating chip that shows the current wind direction + speed at the
 * map center. Anglers position themselves relative to the wind (most
 * species feed in the wind shadow at lakes, against the current at
 * rivers), so surfacing this directly on the map is a high-value
 * differentiator vs generic fishing apps.
 *
 * Approach: fetch wind once when lat/lng changes, debounce so panning
 * doesn't spam the API. The result is regional — same chip covers the
 * whole visible viewport. For a per-dam wind reading at zoom 13+ a
 * future iteration could fetch per-marker.
 *
 * Visual: small pill with a rotated arrow (wind FROM direction) + speed
 * label. Background blurs into the map so it doesn't fight the geography.
 */
export function WindCompassChip({ latitude, longitude, onPress }: Props) {
  const { colors, mode } = useTheme();
  const [wind, setWind] = useState<{ kmh: number; direction: number } | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounce + abort: 800 ms after the last lat/lng update we fetch the
  // wind. If another update lands inside the window the previous timer is
  // cleared so we never fire more than one request per pan-settle.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetchWeather(latitude, longitude)
        .then((w) => {
          if (!cancelled) setWind({ kmh: w.windKmh, direction: w.windDirection });
        })
        .catch(() => { /* silent — chip just stays in its last state */ })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [latitude, longitude]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        chip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radius.pill,
          backgroundColor: mode === 'dark' ? 'rgba(18,28,36,0.92)' : 'rgba(255,255,255,0.95)',
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        },
        arrowWrap: {
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
        },
        speed: { ...typography.bodyBold, color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
        direction: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
      }),
    [colors, mode],
  );

  if (!wind && !loading) return null;

  // Open-Meteo reports wind direction as the angle the wind is coming FROM.
  // The Ionicons "arrow-up" points NORTH (0°); we rotate by the direction
  // value so the arrow visually points in the FROM direction. Anglers
  // naturally read that as "wind coming from this way".
  const arrowRotation = wind ? `${wind.direction}deg` : '0deg';

  return (
    <Pressable
      onPress={onPress}
      style={styles.chip}
      accessibilityRole="button"
      accessibilityLabel={
        wind ? `Вятър ${wind.kmh} километра в час от ${windDirectionLabel(wind.direction)}` : 'Вятър'
      }
    >
      <View style={styles.arrowWrap}>
        <Ionicons
          name="arrow-up"
          size={16}
          color={colors.primary}
          style={{ transform: [{ rotate: arrowRotation }] }}
        />
      </View>
      <View>
        <Text style={styles.speed}>{wind ? `${wind.kmh} км/ч` : '…'}</Text>
        <Text style={styles.direction}>{wind ? windDirectionLabel(wind.direction) : 'зареждам'}</Text>
      </View>
    </Pressable>
  );
}
