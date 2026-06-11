import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, InteractionManager, Linking } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Screen } from '../components/Screen';
import { useAuth } from '../services/authContext';
import AsyncStorage from '../storage/kv';
import { fetchWeather, fetchForecast, type WeatherSnapshot, type ForecastDay } from '../services/weather';
import { catchesStore } from '../storage/storage';
import { fetchRankedClassicPhotos, periodStartIso, type RankedClassicPhoto } from '../services/classicsContest';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { haversineKm } from '../services/leaderboards';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { getFollowingCount, getFollowing } from '../services/social';
import { fetchPublicFeed, type CloudCatch } from '../services/catchSync';
import { fetchMyActiveTournaments } from '../services/tournaments';
import type { Tournament } from '../types';
import { scheduleForecastNotificationIfGood } from '../services/pushNotifications';
import { useUnreadMessagesCount } from '../hooks/useUnreadMessagesCount';
import { useUnreadNotifCount } from '../hooks/useUnreadNotifCount';
import type { Catch } from '../types/index';
import { ComposeFab } from '../components/ComposeFab';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { spacing } from '../theme/typography';

import { useHomeTheme } from './home/useHomeTheme';
import type { HomeSection } from './home/types';
import { HomeTopBar } from './home/sections/HomeTopBar';
import { ConditionsCard } from './home/sections/ConditionsCard';
import { StatTileRow } from './home/sections/StatTileRow';
import { MoreLinksSection } from './home/sections/MoreLinksSection';
import { TournamentsSection } from './home/sections/TournamentsSection';
import { ThisDayRail } from './home/sections/ThisDayRail';
import { FollowingSection } from './home/sections/FollowingSection';
import { NearestWaterSection, type NearestWater } from './home/sections/NearestWaterSection';
import { RecentCatchesSection } from './home/sections/RecentCatchesSection';
import { CommunitySection } from './home/sections/CommunitySection';

const FALLBACK_COORD = { latitude: 42.6977, longitude: 23.3219 };

// ── Main component ────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user, configured } = useAuth();
  const { bg } = useHomeTheme();
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'рибарю';

  const lastFetchRef = useRef<number>(0);
  const [weather, setWeather]           = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [, setPressureTrend] = useState<'up' | 'down' | 'stable'>('stable');
  const [locLabel, setLocLabel]         = useState('София (примерно)');
  const [bestThisMonth, setBestThisMonth] = useState<Catch | null>(null);
  const [topClassic, setTopClassic]     = useState<RankedClassicPhoto | null>(null);
  const [forecast, setForecast]         = useState<ForecastDay[]>([]);
  const [refreshing, setRefreshing]     = useState(false);
  // Badge counts via the ref-counted hooks — these share a single Firestore
  // listener per uid with RootNavigator's tab-bar badge (which uses the same
  // hooks). See useUnreadNotifCount.ts for the cache rationale.
  const unreadMsgs = useUnreadMessagesCount(user?.uid);
  const unreadNotifs = useUnreadNotifCount(user?.uid);
  const [recentCatches, setRecentCatches] = useState<Catch[]>([]);
  // Catches from the same month/day in prior years — powers the "В този ден"
  // memory section. Empty until the user has at least one year of history.
  const [thisDayCatches, setThisDayCatches] = useState<Catch[]>([]);
  const [userCoord, setUserCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [followingCount, setFollowingCount] = useState(0);
  const [catchCount, setCatchCount] = useState(0);
  // ── "Today" hub data ────────────────────────────────────────────
  const [followingCatches, setFollowingCatches] = useState<CloudCatch[]>([]);
  const [activeTournaments, setActiveTournaments] = useState<Tournament[]>([]);
  // Initial-load flags so the catch rails show skeletons on cold load rather
  // than flashing their empty CTA before data lands. They flip true after the
  // first load and stay true for the session (refresh uses the pull spinner).
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [hubLoaded, setHubLoaded] = useState(false);
  // ── Data loading ────────────────────────────────────────────────

  const loadStats = useCallback(async (isCancelled: () => boolean = () => false) => {
    const list = await catchesStore.list();
    if (isCancelled()) return;
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
      .then((r) => { if (!isCancelled()) setTopClassic(r[0] ?? null); })
      .catch(() => {});

    if (user && configured) {
      getFollowingCount(user.uid)
        .then((n) => { if (!isCancelled()) setFollowingCount(n); })
        .catch(() => { if (!isCancelled()) setFollowingCount(0); });
    } else {
      if (!isCancelled()) setFollowingCount(0);
    }
    if (!isCancelled()) setStatsLoaded(true);
  }, [user, configured]);

  /** Loads the "Today" hub data — catches from people the user follows + their
      active tournament countdowns. Both are best-effort and silently empty out
      on failure (Firestore unavailable, no follows, no joined tournaments). */
  const loadTodayHub = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!user || !configured) {
      if (!isCancelled()) {
        setFollowingCatches([]);
        setActiveTournaments([]);
        setHubLoaded(true);
      }
      return;
    }
    try {
      const following = await getFollowing(user.uid);
      if (isCancelled()) return;
      const followingUids = following.map((f) => f.uid).filter(Boolean);
      if (followingUids.length === 0) {
        setFollowingCatches([]);
      } else {
        const page = await fetchPublicFeed(12, undefined, followingUids).catch(() => null);
        if (isCancelled()) return;
        setFollowingCatches(page?.items ?? []);
      }
    } catch {
      if (!isCancelled()) setFollowingCatches([]);
    }
    try {
      const tours = await fetchMyActiveTournaments(user.uid);
      if (!isCancelled()) setActiveTournaments(tours);
    } catch {
      if (!isCancelled()) setActiveTournaments([]);
    }
    if (!isCancelled()) setHubLoaded(true);
  }, [user, configured]);

  const loadWeather = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (isCancelled()) return;
    setWeatherStatus('loading');
    let lat = FALLBACK_COORD.latitude, lng = FALLBACK_COORD.longitude, label = 'София (примерно)';
    let granted = false;
    // Read the existing permission status WITHOUT prompting. The permission
    // request itself only fires on the Map tab (where location is essential).
    // Home shows Sofia weather as a soft fallback and silently upgrades to
    // live coords the moment the user grants permission elsewhere.
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (isCancelled()) return;
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (isCancelled()) return;
        lat = pos.coords.latitude; lng = pos.coords.longitude; label = 'Твоето местоположение';
        granted = true;
      }
    } catch { /* use fallback */ }
    if (isCancelled()) return;
    setLocLabel(label);
    setUserCoord(granted ? { latitude: lat, longitude: lng } : { latitude: FALLBACK_COORD.latitude, longitude: FALLBACK_COORD.longitude });
    try {
      const [w, days] = await Promise.all([
        fetchWeather(lat, lng),
        fetchForecast(lat, lng).catch(() => [] as ForecastDay[]),
      ]);
      if (isCancelled()) return;
      setWeather(w); setForecast(days); setWeatherStatus('idle');
      AsyncStorage.getItem('@ribolov/lastPressure').then((v) => {
        if (isCancelled()) return;
        const last = v ? parseFloat(v) : null;
        if (last !== null) {
          const diff = w.pressureHpa - last;
          setPressureTrend(diff > 1.5 ? 'up' : diff < -1.5 ? 'down' : 'stable');
        }
        AsyncStorage.setItem('@ribolov/lastPressure', String(w.pressureHpa)).catch(() => {});
      }).catch(() => {});
      // Gate the forecast push notification too — if the user navigated away
      // before the fetch returned, they don't want a stale "good weather"
      // notification fired on their behalf. The function dedupes itself.
      if (!isCancelled()) scheduleForecastNotificationIfGood(days).catch(() => {});
    } catch {
      if (!isCancelled()) { setWeather(null); setWeatherStatus('error'); }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    const STALE = 5 * 60 * 1000;
    let cancelled = false;
    const isCancelled = () => cancelled;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastFetchRef.current < STALE) return;
      lastFetchRef.current = now;
      void loadStats(isCancelled);
      void loadWeather(isCancelled);
      void loadTodayHub(isCancelled);
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [loadStats, loadWeather, loadTodayHub]));

  // Reset session-scoped state whenever the active user changes so user A's
  // catches/weather/PB/recent feed don't briefly render for user B between
  // sign-in and the next useFocusEffect fetch. Also clears the 5-minute
  // STALE throttle so the next focus actually re-fetches.
  useEffect(() => {
    lastFetchRef.current = 0;
    setWeather(null);
    setWeatherStatus('idle');
    setForecast([]);
    setRecentCatches([]);
    setBestThisMonth(null);
    setThisDayCatches([]);
    setFollowingCount(0);
    setCatchCount(0);
    setFollowingCatches([]);
    setActiveTournaments([]);
    setTopClassic(null);
    setUserCoord(null);
    setPressureTrend('stable');
    setLocLabel('София (примерно)');
    setStatsLoaded(false);
    setHubLoaded(false);
  }, [user?.uid]);

  const onRefresh = async () => {
    lastFetchRef.current = 0;
    setRefreshing(true);
    await Promise.all([loadStats(), loadWeather(), loadTodayHub()]);
    setRefreshing(false);
  };

  /** Empty-state handler for the Nearest-water section: requests Location
      permission (routing to Settings if the user chose "never ask"), and on
      grant resets the fetch throttle + reloads weather/location so the list
      populates without a focus bounce. Lives here because it owns
      `lastFetchRef` and `loadWeather`. */
  const requestLocation = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === 'denied' && !current.canAskAgain) {
      void Linking.openSettings();
      return;
    }
    const req = await Location.requestForegroundPermissionsAsync();
    if (req.status === 'granted') {
      lastFetchRef.current = 0;
      void loadWeather();
    }
  }, [loadWeather]);

  // ── Derived values ──────────────────────────────────────────────

  const dateStr = useMemo(() =>
    new Date().toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' }), []);

  // Top 3 closest dams / rivers — only meaningful once we have a coord
  const nearestWaters = useMemo<NearestWater[]>(() => {
    if (!userCoord) return [];
    const all = [
      ...DAMS.map((d) => ({ kind: 'dam' as const, id: d.id, name: d.name, region: d.region, latitude: d.latitude, longitude: d.longitude })),
      ...RIVERS.map((r) => ({ kind: 'river' as const, id: r.id, name: r.name, region: r.region, latitude: r.latitude, longitude: r.longitude })),
    ];
    return all
      .map((w) => ({ kind: w.kind, id: w.id, name: w.name, region: w.region, km: haversineKm(userCoord.latitude, userCoord.longitude, w.latitude, w.longitude) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
  }, [userCoord]);

  // ── Section list ────────────────────────────────────────────────
  // Order preserved from the pre-FlashList screen. Each section component
  // decides whether it renders anything (returns null when it has no data).
  const sections = useMemo<HomeSection[]>(() => [
    { key: 'onboarding', render: () => (user && configured
      ? <OnboardingChecklist hasProfilePhoto={!!user.photoURL} catchCount={catchCount} followingCount={followingCount} />
      : null) },
    { key: 'conditions', render: () => (
      <ConditionsCard
        weather={weather}
        weatherStatus={weatherStatus}
        forecast={forecast}
        coord={userCoord}
        followingCatches={followingCatches}
        nearestSpotName={nearestWaters[0]?.name ?? null}
        onRetryWeather={() => { void loadWeather(); }}
      />
    ) },
    { key: 'following', render: () => <FollowingSection catches={followingCatches} loading={!hubLoaded} /> },
    { key: 'stats', render: () => <StatTileRow catchCount={catchCount} best={bestThisMonth} /> },
    { key: 'tournaments', render: () => <TournamentsSection tournaments={activeTournaments} /> },
    { key: 'thisDay', render: () => <ThisDayRail catches={thisDayCatches} /> },
    { key: 'recent', render: () => <RecentCatchesSection catches={recentCatches} loading={!statsLoaded} /> },
    { key: 'nearest', render: () => <NearestWaterSection waters={nearestWaters} onRequestLocation={requestLocation} /> },
    { key: 'community', render: () => <CommunitySection classic={topClassic} /> },
    { key: 'more', render: () => <MoreLinksSection /> },
    { key: 'tail', render: () => <View style={{ height: spacing.xxl }} /> },
  ], [
    user, configured, catchCount, followingCount, bestThisMonth, weather, weatherStatus,
    forecast, userCoord, activeTournaments, thisDayCatches, followingCatches, nearestWaters,
    requestLocation, recentCatches, topClassic, statsLoaded, hubLoaded, loadWeather,
  ]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1 }}>
      <Screen padded={false} background={bg}>
        <FlashList
          data={sections}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.key}
          renderItem={({ item }) => item.render()}
          showsVerticalScrollIndicator={false}
          refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <HomeTopBar
              firstName={firstName}
              dateStr={dateStr}
              locLabel={locLabel}
              unreadMsgs={unreadMsgs}
              unreadNotifs={unreadNotifs}
            />
          }
        />
      </Screen>
      {/* Floating compose button — outside Screen so it stays pinned while
          the rest of the page scrolls. Same component as Feed + Logbook. */}
      <ComposeFab />
    </View>
  );
}
