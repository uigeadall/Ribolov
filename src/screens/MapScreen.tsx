import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  Switch,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { LeafletMap, LeafletMapHandle, LeafletMapType } from '../components/LeafletMap';
import { NativeMapView } from '../components/NativeMapView';
import { USE_REACT_NATIVE_MAPS } from '../config/mapEngine';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { spotsStore, catchesStore, newId } from '../storage/storage';
import { Spot } from '../types';
import type { CatchMapMarker } from '../components/LeafletMap';
import { DAMS, Dam } from '../data/dams';
import { RIVERS, River } from '../data/rivers';
import { fetchWeather, windDirectionLabel, WeatherSnapshot } from '../services/weather';
import { TabsParamList } from '../navigation/types';
import { DamPicker } from '../components/DamPicker';
import { ForecastStrip } from '../components/ForecastStrip';
import { DamFeedSection } from '../components/DamFeedSection';
import { useAuth } from '../services/authContext';
import { WeatherIcon } from '../components/WeatherIcon';
import { StarRatingBar } from '../components/StarRatingBar';
import { fetchDrivingRoutePoints } from '../services/osrmRoute';
import { openDrivingDirections } from '../utils/openDrivingDirections';
import { BiteForecast } from '../components/BiteForecast';
import {
  getWaterReports,
  addWaterReport,
  CONDITION_LABELS,
  type WaterCondition,
  type WaterReport,
} from '../services/fishingReports';
import { getDamLevel, type DamLevel } from '../services/damLevels';
import { handleError } from '../utils/handleError';
import { useAppNavigation } from '../navigation/useAppNavigation';
import type { User } from 'firebase/auth';

type SelectedWater = { kind: 'dam'; item: Dam } | { kind: 'river'; item: River };
type WeatherCacheEntry = { data: WeatherSnapshot; fetchedAt: number };

const WEATHER_TTL_MS = 30 * 60 * 1000;

const WATER_TYPES: {
  id: Spot['waterType'];
  label: string;
  ion: keyof typeof Ionicons.glyphMap;
  color: string;
}[] = [
  { id: 'lake', label: 'Езеро', ion: 'water-outline', color: '#1A7A9C' },
  { id: 'dam', label: 'Язовир', ion: 'layers-outline', color: '#0E4D64' },
  { id: 'river', label: 'Река', ion: 'git-branch-outline', color: '#2E9B5A' },
  { id: 'pond', label: 'Микроязовир', ion: 'ellipse-outline', color: '#7BB7CC' },
  { id: 'sea', label: 'Море', ion: 'boat-outline', color: '#062D3D' },
];

const waterTypeLabel = (t: Spot['waterType']) =>
  WATER_TYPES.find((x) => x.id === t)?.label ?? '';

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function MapScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  const waterTypeColor = (t: Spot['waterType']) =>
    WATER_TYPES.find((x) => x.id === t)?.color ?? colors.primary;

  const mapRef = useRef<LeafletMapHandle>(null);
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<TabsParamList, 'MapTab'>>();
  const focusDamId = route.params?.focusDamId;
  const focusRiverId = route.params?.focusRiverId;

  const [userCoord, setUserCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [waterType, setWaterType] = useState<Spot['waterType']>('lake');
  const [selected, setSelected] = useState<Spot | null>(null);
  const [togglingFavorite, setTogglingFavorite] = useState(false);
  const [mapType, setMapType] = useState<LeafletMapType>('standard');
  const [showDams, setShowDams] = useState(true);
  const [showRivers, setShowRivers] = useState(true);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedWater, setSelectedWater] = useState<SelectedWater | null>(null);
  const [routeLine, setRouteLine] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [damWeather, setDamWeather] = useState<WeatherSnapshot | null>(null);
  const [damWeatherStatus, setDamWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const weatherCacheRef = useRef<Record<string, WeatherCacheEntry>>({});
  const { user, configured } = useAuth();
  const [hintVisible, setHintVisible] = useState(true);
  const lastPosRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const [waterReports, setWaterReports] = useState<WaterReport[]>([]);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportActivity, setReportActivity] = useState(3);
  const [reportCondition, setReportCondition] = useState<WaterCondition>('clear');
  const [reportNote, setReportNote] = useState('');
  const [reportSaving, setReportSaving] = useState(false);
  const [damLevel, setDamLevel] = useState<DamLevel | null>(null);
  const [spotWeather, setSpotWeather] = useState<WeatherSnapshot | null>(null);
  const [spotWeatherLoading, setSpotWeatherLoading] = useState(false);
  const [catchMarkers, setCatchMarkers] = useState<CatchMapMarker[]>([]);
  const [showCatchMarkers, setShowCatchMarkers] = useState(false);
  const [catchCountByName, setCatchCountByName] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('@ribolov/lastMapPos').then((raw) => {
      if (!raw) return;
      try {
        const pos = JSON.parse(raw) as { lat: number; lng: number; zoom: number };
        lastPosRef.current = pos;
        setTimeout(() => mapRef.current?.flyTo(pos.lat, pos.lng, pos.zoom), 600);
      } catch {
        /* ignore bad data */
      }
    });
    AsyncStorage.getItem('@ribolov/catchMarkersOn').then((v) => {
      if (v === 'true') setShowCatchMarkers(true);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem('@ribolov/catchMarkersOn', showCatchMarkers ? 'true' : 'false').catch(
      () => {}
    );
  }, [showCatchMarkers]);

  const load = useCallback(async () => {
    setSpots(await spotsStore.list());
    const catches = await catchesStore.list();
    const markers: CatchMapMarker[] = catches
      .filter((c) => c.location?.latitude != null && c.location?.longitude != null)
      .map((c) => ({
        id: c.id,
        latitude: c.location!.latitude,
        longitude: c.location!.longitude,
        speciesName: c.speciesName,
        weightKg: c.weightKg,
      }));
    setCatchMarkers(markers);
    const countMap = new Map<string, number>();
    catches.forEach((c) => {
      if (c.location?.name)
        countMap.set(c.location.name, (countMap.get(c.location.name) ?? 0) + 1);
    });
    setCatchCountByName(countMap);
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserCoord({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    })();
  }, [load]);

  useEffect(() => {
    if (!focusDamId) return;
    const d = DAMS.find((x) => x.id === focusDamId);
    if (!d) return;
    const t = setTimeout(() => {
      mapRef.current?.flyTo(d.latitude, d.longitude, 12);
      setRouteLine(null);
      setSelectedWater({ kind: 'dam', item: d });
      navigation.setParams({ focusDamId: undefined });
    }, 400);
    return () => clearTimeout(t);
  }, [focusDamId, navigation]);

  useEffect(() => {
    if (!focusRiverId) return;
    const r = RIVERS.find((x) => x.id === focusRiverId);
    if (!r) return;
    const t = setTimeout(() => {
      mapRef.current?.flyTo(r.latitude, r.longitude, 12);
      setRouteLine(null);
      setSelectedWater({ kind: 'river', item: r });
      navigation.setParams({ focusRiverId: undefined });
    }, 400);
    return () => clearTimeout(t);
  }, [focusRiverId, navigation]);

  const sortedSpots = useMemo(() => {
    const list = showFavoritesOnly ? spots.filter((s) => s.isFavorite) : [...spots];
    list.sort((a, b) => {
      const favDiff = (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
      if (favDiff !== 0) return favDiff;
      if (!userCoord) return 0;
      const da = haversineKm(userCoord, { latitude: a.latitude, longitude: a.longitude });
      const db = haversineKm(userCoord, { latitude: b.latitude, longitude: b.longitude });
      return da - db;
    });
    return list;
  }, [spots, showFavoritesOnly, userCoord]);

  const distanceTo = useCallback(
    (s: Spot) =>
      userCoord
        ? haversineKm(userCoord, { latitude: s.latitude, longitude: s.longitude })
        : null,
    [userCoord]
  );

  useEffect(() => {
    if (!selectedWater) {
      setWaterReports([]);
      return;
    }
    getWaterReports(selectedWater.item.id)
      .then(setWaterReports)
      .catch(() => {});
    if (selectedWater.kind === 'dam') {
      getDamLevel(selectedWater.item.id)
        .then(setDamLevel)
        .catch(() => {});
    } else {
      setDamLevel(null);
    }
  }, [selectedWater]);

  useEffect(() => {
    if (!selectedWater) {
      setDamWeather(null);
      setDamWeatherStatus('idle');
      return;
    }
    const { item } = selectedWater;
    const cached = weatherCacheRef.current[item.id];
    if (cached && Date.now() - cached.fetchedAt < WEATHER_TTL_MS) {
      setDamWeather(cached.data);
      setDamWeatherStatus('idle');
      return;
    }
    let cancelled = false;
    setDamWeather(null);
    setDamWeatherStatus('loading');
    fetchWeather(item.latitude, item.longitude)
      .then((w) => {
        if (cancelled) return;
        weatherCacheRef.current[item.id] = { data: w, fetchedAt: Date.now() };
        setDamWeather(w);
        setDamWeatherStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setDamWeatherStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWater]);

  useEffect(() => {
    if (!selected) {
      setSpotWeather(null);
      return;
    }
    const cached = weatherCacheRef.current[`spot-${selected.id}`];
    if (cached && Date.now() - cached.fetchedAt < WEATHER_TTL_MS) {
      setSpotWeather(cached.data);
      return;
    }
    let cancelled = false;
    setSpotWeather(null);
    setSpotWeatherLoading(true);
    fetchWeather(selected.latitude, selected.longitude)
      .then((w) => {
        if (cancelled) return;
        weatherCacheRef.current[`spot-${selected.id}`] = { data: w, fetchedAt: Date.now() };
        setSpotWeather(w);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSpotWeatherLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const saveSpot = async () => {
    if (!pendingCoord) return;
    if (!name.trim()) {
      Alert.alert('Име', 'Дай име на спота, за да го запазиш.');
      return;
    }
    const spot: Spot = {
      id: newId(),
      name: name.trim(),
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      description: description.trim() || undefined,
      waterType,
      createdAt: new Date().toISOString(),
      isFavorite: false,
    };
    await spotsStore.save(spot);
    setPendingCoord(null);
    setName('');
    setDescription('');
    setWaterType('lake');
    load();
  };

  const removeSelected = () => {
    if (!selected) return;
    Alert.alert('Изтриване', `Изтриване на „${selected.name}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await spotsStore.remove(selected.id);
          setSelected(null);
          load();
        },
      },
    ]);
  };

  const onMarkerPress = (id: string) => {
    const s = spots.find((x) => x.id === id);
    if (s) setSelected(s);
  };

  const onDamPress = (id: string) => {
    const d = DAMS.find((x) => x.id === id);
    if (d) {
      setRouteLine(null);
      setSelectedWater({ kind: 'dam', item: d });
    }
  };

  const onRiverPress = (id: string) => {
    const r = RIVERS.find((x) => x.id === id);
    if (r) {
      setRouteLine(null);
      setSelectedWater({ kind: 'river', item: r });
    }
  };

  const saveMapPos = (lat: number, lng: number, zoom: number) => {
    AsyncStorage.setItem('@ribolov/lastMapPos', JSON.stringify({ lat, lng, zoom })).catch(() => {});
  };

  const flyToSpot = (s: Spot) => {
    mapRef.current?.flyTo(s.latitude, s.longitude, 13);
    saveMapPos(s.latitude, s.longitude, 13);
  };

  const flyToWaterBody = useCallback(
    (lat: number, lng: number) => {
      mapRef.current?.flyTo(lat, lng, 12);
      saveMapPos(lat, lng, 12);
      setSelectedWater(null);
    },
    []
  );

  const saveWaterBodyAsFavorite = useCallback(
    async (kind: 'dam' | 'river', item: Dam | River) => {
      const existing = spots.find(
        (s) =>
          Math.abs(s.latitude - item.latitude) < 0.001 &&
          Math.abs(s.longitude - item.longitude) < 0.001
      );
      if (existing) {
        if (!existing.isFavorite) {
          const updated = await spotsStore.toggleFavorite(existing.id);
          setSpots(updated);
        }
      } else {
        const spot: Spot = {
          id: newId(),
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          description: item.description,
          waterType: kind === 'dam' ? 'dam' : 'river',
          createdAt: new Date().toISOString(),
          isFavorite: true,
        };
        const updated = await spotsStore.save(spot);
        setSpots(updated);
      }
      setSelectedWater(null);
      setShowFavoritesOnly(true);
      mapRef.current?.flyTo(item.latitude, item.longitude, 12);
      Alert.alert('Запазен в любими', `„${item.name}" е добавен в любимите ти спотове.`);
    },
    [spots]
  );

  const recordCatchAt = useCallback(
    (target: { latitude: number; longitude: number; name: string }) => {
      setSelectedWater(null);
      setSelected(null);
      navigation.navigate('LogbookTab', {
        screen: 'AddCatch',
        params: { prefillLocation: target },
      });
    },
    [navigation]
  );

  const locateMe = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Локация', 'Разреши достъп до локацията в настройките.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    setUserCoord(c);
    mapRef.current?.flyTo(c.latitude, c.longitude, 13);
  };

  const openInAppRouteToWater = useCallback(async () => {
    if (!selectedWater) return;
    setRouteLoading(true);
    try {
      let origin = userCoord;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        origin = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserCoord(origin);
      }
      if (!origin) {
        Alert.alert(
          'Локация',
          'За маршрут в приложението е нужна текуща позиция. Натисни бутона за локация на картата или разреши GPS.'
        );
        return;
      }
      const pts = await fetchDrivingRoutePoints(origin, {
        latitude: selectedWater.item.latitude,
        longitude: selectedWater.item.longitude,
      });
      setRouteLine(pts);
      setSelectedWater(null);
    } catch {
      Alert.alert(
        'Маршрут',
        'Неуспешно изчисляване по пътища. Провери интернет или опитай навигация във външно приложение.'
      );
    } finally {
      setRouteLoading(false);
    }
  }, [selectedWater, userCoord]);

  const openExternalDrivingRouteToWater = useCallback(async () => {
    if (!selectedWater) return;
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
    } catch {
      /* use last known position */
    }
    await openDrivingDirections(
      { latitude: selectedWater.item.latitude, longitude: selectedWater.item.longitude },
      { origin }
    );
  }, [selectedWater, userCoord]);

  const handleOpenLeaderboard = useCallback(() => {
    if (!selectedWater) return;
    const kind = selectedWater.kind;
    const id = selectedWater.item.id;
    setSelectedWater(null);
    navigation.navigate('ProfileTab', {
      screen: 'Leaderboard',
      params: kind === 'dam' ? { damId: id } : { riverId: id },
    });
  }, [selectedWater, navigation]);

  const handleSubmitReport = useCallback(async () => {
    if (!selectedWater || !user) return;
    setReportSaving(true);
    try {
      await addWaterReport({
        waterBodyId: selectedWater.item.id,
        waterBodyKind: selectedWater.kind,
        waterBodyName: selectedWater.item.name,
        reporterUid: user.uid,
        reporterName: user.displayName ?? 'Рибар',
        fishingActivity: reportActivity,
        waterCondition: reportCondition,
        note: reportNote.trim() || undefined,
      });
      const fresh = await getWaterReports(selectedWater.item.id);
      setWaterReports(fresh);
      setReportSheetOpen(false);
      setReportNote('');
    } catch (e) {
      handleError(e);
    } finally {
      setReportSaving(false);
    }
  }, [selectedWater, user, reportActivity, reportCondition, reportNote]);

  const handleToggleFavorite = useCallback(async () => {
    if (!selected || togglingFavorite) return;
    setTogglingFavorite(true);
    try {
      const updated = await spotsStore.toggleFavorite(selected.id);
      setSpots(updated);
      const fresh = updated.find((x) => x.id === selected.id);
      if (!fresh) {
        setSelected(null);
        return;
      }
      setSelected(fresh);
      if (showFavoritesOnly && !fresh.isFavorite) setSelected(null);
    } finally {
      setTogglingFavorite(false);
    }
  }, [selected, togglingFavorite, showFavoritesOnly]);

  return (
    <Screen padded={false}>
      <View style={{ flex: 1 }}>
        {USE_REACT_NATIVE_MAPS ? (
          <NativeMapView
            ref={mapRef}
            spots={sortedSpots}
            dams={!showFavoritesOnly && showDams ? DAMS : []}
            rivers={!showFavoritesOnly && showRivers ? RIVERS : []}
            catchMarkers={showCatchMarkers ? catchMarkers : []}
            pendingCoord={pendingCoord}
            userCoord={userCoord}
            routeLine={routeLine}
            mapType={mapType}
            onLongPress={(lat, lng) => setPendingCoord({ latitude: lat, longitude: lng })}
            onMarkerPress={onMarkerPress}
            onDamPress={onDamPress}
            onRiverPress={onRiverPress}
          />
        ) : (
          <LeafletMap
            ref={mapRef}
            spots={sortedSpots}
            dams={!showFavoritesOnly && showDams ? DAMS : []}
            rivers={!showFavoritesOnly && showRivers ? RIVERS : []}
            catchMarkers={showCatchMarkers ? catchMarkers : []}
            pendingCoord={pendingCoord}
            userCoord={userCoord}
            routeLine={routeLine}
            mapType={mapType}
            onLongPress={(lat, lng) => setPendingCoord({ latitude: lat, longitude: lng })}
            onMarkerPress={onMarkerPress}
            onDamPress={onDamPress}
            onRiverPress={onRiverPress}
          />
        )}

        <MapTopControls
          colors={colors}
          mapType={mapType}
          showDams={showDams}
          showRivers={showRivers}
          showFavoritesOnly={showFavoritesOnly}
          showCatchMarkers={showCatchMarkers}
          catchMarkersCount={catchMarkers.length}
          hintVisible={hintVisible}
          onMapTypeChange={setMapType}
          onToggleDams={() => setShowDams((v) => !v)}
          onToggleRivers={() => setShowRivers((v) => !v)}
          onToggleFavorites={() => setShowFavoritesOnly((v) => !v)}
          onToggleCatchMarkers={() => setShowCatchMarkers((v) => !v)}
          onHintDismiss={() => setHintVisible(false)}
          onHintShow={() => setHintVisible(true)}
        />

        <Pressable style={styles.fab} onPress={locateMe}>
          <Ionicons name="locate" size={22} color={colors.primary} />
        </Pressable>

        <Pressable style={styles.searchFab} onPress={() => setPickerOpen(true)}>
          <Ionicons name="search" size={20} color={colors.white} />
          <Text style={styles.searchFabText}>Търси водоем</Text>
        </Pressable>

        {routeLine && routeLine.length >= 2 ? (
          <Pressable
            style={styles.routeClearFab}
            onPress={() => setRouteLine(null)}
            accessibilityRole="button"
            accessibilityLabel="Изчисти маршрута"
          >
            <Ionicons name="close-circle-outline" size={22} color={colors.primary} />
            <Text style={styles.routeClearFabText}>Изчисти маршрут</Text>
          </Pressable>
        ) : null}

        {sortedSpots.length > 0 ? (
          <SpotScrollBar
            spots={sortedSpots}
            userCoord={userCoord}
            catchCountByName={catchCountByName}
            colors={colors}
            waterTypeColor={waterTypeColor}
            onSpotPress={flyToSpot}
          />
        ) : null}
      </View>

      <DamPicker
        visible={pickerOpen}
        userCoord={userCoord}
        onClose={() => setPickerOpen(false)}
        onSelect={(pick) => {
          setPickerOpen(false);
          setRouteLine(null);
          mapRef.current?.flyTo(pick.item.latitude, pick.item.longitude, 12);
          setSelectedWater(pick);
        }}
      />

      <NewSpotModal
        visible={!!pendingCoord}
        coord={pendingCoord}
        name={name}
        description={description}
        waterType={waterType}
        colors={colors}
        onChangeName={setName}
        onChangeDescription={setDescription}
        onChangeWaterType={setWaterType}
        onClose={() => setPendingCoord(null)}
        onSave={saveSpot}
      />

      <WaterBodySheet
        selectedWater={selectedWater}
        damWeather={damWeather}
        damWeatherStatus={damWeatherStatus}
        waterReports={waterReports}
        reportSheetOpen={reportSheetOpen}
        reportActivity={reportActivity}
        reportCondition={reportCondition}
        reportNote={reportNote}
        reportSaving={reportSaving}
        damLevel={damLevel}
        routeLoading={routeLoading}
        user={user}
        firebaseConfigured={configured}
        colors={colors}
        onClose={() => setSelectedWater(null)}
        onSaveAsFavorite={() =>
          selectedWater && void saveWaterBodyAsFavorite(selectedWater.kind, selectedWater.item)
        }
        onShowOnMap={() =>
          selectedWater &&
          flyToWaterBody(selectedWater.item.latitude, selectedWater.item.longitude)
        }
        onRecordCatch={() =>
          selectedWater &&
          recordCatchAt({
            latitude: selectedWater.item.latitude,
            longitude: selectedWater.item.longitude,
            name: selectedWater.item.name,
          })
        }
        onOpenInAppRoute={() => void openInAppRouteToWater()}
        onExternalRoute={() => void openExternalDrivingRouteToWater()}
        onOpenLeaderboard={handleOpenLeaderboard}
        onOpenReportSheet={() => setReportSheetOpen(true)}
        onCloseReportSheet={() => setReportSheetOpen(false)}
        onReportActivityChange={setReportActivity}
        onReportConditionChange={setReportCondition}
        onReportNoteChange={setReportNote}
        onSubmitReport={() => void handleSubmitReport()}
      />

      <SpotSheet
        spot={selected}
        userCoord={userCoord}
        spotWeather={spotWeather}
        spotWeatherLoading={spotWeatherLoading}
        catchCountByName={catchCountByName}
        togglingFavorite={togglingFavorite}
        colors={colors}
        onClose={() => setSelected(null)}
        onRemove={removeSelected}
        onRecordCatch={recordCatchAt}
        onToggleFavorite={() => void handleToggleFavorite()}
      />
    </Screen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type MapTopControlsProps = {
  colors: AppColors;
  mapType: LeafletMapType;
  showDams: boolean;
  showRivers: boolean;
  showFavoritesOnly: boolean;
  showCatchMarkers: boolean;
  catchMarkersCount: number;
  hintVisible: boolean;
  onMapTypeChange: (t: LeafletMapType) => void;
  onToggleDams: () => void;
  onToggleRivers: () => void;
  onToggleFavorites: () => void;
  onToggleCatchMarkers: () => void;
  onHintDismiss: () => void;
  onHintShow: () => void;
};

const MapTopControls = React.memo(function MapTopControls({
  colors,
  mapType,
  showDams,
  showRivers,
  showFavoritesOnly,
  showCatchMarkers,
  catchMarkersCount,
  hintVisible,
  onMapTypeChange,
  onToggleDams,
  onToggleRivers,
  onToggleFavorites,
  onToggleCatchMarkers,
  onHintDismiss,
  onHintShow,
}: MapTopControlsProps) {
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  return (
    <View style={styles.topControls}>
      <View style={styles.mapTypeRow}>
        {(
          [
            { key: 'standard', label: 'Карта' },
            { key: 'satellite', label: 'Сателит' },
            { key: 'hybrid', label: 'Хибрид' },
          ] as { key: LeafletMapType; label: string }[]
        ).map((t) => (
          <Pressable
            key={t.key}
            onPress={() => onMapTypeChange(t.key)}
            style={[styles.mapTypeBtn, mapType === t.key && styles.mapTypeBtnActive]}
          >
            <Text style={[styles.mapTypeText, mapType === t.key && styles.mapTypeTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
        <Pressable
          onPress={onToggleDams}
          style={[styles.damToggle, showDams && styles.damToggleActive]}
          hitSlop={6}
        >
          <Ionicons name="layers-outline" size={13} color={showDams ? colors.white : colors.primary} />
          <Text style={[styles.damToggleText, showDams && styles.damToggleTextActive]}>Язовири</Text>
        </Pressable>
        <Pressable
          onPress={onToggleRivers}
          style={[styles.damToggle, showRivers && styles.riverToggleActive]}
          hitSlop={6}
        >
          <Ionicons name="git-branch-outline" size={13} color={showRivers ? colors.white : '#2E9B5A'} />
          <Text style={[styles.damToggleText, showRivers && styles.damToggleTextActive]}>Реки</Text>
        </Pressable>
        <Pressable
          onPress={onToggleFavorites}
          style={[styles.damToggle, showFavoritesOnly && styles.favToggleActive]}
          hitSlop={6}
        >
          <Ionicons name="star" size={13} color={showFavoritesOnly ? colors.white : '#C49A00'} />
          <Text style={[styles.damToggleText, showFavoritesOnly && styles.damToggleTextActive]}>Любими</Text>
        </Pressable>
        {catchMarkersCount > 0 ? (
          <Pressable
            onPress={onToggleCatchMarkers}
            style={[
              styles.damToggle,
              showCatchMarkers && { backgroundColor: '#E85D04', borderColor: '#E85D04' },
            ]}
            hitSlop={6}
          >
            <Text style={{ fontSize: 11 }}>🎣</Text>
            <Text style={[styles.damToggleText, showCatchMarkers && styles.damToggleTextActive]}>
              Мои улови
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hintVisible ? (
        <Pressable style={styles.hintBox} onPress={onHintDismiss} hitSlop={4}>
          <Ionicons name="information-circle-outline" size={15} color={colors.white} />
          <Text style={styles.hintText}>Дълго натискане за нов спот · приближи за имена</Text>
          <Ionicons name="close" size={13} color={colors.white} />
        </Pressable>
      ) : (
        <Pressable
          onPress={onHintShow}
          style={[styles.hintBox, { paddingHorizontal: spacing.sm }]}
          hitSlop={4}
        >
          <Ionicons name="information-circle-outline" size={15} color={colors.white} />
        </Pressable>
      )}
    </View>
  );
});

type SpotScrollBarProps = {
  spots: Spot[];
  userCoord: { latitude: number; longitude: number } | null;
  catchCountByName: Map<string, number>;
  colors: AppColors;
  waterTypeColor: (t: Spot['waterType']) => string;
  onSpotPress: (s: Spot) => void;
};

const SpotScrollBar = React.memo(function SpotScrollBar({
  spots,
  userCoord,
  catchCountByName,
  colors,
  waterTypeColor,
  onSpotPress,
}: SpotScrollBarProps) {
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  const distanceTo = (s: Spot) =>
    userCoord ? haversineKm(userCoord, { latitude: s.latitude, longitude: s.longitude }) : null;

  return (
    <View style={styles.spotList}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
      >
        {spots.map((s) => {
          const dist = distanceTo(s);
          return (
            <Pressable key={s.id} style={styles.spotCard} onPress={() => onSpotPress(s)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {s.isFavorite ? <Ionicons name="star" size={14} color="#E8B923" /> : null}
                <View style={[styles.spotDot, { backgroundColor: waterTypeColor(s.waterType) }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.spotName} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.spotMeta}>
                  {waterTypeLabel(s.waterType)}
                  {dist !== null
                    ? ` · ${dist < 1 ? `${Math.round(dist * 1000)} м` : `${dist.toFixed(1)} км`}`
                    : ''}
                  {(catchCountByName.get(s.name) ?? 0) > 0
                    ? ` · 🎣 ${catchCountByName.get(s.name)}`
                    : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

type NewSpotModalProps = {
  visible: boolean;
  coord: { latitude: number; longitude: number } | null;
  name: string;
  description: string;
  waterType: Spot['waterType'];
  colors: AppColors;
  onChangeName: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onChangeWaterType: (t: Spot['waterType']) => void;
  onClose: () => void;
  onSave: () => void;
};

const NewSpotModal = React.memo(function NewSpotModal({
  visible,
  coord,
  name,
  description,
  waterType,
  colors,
  onChangeName,
  onChangeDescription,
  onChangeWaterType,
  onClose,
  onSave,
}: NewSpotModalProps) {
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Нов спот</Text>
          <Text style={styles.modalCoords}>
            {coord?.latitude.toFixed(4)}, {coord?.longitude.toFixed(4)}
          </Text>
          <TextInput
            placeholder="Име на спота"
            value={name}
            onChangeText={onChangeName}
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            placeholder="Описание (по избор)"
            value={description}
            onChangeText={onChangeDescription}
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            multiline
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.types}>
            {WATER_TYPES.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => onChangeWaterType(t.id)}
                style={[
                  styles.typeChip,
                  waterType === t.id && { backgroundColor: t.color, borderColor: t.color },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons
                    name={t.ion}
                    size={16}
                    color={waterType === t.id ? colors.white : colors.textMuted}
                  />
                  <Text style={[styles.typeText, waterType === t.id && styles.typeTextActive]}>
                    {t.label}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
            <Button title="Отказ" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Запази" onPress={onSave} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
});

type WaterBodySheetProps = {
  selectedWater: SelectedWater | null;
  damWeather: WeatherSnapshot | null;
  damWeatherStatus: 'idle' | 'loading' | 'error';
  waterReports: WaterReport[];
  reportSheetOpen: boolean;
  reportActivity: number;
  reportCondition: WaterCondition;
  reportNote: string;
  reportSaving: boolean;
  damLevel: DamLevel | null;
  routeLoading: boolean;
  user: User | null;
  firebaseConfigured: boolean;
  colors: AppColors;
  onClose: () => void;
  onSaveAsFavorite: () => void;
  onShowOnMap: () => void;
  onRecordCatch: () => void;
  onOpenInAppRoute: () => void;
  onExternalRoute: () => void;
  onOpenLeaderboard: () => void;
  onOpenReportSheet: () => void;
  onCloseReportSheet: () => void;
  onReportActivityChange: (n: number) => void;
  onReportConditionChange: (c: WaterCondition) => void;
  onReportNoteChange: (s: string) => void;
  onSubmitReport: () => void;
};

const WaterBodySheet = React.memo(function WaterBodySheet({
  selectedWater,
  damWeather,
  damWeatherStatus,
  waterReports,
  reportSheetOpen,
  reportActivity,
  reportCondition,
  reportNote,
  reportSaving,
  damLevel,
  routeLoading,
  user,
  firebaseConfigured,
  colors,
  onClose,
  onSaveAsFavorite,
  onShowOnMap,
  onRecordCatch,
  onOpenInAppRoute,
  onExternalRoute,
  onOpenLeaderboard,
  onOpenReportSheet,
  onCloseReportSheet,
  onReportActivityChange,
  onReportConditionChange,
  onReportNoteChange,
  onSubmitReport,
}: WaterBodySheetProps) {
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  return (
    <Modal
      visible={!!selectedWater}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1 }}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Затвори панела за водоема"
        />
        <View style={styles.damModalWrap} pointerEvents="box-none">
          <View style={[styles.modal, styles.damModal]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedWater ? (
                <>
                  <View style={styles.damHeader}>
                    <View
                      style={[
                        styles.damBadge,
                        selectedWater.kind === 'river' && { backgroundColor: '#2E9B5A' },
                      ]}
                    >
                      <Ionicons
                        name={
                          selectedWater.kind === 'river' ? 'git-branch-outline' : 'layers-outline'
                        }
                        size={22}
                        color={colors.white}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalTitle}>{selectedWater.item.name}</Text>
                      <Text style={styles.modalSub}>
                        {selectedWater.kind === 'river' ? 'Река' : 'Язовир'} ·{' '}
                        {selectedWater.item.region}
                      </Text>
                    </View>
                  </View>

                  {selectedWater.item.description ? (
                    <Text style={styles.modalDesc}>{selectedWater.item.description}</Text>
                  ) : null}

                  <View style={styles.damMetaRow}>
                    {selectedWater.kind === 'dam' && selectedWater.item.area ? (
                      <View style={[styles.damMetaChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                        <Ionicons name="resize-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.damMetaText}>{selectedWater.item.area}</Text>
                      </View>
                    ) : null}
                    {selectedWater.kind === 'dam' && selectedWater.item.altitude ? (
                      <View style={[styles.damMetaChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                        <Ionicons name="triangle-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.damMetaText}>{selectedWater.item.altitude} м</Text>
                      </View>
                    ) : null}
                    {selectedWater.kind === 'river' && selectedWater.item.lengthKm ? (
                      <View style={[styles.damMetaChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                        <Ionicons name="arrow-forward-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.damMetaText}>{selectedWater.item.lengthKm}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.damMetaChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.damMetaText}>
                        {selectedWater.item.latitude.toFixed(3)},{' '}
                        {selectedWater.item.longitude.toFixed(3)}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.speciesTitle}>Време сега</Text>
                  {damWeatherStatus === 'loading' ? (
                    <View style={[styles.weatherCard, styles.weatherCenter]}>
                      <ActivityIndicator color={colors.primary} />
                      <Text style={styles.weatherLoadingText}>Зарежда времето…</Text>
                    </View>
                  ) : damWeatherStatus === 'error' ? (
                    <View style={[styles.weatherCard, styles.weatherCenter]}>
                      <Text style={styles.weatherErrorText}>Няма връзка с прогнозата</Text>
                    </View>
                  ) : damWeather ? (
                    <View style={styles.weatherCard}>
                      <View style={styles.weatherTopRow}>
                        <WeatherIcon weatherCode={damWeather.weatherCode} size={44} color={colors.primary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.weatherTemp}>{damWeather.temperatureC}°C</Text>
                          <Text style={styles.weatherDesc}>
                            {damWeather.description} · усеща се {damWeather.feelsLikeC}°
                          </Text>
                        </View>
                        <View style={styles.weatherRating}>
                          <StarRatingBar
                            rating={damWeather.fishingRating}
                            color={colors.accent}
                            emptyColor={colors.border}
                            size={14}
                          />
                          <Text style={styles.weatherRatingLabel}>индекс</Text>
                        </View>
                      </View>
                      <View style={styles.weatherDetailsRow}>
                        <View style={styles.weatherDetail}>
                          <Ionicons name="flag-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.weatherDetailValue}>
                            {damWeather.windKmh} км/ч {windDirectionLabel(damWeather.windDirection)}
                          </Text>
                          <Text style={styles.weatherDetailLabel}>вятър</Text>
                        </View>
                        <View style={styles.weatherDetail}>
                          <Ionicons name="speedometer-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.weatherDetailValue}>{damWeather.pressureHpa} hPa</Text>
                          <Text style={styles.weatherDetailLabel}>налягане</Text>
                        </View>
                        <View style={styles.weatherDetail}>
                          <Ionicons name="water-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.weatherDetailValue}>{damWeather.humidity}%</Text>
                          <Text style={styles.weatherDetailLabel}>влажност</Text>
                        </View>
                      </View>
                      <View style={[styles.weatherDetailsRow, { marginTop: spacing.sm, paddingTop: spacing.sm }]}>
                        <View style={styles.weatherDetail}>
                          <Ionicons name="rainy-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.weatherDetailValue}>
                            {damWeather.precipitationProbability}%
                          </Text>
                          <Text style={styles.weatherDetailLabel}>дъжд</Text>
                        </View>
                        <View style={styles.weatherDetail}>
                          <Ionicons name="sunny-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.weatherDetailValue}>UV {damWeather.uvIndex}</Text>
                          <Text style={styles.weatherDetailLabel}>UV индекс</Text>
                        </View>
                        <View style={styles.weatherDetail}>
                          <Ionicons name="cloud-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.weatherDetailValue}>{damWeather.cloudCover}%</Text>
                          <Text style={styles.weatherDetailLabel}>облачност</Text>
                        </View>
                      </View>
                      <View
                        style={{
                          marginTop: spacing.sm,
                          paddingTop: spacing.sm,
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        }}
                      >
                        <Text style={{ ...typography.caption, color: colors.textMuted }}>
                          {damWeather.moonPhaseName}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  {damWeather ? <BiteForecast weather={damWeather} /> : null}

                  <Text style={styles.speciesTitle}>Рапорти от рибари</Text>
                  {waterReports.length === 0 ? (
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm }}>
                      Все още няма рапорти за последните 24 ч.
                    </Text>
                  ) : (
                    waterReports.map((r) => (
                      <View
                        key={r.id}
                        style={{
                          backgroundColor: colors.surfaceAlt,
                          borderRadius: radius.md,
                          padding: spacing.sm,
                          marginBottom: spacing.sm,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 13 }}>
                          {r.reporterName}
                        </Text>
                        <Text style={{ ...typography.small, color: colors.textMuted }}>
                          {CONDITION_LABELS[r.waterCondition]} · {'⭐'.repeat(r.fishingActivity)}
                        </Text>
                        {r.note ? (
                          <Text style={{ ...typography.small, color: colors.text, marginTop: 2 }}>
                            {r.note}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  )}

                  {user && firebaseConfigured ? (
                    reportSheetOpen ? (
                      <View
                        style={{
                          backgroundColor: colors.card,
                          borderRadius: radius.md,
                          padding: spacing.md,
                          borderWidth: 1,
                          borderColor: colors.border,
                          marginBottom: spacing.sm,
                        }}
                      >
                        <Text style={{ ...typography.bodyBold, color: colors.text, marginBottom: spacing.sm }}>
                          Добави рапорт
                        </Text>
                        <Text style={{ ...typography.small, color: colors.textMuted, marginBottom: 4 }}>
                          Активност (1-5)
                        </Text>
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Pressable
                              key={n}
                              onPress={() => onReportActivityChange(n)}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor:
                                  n <= reportActivity ? colors.primary : colors.surfaceAlt,
                                borderWidth: 1,
                                borderColor: colors.border,
                              }}
                            >
                              <Text
                                style={{
                                  color: n <= reportActivity ? colors.white : colors.text,
                                  fontWeight: '700',
                                }}
                              >
                                {n}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <Text style={{ ...typography.small, color: colors.textMuted, marginBottom: 4 }}>
                          Вода
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                          {(['crystal', 'clear', 'murky', 'muddy'] as WaterCondition[]).map((c) => (
                            <Pressable
                              key={c}
                              onPress={() => onReportConditionChange(c)}
                              style={{
                                paddingHorizontal: spacing.sm,
                                paddingVertical: 4,
                                borderRadius: radius.pill,
                                backgroundColor:
                                  reportCondition === c ? colors.primary : colors.surfaceAlt,
                                borderWidth: 1,
                                borderColor: colors.border,
                              }}
                            >
                              <Text
                                style={{
                                  ...typography.small,
                                  color: reportCondition === c ? colors.white : colors.text,
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
                          onChangeText={onReportNoteChange}
                          style={{
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: radius.md,
                            paddingHorizontal: spacing.md,
                            paddingVertical: spacing.sm,
                            color: colors.text,
                            backgroundColor: colors.surfaceAlt,
                            marginBottom: spacing.sm,
                          }}
                          maxLength={200}
                        />
                        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                          <Button
                            title="Отказ"
                            variant="ghost"
                            compact
                            onPress={onCloseReportSheet}
                            style={{ flex: 1 }}
                          />
                          <Button
                            title="Изпрати"
                            compact
                            loading={reportSaving}
                            onPress={onSubmitReport}
                            style={{ flex: 1 }}
                          />
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        onPress={onOpenReportSheet}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}
                      >
                        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                        <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '600' }}>
                          Добави рапорт за{' '}
                          {selectedWater.kind === 'dam' ? 'язовира' : 'реката'}
                        </Text>
                      </Pressable>
                    )
                  ) : null}

                  <Text style={styles.speciesTitle}>Прогноза 7 дни</Text>
                  <ForecastStrip
                    latitude={selectedWater.item.latitude}
                    longitude={selectedWater.item.longitude}
                    cacheKey={selectedWater.item.id}
                  />

                  {selectedWater.item.species.length > 0 ? (
                    <>
                      <Text style={styles.speciesTitle}>Срещани видове</Text>
                      <View style={styles.speciesRow}>
                        {selectedWater.item.species.map((sp) => (
                          <View key={sp} style={styles.speciesChip}>
                            <Text style={styles.speciesText}>{sp}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {damLevel ? (
                    <>
                      <Text style={styles.speciesTitle}>Ниво на язовира</Text>
                      <View
                        style={{
                          backgroundColor: colors.primarySurface,
                          borderRadius: radius.md,
                          padding: spacing.md,
                          borderWidth: 1,
                          borderColor: colors.border,
                          marginBottom: spacing.sm,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                          <Ionicons name="water" size={22} color={colors.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ ...typography.h2, color: colors.primary }}>
                              {damLevel.fillPercent}%
                            </Text>
                            <Text style={{ ...typography.caption, color: colors.textMuted }}>
                              {damLevel.volumeMcm != null ? `${damLevel.volumeMcm} млн. м³ · ` : ''}
                              актуализирано{' '}
                              {new Date(damLevel.updatedAt).toLocaleDateString('bg-BG')}
                            </Text>
                          </View>
                        </View>
                        <View
                          style={{
                            height: 8,
                            backgroundColor: colors.border,
                            borderRadius: 4,
                            marginTop: spacing.sm,
                          }}
                        >
                          <View
                            style={{
                              height: 8,
                              width: `${damLevel.fillPercent}%`,
                              backgroundColor: colors.primary,
                              borderRadius: 4,
                            }}
                          />
                        </View>
                      </View>
                    </>
                  ) : null}

                  <DamFeedSection
                    damId={selectedWater.item.id}
                    damName={selectedWater.item.name}
                    user={user}
                    firebaseConfigured={firebaseConfigured}
                  />

                  <Button
                    title="Класиране за този водоем"
                    variant="secondary"
                    onPress={onOpenLeaderboard}
                    style={{ marginTop: spacing.lg }}
                  />
                  <Button
                    title="Маршрут в приложението"
                    onPress={onOpenInAppRoute}
                    loading={routeLoading}
                    style={{ marginTop: spacing.lg }}
                  />
                  <Button
                    title="Навигация в Google / Apple Maps"
                    variant="secondary"
                    onPress={onExternalRoute}
                    style={{ marginTop: spacing.md }}
                  />
                  <Button
                    title="Запиши улов от тук"
                    onPress={onRecordCatch}
                    style={{ marginTop: spacing.lg }}
                  />
                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                    <Button
                      title="Запази в любими"
                      variant="secondary"
                      onPress={onSaveAsFavorite}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Покажи на карта"
                      variant="secondary"
                      onPress={onShowOnMap}
                      style={{ flex: 1 }}
                    />
                  </View>
                </>
              ) : null}
              <Pressable
                onPress={onClose}
                style={{ alignItems: 'center', marginTop: spacing.md, paddingBottom: spacing.md }}
              >
                <Text style={{ color: colors.textMuted, ...typography.body }}>Затвори</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
});

type SpotSheetProps = {
  spot: Spot | null;
  userCoord: { latitude: number; longitude: number } | null;
  spotWeather: WeatherSnapshot | null;
  spotWeatherLoading: boolean;
  catchCountByName: Map<string, number>;
  togglingFavorite: boolean;
  colors: AppColors;
  onClose: () => void;
  onRemove: () => void;
  onRecordCatch: (target: { latitude: number; longitude: number; name: string }) => void;
  onToggleFavorite: () => void;
};

const SpotSheet = React.memo(function SpotSheet({
  spot,
  userCoord,
  spotWeather,
  spotWeatherLoading,
  catchCountByName,
  togglingFavorite,
  colors,
  onClose,
  onRemove,
  onRecordCatch,
  onToggleFavorite,
}: SpotSheetProps) {
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  return (
    <Modal visible={!!spot} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{spot?.name}</Text>
          <Text style={styles.modalSub}>{spot ? waterTypeLabel(spot.waterType) : ''}</Text>
          {spot ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: spacing.sm,
                paddingVertical: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Ionicons
                  name="star"
                  size={22}
                  color={spot.isFavorite ? '#E8B923' : colors.textMuted}
                />
                <Text style={typography.bodyBold}>Любим спот</Text>
              </View>
              <Switch
                value={!!spot.isFavorite}
                disabled={togglingFavorite}
                onValueChange={onToggleFavorite}
                trackColor={{ true: '#E8B923', false: colors.border }}
              />
            </View>
          ) : null}
          {spot?.description ? (
            <Text style={styles.modalDesc}>{spot.description}</Text>
          ) : null}
          {spot && (catchCountByName.get(spot.name) ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
              <Ionicons name="fish-outline" size={15} color={colors.primary} />
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '600' }}>
                {catchCountByName.get(spot.name)}{' '}
                {catchCountByName.get(spot.name) === 1 ? 'улов' : 'улова'} от тук
              </Text>
            </View>
          ) : null}
          {spotWeatherLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ ...typography.small, color: colors.textMuted }}>
                Зареждане на прогнозата…
              </Text>
            </View>
          ) : spotWeather ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: spacing.md,
                marginTop: spacing.md,
                padding: spacing.sm,
                backgroundColor: colors.primarySurface,
                borderRadius: 10,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
              }}
            >
              <WeatherIcon weatherCode={spotWeather.weatherCode} size={32} color={colors.primary} />
              <View>
                <Text style={{ ...typography.bodyBold, color: colors.text }}>
                  {spotWeather.temperatureC}°C · {spotWeather.description}
                </Text>
                <Text style={{ ...typography.small, color: colors.textMuted }}>
                  💨 {spotWeather.windKmh} км/ч · 💧 {spotWeather.humidity}% ·{' '}
                  {spotWeather.moonPhaseName}
                </Text>
              </View>
              <View style={{ marginLeft: 'auto' }}>
                <StarRatingBar
                  rating={spotWeather.fishingRating}
                  color={colors.accent}
                  emptyColor={colors.border}
                  size={12}
                />
                <Text style={{ ...typography.small, color: colors.textMuted, marginTop: 2, textAlign: 'right' }}>
                  риболов
                </Text>
              </View>
            </View>
          ) : null}
          <View style={[styles.modalRow, { flexWrap: 'wrap', gap: spacing.sm }]}>
            <Text style={styles.modalCoords}>
              {spot?.latitude.toFixed(4)}, {spot?.longitude.toFixed(4)}
            </Text>
            {spot && userCoord ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="navigate-outline" size={14} color={colors.textMuted} />
                <Text style={styles.modalCoords}>
                  {(() => {
                    const d = haversineKm(userCoord, {
                      latitude: spot.latitude,
                      longitude: spot.longitude,
                    });
                    return d < 1 ? `${Math.round(d * 1000)} м` : `${d.toFixed(1)} км`;
                  })()}
                </Text>
              </View>
            ) : null}
          </View>
          <Button
            title="Запиши улов от тук"
            onPress={() =>
              spot &&
              onRecordCatch({
                latitude: spot.latitude,
                longitude: spot.longitude,
                name: spot.name,
              })
            }
            style={{ marginTop: spacing.md }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
            <Button title="Затвори" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Изтрий" variant="danger" onPress={onRemove} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

function createMapStyles(colors: AppColors) {
  return StyleSheet.create({
    topControls: {
      position: 'absolute',
      top: spacing.md,
      left: 0,
      right: 0,
      alignItems: 'center',
      gap: spacing.sm,
    },
    mapTypeRow: {
      flexDirection: 'row',
      backgroundColor: colors.white,
      borderRadius: radius.pill,
      padding: 4,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    mapTypeBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
    mapTypeBtnActive: { backgroundColor: colors.primary },
    mapTypeText: { ...typography.caption, color: colors.text, fontWeight: '600' },
    mapTypeTextActive: { color: colors.white },
    hintBox: {
      backgroundColor: colors.overlay,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    hintText: { color: colors.white, ...typography.small },
    damToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    damToggleActive: { backgroundColor: '#062D3D', borderColor: '#062D3D' },
    riverToggleActive: { backgroundColor: '#1e6b3d', borderColor: '#1e6b3d' },
    favToggleActive: { backgroundColor: '#C49A00', borderColor: '#C49A00' },
    damToggleText: { ...typography.small, color: colors.text, fontWeight: '600' },
    damToggleTextActive: { color: colors.white },
    damHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    damBadge: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: '#062D3D',
      alignItems: 'center',
      justifyContent: 'center',
    },
    damMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    damMetaChip: {
      backgroundColor: colors.card,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    damMetaText: { ...typography.caption, color: colors.text },
    speciesTitle: {
      ...typography.bodyBold,
      color: colors.text,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    speciesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    speciesChip: {
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    speciesText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
    damModalWrap: { flex: 1, justifyContent: 'flex-end' },
    damModal: { maxHeight: '85%' },
    weatherCard: {
      backgroundColor: colors.primarySurface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    weatherCenter: { alignItems: 'center', justifyContent: 'center', minHeight: 90 },
    weatherLoadingText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
    weatherErrorText: { ...typography.body, color: colors.textMuted },
    weatherTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    weatherTemp: { ...typography.h1, color: colors.text },
    weatherDesc: { ...typography.body, color: colors.textMuted },
    weatherRating: { alignItems: 'flex-end' },
    weatherRatingLabel: { ...typography.small, color: colors.textMuted },
    weatherDetailsRow: {
      flexDirection: 'row',
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      justifyContent: 'space-between',
    },
    weatherDetail: { alignItems: 'center', flex: 1 },
    weatherDetailValue: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    weatherDetailLabel: { ...typography.small, color: colors.textMuted, marginTop: 2 },
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: 130,
      backgroundColor: colors.white,
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    searchFab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: 130 + 48 + spacing.md,
      backgroundColor: '#062D3D',
      paddingHorizontal: spacing.md,
      height: 40,
      borderRadius: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    searchFabText: { color: colors.white, ...typography.caption, fontWeight: '600' },
    routeClearFab: {
      position: 'absolute',
      left: spacing.lg,
      bottom: 130,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.white,
      paddingHorizontal: spacing.md,
      height: 40,
      borderRadius: 20,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    routeClearFabText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
    spotList: { position: 'absolute', bottom: spacing.md, left: 0, right: 0 },
    spotCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.white,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      minWidth: 200,
      maxWidth: 240,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    spotDot: { width: 10, height: 10, borderRadius: 5 },
    spotName: { ...typography.bodyBold, color: colors.text },
    spotMeta: { ...typography.caption, color: colors.textMuted },
    modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    modal: {
      backgroundColor: colors.background,
      padding: spacing.lg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    modalTitle: { ...typography.h2, color: colors.text },
    modalSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    modalDesc: { ...typography.body, color: colors.text, marginTop: spacing.sm },
    modalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
    modalCoords: { ...typography.caption, color: colors.textMuted },
    input: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.md,
    },
    types: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    typeChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    typeText: { ...typography.body, color: colors.text },
    typeTextActive: { color: colors.white, fontWeight: '600' },
  });
}
