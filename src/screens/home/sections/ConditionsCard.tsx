import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from '../../../components/ScalePressable';
import { WeatherIcon } from '../../../components/WeatherIcon';
import { BiteForecast } from '../../../components/BiteForecast';
import { SolunarCard } from '../../../components/SolunarCard';
import { Skeleton } from '../../../components/Skeleton';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing, radius, typography } from '../../../theme/typography';
import { speciesList } from '../../../data/species';
import type { WeatherSnapshot, ForecastDay } from '../../../services/weather';
import { useHomeTheme } from '../useHomeTheme';
import { fishingLabel, moonPhaseEmoji } from '../homeHelpers';
import { selectTodayCard } from '../selectTodayCard';
import { HomeSectionHeader } from './HomeSectionHeader';

type Props = {
  weather: WeatherSnapshot | null;
  weatherStatus: 'idle' | 'loading' | 'error';
  forecast: ForecastDay[];
  coord: { latitude: number; longitude: number } | null;
  followingCatches: { ownerUid: string; ownerName?: string; date: string }[];
  nearestSpotName: string | null;
  onRetryWeather: () => void;
};

function getSeasonSuggestions(weatherCode: number, month: number): string[] {
  const season =
    month >= 3 && month <= 5 ? 'пролет' :
    month >= 6 && month <= 8 ? 'лято' :
    month >= 9 && month <= 11 ? 'есен' : 'зима';

  const matched = speciesList.filter((s) => s.bestSeason.toLowerCase().includes(season));

  // Boost predators when weather is clear/partly cloudy (weatherCode 0-3)
  const clearDay = weatherCode <= 3;
  const sorted = [...matched].sort((a, b) => {
    const aBoost = clearDay && a.category === 'predator' ? 1 : 0;
    const bBoost = clearDay && b.category === 'predator' ? 1 : 0;
    return bBoost - aBoost;
  });

  return sorted.slice(0, 3).map((s) => s.nameBg);
}

/** The merged "Условия" group — smart prompt strip (selectTodayCard), current
    weather with fishing rating, meta grid, bite forecast, species tip, 7-day
    strip and a compact solunar row. Absorbs the old TodayBlock,
    WeatherForecastCard and SolunarSection plus the hero's weather meta. */
export function ConditionsCard({
  weather, weatherStatus, forecast, coord, followingCatches, nearestSpotName, onRetryWeather,
}: Props) {
  const navigation = useAppNavigation();
  const { surface, hairline, textColor, mutedColor, accent, accentSoft, mode } = useHomeTheme();

  const card = selectTodayCard({
    followingCatches,
    fishingRating: weather?.fishingRating ?? null,
    nearestSpotName,
  });

  let icon: keyof typeof Ionicons.glyphMap;
  let title: string;
  let sub: string;
  let onPress: () => void;
  if (card.kind === 'social') {
    icon = 'people-outline';
    title = card.othersCount > 0
      ? `${card.actorName} и още ${card.othersCount} споделиха`
      : `${card.actorName} сподели нов улов`;
    sub = 'Виж какво кълве при приятелите ти';
    onPress = () => (navigation as any).navigate('FeedTab');
  } else if (card.kind === 'conditions') {
    icon = 'flame-outline';
    title = 'Чудесни условия за риболов';
    sub = card.spotName ? `Запиши улов · ${card.spotName}` : 'Запиши улов';
    onPress = () => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  } else {
    icon = 'fish-outline';
    title = 'Готов ли си за риболов?';
    sub = card.spotName ? `Запиши улова си от ${card.spotName}` : 'Запиши улова си в дневника';
    onPress = () => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  }

  const fLabel = weather ? fishingLabel(weather.fishingRating) : null;
  const suggestions = weather
    ? getSeasonSuggestions(weather.weatherCode, new Date().getMonth() + 1)
    : [];

  return (
    <View style={S.wrap}>
      <HomeSectionHeader
        label="Условия"
        link={{ text: 'Виж на картата →', onPress: () => navigation.navigate('MapTab') }}
      />

      <View style={[S.card, { backgroundColor: surface, borderColor: hairline }]}>
        {/* Smart prompt strip */}
        <Pressable onPress={onPress} style={S.strip}>
          <View style={[S.stripIcon, { backgroundColor: accentSoft }]}>
            <Ionicons name={icon} size={18} color={accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[S.stripTitle, { color: textColor }]} numberOfLines={1}>{title}</Text>
            <Text style={[S.stripSub, { color: mutedColor }]} numberOfLines={1}>{sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={mutedColor} />
        </Pressable>

        <View style={[S.divider, { backgroundColor: hairline }]} />

        {/* Current weather */}
        {weather ? (
          <>
            <View style={S.nowRow}>
              <Text style={[S.tempNum, { color: textColor }]}>{weather.temperatureC}°</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[S.nowDesc, { color: textColor }]} numberOfLines={1}>{weather.description}</Text>
                {fLabel && (
                  <View style={S.ratingChipRow}>
                    <View style={[S.ratingDot, { backgroundColor: fLabel.color }]} />
                    <Text style={[S.ratingText, { color: mutedColor }]} numberOfLines={1}>{fLabel.text}</Text>
                  </View>
                )}
              </View>
              <WeatherIcon weatherCode={weather.weatherCode} size={34} color={textColor} />
            </View>

            {/* Meta grid — wind / precip / pressure / moon */}
            <View style={S.metaRow}>
              {[
                { label: 'Вятър', value: `${weather.windKmh} км/ч` },
                { label: 'Дъжд', value: `${weather.precipitationProbability}%` },
                { label: 'Налягане', value: `${Math.round(weather.pressureHpa)}` },
                { label: 'Луна', value: moonPhaseEmoji(weather.moonPhaseName) },
              ].map((m, i) => (
                <React.Fragment key={m.label}>
                  {i > 0 && <View style={[S.metaDivider, { backgroundColor: hairline }]} />}
                  <View style={S.metaCell}>
                    <Text style={[typography.overline, S.metaLabel, { color: mutedColor }]}>{m.label}</Text>
                    <Text style={[S.metaValue, { color: textColor }]}>{m.value}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>

            <View style={[S.divider, { backgroundColor: hairline }]} />
            <BiteForecast weather={weather} />
            {suggestions.length > 0 && (
              <Text style={[S.tip, { color: mutedColor }]} numberOfLines={1}>
                Добри условия за: {suggestions.join(' · ')}
              </Text>
            )}
          </>
        ) : weatherStatus === 'loading' ? (
          <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
            <ActivityIndicator color={mutedColor} size="small" />
          </View>
        ) : weatherStatus === 'error' ? (
          <Pressable onPress={onRetryWeather} style={S.errorRow} hitSlop={8}>
            <Ionicons name="cloud-offline-outline" size={20} color={mutedColor} />
            <Text style={[S.stripSub, { color: mutedColor, flex: 1 }]}>Няма връзка с прогнозата</Text>
            <Text style={[S.stripSub, { color: accent }]}>Опитай отново →</Text>
          </Pressable>
        ) : null}
      </View>

      {/* 7-day strip */}
      {(forecast.length > 0 || weatherStatus === 'loading') && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={{ marginTop: spacing.sm }}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: 2 }}
        >
          {forecast.length === 0
            ? [0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} width={52} height={88} style={{ borderRadius: radius.md }} />)
            : forecast.map((day) => {
                const best = day.fishingRating >= 4;
                const fl = fishingLabel(day.fishingRating);
                return (
                  <ScalePressable
                    key={day.dateIso}
                    style={[S.fcCard, {
                      backgroundColor: best ? accentSoft : surface,
                      borderColor: best ? accent : hairline,
                    }]}
                    onPress={() => navigation.navigate('ProfileTab', { screen: 'TripPlanner' })}
                  >
                    <Text style={[S.fcDay, { color: best ? accent : textColor }]}>{day.dayLabel}</Text>
                    <Text style={[S.fcDate, { color: mutedColor }]}>
                      {new Date(day.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'numeric' })}
                    </Text>
                    <WeatherIcon weatherCode={day.weatherCode} size={20} color={best ? accent : textColor} />
                    <Text style={[S.fcTemp, { color: textColor }]}>{day.maxTempC}°</Text>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {[1, 2, 3, 4, 5].map(i => (
                        <View key={i} style={{ width: 4, height: 3, borderRadius: 1.5, backgroundColor: i <= day.fishingRating ? fl.color : (mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)') }} />
                      ))}
                    </View>
                    {day.precipProbability > 20 && (
                      <Text style={[S.fcRain, { color: mutedColor }]}>{day.precipProbability}%</Text>
                    )}
                  </ScalePressable>
                );
              })}
        </ScrollView>
      )}

      {/* Compact solunar row — SolunarCard styles itself as part of the group */}
      {coord && (
        <View style={{ marginTop: spacing.sm }}>
          <SolunarCard latitude={coord.latitude} longitude={coord.longitude} compact />
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  card: {
    borderRadius: radius.lg, borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stripIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  stripTitle: { fontSize: 15, fontFamily: 'Manrope_800ExtraBold', letterSpacing: -0.2 },
  stripSub: { fontSize: 12, fontFamily: 'Manrope_600SemiBold', marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tempNum: {
    fontSize: 44, fontFamily: 'Manrope_800ExtraBold',
    letterSpacing: -1.5, lineHeight: 48,
  },
  nowDesc: { fontSize: 14, fontFamily: 'Manrope_700Bold' },
  ratingChipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  ratingDot: { width: 8, height: 8, borderRadius: 4 },
  ratingText: { fontSize: 12, fontFamily: 'Manrope_600SemiBold' },
  metaRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: spacing.md },
  metaCell: { flex: 1, alignItems: 'center', gap: 2 },
  metaLabel: { fontSize: 9 },
  metaValue: { fontSize: 13, fontFamily: 'Manrope_700Bold' },
  metaDivider: { width: StyleSheet.hairlineWidth },
  tip: { fontSize: 11, fontFamily: 'Manrope_600SemiBold', marginTop: spacing.sm },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  fcCard: {
    alignItems: 'center', paddingVertical: 8, paddingHorizontal: 7,
    borderRadius: radius.md, minWidth: 52, gap: 2, borderWidth: 1,
  },
  fcDay: { fontSize: 10, fontFamily: 'Manrope_700Bold' },
  fcDate: { fontSize: 8, fontFamily: 'Manrope_400Regular' },
  fcTemp: { fontSize: 12, fontFamily: 'Manrope_700Bold' },
  fcRain: { fontSize: 8, fontFamily: 'Manrope_400Regular' },
});
