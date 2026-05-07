import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { useAuth } from '../services/authContext';
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
import type { Catch } from '../types/index';

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
      paddingVertical: spacing.md + 4,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    statNum: { ...typography.h2, fontSize: 26, color: colors.primary, letterSpacing: -0.5 },
    statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    heroIconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTitle: { ...typography.h2, color: colors.text, letterSpacing: -0.3 },
    heroDate: { ...typography.caption, color: colors.textMuted, marginTop: 2, textTransform: 'capitalize' },
    heroFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    heroFootText: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },
    lastCatchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    lastCatchText: { ...typography.caption, color: colors.textMuted, flex: 1 },
    feedCard: {
      marginBottom: spacing.xl,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    feedIconWrap: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'рибарю';
  const styles = useMemo(() => createHomeStyles(colors), [colors]);

  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [locLabel, setLocLabel] = useState<string>('София (примерно)');
  const [totalCatches, setTotalCatches] = useState(0);
  const [weekCatches, setWeekCatches] = useState(0);
  const [lastCatch, setLastCatch] = useState<Catch | null>(null);
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
    const sorted = [...list].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    setLastCatch(sorted[0] ?? null);
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
          marginBottom: spacing.md,
          backgroundColor: colors.primarySurface,
          borderColor: colors.cardEdge,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={styles.heroRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="fish" size={26} color={colors.white} />
            </View>
            <View>
              <Text style={styles.heroTitle}>{greetingBg()}, {firstName}!</Text>
              <Text style={styles.heroDate}>{dateStr}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => navigation.navigate('ProfileTab', { screen: 'Notifications' })}
            hitSlop={10}
            style={{ marginTop: 2 }}
          >
            <Ionicons name="notifications-outline" size={24} color={colors.primary} />
          </Pressable>
        </View>

        {lastCatch ? (
          <View style={styles.lastCatchRow}>
            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
            <Text style={styles.lastCatchText} numberOfLines={1}>
              Последен: {lastCatch.speciesName}
              {lastCatch.weightKg != null ? ` · ${lastCatch.weightKg} кг` : ''}
              {' · '}{new Date(lastCatch.date).toLocaleDateString('bg-BG')}
            </Text>
          </View>
        ) : null}

        <Button
          title="Запиши улов"
          onPress={() => navigation.navigate('LogbookTab', { screen: 'AddCatch' })}
          style={{ marginTop: spacing.sm }}
        />

        <View style={styles.heroFoot}>
          <Ionicons name="information-circle-outline" size={15} color={colors.primary} />
          <Text style={styles.heroFootText}>
            Дълго натискане на картата добавя спот · Лентата е в Профил
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
            <Ionicons name="archive-outline" size={20} color={colors.primary} style={{ marginBottom: 6 }} />
            <Text style={styles.statNum}>{totalCatches}</Text>
            <Text style={styles.statLbl}>общо записа</Text>
          </View>
          <View style={styles.statBox}>
            <Ionicons name="time-outline" size={20} color={colors.primary} style={{ marginBottom: 6 }} />
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

      <SectionHeader hint="НАВИГАЦИЯ" title="Бързи връзки" subtitle="Един докос за най-използваните функции." />

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
        iconTint={colors.accent}
        title="Класирания"
        subtitle="Резултати от общността и по водоем"
        onPress={() => navigation.navigate('ProfileTab', { screen: 'Leaderboard' })}
      />
      <ListRow
        icon="fish-outline"
        iconTint={colors.accent}
        title="Видове риби"
        subtitle="Описания, сезони и съвети"
        onPress={() => navigation.navigate('ProfileTab', { screen: 'Species', params: { screen: 'SpeciesList' } })}
      />
      <ListRow
        icon="newspaper-outline"
        iconTint={colors.warning}
        title="Лента"
        subtitle="Споделени улови от общността"
        onPress={() => navigation.navigate('FeedTab')}
      />
      <ListRow
        icon="person-outline"
        iconTint={colors.textMuted}
        title="Профил и настройки"
        subtitle="Акаунт, приятели, постижения и още"
        onPress={() => navigation.navigate('ProfileTab', { screen: 'ProfileMain' })}
      />

      <View style={{ height: spacing.md }} />
    </Screen>
  );
}
