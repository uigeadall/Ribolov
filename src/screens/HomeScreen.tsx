import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  ScrollView,
  InteractionManager,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
import { fetchWeather, fetchForecast, windDirectionLabel, type WeatherSnapshot, type ForecastDay } from '../services/weather';
import { catchesStore } from '../storage/storage';
import { fetchRankedClassicPhotos, periodStartIso, type RankedClassicPhoto } from '../services/classicsContest';
import { scheduleForecastNotificationIfGood } from '../services/pushNotifications';
import { subscribeUnreadMessagesCount } from '../services/cloudSync';
import { subscribeMyNotifications } from '../services/socialFeed';
import { BadgeIcon } from '../components/BadgeIcon';
import { Image } from 'expo-image';
import type { Catch } from '../types/index';
import { useAppNavigation } from '../navigation/useAppNavigation';

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
    forecastDayCard: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      minWidth: 62,
      gap: 4,
    },
    forecastDayCardBest: {
      backgroundColor: colors.primarySurface,
      borderColor: colors.primary,
    },
    forecastDayLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
    forecastDayLabelBest: { color: colors.primary },
    forecastDayTemp: { ...typography.caption, color: colors.text, fontWeight: '600' },
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
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'рибарю';
  const styles = useMemo(() => createHomeStyles(colors), [colors]);

  const lastFetchRef = useRef<number>(0);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [locLabel, setLocLabel] = useState<string>('София (примерно)');
  const [totalCatches, setTotalCatches] = useState(0);
  const [weekCatches, setWeekCatches] = useState(0);
  const [lastCatch, setLastCatch] = useState<Catch | null>(null);
  const [bestThisMonth, setBestThisMonth] = useState<Catch | null>(null);
  const [daysSinceCatch, setDaysSinceCatch] = useState<number | null>(null);
  const [topClassic, setTopClassic] = useState<RankedClassicPhoto | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);

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
    const latest = sorted[0] ?? null;
    setLastCatch(latest);
    if (latest) {
      const ms = Date.parse(latest.date);
      setDaysSinceCatch(isNaN(ms) ? null : Math.floor((Date.now() - ms) / 86_400_000));
    } else {
      setDaysSinceCatch(null);
    }
    // Personal best this calendar month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthCatches = list.filter((c) => {
      const t = Date.parse(c.date);
      return !isNaN(t) && t >= monthStart;
    });
    const best = monthCatches.reduce<Catch | null>(
      (m, c) => (!m || (c.weightKg ?? 0) > (m.weightKg ?? 0) ? c : m),
      null
    );
    setBestThisMonth(best);
    // Load top classic in background (best-effort)
    fetchRankedClassicPhotos(periodStartIso('week'), { maxCandidates: 20, resultLimit: 1 })
      .then((r) => setTopClassic(r[0] ?? null))
      .catch(() => {});
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
      const [w, days] = await Promise.all([
        fetchWeather(lat, lng),
        fetchForecast(lat, lng).catch(() => [] as ForecastDay[]),
      ]);
      setWeather(w);
      setForecast(days);
      setWeatherStatus('idle');
      scheduleForecastNotificationIfGood(days).catch(() => {});
    } catch {
      setWeather(null);
      setWeatherStatus('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const STALE_MS = 5 * 60 * 1000;
      const task = InteractionManager.runAfterInteractions(() => {
        const now = Date.now();
        if (now - lastFetchRef.current < STALE_MS) return;
        lastFetchRef.current = now;
        loadStats();
        loadWeather();
      });
      return () => task.cancel();
    }, [loadStats, loadWeather])
  );

  // Live badge counts — wait for Firebase to be configured before subscribing
  useEffect(() => {
    if (!user || !configured) return;
    const unsubMsgs = subscribeUnreadMessagesCount(user.uid, setUnreadMsgs);
    const unsubNotifs = subscribeMyNotifications(user.uid, (items) =>
      setUnreadNotifs(items.filter((n) => !n.read).length)
    );
    return () => { unsubMsgs(); unsubNotifs(); };
  }, [user, configured]);

  const onRefresh = async () => {
    lastFetchRef.current = 0; // bypass cache on explicit pull-to-refresh
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 }}>
            <Pressable
              onPress={() => navigation.navigate('ProfileTab', { screen: 'Chats' })}
              hitSlop={10}
            >
              <BadgeIcon name="chatbubble-outline" size={24} color={colors.primary} count={unreadMsgs} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('ProfileTab', { screen: 'Notifications' })}
              hitSlop={10}
            >
              <BadgeIcon name="notifications-outline" size={24} color={colors.primary} count={unreadNotifs} />
            </Pressable>
          </View>
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
                <Text style={styles.weatherDesc}>
                  {weather.description} · усеща се {weather.feelsLikeC}°
                </Text>
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
              <View style={styles.detailItem}>
                <Ionicons name="rainy-outline" size={18} color={colors.textMuted} />
                <View>
                  <Text style={styles.detailVal}>{weather.precipitationProbability}%</Text>
                  <Text style={styles.detailLbl}>дъжд</Text>
                </View>
              </View>
              <View style={styles.detailItem}>
                <Ionicons name="sunny-outline" size={18} color={colors.textMuted} />
                <View>
                  <Text style={styles.detailVal}>UV {weather.uvIndex}</Text>
                  <Text style={styles.detailLbl}>UV индекс</Text>
                </View>
              </View>
            </View>
            <Text style={[styles.weatherHint, { marginTop: spacing.sm }]}>
              {weather.moonPhaseName}
            </Text>
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

      {forecast.length > 0 ? (
        <>
          <SectionHeader hint="ПРОГНОЗА" title="Следващите 7 дни" subtitle="Дни с по-висок индекс са по-добри за риболов." />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl }}
          >
            {forecast.map((day) => {
              const isBest = day.fishingRating >= 4;
              const dateLabel = new Date(day.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
              return (
                <View
                  key={day.dateIso}
                  style={[styles.forecastDayCard, isBest && styles.forecastDayCardBest]}
                >
                  <Text style={[styles.forecastDayLabel, isBest && styles.forecastDayLabelBest]}>
                    {day.dayLabel}
                  </Text>
                  <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 9 }}>
                    {dateLabel}
                  </Text>
                  <Text style={{ fontSize: 18 }}>
                    {day.fishingRating >= 4 ? '🎣' : day.precipProbability > 60 ? '🌧' : day.fishingRating <= 2 ? '😐' : '🐟'}
                  </Text>
                  <Text style={{ ...typography.small, color: isBest ? colors.primary : colors.text, fontWeight: '700' }}>
                    {'★'.repeat(day.fishingRating)}{'☆'.repeat(5 - day.fishingRating)}
                  </Text>
                  <Text style={styles.forecastDayTemp}>{day.maxTempC}°</Text>
                  {day.precipProbability > 20 ? (
                    <Text style={{ ...typography.caption, color: colors.textMuted }}>{day.precipProbability}%💧</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : null}

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
          onPress={() => navigation.navigate('LogbookTab', { screen: 'LogbookList' })}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      {/* ── Classics preview ── */}
      <SectionHeader hint="КЛАСИКИ" title="Снимка на седмицата" subtitle="Гласувай с харесване · най-много харесвания печели." />
      <Pressable
        onPress={() => navigation.navigate('ProfileTab', { screen: 'Classics' })}
        style={{ marginBottom: spacing.xl }}
      >
        {topClassic?.item.photoUri ? (
          <View style={{ borderRadius: radius.xl, overflow: 'hidden', height: 200 }}>
            <Image source={{ uri: topClassic.item.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            <View style={{ position: 'absolute', inset: 0, justifyContent: 'space-between', padding: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFD700', paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill }}>
                  <Text style={{ fontSize: 13 }}>🥇</Text>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: '#1a1a1a', letterSpacing: 0.5 }}>ПОБЕДИТЕЛ</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill }}>
                  <Ionicons name="heart" size={13} color="#ff6b6b" />
                  <Text style={{ ...typography.small, color: '#fff', fontWeight: '700' }}>{topClassic.likes}</Text>
                </View>
              </View>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.md, padding: spacing.sm }}>
                <Text style={{ ...typography.small, color: 'rgba(255,255,255,0.7)', fontWeight: '600' }}>{topClassic.item.ownerName ?? 'Рибар'}</Text>
                <Text style={{ ...typography.bodyBold, color: '#fff', marginTop: 2 }} numberOfLines={1}>
                  {topClassic.item.photoTitle ?? topClassic.item.speciesName}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 26 }}>🏆</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.bodyBold, color: colors.text }}>Класики тази седмица</Text>
              <Text style={{ ...typography.small, color: colors.textMuted, marginTop: 2 }}>
                Сподели улов и спечели!
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Card>
        )}
      </Pressable>

      {/* ── Personal best this month ── */}
      {bestThisMonth ? (
        <>
          <SectionHeader hint="ЛИЧЕН РЕКОРД" title="Най-голям улов този месец" />
          <Card style={{ marginBottom: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 24 }}>🏆</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.bodyBold, color: colors.text }}>{bestThisMonth.speciesName}</Text>
              <Text style={{ ...typography.body, color: colors.textMuted, marginTop: 2 }}>
                {bestThisMonth.weightKg != null ? `${bestThisMonth.weightKg} кг` : '—'}
                {bestThisMonth.lengthCm != null ? ` · ${bestThisMonth.lengthCm} см` : ''}
                {' · '}{new Date(bestThisMonth.date).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' })}
              </Text>
            </View>
            <Pressable onPress={() => navigation.navigate('LogbookTab', { screen: 'LogbookList' })} hitSlop={8}>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
          </Card>
        </>
      ) : null}

      {/* ── Activity prompt ── */}
      {daysSinceCatch !== null && daysSinceCatch > 2 ? (
        <>
          <SectionHeader hint="АКТИВНОСТ" title={daysSinceCatch === 0 ? 'Улов днес!' : `${daysSinceCatch} ${daysSinceCatch === 1 ? 'ден' : 'дни'} без улов`} />
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ ...typography.body, color: colors.textMuted, lineHeight: 22 }}>
              {daysSinceCatch < 7
                ? 'Готов ли си за следващия излет? Провери прогнозата в картата.'
                : daysSinceCatch < 30
                ? 'Мина доста — може би е ред за риболов. Лентата чака твоя улов!'
                : 'Над месец без запис. Скочи на водата и запиши следващия улов.'}
            </Text>
            <Button
              title="Виж прогнозата"
              variant="secondary"
              compact
              onPress={() => navigation.navigate('MapTab')}
              style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
            />
          </Card>
        </>
      ) : null}

      <SectionHeader hint="НАВИГАЦИЯ" title="Полезни секции" subtitle="Директни връзки към основните функции." />
      <ListRow
        icon="images-outline"
        iconTint={colors.accent}
        title="Седмични и месечни класации"
        subtitle="Класики, награди и снимка на седмицата"
        onPress={() => navigation.navigate('ProfileTab', { screen: 'Classics' })}
      />
      <ListRow
        icon="fish-outline"
        iconTint={colors.primary}
        title="Видове риби"
        subtitle="Описания, сезони, съвети и въжени възли"
        onPress={() => navigation.navigate('ProfileTab', { screen: 'Species', params: { screen: 'SpeciesList' } })}
      />

      <View style={{ height: spacing.md }} />
    </Screen>
  );
}
