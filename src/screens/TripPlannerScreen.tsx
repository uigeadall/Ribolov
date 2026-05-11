import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { StarRatingBar } from '../components/StarRatingBar';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { fetchForecast, type ForecastDay } from '../services/weather';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { spotsStore } from '../storage/storage';
import type { Spot } from '../types';
import { useAppNavigation } from '../navigation/useAppNavigation';

type LocKind = 'dam' | 'river' | 'spot';
type LocationOption = { kind: LocKind; id: string; name: string; lat: number; lng: number };

function makeVerdictText(rating: number) {
  if (rating >= 4) return { text: 'Отличен ден за риболов!', icon: 'checkmark-circle' as const, positive: true };
  if (rating === 3) return { text: 'Приемливи условия.', icon: 'remove-circle' as const, positive: null };
  return { text: 'По-слаби условия — можеш да изчакаш.', icon: 'close-circle' as const, positive: false };
}

export default function TripPlannerScreen() {
  const { colors } = useTheme();
  const navigation = useAppNavigation();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [locTab, setLocTab] = useState<LocKind>('dam');
  const [selectedLoc, setSelectedLoc] = useState<LocationOption | null>(null);
  const [selectedDateIso, setSelectedDateIso] = useState('');
  const [forecast, setForecast] = useState<ForecastDay | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { spotsStore.list().then(setSpots); }, []);

  const dateOptions = useMemo(() => {
    const result: { dateIso: string; label: string; shortLabel: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const label = i === 0 ? 'Днес' : i === 1 ? 'Утре'
        : d.toLocaleDateString('bg-BG', { weekday: 'short' });
      const shortLabel = d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
      result.push({ dateIso: iso, label, shortLabel });
    }
    return result;
  }, []);

  useEffect(() => {
    if (!selectedDateIso && dateOptions.length) setSelectedDateIso(dateOptions[0].dateIso);
  }, [dateOptions, selectedDateIso]);

  const locationOptions: LocationOption[] = useMemo(() => {
    if (locTab === 'dam') return DAMS.map((d) => ({ kind: 'dam', id: d.id, name: d.name, lat: d.latitude, lng: d.longitude }));
    if (locTab === 'river') return RIVERS.map((r) => ({ kind: 'river', id: r.id, name: r.name, lat: r.latitude, lng: r.longitude }));
    return spots.map((s) => ({ kind: 'spot', id: s.id, name: s.name, lat: s.latitude, lng: s.longitude }));
  }, [locTab, spots]);

  const loadForecast = useCallback(async (loc: LocationOption, dateIso: string) => {
    setLoading(true);
    setForecast(null);
    try {
      const days = await fetchForecast(loc.lat, loc.lng);
      setForecast(days.find((d) => d.dateIso === dateIso) ?? null);
    } catch {
      setForecast(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectLocation = (loc: LocationOption) => {
    setSelectedLoc(loc);
    if (selectedDateIso) loadForecast(loc, selectedDateIso);
  };

  const selectDate = (dateIso: string) => {
    setSelectedDateIso(dateIso);
    if (selectedLoc) loadForecast(selectedLoc, dateIso);
  };

  const verdict = forecast ? makeVerdictText(forecast.fishingRating) : null;
  const verdictColor = verdict?.positive === true ? colors.primary : verdict?.positive === false ? colors.danger : colors.textMuted;

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    sectionLabel: { ...typography.h3, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
    dateChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: spacing.xs,
      alignItems: 'center',
    },
    dateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    dateChipLabel: { ...typography.caption, color: colors.text, fontWeight: '700' },
    dateChipLabelActive: { color: colors.white },
    dateChipSub: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    dateChipSubActive: { color: colors.white + 'cc' },
    tabRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { ...typography.small, color: colors.text, fontWeight: '700' },
    tabTextActive: { color: colors.white },
    locRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    locRowActive: { backgroundColor: colors.primarySurface },
    locName: { ...typography.body, color: colors.text, flex: 1 },
    locNameActive: { color: colors.primary, fontWeight: '600' },
    verdictRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
  }), [colors]);

  const locIcon = (kind: LocKind): keyof typeof Ionicons.glyphMap =>
    kind === 'dam' ? 'layers-outline' : kind === 'river' ? 'git-branch-outline' : 'location-outline';

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Планирай излет</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Date selection */}
        <Text style={styles.sectionLabel}>Дата на излета</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
        >
          {dateOptions.map((d) => {
            const active = d.dateIso === selectedDateIso;
            return (
              <Pressable key={d.dateIso} onPress={() => selectDate(d.dateIso)} style={[styles.dateChip, active && styles.dateChipActive]}>
                <Text style={[styles.dateChipLabel, active && styles.dateChipLabelActive]}>{d.label}</Text>
                <Text style={[styles.dateChipSub, active && styles.dateChipSubActive]}>{d.shortLabel}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Location type tabs */}
        <Text style={styles.sectionLabel}>Локация</Text>
        <View style={styles.tabRow}>
          {(['dam', 'river', 'spot'] as LocKind[]).map((t) => (
            <Pressable key={t} onPress={() => setLocTab(t)} style={[styles.tab, locTab === t && styles.tabActive]}>
              <Text style={[styles.tabText, locTab === t && styles.tabTextActive]}>
                {t === 'dam' ? 'Язовири' : t === 'river' ? 'Реки' : 'Мои спотове'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Location list */}
        <Card style={{ marginHorizontal: spacing.lg, maxHeight: 220, padding: 0 }}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {locationOptions.length === 0 ? (
              <Text style={{ ...typography.caption, color: colors.textMuted, padding: spacing.md }}>
                Нямаш запазени спотове.
              </Text>
            ) : locationOptions.map((loc) => {
              const active = selectedLoc?.id === loc.id;
              return (
                <Pressable key={loc.id} onPress={() => selectLocation(loc)} style={[styles.locRow, active && styles.locRowActive]}>
                  <Ionicons name={locIcon(loc.kind)} size={15} color={active ? colors.primary : colors.textMuted} />
                  <Text style={[styles.locName, active && styles.locNameActive]} numberOfLines={1}>{loc.name}</Text>
                  {active ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Card>

        {/* Forecast result */}
        <Text style={styles.sectionLabel}>
          {selectedLoc ? `Прогноза — ${selectedLoc.name}` : 'Прогноза'}
        </Text>

        {!selectedLoc ? (
          <Card style={{ marginHorizontal: spacing.lg }}>
            <Text style={{ ...typography.body, color: colors.textMuted }}>
              Избери дата и локация горе, за да видиш риболовния индекс.
            </Text>
          </Card>
        ) : loading ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : forecast ? (
          <>
            {verdict ? (
              <View style={[styles.verdictRow, { borderColor: verdictColor + '66' }]}>
                <Ionicons name={verdict.icon} size={30} color={verdictColor} />
                <Text style={{ ...typography.bodyBold, color: verdictColor, flex: 1 }}>{verdict.text}</Text>
              </View>
            ) : null}
            <Card style={{ marginHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm }}>
              <StarRatingBar rating={forecast.fishingRating} color={colors.accent} emptyColor={colors.border} size={20} />
              <Text style={{ ...typography.bodyBold, color: colors.text }}>
                {forecast.dayLabel} · {new Date(forecast.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs }}>
                <Text style={{ ...typography.body, color: colors.textMuted }}>🌡 {forecast.maxTempC}°C</Text>
                <Text style={{ ...typography.body, color: colors.textMuted }}>
                  {forecast.precipProbability > 0 ? `💧 ${forecast.precipProbability}% дъжд` : '☀️ без дъжд'}
                </Text>
                <Text style={{ ...typography.body, color: colors.textMuted }}>{forecast.moonPhaseName}</Text>
              </View>
            </Card>
          </>
        ) : (
          <Card style={{ marginHorizontal: spacing.lg }}>
            <Text style={{ ...typography.body, color: colors.textMuted }}>
              Прогнозата е само за следващите 7 дни.
            </Text>
          </Card>
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </Screen>
  );
}
