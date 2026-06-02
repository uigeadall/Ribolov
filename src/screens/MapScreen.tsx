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
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import type { LeafletMapHandle, LeafletMapType } from '../components/LeafletMap';
import { MapEngineComponent } from '../components/mapEngineComponent';
import { Solunar7DayStrip } from '../components/Solunar7DayStrip';
import { WindCompassChip } from '../components/WindCompassChip';
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
  type LiveFishingPin,
} from '../services/liveFishingPins';
import { ensureDirectConversation } from '../services/cloudSync';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { fetchWeather, WeatherSnapshot } from '../services/weather';
import { TabsParamList } from '../navigation/types';
import { DamPicker } from '../components/DamPicker';
import { useAuth } from '../services/authContext';
import { WeatherIcon } from '../components/WeatherIcon';
import { StarRatingBar } from '../components/StarRatingBar';
import { handleError } from '../utils/handleError';
import { useAppNavigation } from '../navigation/useAppNavigation';
import Toast from 'react-native-toast-message';

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
  // Same synchronous-guard pattern as spotSavingRef. The button-level
  // `disabled` props use React state (liveSaving, togglingFavorite) which
  // lags one render — a sub-frame double tap slips through and fires two
  // writes. The favorite-toggle case is especially nasty: two rapid taps
  // toggle the bit twice, ending in the same state the user started in
  // (silent failure of intent).
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
  const [routeLine, setRouteLine] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const weatherCacheRef = useRef<Record<string, WeatherCacheEntry>>({});
  const { user, configured } = useAuth();
  const [hintVisible, setHintVisible] = useState(true);
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
  // Tracks the most recent heatmap fetch failure so the chip can flag the
  // offline/error state instead of looking like "loaded but empty".
  // Previously a network failure silently set cells to [] and the user just
  // saw a blank map with an inert "Хийтмап" chip — no signal anything went
  // wrong. The toast on failure makes the cause immediately visible; the
  // chip colour tracks the error so a subsequent retry tap clears it.
  const [heatmapError, setHeatmapError] = useState(false);
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
    setHeatmapError(false);
    // ~6 months of public catches — enough to populate cells; small enough
    // to stay under the 2500-doc limit on the service side for most regions.
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fetchSpeciesHeatmap(since, filterSpecies ?? undefined)
      .then((cells) => {
        if (cancelled) return;
        setHeatmapCells(cells);
        setHeatmapError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHeatmapCells([]);
        setHeatmapError(true);
        Toast.show({
          type: 'info',
          text1: 'Хийтмапът не е наличен',
          text2: 'Провери връзката и опитай отново.',
          position: 'bottom',
          visibilityTime: 2800,
        });
      })
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
  // Derive from the realtime `livePins` subscription rather than firing a
  // separate Firestore read every time pins update — the subscription is
  // already returning all active pins, so we can just find ours in there.
  useEffect(() => {
    if (!configured || !user) { setMyActivePin(null); return; }
    const mine = livePins.find((p) => p.ownerUid === user.uid) ?? null;
    setMyActivePin(mine);
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
      // Reset the synchronous guard before bailing — otherwise it stayed
      // true and every subsequent "Тук съм" tap silently no-op'd until
      // app restart.
      liveSavingRef.current = false;
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
        ownerName: user.displayName ?? 'Рибар',
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
    Alert.alert('Изтриване', `Изтриване на „${selected.name}“?`, [
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
    if (!d) return;
    setRouteLine(null);
    navigation.navigate('WaterDetail', { kind: 'dam', id: d.id });
  };

  const onRiverPress = (id: string) => {
    const r = RIVERS.find((x) => x.id === id);
    if (!r) return;
    setRouteLine(null);
    navigation.navigate('WaterDetail', { kind: 'river', id: r.id });
  };

  // Map center mirrors the persisted position so the WindCompassChip can
  // re-query weather when the user pans. We debounce the actual weather
  // fetch inside the chip itself (~800 ms) so this state can update on
  // every frame without spamming the API.
  const [mapCenter, setMapCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const saveMapPos = useCallback((lat: number, lng: number, zoom: number) => {
    AsyncStorage.setItem('@ribolov/lastMapPos', JSON.stringify({ lat, lng, zoom })).catch(() => {});
    setMapCenter({ latitude: lat, longitude: lng });
  }, []);

  const flyToSpot = (s: Spot) => {
    mapRef.current?.flyTo(s.latitude, s.longitude, 13);
    saveMapPos(s.latitude, s.longitude, 13);
  };

  const recordCatchAt = useCallback(
    (target: { latitude: number; longitude: number; name: string }) => {
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
        <MapEngineComponent
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

        {/* ── Wind compass chip ──
            Floating in the top-right of the map below the search bar /
            chips row. Shows the regional wind direction + speed at the
            current map center; debounces internally so panning doesn't
            spam the weather API. Falls back to userCoord when the user
            hasn't panned yet (cold-start state). */}
        {(mapCenter ?? userCoord) ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: insets.top + 130,
              right: 12,
            }}
          >
            <WindCompassChip
              latitude={(mapCenter ?? userCoord!).latitude}
              longitude={(mapCenter ?? userCoord!).longitude}
            />
          </View>
        ) : null}

        {/* ── Solunar 7-day strip ──
            Anchored above the spot scroll bar (or directly above the
            home-indicator when no spots). Always visible — gives users
            an at-a-glance view of which day this week is best to fish
            and uses their current location for the moon-transit math.
            Tap a day → fly the map to a wider zoom so they can plan a
            trip around that date. The strip is small (~52 px tall)
            so it doesn't fight the map for screen space. */}
        {userCoord ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              bottom: sortedSpots.length > 0 ? 140 : spacing.md + insets.bottom,
              left: 0,
              right: 0,
            }}
          >
            <Solunar7DayStrip
              latitude={userCoord.latitude}
              longitude={userCoord.longitude}
              onPressDay={(date) => {
                // Tap a day → fly to country zoom so user can pick a
                // spot for that day. A future improvement is to open
                // TripPlanner pre-filled with this date.
                mapRef.current?.flyTo(userCoord.latitude, userCoord.longitude, 8);
              }}
            />
          </View>
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
              <Ionicons
                name={heatmapError && showHeatmap ? 'cloud-offline-outline' : 'flame-outline'}
                size={13}
                color={showHeatmap ? '#fff' : colors.textMuted}
              />
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
          navigation.navigate('WaterDetail', { kind: pick.kind, id: pick.item.id });
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
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
          onPress={() => setSelectedLivePin(null)}
          accessibilityRole="button"
          accessibilityLabel="Затвори"
        >
          {selectedLivePin ? (
            <Pressable onPress={() => {}} accessible={false}>
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
                    accessibilityRole="button"
                    accessibilityLabel="Покажи на картата"
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surfaceAlt, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                  >
                    <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                    <Text style={{ color: colors.text, fontFamily: 'Nunito_700Bold' }}>Покажи</Text>
                  </Pressable>
                  {user && selectedLivePin.ownerUid === user.uid ? (
                    <Pressable
                      onPress={endFishingSession}
                      accessibilityRole="button"
                      accessibilityLabel="Прекрати риболовната сесия"
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
                            const myName = user.displayName ?? 'Рибар';
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
                        accessibilityRole="button"
                        accessibilityLabel={`Изпрати съобщение на ${selectedLivePin.ownerName}`}
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
                        accessibilityRole="button"
                        accessibilityLabel={`Виж профила на ${selectedLivePin.ownerName}`}
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
      {/* Backdrop is a Pressable so tapping outside the sheet dismisses it —
          standard iOS bottom-sheet behavior (Apple Maps, Google Maps,
          Files.app all do this). The sheet itself sits above and consumes
          its own touches, so taps land on the backdrop only when the user
          actually intended to leave the sheet. The sheet is text-input-free
          (no accidental data loss). */}
      <Pressable style={styles.modalOverlay} onPress={onClose} accessibilityRole="button" accessibilityLabel="Затвори">
        <Animated.View
          style={[styles.modal, { transform: [{ translateY: sheetPanY }] }]}
          onStartShouldSetResponder={() => true}
        >
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
      </Pressable>
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
  });
}
