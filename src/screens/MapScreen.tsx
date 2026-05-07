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
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { LeafletMap, LeafletMapHandle, LeafletMapType } from '../components/LeafletMap';
import { NativeMapView } from '../components/NativeMapView';
import { USE_REACT_NATIVE_MAPS } from '../config/mapEngine';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { spotsStore, newId } from '../storage/storage';
import { Spot } from '../types';
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

type SelectedWater = { kind: 'dam'; item: Dam } | { kind: 'river'; item: River };

type WeatherCacheEntry = { data: WeatherSnapshot; fetchedAt: number };
const WEATHER_TTL_MS = 30 * 60 * 1000;

const WATER_TYPES: { id: Spot['waterType']; label: string; ion: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { id: 'lake', label: 'Езеро', ion: 'water-outline', color: '#1A7A9C' },
  { id: 'dam', label: 'Язовир', ion: 'layers-outline', color: '#0E4D64' },
  { id: 'river', label: 'Река', ion: 'git-branch-outline', color: '#2E9B5A' },
  { id: 'pond', label: 'Микроязовир', ion: 'ellipse-outline', color: '#7BB7CC' },
  { id: 'sea', label: 'Море', ion: 'boat-outline', color: '#062D3D' },
];

const waterTypeLabel = (t: Spot['waterType']) => WATER_TYPES.find((x) => x.id === t)?.label ?? '';

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function MapScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createMapStyles(colors), [colors]);
  const waterTypeColor = (t: Spot['waterType']) => WATER_TYPES.find((x) => x.id === t)?.color ?? colors.primary;

  const mapRef = useRef<LeafletMapHandle>(null);
  const navigation = useNavigation<NavigationProp<TabsParamList>>();
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

  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    setSpots(await spotsStore.list());
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
    let list = showFavoritesOnly ? spots.filter((s) => s.isFavorite) : [...spots];
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

  const distanceTo = (s: Spot) =>
    userCoord ? haversineKm(userCoord, { latitude: s.latitude, longitude: s.longitude }) : null;

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
        if (cancelled) return;
        setDamWeatherStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWater]);

  const onLongPress = (lat: number, lng: number) => {
    setPendingCoord({ latitude: lat, longitude: lng });
  };

  const flyToSpot = (s: Spot) => mapRef.current?.flyTo(s.latitude, s.longitude, 13);

  const flyToWaterBody = (lat: number, lng: number) => {
    mapRef.current?.flyTo(lat, lng, 12);
    setSelectedWater(null);
  };

  const saveWaterBodyAsFavorite = async (kind: 'dam' | 'river', item: Dam | River) => {
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
  };

  const recordCatchAt = (target: { latitude: number; longitude: number; name: string }) => {
    setSelectedWater(null);
    setSelected(null);
    navigation.navigate('LogbookTab', {
      screen: 'AddCatch',
      params: { prefillLocation: target },
    });
  };

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

  const openInAppRouteToWater = async () => {
    if (!selectedWater) return;
    setRouteLoading(true);
    try {
      let origin = userCoord;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
  };

  const openExternalDrivingRouteToWater = async () => {
    if (!selectedWater) return;
    let origin = userCoord;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        origin = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserCoord(origin);
      }
    } catch {
      /* ползвай последната позиция от картата, ако има */
    }
    await openDrivingDirections(
      { latitude: selectedWater.item.latitude, longitude: selectedWater.item.longitude },
      { origin }
    );
  };

  return (
    <Screen padded={false}>
      <View style={{ flex: 1 }}>
        {USE_REACT_NATIVE_MAPS ? (
          <NativeMapView
            ref={mapRef}
            spots={sortedSpots}
            dams={!showFavoritesOnly && showDams ? DAMS : []}
            rivers={!showFavoritesOnly && showRivers ? RIVERS : []}
            pendingCoord={pendingCoord}
            userCoord={userCoord}
            routeLine={routeLine}
            mapType={mapType}
            onLongPress={onLongPress}
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
            pendingCoord={pendingCoord}
            userCoord={userCoord}
            routeLine={routeLine}
            mapType={mapType}
            onLongPress={onLongPress}
            onMarkerPress={onMarkerPress}
            onDamPress={onDamPress}
            onRiverPress={onRiverPress}
          />
        )}

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
                onPress={() => setMapType(t.key)}
                style={[styles.mapTypeBtn, mapType === t.key && styles.mapTypeBtnActive]}
              >
                <Text style={[styles.mapTypeText, mapType === t.key && styles.mapTypeTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
            <Pressable
              onPress={() => setShowDams((v) => !v)}
              style={[styles.damToggle, showDams && styles.damToggleActive]}
              hitSlop={6}
            >
              <Ionicons name="layers-outline" size={13} color={showDams ? colors.white : colors.primary} />
              <Text style={[styles.damToggleText, showDams && styles.damToggleTextActive]}>Язовири</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowRivers((v) => !v)}
              style={[styles.damToggle, showRivers && styles.riverToggleActive]}
              hitSlop={6}
            >
              <Ionicons name="git-branch-outline" size={13} color={showRivers ? colors.white : '#2E9B5A'} />
              <Text style={[styles.damToggleText, showRivers && styles.damToggleTextActive]}>Реки</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowFavoritesOnly((v) => !v)}
              style={[styles.damToggle, showFavoritesOnly && styles.favToggleActive]}
              hitSlop={6}
            >
              <Ionicons name="star" size={13} color={showFavoritesOnly ? colors.white : '#C49A00'} />
              <Text style={[styles.damToggleText, showFavoritesOnly && styles.damToggleTextActive]}>Любими</Text>
            </Pressable>
          </View>
          {hintVisible ? (
            <Pressable style={styles.hintBox} onPress={() => setHintVisible(false)} hitSlop={4}>
              <Ionicons name="information-circle-outline" size={15} color={colors.white} />
              <Text style={styles.hintText}>
                Дълго натискане за нов спот · приближи за имена
              </Text>
              <Ionicons name="close" size={13} color={colors.white} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setHintVisible(true)}
              style={[styles.hintBox, { paddingHorizontal: spacing.sm }]}
              hitSlop={4}
            >
              <Ionicons name="information-circle-outline" size={15} color={colors.white} />
            </Pressable>
          )}
        </View>

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
          <View style={styles.spotList}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
            >
              {sortedSpots.map((s) => {
                const dist = distanceTo(s);
                return (
                  <Pressable key={s.id} style={styles.spotCard} onPress={() => flyToSpot(s)}>
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
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
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

      <Modal visible={!!pendingCoord} animationType="slide" transparent onRequestClose={() => setPendingCoord(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Нов спот</Text>
            <Text style={styles.modalCoords}>
              {pendingCoord?.latitude.toFixed(4)}, {pendingCoord?.longitude.toFixed(4)}
            </Text>
            <TextInput
              placeholder="Име на спота"
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              placeholder="Описание (по избор)"
              value={description}
              onChangeText={setDescription}
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              multiline
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.types}>
              {WATER_TYPES.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setWaterType(t.id)}
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
                    <Text style={[styles.typeText, waterType === t.id && styles.typeTextActive]}>{t.label}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <Button title="Отказ" variant="secondary" onPress={() => setPendingCoord(null)} style={{ flex: 1 }} />
              <Button title="Запази" onPress={saveSpot} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!selectedWater}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedWater(null)}
      >
        <View style={{ flex: 1 }}>
          <Pressable
            style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }]}
            onPress={() => setSelectedWater(null)}
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
                    name={selectedWater.kind === 'river' ? 'git-branch-outline' : 'layers-outline'}
                    size={22}
                    color={colors.white}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{selectedWater.item.name}</Text>
                  <Text style={styles.modalSub}>
                    {selectedWater.kind === 'river' ? 'Река' : 'Язовир'} · {selectedWater.item.region}
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
                    {selectedWater.item.latitude.toFixed(3)}, {selectedWater.item.longitude.toFixed(3)}
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
                      <StarRatingBar rating={damWeather.fishingRating} color={colors.accent} emptyColor={colors.border} size={14} />
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
                      <Text style={styles.weatherDetailValue}>{damWeather.precipitationProbability}%</Text>
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
                  <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted }}>
                      {damWeather.moonPhaseName}
                    </Text>
                  </View>
                </View>
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

              <DamFeedSection
                damId={selectedWater.item.id}
                damName={selectedWater.item.name}
                user={user}
                firebaseConfigured={configured}
              />

              <Button
                title="Класиране за този водоем"
                variant="secondary"
                onPress={() => {
                  setSelectedWater(null);
                  navigation.navigate('ProfileTab', {
                    screen: 'Leaderboard',
                    params:
                      selectedWater.kind === 'dam'
                        ? { damId: selectedWater.item.id }
                        : { riverId: selectedWater.item.id },
                  });
                }}
                style={{ marginTop: spacing.lg }}
              />

              <Button
                title="Маршрут в приложението"
                onPress={() => void openInAppRouteToWater()}
                loading={routeLoading}
                style={{ marginTop: spacing.lg }}
              />
              <Button
                title="Навигация в Google / Apple Maps"
                variant="secondary"
                onPress={() => void openExternalDrivingRouteToWater()}
                style={{ marginTop: spacing.md }}
              />

              <Button
                title="Запиши улов от тук"
                onPress={() =>
                  recordCatchAt({
                    latitude: selectedWater.item.latitude,
                    longitude: selectedWater.item.longitude,
                    name: selectedWater.item.name,
                  })
                }
                style={{ marginTop: spacing.lg }}
              />
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <Button
                  title="Запази в любими"
                  variant="secondary"
                  onPress={() =>
                    saveWaterBodyAsFavorite(selectedWater.kind, selectedWater.item)
                  }
                  style={{ flex: 1 }}
                />
                <Button
                  title="Покажи на карта"
                  variant="secondary"
                  onPress={() =>
                    flyToWaterBody(selectedWater.item.latitude, selectedWater.item.longitude)
                  }
                  style={{ flex: 1 }}
                />
              </View>
                </>
              ) : null}
              <Pressable
                onPress={() => setSelectedWater(null)}
                style={{ alignItems: 'center', marginTop: spacing.md, paddingBottom: spacing.md }}
              >
                <Text style={{ color: colors.textMuted, ...typography.body }}>Затвори</Text>
              </Pressable>
            </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{selected?.name}</Text>
            <Text style={styles.modalSub}>{selected ? waterTypeLabel(selected.waterType) : ''}</Text>
            {selected ? (
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
                  <Ionicons name="star" size={22} color={selected.isFavorite ? '#E8B923' : colors.textMuted} />
                  <Text style={typography.bodyBold}>Любим спот</Text>
                </View>
                <Switch
                  value={!!selected.isFavorite}
                  disabled={togglingFavorite}
                  onValueChange={async () => {
                    if (togglingFavorite) return;
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
                      if (showFavoritesOnly && !fresh.isFavorite) {
                        setSelected(null);
                      }
                    } finally {
                      setTogglingFavorite(false);
                    }
                  }}
                  trackColor={{ true: '#E8B923', false: colors.border }}
                />
              </View>
            ) : null}
            {selected?.description ? <Text style={styles.modalDesc}>{selected.description}</Text> : null}
            <View style={[styles.modalRow, { flexWrap: 'wrap', gap: spacing.sm }]}>
              <Text style={styles.modalCoords}>
                {selected?.latitude.toFixed(4)}, {selected?.longitude.toFixed(4)}
              </Text>
              {selected && userCoord ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="navigate-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.modalCoords}>
                    {(() => {
                      const d = haversineKm(userCoord, {
                        latitude: selected.latitude,
                        longitude: selected.longitude,
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
                selected &&
                recordCatchAt({
                  latitude: selected.latitude,
                  longitude: selected.longitude,
                  name: selected.name,
                })
              }
              style={{ marginTop: spacing.md }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <Button title="Затвори" variant="secondary" onPress={() => setSelected(null)} style={{ flex: 1 }} />
              <Button title="Изтрий" variant="danger" onPress={removeSelected} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function createMapStyles(colors: AppColors) {
  return StyleSheet.create({
  topControls: { position: 'absolute', top: spacing.md, left: 0, right: 0, alignItems: 'center', gap: spacing.sm },
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
  damHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  damBadge: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: '#062D3D',
    alignItems: 'center', justifyContent: 'center',
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
  speciesTitle: { ...typography.bodyBold, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
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
