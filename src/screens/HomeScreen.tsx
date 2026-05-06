import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { WeatherIcon } from '../components/WeatherIcon';
import { StarRatingBar } from '../components/StarRatingBar';
import { Button } from '../components/Button';
import { SectionHeader } from '../components/SectionHeader';
import { ListRow } from '../components/ListRow';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { fetchWeather, windDirectionLabel, type WeatherSnapshot } from '../services/weather';
import { catchesStore } from '../storage/storage';

const FALLBACK_COORD = { latitude: 42.6977, longitude: 23.3219 };

function greetingBg(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Добро утро';
  if (h < 18) return 'Добър ден';
  return 'Добър вечер';
}

function createHomeStyles(colors: AppColors) {
  return StyleSheet.create({
    weatherCard: {
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    weatherTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    weatherTemp: { ...typography.h1, fontSize: 34, color: colors.text, letterSpacing: -1 },
    weatherDesc: { ...typography.body, color: colors.textMuted, marginTop: 4 },
    weatherRatingCol: { alignItems: 'flex-end' },
    ratingLabel: { ...typography.small, color: colors.textMuted, marginTop: 6 },
    weatherDetails: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    detailItem: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: '45%' },
    detailVal: { ...typography.body, color: colors.text, flex: 1 },
    detailLbl: { ...typography.small, color: colors.textMuted },
    weatherHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, lineHeight: 20 },
    statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    statBox: {
      flex: 1,
      backgroundColor: colors.primarySurface,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    statNum: { ...typography.h2, fontSize: 26, color: colors.primary },
    statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
    heroTitle: { ...typography.h1, color: colors.primaryDark },
    heroDate: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, textTransform: 'capitalize' },
    heroLead: { ...typography.body, color: colors.text, marginTop: spacing.md, lineHeight: 24 },
    heroFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    heroFootText: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },
  });
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useMemo(() => createHomeStyles(colors), [colors]);

  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [locLabel, setLocLabel] = useState<string>('София (примерно)');
  const [totalCatches, setTotalCatches] = useState(0);
  const [weekCatches, setWeekCatches] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    const list = await catchesStore.list();
    setTotalCatches(list.length);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const n = list.filter((c) => {
      const t = Date.parse(c.date);
      return !Number.isNaN(t) && t >= weekAgo;
    }).length;
    setWeekCatches(n);
  }, []);

  const loadWeather = useCallback(async () => {
    setWeatherStatus('loading');
    let lat = FALLBACK_COORD.latitude;
    let lng = FALLBACK_COORD.longitude;
    let label = 'София (примерно)';

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        label = 'При теб сега';
      }
    } catch {
      /* fallback coords */
    }

    setLocLabel(label);

    try {
      const w = await fetchWeather(lat, lng);
      setWeather(w);
      setWeatherStatus('idle');
    } catch {
      setWeather(null);
      setWeatherStatus('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
      loadWeather();
    }, [loadStats, loadWeather])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadWeather()]);
    setRefreshing(false);
  };

  const dateStr = useMemo(
    () =>
      new Date().toLocaleDateString('bg-BG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    []
  );

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ),
      }}
    >
      <Card
        style={{
          marginBottom: spacing.xl,
          backgroundColor: colors.primarySurface,
          borderColor: colors.cardEdge,
        }}
      >
        <Text style={styles.heroTitle}>{greetingBg()}</Text>
        <Text style={styles.heroDate}>{dateStr}</Text>
        <Text style={styles.heroLead}>
          Оттук виждаш времето, обобщение от дневника и най-полезните екрани — всичко е на едно място.
        </Text>
        <View style={styles.heroFoot}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.heroFootText}>
            Дълго натискане на картата добавя спот. В профила са лентата и класиките със снимки.
          </Text>
        </View>
      </Card>

      <SectionHeader hint="ПРОГНОЗА" title="Време сега" subtitle="Подходящо за бърз излет край теб или избран водоем от картата." />
      <Card style={styles.weatherCard}>
        {weatherStatus === 'loading' && !weather ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.weatherHint, { textAlign: 'center', marginTop: spacing.md }]}>
              Зареждаме прогнозата…
            </Text>
          </View>
        ) : weatherStatus === 'error' || !weather ? (
          <View>
            <Text style={{ ...typography.body, color: colors.text }}>
              Няма връзка с прогнозата. Провери интернет и опитай отново.
            </Text>
            <Button title="Опитай отново" variant="secondary" onPress={loadWeather} style={{ marginTop: spacing.md }} />
          </View>
        ) : (
          <>
            <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm }}>{locLabel}</Text>
            <View style={styles.weatherTop}>
              <WeatherIcon weatherCode={weather.weatherCode} size={54} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.weatherTemp}>{weather.temperatureC}°C</Text>
                <Text style={styles.weatherDesc}>{weather.description}</Text>
              </View>
              <View style={styles.weatherRatingCol}>
                <StarRatingBar rating={weather.fishingRating} color={colors.accent} emptyColor={colors.border} size={14} />
                <Text style={styles.ratingLabel}>риболовен индекс</Text>
              </View>
            </View>
            <View style={styles.weatherDetails}>
              <View style={[styles.detailItem, { minWidth: '100%' }]}>
                <Ionicons name="flag-outline" size={18} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailVal}>
                    {weather.windKmh} км/ч {windDirectionLabel(weather.windDirection)}
                  </Text>
                  <Text style={styles.detailLbl}>вятър</Text>
                </View>
              </View>
              <View style={styles.detailItem}>
                <Ionicons name="speedometer-outline" size={18} color={colors.textMuted} />
                <View>
                  <Text style={styles.detailVal}>{weather.pressureHpa} hPa</Text>
                  <Text style={styles.detailLbl}>налягане</Text>
                </View>
              </View>
              <View style={styles.detailItem}>
                <Ionicons name="water-outline" size={18} color={colors.textMuted} />
                <View>
                  <Text style={styles.detailVal}>{weather.humidity}%</Text>
                  <Text style={styles.detailLbl}>влажност</Text>
                </View>
              </View>
            </View>
            <Text style={styles.weatherHint}>
              На картата можеш да избереш язовир или река и да видиш прогноза за точното място и следващите 7 дни.
            </Text>
            <Button
              title="Отвори картата"
              variant="secondary"
              compact
              onPress={() => navigation.navigate('MapTab')}
              style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
            />
          </>
        )}
      </Card>

      <SectionHeader hint="ДНЕВНИК" title="Твоите улови" subtitle="Брой записи на устройството — синхронизацията е от профила, ако си влязъл." />
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{totalCatches}</Text>
            <Text style={styles.statLbl}>общо записа</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{weekCatches}</Text>
            <Text style={styles.statLbl}>последни 7 дни</Text>
          </View>
        </View>
        <Button
          title="Дневник — всички улови"
          variant="secondary"
          compact
          onPress={() => navigation.navigate('LogbookTab')}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <SectionHeader hint="НАВИГАЦИЯ" title="Къде да отидеш" subtitle="Един докос за най-често ползваните екрани." />

      <ListRow
        icon="book-outline"
        title="Дневник на улова"
        subtitle="Записвай риба, снимки и бележки"
        onPress={() => navigation.navigate('LogbookTab')}
      />
      <ListRow
        icon="map-outline"
        iconTint={colors.primaryLight}
        title="Карта и водоеми"
        subtitle="Язовири, реки, спотове и прогноза"
        onPress={() => navigation.navigate('MapTab')}
      />
      <ListRow
        icon="podium-outline"
        iconTint="#7C4DFF"
        title="Класирания"
        subtitle="Резултати от общността и по водоем"
        onPress={() => navigation.navigate('ProfileTab', { screen: 'Leaderboard' })}
      />
      <ListRow
        icon="fish-outline"
        iconTint={colors.accent}
        title="Видове риби"
        subtitle="Описания, сезони и съвети"
        onPress={() => navigation.navigate('SpeciesTab')}
      />
      <ListRow
        icon="people-outline"
        iconTint="#C97D12"
        title="Лента и профил"
        subtitle="Споделени улови, приятели, настройки"
        onPress={() =>
          navigation.navigate('ProfileTab', {
            screen: 'Feed',
          })
        }
      />

      <View style={{ height: spacing.md }} />
    </Screen>
  );
}
