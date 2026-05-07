import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

type Day = { date: string; code: number; maxC: number; minC: number; precipProb: number };

const TTL_MS = 2 * 60 * 60 * 1000;

function wmoShort(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Ч. облачно';
  if (code <= 3) return 'Облачно';
  if (code <= 48) return 'Мъгла';
  if (code <= 67) return 'Дъжд';
  if (code <= 77) return 'Сняг';
  return 'Гръм.';
}

type Props = {
  latitude: number;
  longitude: number;
  cacheKey: string;
};

export function ForecastStrip({ latitude, longitude, cacheKey }: Props) {
  const { colors } = useTheme();
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
        chip: {
          width: 88,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.sm,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
        },
        day: { ...typography.caption, fontWeight: '700', color: colors.text },
        tempRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
        tMax: { ...typography.bodyBold, fontSize: 14, color: colors.primary },
        tMin: { ...typography.small, color: colors.textMuted },
        desc: { ...typography.small, color: colors.textMuted, marginTop: 2 },
        rain: { ...typography.small, color: colors.primaryLight, marginTop: 1 },
        center: { paddingVertical: spacing.md, alignItems: 'center' },
        err: { ...typography.caption, color: colors.danger },
      }),
    [colors]
  );

  useEffect(() => {
    let cancelled = false;
    const storageKey = `@ribolov/forecast2:${cacheKey}`;

    (async () => {
      setLoading(true);
      setErr(false);
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { at: number; days: Day[] };
          if (parsed.at && Date.now() - parsed.at < TTL_MS && Array.isArray(parsed.days)) {
            setDays(parsed.days);
            setLoading(false);
            return;
          }
        }

        const url =
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${latitude}&longitude=${longitude}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&forecast_days=7&timezone=auto`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('forecast');
        const json = (await res.json()) as {
          daily: {
            time: string[];
            weather_code: number[];
            temperature_2m_max: number[];
            temperature_2m_min: number[];
            precipitation_probability_max: number[];
          };
        };
        const next: Day[] = json.daily.time.map((date, i) => ({
          date,
          code: json.daily.weather_code[i] ?? 0,
          maxC: Math.round(json.daily.temperature_2m_max[i] ?? 0),
          minC: Math.round(json.daily.temperature_2m_min[i] ?? 0),
          precipProb: Math.round(json.daily.precipitation_probability_max[i] ?? 0),
        }));
        if (!cancelled) {
          setDays(next);
          await AsyncStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), days: next }));
        }
      } catch {
        if (!cancelled) setErr(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [latitude, longitude, cacheKey]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (err || days.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Няма прогноза</Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {days.map((d) => (
        <View key={d.date} style={styles.chip}>
          <Text style={styles.day} numberOfLines={1}>
            {d.date.slice(5).replace('-', '.')}
          </Text>
          <View style={styles.tempRow}>
            <Text style={styles.tMax}>{d.maxC}°</Text>
            <Text style={styles.tMin}>{d.minC}°</Text>
          </View>
          <Text style={styles.desc} numberOfLines={1}>{wmoShort(d.code)}</Text>
          {d.precipProb > 0 ? (
            <Text style={styles.rain}>💧 {d.precipProb}%</Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
