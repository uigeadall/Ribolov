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
  InteractionManager,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { LeafletMap, LeafletMapHandle, LeafletMapType } from '../components/LeafletMap';
import { NativeMapView } from '../components/NativeMapView';
import { USE_REACT_NATIVE_MAPS } from '../config/mapEngine';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import AsyncStorage from '../storage/kv';
import { spotsStore, catchesStore, getCatchCountByName, newId } from '../storage/storage';
import { Spot } from '../types';
import type { CatchMapMarker, LiveFishingMarker, HeatmapCell } from '../components/LeafletMap';
import { fetchSpeciesHeatmap } from '../services/catchSync';
import { SharePickerModal, buildSpotSharedRef } from '../components/SharePickerModal';
import {
  subscribeActiveLivePins,
  createLiveFishingPin,
  deleteLiveFishingPin,
  getMyActiveLivePin,
  type LiveFishingPin,
} from '../services/liveFishingPins';
import { ensureDirectConversation } from '../services/cloudSync';
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
import Toast from 'react-native-toast-message';
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

function bearingDeg(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingLabel(deg: number): string {
  const dirs = ['С', 'СИ', 'И', 'ЮИ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return dirs[Math.round(deg / 45) % 8];
}

export default function MapScreen() {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
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
  // Synchronous double-tap guard for the NewSpotModal Save button. Same shape
  // as the AddCatch and PostCard guards — React's batched state-setter means
  // a plain `saving` bool is too slow to block a rapid second tap before the
  // first invocation reaches `spotsStore.save`. Each saveSpot call generates
  // a fresh newId() so without this guard two taps create TWO duplicate
  // spots at the same coordinates.
  const spotSavingRef = useRef(false);
  // Generation counter for in-app route fetches. Each openInAppRouteToWater
  // call bumps it + captures the local value; when the OSRM fetch resolves
  // we compare against the current ref. A user who tapped "Маршрут" for
  // dam A, then closed that sheet and tapped dam B before A's fetch
  // returned, would otherwise see A's route painted (and B's sheet closed)
  // out from under them.
  const routeRequestIdRef = useRef(0);
  // Same synchronous-guard pattern as spotSavingRef. The button-level
  // `disabled` props use React state (reportSaving, liveSaving,
  // togglingFavorite) which lags one render — a sub-frame double tap
  // slips through and fires two writes. The favorite-toggle case is
  // especially nasty: two rapid taps toggle the bit twice, ending in
  // the same state the user started in (silent failure of intent).
  const reportSavingRef = useRef(false);
  const liveSavingRef = useRef(false);
  const favoriteTogglingRef = useRef(false);
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
  const [layersOpen, setLayersOpen] = useState(false);
  const [catchCountByName, setCatchCountByName] = useState<Map<string, number>>(new Map());
  const [filterSpecies, setFilterSpecies] = useState<string | null>(null);
  // Privacy-aware species heatmap. Server returns pre-aggregated cells (3+
  // distinct anglers each, coords snapped to a coarse grid) — see
  // fetchSpeciesHeatmap. We fetch on toggle-on or species-filter change.
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  // Spot DM-share — when set, SharePickerModal opens with this spot's SharedRef.
  // Cleared when the picker closes (regardless of whether the user actually sent).
  const [shareSpotRef, setShareSpotRef] = useState<Spot | null>(null);

  // Live "fishing here right now" pins
  const [livePins, setLivePins] = useState<LiveFishingPin[]>([]);
  const [myActivePin, setMyActivePin] = useState<LiveFishingPin | null>(null);
  const [liveSheetOpen, setLiveSheetOpen] = useState(false);
  const [liveNote, setLiveNote] = useState('');
  const [liveSaving, setLiveSaving] = useState(false);
  const [selectedLivePin, setSelectedLivePin] = useState<LiveFishingPin | null>(null);
  const livePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  useFocusEffect(useCallback(() => {
    void ScreenOrientation.unlockAsync();
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Skip restoring last position if we're being focused on a specific water body —
    // otherwise the saved-position fly-to races and overrides the focus target.
    if (!focusDamId && !focusRiverId) {
      AsyncStorage.getItem('@ribolov/lastMapPos').then((raw) => {
        if (!raw) return;
        try {
          const pos = JSON.parse(raw) as { lat: number; lng: number; zoom: number };
          timer = setTimeout(() => mapRef.current?.flyTo(pos.lat, pos.lng, pos.zoom), 600);
        } catch {
          /* ignore bad data */
        }
      });
    }
    AsyncStorage.getItem('@ribolov/catchMarkersOn').then((v) => {
      if (v === 'true') setShowCatchMarkers(true);
    });
    return () => { if (timer) clearTimeout(timer); };
  }, [focusDamId, focusRiverId]);

  useEffect(() => {
    AsyncStorage.setItem('@ribolov/catchMarkersOn', showCatchMarkers ? 'true' : 'false').catch(
      () => {}
    );
  }, [showCatchMarkers]);

  // Heatmap data — fetched only when the layer is enabled, and refetched if
  // the species filter changes (so the heatmap visibly narrows to the chosen
  // species). Aggregation is done in the service; we never receive raw points.
  useEffect(() => {
    if (!showHeatmap) {
      setHeatmapCells([]);
      return;
    }
    let cancelled = false;
    setHeatmapLoading(true);
    // ~6 months of public catches — enough to populate cells; small enough
    // to stay under the 2500-doc limit on the service side for most regions.
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fetchSpeciesHeatmap(since, filterSpecies ?? undefined)
      .then((cells) => { if (!cancelled) setHeatmapCells(cells); })
      .catch(() => { if (!cancelled) setHeatmapCells([]); })
      .finally(() => { if (!cancelled) setHeatmapLoading(false); });
    return () => { cancelled = true; };
  }, [showHeatmap, filterSpecies]);

  const load = useCallback(async () => {
    const [loadedSpots, catches] = await Promise.all([spotsStore.list(), catchesStore.list()]);
    setSpots(loadedSpots);
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
    setCatchCountByName(getCatchCountByName(catches));
  }, []);

  const catchSpeciesList = useMemo(() => {
    const seen = new Set<string>();
    catchMarkers.forEach((m) => { if (m.speciesName) seen.add(m.speciesName); });
    return Array.from(seen).sort();
  }, [catchMarkers]);

  const filteredCatchMarkers = useMemo(() => {
    if (!filterSpecies) return catchMarkers;
    return catchMarkers.filter((m) => m.speciesName === filterSpecies);
  }, [catchMarkers, filterSpecies]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => { load(); });
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setUserCoord({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        /* GPS may be off or simulator has no location — ignore */
      }
    })();
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [load]);

  // Refresh spots + catch markers + catchCountByName whenever the Map tab
  // refocuses. Without this, adding a catch via AddCatchScreen and returning
  // to the map shows stale data until the screen fully remounts (kill-app or
  // pop-from-stack). The catchesStore in-memory cache makes the re-read
  // cheap, so running on every focus is fine. Pattern matches LogbookScreen
  // and TournamentsScreen.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

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

  const spotCenter = useMemo(() => {
    if (sortedSpots.length === 0) return null;
    const avgLat = sortedSpots.reduce((s, x) => s + x.latitude, 0) / sortedSpots.length;
    const avgLng = sortedSpots.reduce((s, x) => s + x.longitude, 0) / sortedSpots.length;
    return { latitude: avgLat, longitude: avgLng };
  }, [sortedSpots]);

  const distanceTo = useCallback(
    (s: Spot) =>
      userCoord
        ? haversineKm(userCoord, { latitude: s.latitude, longitude: s.longitude })
        : null,
    [userCoord]
  );

  // Live pins — real-time subscription to all active pins on the map.
  useEffect(() => {
    if (!configured) return;
    const unsub = subscribeActiveLivePins(setLivePins);
    return unsub;
  }, [configured]);

  // Track whether THIS user already has an active pin (so the FAB toggles).
  useEffect(() => {
    if (!configured || !user) { setMyActivePin(null); return; }
    let cancelled = false;
    getMyActiveLivePin(user.uid).then((p) => { if (!cancelled) setMyActivePin(p); });
    return () => { cancelled = true; };
  }, [configured, user, livePins]);

  // Pulse the FAB while an active pin is up — subtle visual cue that a session is running.
  useEffect(() => {
    if (!myActivePin) {
      livePulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(livePulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => { loop.stop(); };
  }, [myActivePin, livePulse]);

  // Marker form (lat/lng/note) for the native map.
  const liveMarkers = useMemo<LiveFishingMarker[]>(
    () => livePins.map((p) => ({
      id: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      ownerUid: p.ownerUid,
      ownerName: p.ownerName,
      note: p.note,
      expiresAt: p.expiresAt,
    })),
    [livePins],
  );

  const onLivePinPress = useCallback((id: string) => {
    const pin = livePins.find((p) => p.id === id);
    if (pin) setSelectedLivePin(pin);
  }, [livePins]);

  const startFishingSession = useCallback(async () => {
    if (!user) return;
    if (myActivePin) {
      // Already active — show the pin instead
      setSelectedLivePin(myActivePin);
      return;
    }
    setLiveSheetOpen(true);
  }, [user, myActivePin]);

  const confirmFishingSession = useCallback(async () => {
    if (!user || liveSavingRef.current) return;
    liveSavingRef.current = true;
    let lat = userCoord?.latitude;
    let lon = userCoord?.longitude;
    if (lat == null || lon == null) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude; lon = loc.coords.longitude;
          setUserCoord({ latitude: lat, longitude: lon });
        }
      } catch { /* ignore */ }
    }
    if (lat == null || lon == null) {
      Alert.alert('Локация', 'За пускане на жив пин е нужна локация. Разреши GPS.');
      return;
    }
    // Auto-detect the nearest dam/river — radius matches what the leaderboard uses.
    const nearestDam = DAMS
      .map((d) => ({ name: d.name, km: haversineKm({ latitude: lat!, longitude: lon! }, { latitude: d.latitude, longitude: d.longitude }) }))
      .filter((d) => d.km <= 5)
      .sort((a, b) => a.km - b.km)[0];
    const nearestRiver = nearestDam ? null : RIVERS
      .map((r) => ({ name: r.name, km: haversineKm({ latitude: lat!, longitude: lon! }, { latitude: r.latitude, longitude: r.longitude }) }))
      .filter((r) => r.km <= 3)
      .sort((a, b) => a.km - b.km)[0];
    const detectedWater = (nearestDam ?? nearestRiver)?.name;
    setLiveSaving(true);
    try {
      const id = await createLiveFishingPin({
        ownerUid: user.uid,
        ownerName: user.displayName ?? user.email ?? 'Рибар',
        ownerPhotoUrl: user.photoURL ?? undefined,
        latitude: lat,
        longitude: lon,
        note: liveNote.trim() || undefined,
        waterName: detectedWater,
      });
      setLiveSheetOpen(false);
      setLiveNote('');
      // Optimistically reflect my pin
      setMyActivePin({
        id,
        ownerUid: user.uid,
        ownerName: user.displayName ?? 'Рибар',
        ownerPhotoUrl: user.photoURL ?? undefined,
        latitude: lat,
        longitude: lon,
        note: liveNote.trim() || undefined,
        waterName: detectedWater,
        expiresAt: Date.now() + 4 * 3600_000,
      });
    } catch (e) {
      handleError(e);
    } finally {
      liveSavingRef.current = false;
      setLiveSaving(false);
    }
  }, [user, liveNote, liveSaving, userCoord]);

  const endFishingSession = useCallback(async () => {
    if (!myActivePin) return;
    Alert.alert(
      'Прекрати',
      'Сигурен ли си? Жив пинът ще изчезне за всички.',
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Прекрати',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteLiveFishingPin(myActivePin.id);
              setMyActivePin(null);
              setSelectedLivePin(null);
            } catch (e) {
              handleError(e);
            }
          },
        },
      ],
    );
  }, [myActivePin]);

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
    if (spotSavingRef.current) return;
    if (!pendingCoord) return;
    if (!name.trim()) {
      Alert.alert('Име', 'Дай име на спота, за да го запазиш.');
      return;
    }
    spotSavingRef.current = true;
    try {
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
    } finally {
      spotSavingRef.current = false;
    }
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

  const saveMapPos = useCallback((lat: number, lng: number, zoom: number) => {
    AsyncStorage.setItem('@ribolov/lastMapPos', JSON.stringify({ lat, lng, zoom })).catch(() => {});
  }, []);

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
      Toast.show({ type: 'success', text1: 'Запазен в любими', text2: `„${item.name}" е добавен в любимите ти спотове.`, visibilityTime: 2500 });
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
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Локация', 'Разреши достъп до локацията в настройките.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserCoord(c);
      mapRef.current?.flyTo(c.latitude, c.longitude, 13);
    } catch {
      Alert.alert('Локация', 'Неуспешно засичане на текущата позиция. Опитай отново.');
    }
  };

  const openInAppRouteToWater = useCallback(async () => {
    if (!selectedWater) return;
    // Capture the dam we're routing TO so we can verify the user is still on
    // the same sheet when OSRM responds. Without this, a slow response can
    // paint a stale route + close a sheet the user opened after switching
    // dams.
    const requestedWater = selectedWater;
    const requestId = ++routeRequestIdRef.current;
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
      } catch {
        /* Use last known position if GPS lookup fails */
      }
      if (!origin) {
        Alert.alert(
          'Локация',
          'За маршрут в приложението е нужна текуща позиция. Натисни бутона за локация на картата или разреши GPS.'
        );
        return;
      }
      const pts = await fetchDrivingRoutePoints(origin, {
        latitude: requestedWater.item.latitude,
        longitude: requestedWater.item.longitude,
      });
      // Bail if the user has since fired a different route fetch OR closed
      // the sheet for `requestedWater` (or moved to a different dam). Either
      // condition means this response is stale.
      if (requestId !== routeRequestIdRef.current) return;
      setRouteLine(pts);
      // Only auto-close the sheet if it's still showing the same dam we
      // routed to — preserves UX when the user moved on.
      setSelectedWater((curr) => (curr === requestedWater ? null : curr));
    } catch {
      // Don't show the error if a newer route request superseded this one;
      // the newer one will handle its own outcome.
      if (requestId === routeRequestIdRef.current) {
        Alert.alert(
          'Маршрут',
          'Неуспешно изчисляване по пътища. Провери интернет или опитай навигация във външно приложение.'
        );
      }
    } finally {
      if (requestId === routeRequestIdRef.current) {
        setRouteLoading(false);
      }
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
    if (!selectedWater || !user || reportSavingRef.current) return;
    reportSavingRef.current = true;
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
      reportSavingRef.current = false;
      setReportSaving(false);
    }
  }, [selectedWater, user, reportActivity, reportCondition, reportNote]);

  const handleToggleFavorite = useCallback(async () => {
    if (!selected || favoriteTogglingRef.current) return;
    favoriteTogglingRef.current = true;
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
      favoriteTogglingRef.current = false;
      setTogglingFavorite(false);
    }
  }, [selected, togglingFavorite, showFavoritesOnly]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ── Map (full screen base layer) ── */}
      <View style={StyleSheet.absoluteFill}>
        {USE_REACT_NATIVE_MAPS ? (
          <NativeMapView
            ref={mapRef}
            spots={sortedSpots}
            dams={!showFavoritesOnly && showDams ? DAMS : []}
            rivers={!showFavoritesOnly && showRivers ? RIVERS : []}
            catchMarkers={showCatchMarkers ? filteredCatchMarkers : []}
            heatmapCells={showHeatmap ? heatmapCells : []}
            pendingCoord={pendingCoord}
            userCoord={userCoord}
            routeLine={routeLine}
            mapType={mapType}
            onLongPress={(lat, lng) => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              setPendingCoord({ latitude: lat, longitude: lng });
              setName('');
              setDescription('');
            }}
            onMarkerPress={onMarkerPress}
            onDamPress={onDamPress}
            onRiverPress={onRiverPress}
            onLivePinPress={onLivePinPress}
            liveFishingMarkers={liveMarkers}
            onMapMove={saveMapPos}
          />
        ) : (
          <LeafletMap
            ref={mapRef}
            spots={sortedSpots}
            dams={!showFavoritesOnly && showDams ? DAMS : []}
            rivers={!showFavoritesOnly && showRivers ? RIVERS : []}
            catchMarkers={showCatchMarkers ? filteredCatchMarkers : []}
            heatmapCells={showHeatmap ? heatmapCells : []}
            pendingCoord={pendingCoord}
            userCoord={userCoord}
            routeLine={routeLine}
            mapType={mapType}
            onLongPress={(lat, lng) => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              setPendingCoord({ latitude: lat, longitude: lng });
              setName('');
              setDescription('');
            }}
            onMarkerPress={onMarkerPress}
            onDamPress={onDamPress}
            onRiverPress={onRiverPress}
            onMapMove={saveMapPos}
          />
        )}

        {sortedSpots.length > 1 && spotCenter ? (
          <Pressable
            style={[styles.fab, { bottom: 130 + 48 + spacing.sm + 40 + spacing.sm + 56 }]}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              mapRef.current?.flyTo(spotCenter.latitude, spotCenter.longitude, 9);
            }}
            accessibilityLabel="Виж всички спотове"
          >
            <Ionicons name="contract-outline" size={22} color={colors.primary} />
          </Pressable>
        ) : null}

        {(showCatchMarkers || showHeatmap) && catchSpeciesList.length > 1 ? (
          <SpeciesFilterRow
            species={catchSpeciesList}
            selected={filterSpecies}
            colors={colors}
            onSelect={(s) => setFilterSpecies((prev) => (prev === s ? null : s))}
          />
        ) : null}

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
            mode={mode}
            waterTypeColor={waterTypeColor}
            onSpotPress={flyToSpot}
            onSpotLongPress={(s) => recordCatchAt({ latitude: s.latitude, longitude: s.longitude, name: s.name })}
          />
        ) : null}
      </View>

      {/* ── Floating top controls ── */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 10, left: 12, right: 12, gap: 8 }}>
        {/* Search bar row */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: mode === 'dark' ? 'rgba(18,28,36,0.96)' : 'rgba(255,255,255,0.97)',
          borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <Pressable style={{ flex: 1 }} onPress={() => setPickerOpen(true)}>
            <Text style={{ fontSize: 15, color: colors.textMuted, fontFamily: 'Nunito_600SemiBold' }}>
              Търси язовир или река…
            </Text>
          </Pressable>
          <Pressable
            onPress={locateMe}
            hitSlop={8}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="locate" size={18} color={colors.primary} />
          </Pressable>
        </View>

        {/* Filter chips row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingRight: 4 }}
          style={{}}
        >
          {/* Map type segment */}
          <View style={{
            flexDirection: 'row', overflow: 'hidden', borderRadius: 20,
            backgroundColor: mode === 'dark' ? 'rgba(18,28,36,0.96)' : 'rgba(255,255,255,0.97)',
            shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}>
            {(['standard', 'satellite', 'hybrid'] as LeafletMapType[]).map((type, idx) => (
              <Pressable
                key={type}
                onPress={() => setMapType(type)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 7,
                  backgroundColor: mapType === type ? colors.primary : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: mapType === type ? '#fff' : colors.textMuted }}>
                  {(['Карта', 'Сателит', 'Хибрид'])[idx]}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Toggle chips */}
          {[
            { key: 'dams', active: showDams, icon: 'layers-outline' as const, label: 'Язовири', activeColor: '#062D3D', onPress: () => setShowDams((v) => !v) },
            { key: 'rivers', active: showRivers, icon: 'git-branch-outline' as const, label: 'Реки', activeColor: '#1e6b3d', onPress: () => setShowRivers((v) => !v) },
            { key: 'favs', active: showFavoritesOnly, icon: 'star' as const, label: 'Любими', activeColor: '#B8860B', onPress: () => setShowFavoritesOnly((v) => !v) },
          ].map((chip) => (
            <Pressable
              key={chip.key}
              onPress={chip.onPress}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                backgroundColor: chip.active ? chip.activeColor : (mode === 'dark' ? 'rgba(18,28,36,0.96)' : 'rgba(255,255,255,0.97)'),
                shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              }}
            >
              <Ionicons name={chip.icon} size={13} color={chip.active ? '#fff' : colors.textMuted} />
              <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: chip.active ? '#fff' : colors.text }}>
                {chip.label}
              </Text>
            </Pressable>
          ))}

          {catchMarkers.length > 0 ? (
            <Pressable
              onPress={() => setShowCatchMarkers((v) => !v)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                backgroundColor: showCatchMarkers ? '#E85D04' : (mode === 'dark' ? 'rgba(18,28,36,0.96)' : 'rgba(255,255,255,0.97)'),
                shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              }}
            >
              <Text style={{ fontSize: 12 }}>🎣</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: showCatchMarkers ? '#fff' : colors.text }}>
                Мои улови
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => setShowHeatmap((v) => !v)}
            accessibilityLabel="Хийтмап на улови"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
              backgroundColor: showHeatmap ? '#C92A2A' : (mode === 'dark' ? 'rgba(18,28,36,0.96)' : 'rgba(255,255,255,0.97)'),
              shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
              elevation: 4,
            }}
          >
            {heatmapLoading ? (
              <ActivityIndicator size="small" color={showHeatmap ? '#fff' : colors.primary} />
            ) : (
              <Ionicons name="flame-outline" size={13} color={showHeatmap ? '#fff' : colors.textMuted} />
            )}
            <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: showHeatmap ? '#fff' : colors.text }}>
              Хийтмап
            </Text>
          </Pressable>
        </ScrollView>
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
        onShareToFriend={() => { if (selected) setShareSpotRef(selected); }}
      />

      {/* Lazy-mounted DM share sheet for spots — only renders when a spot is
          actively being shared. Pattern matches FeedPost and PostCard. */}
      {shareSpotRef && (
        <SharePickerModal
          visible
          onClose={() => setShareSpotRef(null)}
          sharedRef={buildSpotSharedRef(shareSpotRef)}
        />
      )}

      {/* Live "fishing here now" FAB — bottom-right above the spot scroll bar */}
      {user && configured ? (
        <View
          style={{
            position: 'absolute',
            right: 16,
            bottom: 130 + 48 + 8 + 40 + 8,
          }}
          pointerEvents="box-none"
        >
          {/* Pulsing halo behind active FAB */}
          {myActivePin ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -6, left: -6, right: -6, bottom: -6,
                borderRadius: 32,
                backgroundColor: '#E85D04',
                opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
                transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
              }}
            />
          ) : null}
          <Pressable
            onPress={startFishingSession}
            style={{
              paddingHorizontal: 14, paddingVertical: 10,
              borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: myActivePin ? '#E85D04' : 'rgba(232,93,4,0.92)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
              shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8,
              elevation: 6,
            }}
            accessibilityLabel="Жив пин на яза"
          >
            <Ionicons name={myActivePin ? 'flame' : 'flame-outline'} size={18} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {myActivePin ? 'Активен пин' : 'Тук съм'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Start session sheet */}
      <Modal visible={liveSheetOpen} transparent animationType="fade" onRequestClose={() => setLiveSheetOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }} onPress={() => setLiveSheetOpen(false)}>
          <Pressable onPress={() => {}}>
            <View style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg,
              borderTopWidth: 1, borderColor: colors.border,
            }}>
              <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#E85D04', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="flame" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 17, fontFamily: 'Nunito_800ExtraBold', color: colors.text }}>Тук съм за риболов</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    Изчезва автоматично след 4 часа
                  </Text>
                </View>
              </View>
              <Text style={{ fontSize: 11, fontFamily: 'Nunito_700Bold', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 4 }}>
                Кратко съобщение (по избор)
              </Text>
              <TextInput
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: 12, borderWidth: 1, borderColor: colors.border,
                  paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 14,
                }}
                placeholder="напр. Хапе на пиявица, ела при мен"
                placeholderTextColor={colors.textMuted}
                value={liveNote}
                onChangeText={setLiveNote}
                maxLength={200}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.lg }}>
                <Pressable
                  onPress={() => { setLiveSheetOpen(false); setLiveNote(''); }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surfaceAlt }}
                >
                  <Text style={{ color: colors.text, fontFamily: 'Nunito_700Bold' }}>Отказ</Text>
                </Pressable>
                <Pressable
                  onPress={confirmFishingSession}
                  disabled={liveSaving}
                  style={{ flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#E85D04', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: liveSaving ? 0.6 : 1 }}
                >
                  {liveSaving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="flame" size={18} color="#fff" />}
                  <Text style={{ color: '#fff', fontFamily: 'Nunito_800ExtraBold' }}>{liveSaving ? 'Пускам…' : 'Пусни пин'}</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Live pin detail */}
      <Modal visible={selectedLivePin != null} transparent animationType="fade" onRequestClose={() => setSelectedLivePin(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }} onPress={() => setSelectedLivePin(null)}>
          {selectedLivePin ? (
            <Pressable onPress={() => {}}>
              <View style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: 28, borderTopRightRadius: 28,
                padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg,
                borderTopWidth: 1, borderColor: colors.border,
              }}>
                <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#E85D04', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="flame" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontFamily: 'Nunito_800ExtraBold', color: colors.text }}>
                      {selectedLivePin.ownerName} е тук
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {selectedLivePin.waterName ? `${selectedLivePin.waterName} · ` : ''}
                      Изчезва след {Math.max(1, Math.round((selectedLivePin.expiresAt - Date.now()) / 60_000))} мин
                    </Text>
                  </View>
                </View>
                {selectedLivePin.note ? (
                  <View style={{
                    backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12,
                    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
                  }}>
                    <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>{selectedLivePin.note}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={() => {
                      const pin = selectedLivePin;
                      setSelectedLivePin(null);
                      mapRef.current?.flyTo(pin.latitude, pin.longitude, 13);
                    }}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surfaceAlt, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                  >
                    <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                    <Text style={{ color: colors.text, fontFamily: 'Nunito_700Bold' }}>Покажи</Text>
                  </Pressable>
                  {user && selectedLivePin.ownerUid === user.uid ? (
                    <Pressable
                      onPress={endFishingSession}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.danger, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                    >
                      <Ionicons name="close-circle-outline" size={16} color="#fff" />
                      <Text style={{ color: '#fff', fontFamily: 'Nunito_700Bold' }}>Прекрати</Text>
                    </Pressable>
                  ) : user && selectedLivePin.ownerUid !== user.uid ? (
                    <>
                      <Pressable
                        onPress={async () => {
                          const pin = selectedLivePin;
                          if (!user) return;
                          try {
                            const myName = user.displayName ?? user.email ?? 'Рибар';
                            const convId = await ensureDirectConversation(user.uid, myName, pin.ownerUid, pin.ownerName);
                            setSelectedLivePin(null);
                            (navigation as any).navigate('ProfileTab', {
                              screen: 'ChatDetail',
                              params: { convId, otherUid: pin.ownerUid, otherName: pin.ownerName },
                            });
                          } catch (e) {
                            handleError(e);
                          }
                        }}
                        style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                      >
                        <Ionicons name="chatbubble-outline" size={16} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: 'Nunito_700Bold' }}>Чат</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          const pin = selectedLivePin;
                          setSelectedLivePin(null);
                          navigation.navigate('UserPublicProfile', { uid: pin.ownerUid, displayName: pin.ownerName });
                        }}
                        style={{ width: 48, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surfaceAlt, justifyContent: 'center' }}
                      >
                        <Ionicons name="person-outline" size={18} color={colors.primary} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type MapTopControlsProps = {
  colors: AppColors;
  mode: 'light' | 'dark';
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
  mode,
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
      <View style={[styles.mapTypeRow, { overflow: 'hidden' }]}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={80} tint={mode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: mode === 'dark' ? 'rgba(10,25,32,0.92)' : 'rgba(240,250,255,0.95)' }]} />
        )}
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
  mode: 'light' | 'dark';
  waterTypeColor: (t: Spot['waterType']) => string;
  onSpotPress: (s: Spot) => void;
  onSpotLongPress: (s: Spot) => void;
};

const SpotScrollBar = React.memo(function SpotScrollBar({
  spots,
  userCoord,
  catchCountByName,
  colors,
  mode,
  waterTypeColor,
  onSpotPress,
  onSpotLongPress,
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
            <View key={s.id} style={[styles.spotCard, { overflow: 'hidden', backgroundColor: 'transparent', borderLeftWidth: 3, borderLeftColor: waterTypeColor(s.waterType) }]}>
              {Platform.OS === 'ios' ? (
                <BlurView intensity={75} tint={mode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: mode === 'dark' ? 'rgba(14,33,41,0.96)' : 'rgba(245,252,255,0.97)' }]} />
              )}
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}
                onPress={() => onSpotPress(s)}
                onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSpotLongPress(s); }}
                delayLongPress={400}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {s.isFavorite ? <Ionicons name="star" size={14} color="#E8B923" /> : null}
                  <Ionicons
                    name={WATER_TYPES.find((x) => x.id === s.waterType)?.ion ?? 'water-outline'}
                    size={15}
                    color={waterTypeColor(s.waterType)}
                  />
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
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
});

type SpeciesFilterRowProps = {
  species: string[];
  selected: string | null;
  colors: AppColors;
  onSelect: (s: string) => void;
};

const SpeciesFilterRow = React.memo(function SpeciesFilterRow({
  species,
  selected,
  colors,
  onSelect,
}: SpeciesFilterRowProps) {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 140 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.xs, alignItems: 'center' }}
        style={{ maxHeight: 44 }}
      >
        {species.map((s) => {
          const active = selected === s;
          return (
            <Pressable
              key={s}
              onPress={() => onSelect(s)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                shadowColor: '#000',
                shadowOpacity: 0.1,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              }}
            >
              <Text style={{ ...typography.small, fontWeight: '600', color: active ? colors.white : colors.text }} numberOfLines={1}>
                {s}
              </Text>
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {WATER_TYPES.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => onChangeWaterType(t.id)}
                style={{
                  flex: 1,
                  minWidth: '28%',
                  alignItems: 'center',
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  backgroundColor: waterType === t.id ? t.color + '22' : colors.card,
                  borderColor: waterType === t.id ? t.color : colors.border,
                }}
              >
                <Ionicons
                  name={t.ion}
                  size={22}
                  color={waterType === t.id ? t.color : colors.textMuted}
                />
                <Text style={{
                  ...typography.small,
                  color: waterType === t.id ? t.color : colors.text,
                  fontWeight: '600',
                  marginTop: 4,
                  textAlign: 'center',
                }}>
                  {t.label}
                </Text>
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
  const sheetPanY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) sheetPanY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(sheetPanY, { toValue: 700, duration: 200, useNativeDriver: true }).start(() => {
            sheetPanY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
        }
      },
    })
  ).current;
  const headerColor = selectedWater?.kind === 'river' ? '#2E9B5A' : '#0E4D64';
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
          <Animated.View style={[styles.modal, styles.damModal, { transform: [{ translateY: sheetPanY }] }]}>
            <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: spacing.xxl + 24 }}
            >
              {selectedWater ? (
                <>
                  <LinearGradient
                    colors={[headerColor, headerColor + '44']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
                  >
                    <Ionicons
                      name={selectedWater?.kind === 'river' ? 'git-branch-outline' : 'layers-outline'}
                      size={18}
                      color={colors.white}
                    />
                    <Text style={{ ...typography.small, color: colors.white, fontWeight: '700', opacity: 0.9 }}>
                      {selectedWater?.kind === 'river' ? 'Река' : 'Язовир'}
                    </Text>
                  </LinearGradient>
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

                  {/* Primary CTA — the action we actually want users to take. */}
                  <Pressable
                    onPress={onRecordCatch}
                    style={({ pressed }) => [styles.primaryCta, pressed && { opacity: 0.85 }]}
                  >
                    <Ionicons name="fish" size={20} color="#fff" />
                    <Text style={styles.primaryCtaText}>Запиши улов от тук</Text>
                  </Pressable>

                  {/* Secondary actions — compact icon pills, horizontal scroll
                      so we never have wrap issues regardless of label length. */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pillRowContent}
                  >
                    <Pressable style={styles.iconPill} onPress={onSaveAsFavorite}>
                      <Ionicons name="star-outline" size={18} color="#C49A00" />
                      <Text style={styles.iconPillText}>Любими</Text>
                    </Pressable>
                    <Pressable style={styles.iconPill} onPress={onShowOnMap}>
                      <Ionicons name="map-outline" size={18} color={colors.primary} />
                      <Text style={styles.iconPillText}>На карта</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.iconPill, routeLoading && { opacity: 0.6 }]}
                      onPress={onOpenInAppRoute}
                      disabled={routeLoading}
                    >
                      {routeLoading
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Ionicons name="navigate-outline" size={18} color={colors.primary} />}
                      <Text style={styles.iconPillText}>Маршрут</Text>
                    </Pressable>
                    <Pressable style={styles.iconPill} onPress={onExternalRoute}>
                      <Ionicons name="open-outline" size={18} color={colors.primary} />
                      <Text style={styles.iconPillText}>Навигация</Text>
                    </Pressable>
                    <Pressable style={styles.iconPill} onPress={onOpenLeaderboard}>
                      <Ionicons name="trophy-outline" size={18} color="#C49A00" />
                      <Text style={styles.iconPillText}>Класиране</Text>
                    </Pressable>
                  </ScrollView>
                </>
              ) : null}
              {/* Standalone "Затвори" text removed — the drag handle is the
                  affordance for closing the sheet. Removed both the visual
                  noise and the overlap bug where the text collided with the
                  last row of the old 3x2 action grid. */}
            </ScrollView>
          </Animated.View>
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
  onShareToFriend: () => void;
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
  onShareToFriend,
}: SpotSheetProps) {
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  const sheetPanY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) sheetPanY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(sheetPanY, { toValue: 700, duration: 200, useNativeDriver: true }).start(() => {
            sheetPanY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
        }
      },
    })
  ).current;
  const spotTypeColor = spot
    ? (WATER_TYPES.find((x) => x.id === spot.waterType)?.color ?? colors.primary)
    : colors.primary;
  return (
    <Modal visible={!!spot} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[styles.modal, { transform: [{ translateY: sheetPanY }] }]}>
          <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <View style={{ height: 3, backgroundColor: spotTypeColor, borderRadius: 2, marginBottom: spacing.sm }} />
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
            {spot && userCoord ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="compass-outline" size={14} color={colors.textMuted} />
                <Text style={styles.modalCoords}>
                  {bearingLabel(bearingDeg(userCoord, { latitude: spot.latitude, longitude: spot.longitude }))}
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
          <Button
            title="Сподели в чат"
            variant="secondary"
            onPress={onShareToFriend}
            style={{ marginTop: spacing.sm }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
            <Button title="Затвори" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Изтрий" variant="danger" onPress={onRemove} style={{ flex: 1 }} />
          </View>
        </Animated.View>
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
      backgroundColor: 'transparent',
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
    layersFab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: 130 + 48 + spacing.sm + 40 + spacing.sm,
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
    layersPanel: {
      position: 'absolute',
      right: spacing.lg + 48 + spacing.sm,
      bottom: 130 + 48 + spacing.sm + 40 + spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.sm,
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 5,
    },
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
    actionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    actionBtn: {
      flex: 1,
      minWidth: '30%',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    actionBtnText: {
      ...typography.small,
      color: colors.text,
      fontWeight: '600',
      textAlign: 'center',
    },
    // New dam-sheet action styles — primary CTA + horizontal icon pill row
    primaryCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      marginTop: spacing.lg,
      shadowColor: colors.primary,
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
    pillRowContent: {
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingRight: spacing.lg,
    },
    iconPill: {
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
    iconPillText: {
      ...typography.small,
      color: colors.text,
      fontWeight: '700',
      fontSize: 13,
    },
  });
}
