import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
  InteractionManager,
} from 'react-native';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { ActionSheet } from '../components/ActionSheet';
import { useAuth } from '../services/authContext';
import { WeatherIcon } from '../components/WeatherIcon';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import AsyncStorage from '../storage/kv';
import { fetchWeather, fetchForecast, windDirectionLabel, type WeatherSnapshot, type ForecastDay } from '../services/weather';
import { catchesStore } from '../storage/storage';
import { fetchRankedClassicPhotos, periodStartIso, type RankedClassicPhoto } from '../services/classicsContest';
import { speciesList } from '../data/species';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { haversineKm } from '../services/leaderboards';
import { BiteForecast } from '../components/BiteForecast';
import { FeaturedAnglerCard } from '../components/FeaturedAnglerCard';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { getFollowingCount, getFollowing } from '../services/social';
import { fetchPublicFeed, type CloudCatch } from '../services/catchSync';
import { fetchMyActiveTournaments } from '../services/tournaments';
import type { Tournament } from '../types';
import { scheduleForecastNotificationIfGood } from '../services/pushNotifications';
import { subscribeUnreadMessagesCount } from '../services/cloudSync';
import { subscribeMyNotifications } from '../services/socialFeed';
import { BadgeIcon } from '../components/BadgeIcon';
import { Skeleton } from '../components/Skeleton';
import { Image } from 'expo-image';
import type { Catch } from '../types/index';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { ScalePressable } from '../components/ScalePressable';

const FALLBACK_COORD = { latitude: 42.6977, longitude: 23.3219 };
const WAVE = 32;

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Добро утро';
  if (h < 18) return 'Добър ден';
  return 'Добър вечер';
}

function fishingLabel(rating: number) {
  if (rating >= 4) return { text: 'Перфектно за риболов', color: '#34C97A' };
  if (rating >= 3) return { text: 'Добри условия', color: '#F5C842' };
  return { text: 'Умерени условия', color: '#F5890A' };
}

function moonPhaseEmoji(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (n.includes('нова') || n.includes('new')) return '🌑';
  if (n.includes('пълн') || n.includes('full')) return '🌕';
  if ((n.includes('нараст') || n.includes('wax')) && n.includes('четв')) return '🌓';
  if ((n.includes('нам') || n.includes('wan')) && n.includes('четв')) return '🌗';
  return '🌕';
}

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

// ── Styles ────────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  // ─── Hero ────────────────────────────────────────────────────────
  hero: { paddingBottom: WAVE + 100, overflow: 'hidden' },
  heroBg: { ...StyleSheet.absoluteFillObject },
  heroInner: { paddingHorizontal: spacing.xl, paddingTop: spacing.xs },

  heroBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroLogoWrap: {
    width: 38, height: 38, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroAppName: {
    color: '#fff', fontSize: 19,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.3,
  },
  heroAppSub: {
    color: 'rgba(255,255,255,0.52)', fontSize: 9,
    fontFamily: 'Nunito_700Bold', letterSpacing: 1.8, textTransform: 'uppercase',
  },
  heroIcons: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  // Split layout: left (60%) + right (40%)
  heroSplit: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  heroLeft: { flex: 3, paddingRight: spacing.md },
  heroRight: { flex: 2, alignItems: 'flex-end' },

  heroGreeting: {
    color: '#fff', fontSize: 26,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.6,
    marginBottom: 4,
  },
  heroDate: {
    color: 'rgba(255,255,255,0.6)', fontSize: 12,
    fontFamily: 'Nunito_600SemiBold', letterSpacing: 0.3,
    textTransform: 'capitalize', marginBottom: spacing.md,
  },
  heroLocBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  heroLocText: {
    color: 'rgba(255,255,255,0.85)', fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
  },

  // Right column weather
  heroTempNum: {
    color: '#fff', fontSize: 48,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -2,
    lineHeight: 52,
  },
  heroFishingLabel: {
    fontSize: 10, fontFamily: 'Nunito_700Bold',
    marginTop: 4, textAlign: 'right',
  },

  // Meta row (wind / humidity / moon) as glass pills
  heroMetaRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10,
    marginTop: spacing.sm,
  },
  heroMetaItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5,
  },
  heroMetaDivider: {
    width: 1, height: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  heroMetaText: {
    color: 'rgba(255,255,255,0.82)', fontSize: 11,
    fontFamily: 'Nunito_600SemiBold',
  },

  // ─── Wave ────────────────────────────────────────────────────────
  wave: {
    borderTopLeftRadius: WAVE, borderTopRightRadius: WAVE,
    marginTop: -WAVE, paddingTop: spacing.xl,
  },

  // ─── Section headers ─────────────────────────────────────────────
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionAccent: {
    width: 3, height: 16, borderRadius: 2,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Nunito_700Bold',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  sectionLink: { fontSize: 12, fontFamily: 'Nunito_700Bold' },

  // ─── Big CTA card ────────────────────────────────────────────────
  ctaCard: {
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    borderRadius: 22, height: 80, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
    shadowColor: '#E06400', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45, shadowRadius: 16, elevation: 8,
  },
  ctaCardText: {
    color: '#fff', fontSize: 18,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.4,
  },
  ctaCardSub: {
    color: 'rgba(255,255,255,0.72)', fontSize: 12,
    fontFamily: 'Nunito_600SemiBold', marginTop: 2,
  },

  // Small pill shortcut buttons
  pillRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
  },
  pillBtn: {
    flex: 1, height: 76,
    borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  pillBtnText: { fontSize: 12, fontFamily: 'Nunito_700Bold' },

  // ─── Stats bento grid ────────────────────────────────────────────
  bentoPad: { paddingHorizontal: spacing.xl, marginBottom: spacing.xl },
  bentoRow: { flexDirection: 'row', gap: spacing.sm },
  bentoLeft: {
    flex: 1, borderRadius: 18, padding: spacing.lg,
    borderWidth: 1.5, minHeight: 150,
    justifyContent: 'flex-end', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  bentoRight: { flex: 1, gap: spacing.sm },
  bentoSmall: {
    flex: 1, borderRadius: 18, padding: spacing.md,
    borderWidth: 1.5, justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  bentoFishIcon: {
    position: 'absolute', top: spacing.md, right: spacing.md,
  },
  bentoBigNum: {
    fontSize: 30, fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.8,
  },
  bentoLabel: {
    fontSize: 11, fontFamily: 'Nunito_600SemiBold', marginTop: 2,
  },
  bentoSmallNum: {
    fontSize: 22, fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.5,
  },
  bentoSmallLabel: {
    fontSize: 10, fontFamily: 'Nunito_600SemiBold', marginTop: 1,
  },

  // ─── Dark weather card ───────────────────────────────────────────
  weatherCard: {
    marginHorizontal: spacing.xl, marginBottom: spacing.sm,
    borderRadius: 20, overflow: 'hidden',
    padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 14, elevation: 8,
  },
  weatherCardBg: { ...StyleSheet.absoluteFillObject },
  wcTempRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  wcTemp: { fontSize: 46, fontFamily: 'Nunito_800ExtraBold', color: '#fff', letterSpacing: -2, lineHeight: 52 },
  wcDesc: { fontSize: 13, fontFamily: 'Nunito_600SemiBold', color: 'rgba(255,255,255,0.65)', marginTop: 3, lineHeight: 18 },
  wcLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
  wcLocText: { fontSize: 11, fontFamily: 'Nunito_400Regular', color: 'rgba(255,255,255,0.45)' },
  wcFishRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  wcFishTitle: { fontSize: 11, fontFamily: 'Nunito_700Bold', color: '#fff' },
  wcFishLabel: { fontSize: 10, fontFamily: 'Nunito_600SemiBold', marginTop: 1 },
  wcRatingDots: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  wcDot: { width: 7, height: 7, borderRadius: 3.5 },
  wcGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wcStat: {
    flex: 1, minWidth: '47%' as const,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12, padding: 10,
  },
  wcStatHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  wcStatLabel: { fontSize: 8, fontFamily: 'Nunito_700Bold', color: 'rgba(255,255,255,0.45)', letterSpacing: 0.8 },
  wcStatValue: { fontSize: 20, fontFamily: 'Nunito_800ExtraBold', color: '#fff', letterSpacing: -0.5 },
  wcStatUnit: { fontSize: 12, fontFamily: 'Nunito_600SemiBold', color: 'rgba(255,255,255,0.55)' },
  wcStatSub: { fontSize: 9, fontFamily: 'Nunito_400Regular', color: 'rgba(255,255,255,0.45)', marginTop: 2 },

  // ─── Forecast strip ──────────────────────────────────────────────
  forecastScroll: { marginBottom: spacing.sm },
  fcCard: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 7, borderRadius: 13, minWidth: 52, gap: 2 },
  fcDay: { fontSize: 10, fontFamily: 'Nunito_700Bold' },
  fcDate: { fontSize: 8, fontFamily: 'Nunito_400Regular' },
  fcTemp: { fontSize: 12, fontFamily: 'Nunito_700Bold' },

  // ─── Recent catch cards ──────────────────────────────────────────
  catchCard: {
    width: 120, height: 160, borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  catchEmpty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.sm,
  },

  // ─── Nearest waters list ─────────────────────────────────────────
  nearbyList: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  nearbyIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  nearbyName: { fontSize: 14, fontFamily: 'Nunito_700Bold' },
  nearbyMeta: { fontSize: 11, fontFamily: 'Nunito_400Regular', marginTop: 1 },
  nearbyDistance: { fontSize: 14, fontFamily: 'Nunito_800ExtraBold' },

  // ─── Classics card ───────────────────────────────────────────────
  classicsCard: {
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
    borderRadius: 24, overflow: 'hidden', height: 200,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22, shadowRadius: 16, elevation: 8,
  },
  classicsOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 130, justifyContent: 'flex-end', padding: spacing.md,
  },
  classicsOwner: {
    fontSize: 11, fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255,255,255,0.65)',
  },
  classicsTitle: {
    fontSize: 16, fontFamily: 'Nunito_800ExtraBold',
    color: '#fff', marginTop: 2, marginBottom: 8,
  },
  classicsActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  classicsLike: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  classicsVote: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
  },
  classicsBadge: {
    position: 'absolute', top: spacing.md, left: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFD700',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, elevation: 4,
  },

  // ─── Personal best — cinematic ───────────────────────────────────
  pbCard: {
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
    borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 14, elevation: 8,
  },
  pbCoverImage: { width: '100%', height: 120 },
  pbGradient: {
    position: 'absolute', left: 0, right: 0, top: 0, height: 120,
  },
  pbNoCover: {
    height: 120, alignItems: 'center', justifyContent: 'center',
  },
  pbBody: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.lg, gap: spacing.md,
  },
  pbStats: { flex: 1 },
  pbSpecies: {
    fontSize: 15, fontFamily: 'Nunito_700Bold',
  },
  pbWeight: {
    fontSize: 13, fontFamily: 'Nunito_600SemiBold', marginTop: 2,
  },
  pbDate: {
    fontSize: 11, fontFamily: 'Nunito_400Regular', marginTop: 2,
  },
});

// ── Main component ────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'рибарю';

  const lastFetchRef = useRef<number>(0);
  const [weather, setWeather]           = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [pressureTrend, setPressureTrend] = useState<'up' | 'down' | 'stable'>('stable');
  const [locLabel, setLocLabel]         = useState('София (примерно)');
  const [bestThisMonth, setBestThisMonth] = useState<Catch | null>(null);
  const [topClassic, setTopClassic]     = useState<RankedClassicPhoto | null>(null);
  const [forecast, setForecast]         = useState<ForecastDay[]>([]);
  const [refreshing, setRefreshing]     = useState(false);
  const [unreadMsgs, setUnreadMsgs]     = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [recentCatches, setRecentCatches] = useState<Catch[]>([]);
  // Catches from the same month/day in prior years — powers the
  // "В този ден" memory section. Empty until the user has at least one
  // year of history on this calendar day.
  const [thisDayCatches, setThisDayCatches] = useState<Catch[]>([]);
  const [userCoord, setUserCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [followingCount, setFollowingCount] = useState(0);
  const [catchCount, setCatchCount] = useState(0);
  // ── "Today" hub data ────────────────────────────────────────────
  const [followingCatches, setFollowingCatches] = useState<CloudCatch[]>([]);
  const [activeTournaments, setActiveTournaments] = useState<Tournament[]>([]);
  // ── Data loading ────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    const list = await catchesStore.list();
    setCatchCount(list.length);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthList  = list.filter((c) => { const t = Date.parse(c.date); return !isNaN(t) && t >= monthStart; });
    setBestThisMonth(
      monthList.reduce<Catch | null>((best, c) => (!best || (c.weightKg ?? 0) > (best.weightKg ?? 0) ? c : best), null)
    );

    setRecentCatches(
      list
        .filter((c) => !isNaN(Date.parse(c.date)))
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        .slice(0, 6),
    );

    // "В този ден" — catches on this same calendar day in prior years.
    // Match by month+day, exclude the current year so today's catches
    // (already in Recent) don't double-up. Sort most-recent-year first.
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    const currentYear = today.getFullYear();
    const sameDay = list.filter((c) => {
      const t = Date.parse(c.date);
      if (isNaN(t)) return false;
      const d = new Date(t);
      return d.getMonth() === todayMonth && d.getDate() === todayDate && d.getFullYear() !== currentYear;
    }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    setThisDayCatches(sameDay.slice(0, 8));

    fetchRankedClassicPhotos(periodStartIso('week'), { maxCandidates: 20, resultLimit: 1 })
      .then((r) => setTopClassic(r[0] ?? null))
      .catch(() => {});

    if (user && configured) {
      getFollowingCount(user.uid).then(setFollowingCount).catch(() => setFollowingCount(0));
    } else {
      setFollowingCount(0);
    }
  }, [user, configured]);

  /** Loads the "Today" hub data — catches from people the user follows + their
      active tournament countdowns. Both are best-effort and silently empty out
      on failure (Firestore unavailable, no follows, no joined tournaments). */
  const loadTodayHub = useCallback(async () => {
    if (!user || !configured) {
      setFollowingCatches([]);
      setActiveTournaments([]);
      return;
    }
    try {
      const following = await getFollowing(user.uid);
      const followingUids = following.map((f) => f.uid).filter(Boolean);
      if (followingUids.length === 0) {
        setFollowingCatches([]);
      } else {
        const page = await fetchPublicFeed(12, undefined, followingUids).catch(() => null);
        setFollowingCatches(page?.items ?? []);
      }
    } catch {
      setFollowingCatches([]);
    }
    try {
      const tours = await fetchMyActiveTournaments(user.uid);
      setActiveTournaments(tours);
    } catch {
      setActiveTournaments([]);
    }
  }, [user, configured]);

  const loadWeather = useCallback(async () => {
    setWeatherStatus('loading');
    let lat = FALLBACK_COORD.latitude, lng = FALLBACK_COORD.longitude, label = 'София (примерно)';
    let granted = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude; lng = pos.coords.longitude; label = 'Твоето местоположение';
        granted = true;
      }
    } catch { /* use fallback */ }
    setLocLabel(label);
    setUserCoord(granted ? { latitude: lat, longitude: lng } : { latitude: FALLBACK_COORD.latitude, longitude: FALLBACK_COORD.longitude });
    try {
      const [w, days] = await Promise.all([
        fetchWeather(lat, lng),
        fetchForecast(lat, lng).catch(() => [] as ForecastDay[]),
      ]);
      setWeather(w); setForecast(days); setWeatherStatus('idle');
      AsyncStorage.getItem('@ribolov/lastPressure').then((v) => {
        const last = v ? parseFloat(v) : null;
        if (last !== null) {
          const diff = w.pressureHpa - last;
          setPressureTrend(diff > 1.5 ? 'up' : diff < -1.5 ? 'down' : 'stable');
        }
        AsyncStorage.setItem('@ribolov/lastPressure', String(w.pressureHpa)).catch(() => {});
      }).catch(() => {});
      scheduleForecastNotificationIfGood(days).catch(() => {});
    } catch { setWeather(null); setWeatherStatus('error'); }
  }, []);

  useFocusEffect(useCallback(() => {
    const STALE = 5 * 60 * 1000;
    const task = InteractionManager.runAfterInteractions(() => {
      const now = Date.now();
      if (now - lastFetchRef.current < STALE) return;
      lastFetchRef.current = now;
      loadStats(); loadWeather(); loadTodayHub();
    });
    return () => task.cancel();
  }, [loadStats, loadWeather, loadTodayHub]));

  useEffect(() => {
    if (!user || !configured) {
      setUnreadMsgs(0);
      setUnreadNotifs(0);
      return;
    }
    const unsubMsgs   = subscribeUnreadMessagesCount(user.uid, setUnreadMsgs);
    const unsubNotifs  = subscribeMyNotifications(user.uid, (items) =>
      setUnreadNotifs(items.filter((n) => !n.read).length)
    );
    return () => { unsubMsgs(); unsubNotifs(); };
  }, [user, configured]);

  // Reset the focus-effect throttle when auth identity changes so the next
  // focus re-fetches stats/follows for the new user instead of skipping under
  // the 5-minute STALE window.
  useEffect(() => {
    lastFetchRef.current = 0;
  }, [user?.uid]);

  const onRefresh = async () => {
    lastFetchRef.current = 0;
    setRefreshing(true);
    await Promise.all([loadStats(), loadWeather(), loadTodayHub()]);
    setRefreshing(false);
  };

  // ── Derived values ──────────────────────────────────────────────

  const dateStr = useMemo(() =>
    new Date().toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' }), []);

  const heroGrad: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#4EAEE0', '#1E7CC4', '#0D559A'];

  const waveColor  = mode === 'dark' ? '#080E1A' : '#F2F8FF';
  const cardBg     = mode === 'dark' ? '#0E1E35' : '#FFFFFF';
  const cardBorder = mode === 'dark' ? 'rgba(74,168,232,0.15)' : 'rgba(21,112,184,0.10)';
  const textColor  = colors.text;
  const mutedColor = colors.textMuted;
  const primary    = colors.primary;
  const accent     = colors.accent;

  const fLabel = weather ? fishingLabel(weather.fishingRating) : null;

  // Top 3 closest dams / rivers — only meaningful once we have a coord
  const nearestWaters = useMemo(() => {
    if (!userCoord) return [];
    const all = [
      ...DAMS.map((d) => ({ kind: 'dam' as const, id: d.id, name: d.name, region: d.region, latitude: d.latitude, longitude: d.longitude })),
      ...RIVERS.map((r) => ({ kind: 'river' as const, id: r.id, name: r.name, region: r.region, latitude: r.latitude, longitude: r.longitude })),
    ];
    return all
      .map((w) => ({ ...w, km: haversineKm(userCoord.latitude, userCoord.longitude, w.latitude, w.longitude) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
  }, [userCoord]);

  // ── Render ──────────────────────────────────────────────────────

  // Compose action sheet — surfaced both from the existing big CTA card
  // (which still goes straight to AddCatch) and from a new floating FAB
  // that lets the user pick post vs catch from anywhere on the screen.
  const openComposeSheet = useCallback(() => {
    if (!user || !configured) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheet.show({
      title: 'Какво искаш да споделиш?',
      options: [
        {
          label: 'Сподели улов',
          icon: 'fish-outline',
          onPress: () => (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} }),
        },
        {
          label: 'Напиши пост',
          icon: 'create-outline',
          onPress: () => (navigation as any).navigate('FeedTab', { screen: 'CreatePost' }),
        },
      ],
    });
  }, [user, configured, navigation]);

  return (
    <View style={{ flex: 1 }}>
    <Screen
      scroll padded={false}
      scrollProps={{ refreshControl: <FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> }}
    >

      {/* ════════════════════════════════════════
          HERO — split layout
      ════════════════════════════════════════ */}
      <View style={S.hero}>
        <LinearGradient colors={heroGrad} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={S.heroBg} pointerEvents="none" />
        <View style={S.heroInner}>

          {/* App bar */}
          <View style={S.heroBar}>
            <View style={S.heroBrand}>
              <View style={S.heroLogoWrap}>
                <Ionicons name="fish-outline" size={20} color="#fff" />
              </View>
              <View>
                <Text style={S.heroAppName}>РИБОЛОВ</Text>
                <Text style={S.heroAppSub}>Твоят дневник</Text>
              </View>
            </View>
            <View style={S.heroIcons}>
              <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Chats' })} hitSlop={12}>
                <BadgeIcon name="chatbubble-outline" size={23} color="rgba(255,255,255,0.9)" count={unreadMsgs} />
              </Pressable>
              <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Notifications' })} hitSlop={12}>
                <BadgeIcon name="notifications-outline" size={23} color="rgba(255,255,255,0.9)" count={unreadNotifs} />
              </Pressable>
            </View>
          </View>

          {/* Split: left greeting + right weather temp */}
          <View style={S.heroSplit}>

            {/* Left 60% */}
            <View style={S.heroLeft}>
              <Text style={S.heroGreeting}>{greeting()},{'\n'}{firstName}!</Text>
              <Text style={S.heroDate}>{dateStr}</Text>
              <View style={S.heroLocBadge}>
                <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.8)" />
                <Text style={S.heroLocText} numberOfLines={1}>{locLabel}</Text>
              </View>
            </View>

            {/* Right 40% — temperature + weather icon + fishing label */}
            <View style={S.heroRight}>
              {weatherStatus === 'loading' && !weather ? (
                <ActivityIndicator color="rgba(255,255,255,0.7)" style={{ marginTop: 8 }} />
              ) : weather ? (
                <>
                  <WeatherIcon weatherCode={weather.weatherCode} size={36} color="rgba(255,255,255,0.9)" />
                  <Text style={S.heroTempNum}>{weather.temperatureC}°</Text>
                  {fLabel && (
                    <Text style={[S.heroFishingLabel, { color: fLabel.color }]} numberOfLines={2}>
                      {fLabel.text}
                    </Text>
                  )}
                </>
              ) : null}
            </View>
          </View>

          {/* Meta row: wind / humidity / moon — full width glass bar */}
          {weather && (
            <View style={S.heroMetaRow}>
              <View style={S.heroMetaItem}>
                <Ionicons name="flag-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={S.heroMetaText}>{weather.windKmh} км/ч</Text>
              </View>
              <View style={S.heroMetaDivider} />
              <View style={S.heroMetaItem}>
                <Ionicons name="water-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={S.heroMetaText}>{weather.humidity}%</Text>
              </View>
              <View style={S.heroMetaDivider} />
              <View style={S.heroMetaItem}>
                <Text style={S.heroMetaText}>{moonPhaseEmoji(weather.moonPhaseName)}</Text>
                <Text style={S.heroMetaText}>{weather.moonPhaseName}</Text>
              </View>
            </View>
          )}
          {weatherStatus === 'loading' && !weather && (
            <View style={[S.heroMetaRow, { justifyContent: 'center' }]}>
              <ActivityIndicator color="rgba(255,255,255,0.5)" size="small" />
            </View>
          )}
        </View>
      </View>

      {/* ════════════════════════════════════════
          CONTENT — rises over hero (wave effect)
      ════════════════════════════════════════ */}
      <View style={[S.wave, { backgroundColor: waveColor }]}>

        {/* ── Onboarding checklist (hides itself once all steps complete or user dismisses) ── */}
        {user && configured ? (
          <OnboardingChecklist
            hasProfilePhoto={!!user.photoURL}
            catchCount={catchCount}
            followingCount={followingCount}
          />
        ) : null}

        {/* ── Big CTA card ── */}
        <ScalePressable
          style={S.ctaCard}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
            navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
          }}
          android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
        >
          <LinearGradient
            colors={['#F5A020', '#E05E00']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Ionicons name="add-circle-outline" size={32} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={S.ctaCardText}>Запиши нов улов</Text>
            <Text style={S.ctaCardSub}>Добави улов в дневника</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
        </ScalePressable>

        {/* ── Pill shortcut row — calm surface cards, single accent ── */}
        <View style={S.pillRow}>
          {[
            { icon: 'compass' as const, label: 'Места', onPress: () => navigation.navigate('MapTab') },
            { icon: 'telescope' as const, label: 'Лента', onPress: () => navigation.navigate('FeedTab', { screen: 'FeedList' }) },
            { icon: 'people' as const, label: 'Приятели', onPress: () => navigation.navigate('FeedTab', { screen: 'Friends' }) },
          ].map((p) => (
            <ScalePressable
              key={p.label}
              style={[S.pillBtn, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={p.onPress}
            >
              <Ionicons name={p.icon} size={24} color={primary} />
              <Text style={[S.pillBtnText, { color: textColor }]}>{p.label}</Text>
            </ScalePressable>
          ))}
        </View>

        {/* ── Dark weather card ── */}
        {(weather || weatherStatus === 'loading') && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: primary }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Прогноза</Text>
              </View>
              <Pressable onPress={() => navigation.navigate('MapTab')} hitSlop={8}>
                <Text style={[S.sectionLink, { color: primary }]}>Виж на картата →</Text>
              </Pressable>
            </View>

            {/* ── Species suggestions tip ── */}
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

            <Pressable style={S.weatherCard} onPress={() => navigation.navigate('MapTab')}>
              {/* Always dark blue background */}
              <LinearGradient
                colors={['#0A1828', '#0D2240']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={S.weatherCardBg}
              />

              {weatherStatus === 'loading' && !weather ? (
                <View style={{ gap: 10 }}>
                  <Skeleton height={48} width="60%" />
                  <Skeleton height={74} width="100%" style={{ borderRadius: 14 }} />
                </View>
              ) : weather ? (
                <>
                  {/* Top shimmer */}
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.13)' }} />

                  {/* Temperature row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.11)', borderRadius: 14, padding: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
                      <WeatherIcon weatherCode={weather.weatherCode} size={32} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
                        <Text style={{ fontSize: 40, fontFamily: 'Nunito_800ExtraBold', color: '#fff', letterSpacing: -2, lineHeight: 44 }}>{weather.temperatureC}</Text>
                        <Text style={{ fontSize: 17, fontFamily: 'Nunito_600SemiBold', color: 'rgba(255,255,255,0.55)', marginBottom: 7 }}>°C</Text>
                      </View>
                      <Text style={{ fontSize: 12, fontFamily: 'Nunito_600SemiBold', color: 'rgba(255,255,255,0.65)' }}>{weather.description} · Усеща се {weather.feelsLikeC}°</Text>
                    </View>
                    {/* Fishing score pill — top-right */}
                    {fLabel && (
                      <View style={{ alignItems: 'center', gap: 3 }}>
                        <View style={{ backgroundColor: fLabel.color + '28', borderRadius: 10, borderWidth: 1, borderColor: fLabel.color + '55', paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 15, fontFamily: 'Nunito_800ExtraBold', color: fLabel.color }}>{weather.fishingRating}<Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>/5</Text></Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 3 }}>
                          {[1,2,3,4,5].map(i => (
                            <View key={i} style={{ width: 10, height: 3, borderRadius: 1.5, backgroundColor: i <= weather.fishingRating ? fLabel.color : 'rgba(255,255,255,0.15)' }} />
                          ))}
                        </View>
                        <Text style={{ fontSize: 8, fontFamily: 'Nunito_600SemiBold', color: fLabel.color }}>{fLabel.text}</Text>
                      </View>
                    )}
                  </View>

                  {/* Stats — single horizontal row of 4 */}
                  <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                    {[
                      { iconName: 'flag' as const,         iconColor: '#52A8F0', bg: 'rgba(82,168,240,0.18)',   label: 'ВЯТЪР',    value: `${weather.windKmh}`, unit: 'км/ч', sub: windDirectionLabel(weather.windDirection) },
                      { iconName: 'speedometer' as const,  iconColor: '#50C8B4', bg: 'rgba(80,200,180,0.18)',   label: 'НАЛЯГАНЕ', value: `${weather.pressureHpa}`, unit: 'hPa', sub: pressureTrend === 'up' ? 'Расте ↑' : pressureTrend === 'down' ? 'Пада ↓' : 'Стабилно' },
                      { iconName: 'rainy' as const,        iconColor: '#64AAE6', bg: 'rgba(100,170,230,0.18)',  label: 'ДЪЖД',     value: `${weather.precipitationProbability}`, unit: '%', sub: 'вероятност' },
                    ].map(({ iconName, iconColor, bg, label, value, unit, sub }, idx) => (
                      <React.Fragment key={label}>
                        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 3 }}>
                          <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name={iconName} size={13} color={iconColor} />
                          </View>
                          <Text style={{ fontSize: 8, fontFamily: 'Nunito_700Bold', color: 'rgba(255,255,255,0.38)', letterSpacing: 0.5 }}>{label}</Text>
                          <Text style={{ fontSize: 14, fontFamily: 'Nunito_800ExtraBold', color: '#fff', letterSpacing: -0.3 }} numberOfLines={1}>{value}<Text style={{ fontSize: 9, fontFamily: 'Nunito_400Regular', color: 'rgba(255,255,255,0.45)' }}>{unit}</Text></Text>
                          <Text style={{ fontSize: 9, fontFamily: 'Nunito_400Regular', color: 'rgba(255,255,255,0.38)' }} numberOfLines={1}>{sub}</Text>
                        </View>
                        <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 8 }} />
                      </React.Fragment>
                    ))}
                    {/* Moon cell */}
                    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 3 }}>
                      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(160,120,220,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 13 }}>{moonPhaseEmoji(weather.moonPhaseName)}</Text>
                      </View>
                      <Text style={{ fontSize: 8, fontFamily: 'Nunito_700Bold', color: 'rgba(255,255,255,0.38)', letterSpacing: 0.5 }}>ЛУНА</Text>
                      <Text style={{ fontSize: 14, fontFamily: 'Nunito_800ExtraBold', color: '#fff' }} numberOfLines={1}>{Math.round((1 - Math.abs(0.5 - weather.moonPhase) * 2) * 100)}<Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontFamily: 'Nunito_400Regular' }}>%</Text></Text>
                      <Text style={{ fontSize: 9, fontFamily: 'Nunito_400Regular', color: 'rgba(255,255,255,0.38)' }} numberOfLines={1}>{weather.moonPhaseName}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </Pressable>

            {/* 7-day forecast */}
            {(forecast.length > 0 || weatherStatus === 'loading') && (
              <ScrollView
                horizontal showsHorizontalScrollIndicator={false}
                style={[S.forecastScroll, { marginBottom: spacing.xl }]}
                contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: 4 }}
              >
                {forecast.length === 0
                  ? [0,1,2,3,4,5,6].map((i) => <Skeleton key={i} width={52} height={88} style={{ borderRadius: 13 }} />)
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
                            {[1,2,3,4,5].map(i => (
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
        )}

        {/* ── Bite forecast for today (uses existing component) ── */}
        {weather && (
          <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: primary }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Прогноза за хапки</Text>
              </View>
            </View>
            <BiteForecast weather={weather} />
          </View>
        )}

        {/* ── Active tournaments — countdown to soonest ending ── */}
        {activeTournaments.length > 0 && (
          <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: '#E8902E' }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Твои турнири</Text>
              </View>
              {activeTournaments.length > 1 ? (
                <Pressable
                  onPress={() => (navigation as any).navigate('ProfileTab', { screen: 'Tournaments' })}
                  hitSlop={8}
                >
                  <Text style={[S.sectionLink, { color: primary }]}>Виж всички →</Text>
                </Pressable>
              ) : null}
            </View>
            {activeTournaments.slice(0, 2).map((t) => {
              const daysLeft = t.endDate
                ? Math.max(0, Math.ceil((Date.parse(t.endDate + 'T23:59:59') - Date.now()) / 86_400_000))
                : null;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => (navigation as any).navigate('ProfileTab', { screen: 'TournamentDetail', params: { id: t.id } })}
                  style={{
                    backgroundColor: cardBg,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: cardBorder,
                    padding: spacing.md,
                    marginBottom: spacing.sm,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                  }}
                >
                  <View style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: 'rgba(232,144,46,0.16)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="trophy" size={22} color="#E8902E" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.bodyBold, color: textColor }} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={{ ...typography.caption, color: mutedColor, marginTop: 2 }} numberOfLines={1}>
                      {daysLeft === 0
                        ? 'Завършва днес'
                        : daysLeft === 1
                        ? 'Остава 1 ден'
                        : daysLeft != null
                        ? `Остават ${daysLeft} дни`
                        : 'Активен'}
                      {t.speciesName ? ` · ${t.speciesName}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={mutedColor} />
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ── В този ден (this day in history) ── */}
        {thisDayCatches.length > 0 && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: '#E8902E' }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>В този ден</Text>
              </View>
            </View>
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
            >
              {thisDayCatches.map((c) => {
                const yearsAgo = new Date().getFullYear() - new Date(c.date).getFullYear();
                const ageLabel = yearsAgo === 1 ? 'преди 1 година' : `преди ${yearsAgo} години`;
                return (
                  <Pressable
                    key={c.id}
                    style={[S.catchCard, { backgroundColor: c.photoUri ? 'transparent' : (mode === 'dark' ? '#0E1E35' : colors.primarySurface) }]}
                    onPress={() => navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })}
                  >
                    {c.photoUri ? (
                      <>
                        <Image source={{ uri: c.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
                        <LinearGradient
                          colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.78)']}
                          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                        <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(232,144,46,0.95)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
                          <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'Nunito_700Bold', letterSpacing: 0.3 }} numberOfLines={1}>{ageLabel}</Text>
                        </View>
                        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
                          <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Nunito_700Bold' }} numberOfLines={1}>{c.speciesName}</Text>
                          {c.weightKg != null ? (
                            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>{c.weightKg} кг</Text>
                          ) : null}
                        </View>
                      </>
                    ) : (
                      <View style={S.catchEmpty}>
                        <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: '#E8902E', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
                          <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'Nunito_700Bold', letterSpacing: 0.3 }} numberOfLines={1}>{ageLabel}</Text>
                        </View>
                        <Text style={{ fontSize: 28 }}>🐟</Text>
                        <Text style={{ fontSize: 10, color: textColor, fontFamily: 'Nunito_600SemiBold', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>
                          {c.speciesName}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* ── Following catches — fresh activity from anglers you follow ── */}
        {followingCatches.length > 0 && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: primary }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>От твоите приятели</Text>
              </View>
              <Pressable onPress={() => (navigation as any).navigate('FeedTab')} hitSlop={8}>
                <Text style={[S.sectionLink, { color: primary }]}>Към лентата →</Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
            >
              {followingCatches.map((c) => (
                <Pressable
                  key={c.id}
                  style={[S.catchCard, { backgroundColor: c.photoUri ? 'transparent' : (mode === 'dark' ? '#0E1E35' : colors.primarySurface) }]}
                  onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })}
                >
                  {c.photoUri ? (
                    <>
                      <Image source={{ uri: c.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
                      <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.78)']}
                        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 92, justifyContent: 'flex-end', padding: 10 }}
                      >
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10, fontFamily: 'Nunito_600SemiBold' }} numberOfLines={1}>
                          {c.ownerName ?? 'Рибар'}
                        </Text>
                        <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Nunito_700Bold', marginTop: 1 }} numberOfLines={1}>
                          {c.speciesName}
                        </Text>
                        {c.weightKg != null ? (
                          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>{c.weightKg} кг</Text>
                        ) : null}
                      </LinearGradient>
                    </>
                  ) : (
                    <View style={S.catchEmpty}>
                      <Text style={{ fontSize: 28 }}>🐟</Text>
                      <Text style={{ fontSize: 10, color: textColor, fontFamily: 'Nunito_600SemiBold', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>
                        {c.speciesName}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Nearest water bodies ── */}
        {nearestWaters.length > 0 && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: primary }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Най-близки водоеми</Text>
              </View>
              <Pressable onPress={() => navigation.navigate('MapTab')} hitSlop={8}>
                <Text style={[S.sectionLink, { color: primary }]}>Виж карта →</Text>
              </Pressable>
            </View>
            <View style={S.nearbyList}>
              {nearestWaters.map((w) => (
                <ScalePressable
                  key={`${w.kind}-${w.id}`}
                  style={[S.nearbyRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
                  onPress={() => navigation.navigate('MapTab', w.kind === 'dam' ? { focusDamId: w.id } : { focusRiverId: w.id })}
                >
                  <View style={[S.nearbyIconWrap, { backgroundColor: colors.primarySurface }]}>
                    <Ionicons name={w.kind === 'dam' ? 'layers-outline' : 'git-branch-outline'} size={20} color={primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[S.nearbyName, { color: textColor }]} numberOfLines={1}>{w.name}</Text>
                    <Text style={[S.nearbyMeta, { color: mutedColor }]} numberOfLines={1}>
                      {w.kind === 'dam' ? 'Язовир' : 'Река'} · {w.region}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[S.nearbyDistance, { color: primary }]}>{Math.round(w.km)} км</Text>
                  </View>
                </ScalePressable>
              ))}
            </View>
          </>
        )}

        {/* ── Recent catches ── */}
        {recentCatches.length > 0 && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: primary }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Недавни улови</Text>
              </View>
              <Pressable onPress={() => navigation.navigate('LogbookTab', { screen: 'LogbookList' })} hitSlop={8}>
                <Text style={[S.sectionLink, { color: primary }]}>Виж всички →</Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
            >
              {recentCatches.map((c) => (
                <Pressable
                  key={c.id}
                  style={[S.catchCard, { backgroundColor: c.photoUri ? 'transparent' : (mode === 'dark' ? '#0E1E35' : colors.primarySurface) }]}
                  onPress={() => navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })}
                >
                  {c.photoUri ? (
                    <>
                      <Image source={{ uri: c.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
                      <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.75)']}
                        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, justifyContent: 'flex-end', padding: 10 }}
                      >
                        <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Nunito_700Bold' }} numberOfLines={1}>{c.speciesName}</Text>
                        {c.weightKg != null && <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>{c.weightKg} кг</Text>}
                      </LinearGradient>
                    </>
                  ) : (
                    <View style={S.catchEmpty}>
                      <Text style={{ fontSize: 28 }}>🐟</Text>
                      <Text style={{ fontSize: 10, color: textColor, fontFamily: 'Nunito_600SemiBold', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>{c.speciesName}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Featured angler of the week ── */}
        <FeaturedAnglerCard />

        {/* ── Classics highlight ── */}
        {topClassic?.item.photoUri && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: '#FFD700' }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Снимка на седмицата</Text>
              </View>
              <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Classics' })} hitSlop={8}>
                <Text style={[S.sectionLink, { color: primary }]}>Класики →</Text>
              </Pressable>
            </View>
            <Pressable style={S.classicsCard} onPress={() => navigation.navigate('ProfileTab', { screen: 'Classics' })}>
              <Image source={{ uri: topClassic.item.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={S.classicsOverlay}>
                <Text style={S.classicsOwner}>{topClassic.item.ownerName ?? 'Рибар'}</Text>
                <Text style={S.classicsTitle} numberOfLines={1}>{topClassic.item.photoTitle ?? topClassic.item.speciesName}</Text>
                <View style={S.classicsActions}>
                  <View style={S.classicsLike}>
                    <Ionicons name="heart" size={12} color="#ff6b6b" />
                    <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: '#fff' }}>{topClassic.likes}</Text>
                  </View>
                  <View style={[S.classicsVote, { backgroundColor: accent }]}>
                    <Ionicons name="heart-outline" size={12} color="#fff" />
                    <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: '#fff' }}>Гласувай</Text>
                  </View>
                </View>
              </LinearGradient>
              <View style={S.classicsBadge}>
                <Text style={{ fontSize: 13 }}>🥇</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Nunito_800ExtraBold', color: '#2a1800' }}>ПОБЕДИТЕЛ</Text>
              </View>
            </Pressable>
          </>
        )}

        {/* ── Personal best — cinematic card ── */}
        {bestThisMonth && (
          <>
            <View style={S.sectionRow}>
              <View style={S.sectionLeft}>
                <View style={[S.sectionAccent, { backgroundColor: accent }]} />
                <Text style={[S.sectionLabel, { color: mutedColor }]}>Личен рекорд — този месец</Text>
              </View>
            </View>
            <Pressable
              style={[S.pbCard, { backgroundColor: cardBg }]}
              onPress={() => navigation.navigate('LogbookTab', { screen: 'LogbookList' })}
            >
              {bestThisMonth.photoUri ? (
                <>
                  <Image
                    source={{ uri: bestThisMonth.photoUri }}
                    style={S.pbCoverImage}
                    contentFit="cover"
                  />
                  <LinearGradient
                    colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                    style={S.pbGradient}
                  />
                </>
              ) : (
                <LinearGradient
                  colors={[primary + '33', primary + '11']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={S.pbNoCover}
                >
                  <Text style={{ fontSize: 44 }}>🏆</Text>
                  {bestThisMonth.weightKg != null && (
                    <Text style={{ fontSize: 22, fontFamily: 'Nunito_800ExtraBold', color: accent, marginTop: 4 }}>
                      {bestThisMonth.weightKg} кг
                    </Text>
                  )}
                </LinearGradient>
              )}
              <View style={[S.pbBody, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cardBorder }]}>
                <View style={S.pbStats}>
                  <Text style={[S.pbSpecies, { color: textColor }]}>{bestThisMonth.speciesName}</Text>
                  <Text style={[S.pbWeight, { color: accent }]}>
                    {bestThisMonth.weightKg != null ? `${bestThisMonth.weightKg} кг` : '—'}
                    {bestThisMonth.lengthCm != null ? ` · ${bestThisMonth.lengthCm} см` : ''}
                  </Text>
                  <Text style={[S.pbDate, { color: mutedColor }]}>
                    {new Date(bestThisMonth.date).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={mutedColor} />
              </View>
            </Pressable>
          </>
        )}

        <View style={{ height: spacing.xxl }} />
      </View>
    </Screen>
    {/* Floating compose button — outside Screen so it stays pinned while
        the rest of the page scrolls. Hidden until auth is configured. */}
    {user && configured ? (
      <Pressable
        onPress={openComposeSheet}
        accessibilityRole="button"
        accessibilityLabel="Сподели"
        style={{
          position: 'absolute',
          right: spacing.lg,
          bottom: 100,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: '#F5A020',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>
    ) : null}
    </View>
  );
}
