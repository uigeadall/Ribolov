import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { ScalePressable } from '../../../components/ScalePressable';
import { WeatherIcon } from '../../../components/WeatherIcon';
import { BiteForecast } from '../../../components/BiteForecast';
import { Skeleton } from '../../../components/Skeleton';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import { speciesList } from '../../../data/species';
import type { WeatherSnapshot, ForecastDay } from '../../../services/weather';
import { useHomeTheme } from '../useHomeTheme';
import { fishingLabel } from '../homeHelpers';
import { HomeSectionHeader } from './HomeSectionHeader';

type Props = {
  weather: WeatherSnapshot | null;
  weatherStatus: 'idle' | 'loading' | 'error';
  forecast: ForecastDay[];
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

/** "Прогноза" — season-species tip + today's bite forecast + the 7-day strip.
    Renders nothing when there's neither weather nor a load in flight. */
export function WeatherForecastCard({ weather, weatherStatus, forecast }: Props) {
  const navigation = useAppNavigation();
  const { mode, primary, cardBg, cardBorder, textColor, mutedColor } = useHomeTheme();
  if (!(weather || weatherStatus === 'loading')) return null;
  return (
    <>
      <HomeSectionHeader
        label="Прогноза"
        link={{ text: 'Виж на картата →', onPress: () => navigation.navigate('MapTab') }}
      />

      {/* Species suggestions tip */}
      {weather && (() => {
        const suggestions = getSeasonSuggestions(weather.weatherCode, new Date().getMonth() + 1);
        return suggestions.length > 0 ? (
          <View style={{
            marginHorizontal: spacing.xl,
            marginBottom: spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: mode === 'dark' ? 'rgba(78,174,224,0.10)' : 'rgba(21,112,184,0.07)',
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderWidth: 1,
            borderColor: mode === 'dark' ? 'rgba(78,174,224,0.18)' : 'rgba(21,112,184,0.14)',
          }}>
            <Text style={{ fontSize: 13 }}>🎣</Text>
            <Text
              style={{ fontSize: 11, fontFamily: 'Nunito_600SemiBold', color: mutedColor, flex: 1 }}
              numberOfLines={1}
            >
              {'Добри условия за: ' + suggestions.join(' · ')}
            </Text>
          </View>
        ) : null;
      })()}

      {/* Bite forecast inline */}
      {weather && (
        <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.md }}>
          <BiteForecast weather={weather} />
        </View>
      )}

      {/* 7-day forecast */}
      {(forecast.length > 0 || weatherStatus === 'loading') && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={[S.forecastScroll, { marginBottom: spacing.xl }]}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: 4 }}
        >
          {forecast.length === 0
            ? [0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} width={52} height={88} style={{ borderRadius: 13 }} />)
            : forecast.map((day) => {
                const best = day.fishingRating >= 4;
                const fl = fishingLabel(day.fishingRating);
                return (
                  <ScalePressable
                    key={day.dateIso}
                    style={[S.fcCard, {
                      backgroundColor: best ? primary + '18' : cardBg,
                      borderWidth: 1.5,
                      borderColor: best ? primary : cardBorder,
                    }]}
                    onPress={() => navigation.navigate('ProfileTab', { screen: 'TripPlanner' })}
                  >
                    <Text style={[S.fcDay, { color: best ? primary : textColor }]}>{day.dayLabel}</Text>
                    <Text style={[S.fcDate, { color: mutedColor }]}>
                      {new Date(day.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'numeric' })}
                    </Text>
                    <WeatherIcon weatherCode={day.weatherCode} size={20} color={best ? primary : textColor} />
                    <Text style={[S.fcTemp, { color: textColor }]}>{day.maxTempC}°</Text>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {[1, 2, 3, 4, 5].map(i => (
                        <View key={i} style={{ width: 4, height: 3, borderRadius: 1.5, backgroundColor: i <= day.fishingRating ? fl.color : (mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)') }} />
                      ))}
                    </View>
                    {day.precipProbability > 20 && (
                      <Text style={{ fontSize: 8, fontFamily: 'Nunito_400Regular', color: mutedColor }}>{day.precipProbability}% 💧</Text>
                    )}
                  </ScalePressable>
                );
              })}
        </ScrollView>
      )}
    </>
  );
}

const S = StyleSheet.create({
  forecastScroll: { marginBottom: spacing.sm },
  fcCard: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 7, borderRadius: 13, minWidth: 52, gap: 2 },
  fcDay: { fontSize: 10, fontFamily: 'Nunito_700Bold' },
  fcDate: { fontSize: 8, fontFamily: 'Nunito_400Regular' },
  fcTemp: { fontSize: 12, fontFamily: 'Nunito_700Bold' },
});
