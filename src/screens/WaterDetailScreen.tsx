import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StatusBar,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Button } from '../components/Button';
import type { LeafletMapHandle } from '../components/LeafletMap';
import { MapEngineComponent } from '../components/mapEngineComponent';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { WeatherIcon } from '../components/WeatherIcon';
import { StarRatingBar } from '../components/StarRatingBar';
import { BiteForecast } from '../components/BiteForecast';
import { ForecastStrip } from '../components/ForecastStrip';
import { DamFeedSection } from '../components/DamFeedSection';
import { SharePickerModal, buildSpotSharedRef } from '../components/SharePickerModal';

import { DAMS, type Dam } from '../data/dams';
import { RIVERS, type River } from '../data/rivers';
import { fetchWeather, windDirectionLabel, type WeatherSnapshot } from '../services/weather';
import {
  getWaterReports,
  addWaterReport,
  CONDITION_LABELS,
  type WaterCondition,
  type WaterReport,
} from '../services/fishingReports';
import { getDamLevel, type DamLevel } from '../services/damLevels';
import { fetchDrivingRoutePoints } from '../services/osrmRoute';
import { openDrivingDirections } from '../utils/openDrivingDirections';
import { spotsStore, newId } from '../storage/storage';
import type { Spot } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { useAuth } from '../services/authContext';
import { handleError } from '../utils/handleError';

type WaterItem =
  | { kind: 'dam'; item: Dam }
  | { kind: 'river'; item: River };

function resolveWater(kind: 'dam' | 'river', id: string): WaterItem | null {
  if (kind === 'dam') {
    const d = DAMS.find((x) => x.id === id);
    return d ? { kind: 'dam', item: d } : null;
  }
  const r = RIVERS.find((x) => x.id === id);
  return r ? { kind: 'river', item: r } : null;
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const KIND_THEME = {
  dam: { color: '#0E4D64', icon: 'layers' as const, label: 'Язовир' },
  river: { color: '#2E9B5A', icon: 'git-branch' as const, label: 'Река' },
};

export default function WaterDetailScreen() {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'WaterDetail'>>();
  const { kind, id } = route.params;
  const { user, configured } = useAuth();

  const water = useMemo(() => resolveWater(kind, id), [kind, id]);
  const theme = KIND_THEME[kind];
  const styles = useMemo(() => createStyles(colors, mode), [colors, mode]);

  const mapRef = useRef<LeafletMapHandle>(null);
  const [userCoord, setUserCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reports, setReports] = useState<WaterReport[]>([]);
  const [damLevel, setDamLevel] = useState<DamLevel | null>(null);

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportActivity, setReportActivity] = useState(3);
  const [reportCondition, setReportCondition] = useState<WaterCondition>('clear');
  const [reportNote, setReportNote] = useState('');
  const [reportSaving, setReportSaving] = useState(false);

  const [routeLoading, setRouteLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (!water) return;
    const t = setTimeout(() => {
      mapRef.current?.flyTo(water.item.latitude, water.item.longitude, 11);
    }, 250);
    return () => clearTimeout(t);
  }, [water]);

  useEffect(() => {
    if (!water) return;
    let cancelled = false;
    setWeatherStatus('loading');
    fetchWeather(water.item.latitude, water.item.longitude)
      .then((w) => {
        if (cancelled) return;
        setWeather(w);
        setWeatherStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setWeatherStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [water]);

  useEffect(() => {
    if (!water) return;
    getWaterReports(water.item.id).then(setReports).catch(() => {});
    if (water.kind === 'dam') {
      getDamLevel(water.item.id).then(setDamLevel).catch(() => {});
    }
  }, [water]);

  useEffect(() => {
    if (!water) return;
    let cancelled = false;
    spotsStore.list().then((all) => {
      if (cancelled) return;
      const match = all.find(
        (s) =>
          Math.abs(s.latitude - water.item.latitude) < 0.001 &&
          Math.abs(s.longitude - water.item.longitude) < 0.001 &&
          !!s.isFavorite,
      );
      setIsFavorite(!!match);
    });
    return () => {
      cancelled = true;
    };
  }, [water]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
        setUserCoord({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {}
    })();
  }, []);

  const distanceKm = useMemo(() => {
    if (!water || !userCoord) return null;
    return haversineKm(userCoord, {
      latitude: water.item.latitude,
      longitude: water.item.longitude,
    });
  }, [water, userCoord]);

  const recordCatch = useCallback(() => {
    if (!water) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('LogbookTab', {
      screen: 'AddCatch',
      params: {
        prefillLocation: {
          latitude: water.item.latitude,
          longitude: water.item.longitude,
          name: water.item.name,
        },
      },
    });
  }, [water, navigation]);

  const toggleFavorite = useCallback(async () => {
    if (!water || favoriting) return;
    setFavoriting(true);
    try {
      const all = await spotsStore.list();
      const existing = all.find(
        (s) =>
          Math.abs(s.latitude - water.item.latitude) < 0.001 &&
          Math.abs(s.longitude - water.item.longitude) < 0.001,
      );
      if (existing) {
        const updated = await spotsStore.toggleFavorite(existing.id);
        const fresh = updated.find((x) => x.id === existing.id);
        setIsFavorite(!!fresh?.isFavorite);
        Toast.show({
          type: 'success',
          text1: fresh?.isFavorite ? 'Запазен в любими' : 'Премахнат от любими',
          text2: `„${water.item.name}“`,
          visibilityTime: 2000,
        });
      } else {
        const spot: Spot = {
          id: newId(),
          name: water.item.name,
          latitude: water.item.latitude,
          longitude: water.item.longitude,
          description: water.item.description,
          waterType: water.kind === 'dam' ? 'dam' : 'river',
          createdAt: new Date().toISOString(),
          isFavorite: true,
        };
        await spotsStore.save(spot);
        setIsFavorite(true);
        Toast.show({
          type: 'success',
          text1: 'Запазен в любими',
          text2: `„${water.item.name}“`,
          visibilityTime: 2000,
        });
      }
    } finally {
      setFavoriting(false);
    }
  }, [water, favoriting]);

  const showOnMap = useCallback(() => {
    if (!water) return;
    navigation.navigate('Main' as any, {
      screen: 'MapTab',
      params:
        water.kind === 'dam'
          ? { focusDamId: water.item.id }
          : { focusRiverId: water.item.id },
    });
  }, [water, navigation]);

  const openLeaderboard = useCallback(() => {
    if (!water) return;
    navigation.navigate('ProfileTab', {
      screen: 'Leaderboard',
      params: water.kind === 'dam' ? { damId: water.item.id } : { riverId: water.item.id },
    });
  }, [water, navigation]);

  const openInAppRoute = useCallback(async () => {
    if (!water) return;
    setRouteLoading(true);
    try {
      let origin = userCoord;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          origin = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserCoord(origin);
        }
      } catch {}
      if (!origin) {
        Alert.alert(
          'Локация',
          'Разреши достъп до GPS, за да изчислим маршрут до водоема.',
        );
        return;
      }
      const pts = await fetchDrivingRoutePoints(origin, {
        latitude: water.item.latitude,
        longitude: water.item.longitude,
      });
      if (pts && pts.length >= 2) {
        // Hand the polyline back to the MapTab so the user sees the route on
        // the main map. Most natural in this flow — the user already wanted to
        // see where this water body is, now they see how to get there.
        navigation.navigate('Main' as any, {
          screen: 'MapTab',
          params:
            water.kind === 'dam'
              ? { focusDamId: water.item.id }
              : { focusRiverId: water.item.id },
        });
      }
    } catch {
      Alert.alert(
        'Маршрут',
        'Неуспешно изчисляване по пътища. Опитай навигация в Google Maps.',
      );
    } finally {
      setRouteLoading(false);
    }
  }, [water, userCoord, navigation]);

  const openExternalRoute = useCallback(async () => {
    if (!water) return;
    let origin = userCoord;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        origin = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      }
    } catch {}
    await openDrivingDirections(
      { latitude: water.item.latitude, longitude: water.item.longitude },
      { origin },
    );
  }, [water, userCoord]);

  const submitReport = useCallback(async () => {
    if (!water || !user || reportSaving) return;
    setReportSaving(true);
    try {
      await addWaterReport({
        waterBodyId: water.item.id,
        waterBodyKind: water.kind,
        waterBodyName: water.item.name,
        reporterUid: user.uid,
        reporterName: user.displayName ?? 'Рибар',
        fishingActivity: reportActivity,
        waterCondition: reportCondition,
        note: reportNote.trim() || undefined,
      });
      const fresh = await getWaterReports(water.item.id);
      setReports(fresh);
      setReportModalOpen(false);
      setReportNote('');
    } catch (e) {
      handleError(e);
    } finally {
      setReportSaving(false);
    }
  }, [water, user, reportActivity, reportCondition, reportNote, reportSaving]);

  if (!water) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.iconButton}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          <Ionicons name="alert-circle-outline" size={42} color={colors.textMuted} />
          <Text style={{ ...typography.bodyBold, color: colors.text, marginTop: spacing.md }}>
            Водоемът не е намерен
          </Text>
        </View>
      </View>
    );
  }

  const w = water.item;
  const lastReport = reports[0];

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'light-content'}
        backgroundColor="transparent"
        translucent
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl + 64 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HERO MINI-MAP ── */}
        <View style={styles.heroWrap}>
          <View style={styles.heroMap}>
            <MapEngineComponent
              ref={mapRef}
              spots={[]}
              dams={water.kind === 'dam' ? [water.item as Dam] : []}
              rivers={water.kind === 'river' ? [water.item as River] : []}
              catchMarkers={[]}
              heatmapCells={[]}
              pendingCoord={null}
              userCoord={userCoord}
              routeLine={null}
              mapType="hybrid"
              onLongPress={() => {}}
              onMarkerPress={() => {}}
              onDamPress={() => {}}
              onRiverPress={() => {}}
            />
          </View>

          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
            locations={[0, 0.45, 1]}
            style={styles.heroGradient}
            pointerEvents="none"
          />

          {/* Header overlaying the map */}
          <View
            style={[styles.header, { paddingTop: insets.top + 6 }]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={styles.iconButtonOverlay}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={toggleFavorite}
              hitSlop={12}
              style={styles.iconButtonOverlay}
            >
              {favoriting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons
                  name={isFavorite ? 'star' : 'star-outline'}
                  size={20}
                  color={isFavorite ? '#FFD24A' : '#fff'}
                />
              )}
            </Pressable>
            <Pressable
              onPress={() => setShareOpen(true)}
              hitSlop={12}
              style={[styles.iconButtonOverlay, { marginLeft: spacing.sm }]}
            >
              <Ionicons name="paper-plane-outline" size={20} color="#fff" />
            </Pressable>
          </View>

          {/* Title block — bottom of hero */}
          <View style={styles.heroFoot} pointerEvents="none">
            <View style={[styles.kindBadge, { backgroundColor: theme.color }]}>
              <Ionicons name={theme.icon} size={12} color="#fff" />
              <Text style={styles.kindBadgeText}>{theme.label}</Text>
            </View>
            <Text style={styles.heroTitle}>{w.name}</Text>
            <Text style={styles.heroSub}>
              {w.region}
              {distanceKm != null
                ? ` · ${distanceKm < 1 ? `${Math.round(distanceKm * 1000)} м` : `${distanceKm.toFixed(1)} км`} от теб`
                : ''}
            </Text>
          </View>
        </View>

        {/* ── STAT TILES ── */}
        <View style={styles.statRow}>
          {water.kind === 'dam' && water.item.area ? (
            <StatTile
              colors={colors}
              icon="resize-outline"
              label="Площ"
              value={water.item.area}
            />
          ) : null}
          {water.kind === 'dam' && water.item.altitude ? (
            <StatTile
              colors={colors}
              icon="triangle-outline"
              label="Височина"
              value={`${water.item.altitude} м`}
            />
          ) : null}
          {water.kind === 'river' && water.item.lengthKm ? (
            <StatTile
              colors={colors}
              icon="arrow-forward-outline"
              label="Дължина"
              value={water.item.lengthKm}
            />
          ) : null}
          {damLevel ? (
            <StatTile
              colors={colors}
              icon="water-outline"
              label="Ниво"
              value={`${damLevel.fillPercent}%`}
              accent={
                damLevel.fillPercent < 30
                  ? '#E04A4A'
                  : damLevel.fillPercent < 60
                    ? '#E8B923'
                    : colors.primary
              }
            />
          ) : null}
          {weather ? (
            <StatTile
              colors={colors}
              icon="star-outline"
              label="Риболов"
              value={`${weather.fishingRating}/5`}
              accent={colors.accent}
            />
          ) : null}
        </View>

        {/* ── PRIMARY CTA ── */}
        <View style={styles.bodyPad}>
          <Pressable
            onPress={recordCatch}
            style={({ pressed }) => [
              styles.primaryCta,
              { backgroundColor: theme.color },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="fish" size={20} color="#fff" />
            <Text style={styles.primaryCtaText}>Запиши улов от тук</Text>
          </Pressable>

          {/* ── ACTION PILLS ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
          >
            <Pressable style={styles.pill} onPress={showOnMap}>
              <Ionicons name="map-outline" size={16} color={colors.primary} />
              <Text style={styles.pillText}>На карта</Text>
            </Pressable>
            <Pressable
              style={[styles.pill, routeLoading && { opacity: 0.6 }]}
              onPress={() => void openInAppRoute()}
              disabled={routeLoading}
            >
              {routeLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="navigate-outline" size={16} color={colors.primary} />
              )}
              <Text style={styles.pillText}>Маршрут</Text>
            </Pressable>
            <Pressable style={styles.pill} onPress={() => void openExternalRoute()}>
              <Ionicons name="open-outline" size={16} color={colors.primary} />
              <Text style={styles.pillText}>Навигация</Text>
            </Pressable>
            <Pressable style={styles.pill} onPress={openLeaderboard}>
              <Ionicons name="trophy-outline" size={16} color="#C49A00" />
              <Text style={styles.pillText}>Класиране</Text>
            </Pressable>
          </ScrollView>

          {w.description ? <Text style={styles.description}>{w.description}</Text> : null}

          {/* ── DASHBOARD ROW: Weather + Reports summary ── */}
          <View style={styles.dashRow}>
            <View style={[styles.dashTile, { flex: 1 }]}>
              <View style={styles.dashTileHead}>
                <Ionicons name="partly-sunny-outline" size={14} color={colors.textMuted} />
                <Text style={styles.dashTileLabel}>Време сега</Text>
              </View>
              {weatherStatus === 'loading' ? (
                <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : weather ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
                  <WeatherIcon weatherCode={weather.weatherCode} size={36} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dashTileBig}>{weather.temperatureC}°</Text>
                    <Text style={styles.dashTileFoot} numberOfLines={1}>
                      💨 {weather.windKmh} км/ч
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.dashTileFoot}>Няма връзка</Text>
              )}
            </View>

            <View style={[styles.dashTile, { flex: 1 }]}>
              <View style={styles.dashTileHead}>
                <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                <Text style={styles.dashTileLabel}>Рапорти (24ч)</Text>
              </View>
              <Text style={styles.dashTileBig}>{reports.length}</Text>
              {lastReport ? (
                <Text style={styles.dashTileFoot} numberOfLines={1}>
                  {CONDITION_LABELS[lastReport.waterCondition]} · {'⭐'.repeat(lastReport.fishingActivity)}
                </Text>
              ) : (
                <Text style={styles.dashTileFoot}>Все още няма</Text>
              )}
            </View>
          </View>

          {/* ── BITE FORECAST ── */}
          {weather ? (
            <View style={styles.section}>
              <BiteForecast weather={weather} />
            </View>
          ) : null}

          {/* ── WEATHER DETAILS ── */}
          {weather ? (
            <View style={styles.card}>
              <View style={styles.weatherDetailsRow}>
                <WeatherDetail icon="flag-outline" colors={colors} value={`${weather.windKmh} км/ч ${windDirectionLabel(weather.windDirection)}`} label="вятър" />
                <WeatherDetail icon="speedometer-outline" colors={colors} value={`${weather.pressureHpa} hPa`} label="налягане" />
                <WeatherDetail icon="water-outline" colors={colors} value={`${weather.humidity}%`} label="влажност" />
              </View>
              <View style={[styles.weatherDetailsRow, { marginTop: spacing.sm, paddingTop: spacing.sm }]}>
                <WeatherDetail icon="rainy-outline" colors={colors} value={`${weather.precipitationProbability}%`} label="дъжд" />
                <WeatherDetail icon="sunny-outline" colors={colors} value={`UV ${weather.uvIndex}`} label="UV индекс" />
                <WeatherDetail icon="cloud-outline" colors={colors} value={`${weather.cloudCover}%`} label="облачност" />
              </View>
              <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: spacing.sm }}>
                {weather.moonPhaseName}
              </Text>
            </View>
          ) : null}

          {/* ── PHOTOS ── */}
          <View style={styles.section}>
            <DamFeedSection
              damId={w.id}
              damName={w.name}
              user={user}
              firebaseConfigured={configured}
            />
          </View>

          {/* ── REPORTS ── */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Рапорти от рибари</Text>
            {user && configured ? (
              <Pressable
                onPress={() => setReportModalOpen(true)}
                style={styles.sectionAction}
                hitSlop={6}
              >
                <Ionicons name="add-circle" size={16} color={colors.primary} />
                <Text style={styles.sectionActionText}>Добави</Text>
              </Pressable>
            ) : null}
          </View>
          {reports.length === 0 ? (
            <Text style={styles.muted}>Все още няма рапорти за последните 24 ч.</Text>
          ) : (
            reports.map((r) => (
              <View key={r.id} style={styles.reportCard}>
                <Text style={styles.reportName}>{r.reporterName}</Text>
                <Text style={styles.reportSub}>
                  {CONDITION_LABELS[r.waterCondition]} · {'⭐'.repeat(r.fishingActivity)}
                </Text>
                {r.note ? <Text style={styles.reportNote}>{r.note}</Text> : null}
              </View>
            ))
          )}

          {/* ── 7-DAY FORECAST ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Прогноза 7 дни</Text>
            <ForecastStrip latitude={w.latitude} longitude={w.longitude} cacheKey={w.id} />
          </View>

          {/* ── SPECIES ── */}
          {w.species.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Срещани видове</Text>
              <View style={styles.speciesRow}>
                {w.species.map((sp) => (
                  <View key={sp} style={styles.speciesChip}>
                    <Text style={styles.speciesText}>{sp}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── DAM LEVEL ── */}
          {damLevel ? (() => {
            const levelColor =
              damLevel.fillPercent < 30
                ? '#E04A4A'
                : damLevel.fillPercent < 60
                  ? '#E8B923'
                  : colors.primary;
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Ниво на язовира</Text>
                <View style={styles.levelCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Ionicons name="water" size={26} color={levelColor} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...typography.h1, color: levelColor }}>
                        {damLevel.fillPercent}%
                      </Text>
                      <Text style={{ ...typography.caption, color: colors.textMuted }}>
                        {damLevel.volumeMcm != null ? `${damLevel.volumeMcm} млн. м³ · ` : ''}
                        акт. {new Date(damLevel.updatedAt).toLocaleDateString('bg-BG')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.levelBarBg}>
                    <View
                      style={{
                        height: 8,
                        width: `${damLevel.fillPercent}%`,
                        backgroundColor: levelColor,
                        borderRadius: 4,
                      }}
                    />
                  </View>
                </View>
              </View>
            );
          })() : null}
        </View>
      </ScrollView>

      {/* ── ADD REPORT MODAL ── */}
      <Modal
        visible={reportModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReportModalOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
          onPress={() => setReportModalOpen(false)}
        >
          <Pressable onPress={() => {}} accessible={false}>
            <View style={styles.reportSheet}>
              <View style={{ alignItems: 'center', paddingBottom: spacing.sm }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
              </View>
              <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.sm }}>
                Добави рапорт
              </Text>
              <Text style={styles.reportFieldLabel}>Активност (1-5)</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setReportActivity(n)}
                    style={[
                      styles.activityBtn,
                      {
                        backgroundColor: n <= reportActivity ? colors.primary : colors.surfaceAlt,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: n <= reportActivity ? '#fff' : colors.text,
                        fontWeight: '700',
                      }}
                    >
                      {n}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.reportFieldLabel}>Вода</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
                {(['crystal', 'clear', 'murky', 'muddy'] as WaterCondition[]).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setReportCondition(c)}
                    style={[
                      styles.conditionChip,
                      {
                        backgroundColor: reportCondition === c ? colors.primary : colors.surfaceAlt,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        ...typography.small,
                        color: reportCondition === c ? '#fff' : colors.text,
                        fontWeight: '600',
                      }}
                    >
                      {CONDITION_LABELS[c]}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                placeholder="Бележка (по избор)"
                placeholderTextColor={colors.textMuted}
                value={reportNote}
                onChangeText={setReportNote}
                style={styles.reportInput}
                maxLength={200}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, paddingBottom: insets.bottom + spacing.sm }}>
                <Button title="Отказ" variant="ghost" compact onPress={() => setReportModalOpen(false)} style={{ flex: 1 }} />
                <Button title="Изпрати" compact loading={reportSaving} onPress={() => void submitReport()} style={{ flex: 1 }} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {shareOpen && water ? (
        <SharePickerModal
          visible
          onClose={() => setShareOpen(false)}
          sharedRef={buildSpotSharedRef({
            id: water.item.id,
            name: water.item.name,
            waterType: water.kind === 'dam' ? 'Язовир' : 'Река',
            latitude: water.item.latitude,
            longitude: water.item.longitude,
          })}
        />
      ) : null}
    </View>
  );
}

function StatTile({
  colors,
  icon,
  label,
  value,
  accent,
}: {
  colors: AppColors;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: radius.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        minWidth: 78,
        gap: 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={11} color={colors.textMuted} />
        <Text style={{ ...typography.small, color: colors.textMuted, fontSize: 10 }}>
          {label}
        </Text>
      </View>
      <Text
        style={{
          ...typography.bodyBold,
          color: accent ?? colors.text,
          fontSize: 15,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function WeatherDetail({
  icon,
  colors,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  colors: AppColors;
  value: string;
  label: string;
}) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ ...typography.small, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

function createStyles(colors: AppColors, mode: 'light' | 'dark') {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 5,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconButtonOverlay: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroWrap: {
      height: 280,
      width: '100%',
      backgroundColor: colors.surfaceAlt,
    },
    heroMap: {
      ...StyleSheet.absoluteFillObject,
    },
    heroGradient: {
      ...StyleSheet.absoluteFillObject,
    },
    heroFoot: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.lg,
      gap: 6,
    },
    kindBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    kindBadgeText: {
      ...typography.small,
      color: '#fff',
      fontWeight: '700',
      fontSize: 10,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    heroTitle: {
      ...typography.h1,
      color: '#fff',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    heroSub: {
      ...typography.caption,
      color: 'rgba(255,255,255,0.92)',
      textShadowColor: 'rgba(0,0,0,0.5)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    statRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    bodyPad: {
      paddingHorizontal: spacing.lg,
    },
    primaryCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      marginTop: spacing.lg,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 10,
      elevation: 3,
    },
    primaryCtaText: {
      ...typography.bodyBold,
      color: '#fff',
      fontSize: 16,
      letterSpacing: 0.2,
    },
    pillRow: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
      paddingRight: spacing.lg,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillText: {
      ...typography.small,
      color: colors.text,
      fontWeight: '700',
      fontSize: 12,
    },
    description: {
      ...typography.body,
      color: colors.text,
      marginTop: spacing.md,
      opacity: 0.9,
    },
    dashRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    dashTile: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 90,
    },
    dashTileHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 2,
    },
    dashTileLabel: {
      ...typography.small,
      color: colors.textMuted,
      fontSize: 11,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      fontWeight: '700',
    },
    dashTileBig: {
      ...typography.h2,
      color: colors.text,
    },
    dashTileFoot: {
      ...typography.small,
      color: colors.textMuted,
    },
    section: {
      marginTop: spacing.lg,
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      ...typography.bodyBold,
      color: colors.text,
      marginBottom: spacing.sm,
    },
    sectionAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    sectionActionText: {
      ...typography.small,
      color: colors.primary,
      fontWeight: '700',
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.md,
    },
    weatherDetailsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 0,
    },
    muted: {
      ...typography.caption,
      color: colors.textMuted,
      marginBottom: spacing.sm,
    },
    reportCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reportName: {
      ...typography.bodyBold,
      color: colors.text,
      fontSize: 13,
    },
    reportSub: {
      ...typography.small,
      color: colors.textMuted,
    },
    reportNote: {
      ...typography.small,
      color: colors.text,
      marginTop: 2,
    },
    speciesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    speciesChip: {
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    speciesText: {
      ...typography.caption,
      color: colors.primary,
      fontWeight: '600',
    },
    levelCard: {
      backgroundColor: colors.primarySurface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    levelBarBg: {
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      marginTop: spacing.sm,
      overflow: 'hidden',
    },
    reportSheet: {
      backgroundColor: colors.background,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    reportFieldLabel: {
      ...typography.small,
      color: colors.textMuted,
      marginBottom: 4,
    },
    activityBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    conditionChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reportInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      minHeight: 80,
      textAlignVertical: 'top',
    },
  });
}
