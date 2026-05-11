import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { LogbookStackParamList } from '../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { BanPeriodCard } from '../components/BanPeriodCard';
import { TripPickerModal } from '../components/TripPickerModal';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { catchesStore, tripsStore, newId } from '../storage/storage';
import { speciesList } from '../data/species';
import { Achievement, Catch, TripPlan } from '../types';
import { useAuth } from '../services/authContext';
import { doc, getDoc } from 'firebase/firestore';
import { pushCatch, ensureCatchPhotoUploadedForCloud } from '../services/cloudSync';
import { ensureFirebase } from '../services/firebase';
import { enqueueCatchSync } from '../services/catchSyncQueue';
import { checkBanPeriod } from '../services/notifications';
import { checkNewPersonalBest } from '../services/personalBests';
import { checkForNewUnlocks } from '../services/achievements';
import { AchievementUnlockModal } from '../components/AchievementUnlockModal';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { isRemoteImageUri } from '../utils/formatCatchDate';
import { handleError } from '../utils/handleError';
import { fetchWeather } from '../services/weather';

// ─── Form state (reducer) ────────────────────────────────────────────────────

type FormState = {
  speciesId: string;
  weight: string;
  length: string;
  bait: string;
  notes: string;
  photoTitle: string;
  released: boolean;
  shareToFeed: boolean;
  photoUri: string | undefined;
  locationCoords: { lat: number; lon: number } | null;
  locationName: string;
  cameraVerifiedPhoto: boolean;
  extraPhotoUris: string[];
  tripId: string | undefined;
};

type FormAction =
  | { type: 'SET_SPECIES'; payload: string }
  | { type: 'SET_WEIGHT'; payload: string }
  | { type: 'SET_LENGTH'; payload: string }
  | { type: 'SET_BAIT'; payload: string }
  | { type: 'SET_NOTES'; payload: string }
  | { type: 'SET_PHOTO_TITLE'; payload: string }
  | { type: 'SET_RELEASED'; payload: boolean }
  | { type: 'SET_SHARE_TO_FEED'; payload: boolean }
  | { type: 'SET_PHOTO'; payload: { uri: string | undefined; cameraVerified: boolean } }
  | { type: 'CLEAR_PHOTO' }
  | { type: 'SET_LOCATION'; payload: { coords: { lat: number; lon: number }; name: string } }
  | { type: 'ADD_EXTRA_PHOTO'; payload: string }
  | { type: 'REMOVE_EXTRA_PHOTO'; payload: number }
  | { type: 'SET_TRIP'; payload: string | undefined }
  | { type: 'LOAD_CATCH'; payload: Partial<FormState> };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_SPECIES': return { ...state, speciesId: action.payload };
    case 'SET_WEIGHT': return { ...state, weight: action.payload };
    case 'SET_LENGTH': return { ...state, length: action.payload };
    case 'SET_BAIT': return { ...state, bait: action.payload };
    case 'SET_NOTES': return { ...state, notes: action.payload };
    case 'SET_PHOTO_TITLE': return { ...state, photoTitle: action.payload.slice(0, 120) };
    case 'SET_RELEASED': return { ...state, released: action.payload };
    case 'SET_SHARE_TO_FEED': return { ...state, shareToFeed: action.payload };
    case 'SET_PHOTO': return { ...state, photoUri: action.payload.uri, cameraVerifiedPhoto: action.payload.cameraVerified };
    case 'CLEAR_PHOTO': return { ...state, photoUri: undefined, photoTitle: '', cameraVerifiedPhoto: false };
    case 'SET_LOCATION': return { ...state, locationCoords: action.payload.coords, locationName: action.payload.name };
    case 'ADD_EXTRA_PHOTO': return { ...state, extraPhotoUris: [...state.extraPhotoUris, action.payload] };
    case 'REMOVE_EXTRA_PHOTO': return { ...state, extraPhotoUris: state.extraPhotoUris.filter((_, i) => i !== action.payload) };
    case 'SET_TRIP': return { ...state, tripId: action.payload };
    case 'LOAD_CATCH': return { ...state, ...action.payload };
    default: return state;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function compressPhoto(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    return uri;
  }
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AddCatchScreen() {
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<LogbookStackParamList, 'AddCatch'>>();
  const prefill = route.params?.prefillLocation;
  const editCatchId = route.params?.editCatchId;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createAddCatchStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { user, configured } = useAuth();

  const [form, dispatch] = useReducer(formReducer, {
    speciesId: speciesList[0].id,
    weight: '',
    length: '',
    bait: '',
    notes: '',
    photoTitle: '',
    released: false,
    shareToFeed: false,
    photoUri: undefined,
    locationCoords: prefill ? { lat: prefill.latitude, lon: prefill.longitude } : null,
    locationName: prefill?.name ?? '',
    cameraVerifiedPhoto: false,
    extraPhotoUris: [],
    tripId: undefined,
  });

  const [saving, setSaving] = useState(false);
  const [unlockedNow, setUnlockedNow] = useState<Achievement[]>([]);
  const [editLoaded, setEditLoaded] = useState(!editCatchId);
  const [initialCatch, setInitialCatch] = useState<Catch | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const formDirtyRef = useRef(false);
  const conditionsRef = useRef<Catch['conditions'] | null>(null);
  // Stable ID prevents duplicate entries on retry
  const catchIdRef = useRef<string>(editCatchId ?? newId());

  const selectedSpecies = useMemo(
    () => speciesList.find((s) => s.id === form.speciesId)!,
    [form.speciesId]
  );
  const banInfo = useMemo(
    () => checkBanPeriod(selectedSpecies?.banPeriod),
    [selectedSpecies]
  );

  useEffect(() => {
    tripsStore.list().then(setTrips);
  }, []);

  useEffect(() => {
    if (form.weight || form.length || form.bait || form.notes || form.photoUri) {
      formDirtyRef.current = true;
    }
  }, [form.weight, form.length, form.bait, form.notes, form.photoUri]);

  useEffect(() => {
    if (editCatchId || saving) return;
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!formDirtyRef.current) return;
      e.preventDefault();
      Alert.alert(
        'Несъхранени данни',
        'Уловът не е записан. Сигурен ли си, че искаш да излезеш?',
        [
          { text: 'Остани', style: 'cancel' },
          { text: 'Излез', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsub;
  }, [navigation, editCatchId, saving]);

  useEffect(() => {
    if (!editCatchId) return;
    let alive = true;
    catchesStore.list().then((list) => {
      const c = list.find((x) => x.id === editCatchId);
      if (!alive) return;
      if (!c) {
        Alert.alert('Грешка', 'Записът не е намерен.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }
      setInitialCatch(c);
      dispatch({
        type: 'LOAD_CATCH',
        payload: {
          speciesId: speciesList.some((s) => s.id === c.speciesId) ? c.speciesId : speciesList[0].id,
          weight: c.weightKg != null ? String(c.weightKg) : '',
          length: c.lengthCm != null ? String(c.lengthCm) : '',
          bait: c.bait ?? '',
          notes: c.notes ?? '',
          photoTitle: c.photoTitle ?? '',
          released: !!c.released,
          photoUri: c.photoUri,
          cameraVerifiedPhoto: isRemoteImageUri(c.photoUri) || c.photoTakenWithAppCamera === true,
          locationCoords: c.location
            ? { lat: c.location.latitude, lon: c.location.longitude }
            : null,
          locationName: c.location?.name ?? '',
          tripId: c.tripId,
        },
      });
      if (c.conditions) conditionsRef.current = c.conditions;
      setEditLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [editCatchId, navigation]);

  useEffect(() => {
    if (!form.locationCoords) return;
    let cancelled = false;
    fetchWeather(form.locationCoords.lat, form.locationCoords.lon)
      .then((snap) => {
        if (cancelled) return;
        conditionsRef.current = {
          temperatureC: snap.temperatureC,
          pressureHpa: snap.pressureHpa,
          windKmh: snap.windKmh,
          moonPhase: snap.moonPhase,
          moonPhaseName: snap.moonPhaseName,
          fishingRating: snap.fishingRating,
        };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.locationCoords]);

  useEffect(() => {
    if (!editCatchId || !configured || !user) return;
    const fb = ensureFirebase();
    if (!fb) return;
    let cancelled = false;
    void getDoc(doc(fb.db, 'publicCatches', editCatchId)).then((snap) => {
      if (!cancelled && snap.exists()) dispatch({ type: 'SET_SHARE_TO_FEED', payload: true });
    });
    return () => {
      cancelled = true;
    };
  }, [editCatchId, configured, user]);

  const pickPhoto = async () => {
    if (form.shareToFeed) {
      Alert.alert(
        'Само камерата',
        'За публично споделяне и класиките снимката трябва да е заснета с камерата в приложението — така се ограничава качване на стари снимки от галерията.'
      );
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нужно е разрешение', 'Разреши достъп до галерията, за да добавиш снимка.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      dispatch({
        type: 'SET_PHOTO',
        payload: { uri: await compressPhoto(result.assets[0].uri), cameraVerified: false },
      });
    }
  };

  const takePhoto = async () => {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.status === 'denied' && !current.canAskAgain) {
      Alert.alert(
        'Достъп до камерата',
        'Ribolov няма достъп до камерата. Отвори настройките на телефона и разреши достъп.',
        [
          { text: 'Отказ', style: 'cancel' },
          { text: 'Отвори настройките', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Достъп до камерата', 'Разреши достъп до камерата в настройките на телефона.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      dispatch({
        type: 'SET_PHOTO',
        payload: { uri: await compressPhoto(result.assets[0].uri), cameraVerified: true },
      });
    }
  };

  const addExtraPhoto = async () => {
    if (form.extraPhotoUris.length >= 4) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Достъп до галерията', 'Разреши достъп до галерията в настройките на телефона.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      dispatch({
        type: 'ADD_EXTRA_PHOTO',
        payload: await compressPhoto(result.assets[0].uri),
      });
    }
  };

  const grabLocation = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нужно е разрешение', 'Разреши достъп до локацията.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    let name = '';
    try {
      const places = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (places[0]) {
        const p = places[0];
        name = [p.name, p.city ?? p.region].filter(Boolean).join(', ');
      }
    } catch {}
    dispatch({
      type: 'SET_LOCATION',
      payload: {
        coords: { lat: loc.coords.latitude, lon: loc.coords.longitude },
        name,
      },
    });
  };

  const syncCatchToCloud = async (
    catchItem: Catch,
    sharePublic: boolean
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!user) return { ok: true };
    try {
      let toSync = catchItem;
      if (catchItem.photoUri?.trim() && !/^https?:\/\//i.test(catchItem.photoUri.trim())) {
        toSync = await ensureCatchPhotoUploadedForCloud(catchItem, user.uid);
      }
      await pushCatch(toSync, user.uid, user.displayName ?? user.email ?? 'Рибар', sharePublic);
      await catchesStore.save({ ...toSync, syncedToCloud: true });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  };

  const save = async () => {
    if (!form.speciesId) return;
    const trimmedPhotoTitle = form.photoTitle.trim().slice(0, 120);
    const uri = form.photoUri?.trim();
    if (form.shareToFeed && uri && !isRemoteImageUri(uri) && !form.cameraVerifiedPhoto) {
      Alert.alert(
        'Нужна е камерата',
        'За публично споделяне и участие в класиките снимката не може да е от галерията. Направи я с камерата в приложението или изключи публичното споделяне.'
      );
      return;
    }

    setSaving(true);
    const id = catchIdRef.current;
    const photoTakenWithAppCamera = !uri
      ? undefined
      : isRemoteImageUri(uri)
      ? initialCatch?.photoTakenWithAppCamera ?? false
      : form.cameraVerifiedPhoto;

    const item: Catch = {
      id,
      speciesId: form.speciesId,
      speciesName: selectedSpecies.nameBg,
      weightKg: (() => { const v = parseFloat(form.weight.replace(',', '.')); return isNaN(v) ? undefined : v; })(),
      lengthCm: (() => { const v = parseFloat(form.length.replace(',', '.')); return isNaN(v) ? undefined : v; })(),
      date: initialCatch?.date ?? new Date().toISOString(),
      bait: form.bait || undefined,
      notes: form.notes || undefined,
      ...(form.photoUri && trimmedPhotoTitle ? { photoTitle: trimmedPhotoTitle } : {}),
      released: form.released,
      photoUri: form.photoUri,
      extraPhotoUris: form.extraPhotoUris.length > 0 ? form.extraPhotoUris : undefined,
      photoTakenWithAppCamera,
      ...(uri &&
      initialCatch?.photoUri?.trim() === uri &&
      isRemoteImageUri(uri) &&
      initialCatch.photoStoragePath
        ? { photoStoragePath: initialCatch.photoStoragePath }
        : {}),
      location: form.locationCoords
        ? {
            latitude: form.locationCoords.lat,
            longitude: form.locationCoords.lon,
            name: form.locationName || undefined,
          }
        : undefined,
      ...(form.tripId ? { tripId: form.tripId } : {}),
      conditions: conditionsRef.current ?? initialCatch?.conditions ?? undefined,
    };

    try {
      await catchesStore.save(item);
      if (user) {
        const sync = await syncCatchToCloud(item, form.shareToFeed);
        if (!sync.ok) {
          await enqueueCatchSync(item.id, form.shareToFeed);
          Alert.alert(
            'Облачна грешка',
            `Уловът е записан локално. Синхронизацията ще се повтори автоматично при връзка. Подробности: ${sync.message}\n\nМожеш да опиташ и ръчно.`,
            [
              { text: 'OK', style: 'cancel' },
              {
                text: 'Опитай отново',
                onPress: async () => {
                  const again = await syncCatchToCloud(item, form.shareToFeed);
                  if (again.ok) Alert.alert('Готово', 'Уловът е синхронизиран с облака.');
                  else Alert.alert('Пак неуспех', again.message);
                },
              },
            ]
          );
        }
      } else if (form.shareToFeed) {
        Alert.alert('Нужен е акаунт', 'За да споделиш публично, влез/регистрирай се в Профил.');
      }

      const allCatches = await catchesStore.list();
      const pb = checkNewPersonalBest(item, allCatches);
      if (pb.isNew && !editCatchId) {
        const pbMsg =
          pb.field === 'both'
            ? 'Нов личен рекорд по тегло и дължина! 🏆'
            : pb.field === 'weight'
            ? 'Нов личен рекорд по тегло! 🏆'
            : 'Нов личен рекорд по дължина! 🏆';
        Alert.alert('Личен рекорд!', `${item.speciesName} — ${pbMsg}`);
      }

      const achCtx = { firebaseConfigured: configured, userLoggedIn: !!user, uid: user?.uid };
      const newUnlocks = await checkForNewUnlocks(allCatches, achCtx);
      Toast.show({
        type: 'success',
        text1: editCatchId ? 'Уловът е обновен' : 'Уловът е записан',
        visibilityTime: 2000,
      });
      if (newUnlocks.length > 0) {
        setUnlockedNow(newUnlocks);
      } else {
        navigation.goBack();
      }
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  };

  if (editCatchId && !editLoaded) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} {...keyboardAwareScrollProps}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
          <Text style={styles.title}>{editCatchId ? 'Редактирай улов' : 'Нов улов'}</Text>
          <View style={{ width: 28 }} />
        </View>

        <PhotoSection
          photoUri={form.photoUri}
          shareToFeed={form.shareToFeed}
          extraPhotoUris={form.extraPhotoUris}
          photoTitle={form.photoTitle}
          colors={colors}
          styles={styles}
          onPickPhoto={() => void pickPhoto()}
          onTakePhoto={() => void takePhoto()}
          onClearPhoto={() => dispatch({ type: 'CLEAR_PHOTO' })}
          onAddExtraPhoto={() => void addExtraPhoto()}
          onRemoveExtraPhoto={(i) => dispatch({ type: 'REMOVE_EXTRA_PHOTO', payload: i })}
          onChangePhotoTitle={(t) => dispatch({ type: 'SET_PHOTO_TITLE', payload: t })}
        />

        <Text style={styles.label}>Вид риба</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
        >
          <View>
            <Text style={{ ...typography.bodyBold, color: colors.text }}>
              {selectedSpecies.nameBg}
            </Text>
            <Text style={{ ...typography.small, color: colors.textMuted, fontStyle: 'italic' }}>
              {selectedSpecies.nameLatin}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </Pressable>
        <SpeciesPicker
          visible={pickerOpen}
          selectedId={form.speciesId}
          onSelect={(id) => dispatch({ type: 'SET_SPECIES', payload: id })}
          onClose={() => setPickerOpen(false)}
        />

        <BanPeriodCard speciesName={selectedSpecies.nameBg} banInfo={banInfo} />

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Тегло (кг)</Text>
            <TextInput
              value={form.weight}
              onChangeText={(v) => dispatch({ type: 'SET_WEIGHT', payload: v })}
              placeholder="напр. 2.5"
              keyboardType="decimal-pad"
              returnKeyType="next"
              style={styles.input}
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Дължина (см)</Text>
            <TextInput
              value={form.length}
              onChangeText={(v) => dispatch({ type: 'SET_LENGTH', payload: v })}
              placeholder="напр. 45"
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={colors.textMuted}
            />
            <WeightEstimator
              length={form.length}
              weight={form.weight}
              speciesId={form.speciesId}
              colors={colors}
              onAccept={(w) => dispatch({ type: 'SET_WEIGHT', payload: w })}
            />
          </View>
        </View>

        <Text style={styles.label}>Стръв / примамка</Text>
        <TextInput
          value={form.bait}
          onChangeText={(v) => dispatch({ type: 'SET_BAIT', payload: v })}
          placeholder="напр. царевица, червей, воблер..."
          returnKeyType="next"
          style={styles.input}
          placeholderTextColor={colors.textMuted}
        />

        <Card style={{ marginTop: spacing.md }}>
          <View style={styles.locRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Локация</Text>
              {form.locationCoords ? (
                <Text style={styles.muted}>
                  {form.locationName ||
                    `${form.locationCoords.lat.toFixed(4)}, ${form.locationCoords.lon.toFixed(4)}`}
                </Text>
              ) : (
                <Text style={styles.muted}>Без координати</Text>
              )}
            </View>
            <Button
              title={form.locationCoords ? 'Обнови' : 'Маркирай'}
              variant="secondary"
              onPress={() => void grabLocation()}
            />
          </View>
        </Card>

        <Text style={styles.label}>Бележки</Text>
        <TextInput
          value={form.notes}
          onChangeText={(v) => dispatch({ type: 'SET_NOTES', payload: v })}
          placeholder="Условия, час, какво е работило..."
          multiline
          numberOfLines={4}
          style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
          placeholderTextColor={colors.textMuted}
        />

        {trips.length > 0 ? (
          <>
            <Text style={[styles.label, { marginTop: spacing.md }]}>Излет (по избор)</Text>
            <Pressable
              onPress={() => setTripPickerOpen(true)}
              style={[
                styles.input,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: undefined,
                  paddingVertical: spacing.sm + 2,
                },
              ]}
            >
              <Text style={{ color: form.tripId ? colors.text : colors.textMuted, fontSize: 16 }}>
                {form.tripId
                  ? (trips.find((t) => t.id === form.tripId)?.title ?? 'Излет')
                  : 'Не е избран'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </Pressable>
            <TripPickerModal
              visible={tripPickerOpen}
              trips={trips}
              selectedTripId={form.tripId}
              onSelect={(id) => dispatch({ type: 'SET_TRIP', payload: id })}
              onClose={() => setTripPickerOpen(false)}
            />
          </>
        ) : null}

        <View style={[styles.row2, { alignItems: 'center', marginTop: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Пуснат обратно</Text>
            <Text style={styles.muted}>Catch & release</Text>
          </View>
          <Switch
            value={form.released}
            onValueChange={(v) => dispatch({ type: 'SET_RELEASED', payload: v })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        <View style={[styles.row2, { alignItems: 'center', marginTop: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Сподели публично</Text>
            <Text style={styles.muted}>
              {user ? 'В лентата и класиките; снимка само от камерата.' : 'Изисква акаунт.'}
            </Text>
          </View>
          <Switch
            value={form.shareToFeed}
            onValueChange={(v) => {
              if (!v) {
                dispatch({ type: 'SET_SHARE_TO_FEED', payload: false });
                return;
              }
              if (
                form.photoUri?.trim() &&
                !isRemoteImageUri(form.photoUri) &&
                !form.cameraVerifiedPhoto
              ) {
                Alert.alert(
                  'Галерията не се ползва за класики',
                  'За публично споделяне трябва снимка от камерата. Премахни текущата снимка или я заснеми отново с „Снимай".',
                  [{ text: 'OK', style: 'cancel' }]
                );
                return;
              }
              dispatch({ type: 'SET_SHARE_TO_FEED', payload: true });
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        <Button
          title={editCatchId ? 'Запази промените' : 'Запази улова'}
          onPress={() => void save()}
          loading={saving}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>

      <AchievementUnlockModal
        visible={unlockedNow.length > 0}
        achievements={unlockedNow}
        onClose={() => {
          setUnlockedNow([]);
          navigation.goBack();
        }}
      />
    </Screen>
  );
}

// ─── Local sub-components ─────────────────────────────────────────────────────

type PhotoSectionProps = {
  photoUri: string | undefined;
  shareToFeed: boolean;
  extraPhotoUris: string[];
  photoTitle: string;
  colors: AppColors;
  styles: ReturnType<typeof createAddCatchStyles>;
  onPickPhoto: () => void;
  onTakePhoto: () => void;
  onClearPhoto: () => void;
  onAddExtraPhoto: () => void;
  onRemoveExtraPhoto: (idx: number) => void;
  onChangePhotoTitle: (t: string) => void;
};

function PhotoSection({
  photoUri,
  shareToFeed,
  extraPhotoUris,
  photoTitle,
  colors,
  styles,
  onPickPhoto,
  onTakePhoto,
  onClearPhoto,
  onAddExtraPhoto,
  onRemoveExtraPhoto,
  onChangePhotoTitle,
}: PhotoSectionProps) {
  return (
    <>
      <Pressable
        onPress={() => {
          if (photoUri && shareToFeed) onTakePhoto();
          else if (photoUri) onPickPhoto();
          else onTakePhoto();
        }}
        style={styles.photoBox}
      >
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="camera-outline" size={36} color={colors.primary} />
            <Text style={styles.photoText}>Добави снимка</Text>
          </View>
        )}
      </Pressable>

      {photoUri ? (
        <>
          <Text style={styles.label}>Заглавие на снимката (по избор)</Text>
          <TextInput
            value={photoTitle}
            onChangeText={onChangePhotoTitle}
            placeholder="напр. Зоран от яз. Искър, здрачен шаран…"
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />
          <Text style={[styles.muted, { marginTop: spacing.xs }]}>
            Показва се в лентата и участва в класиките с лайкове.
          </Text>
          {shareToFeed ? (
            <Text style={[styles.muted, { marginTop: spacing.xs, fontStyle: 'italic' }]}>
              За класиките снимката трябва да е направена с камерата тук — не от галерията.
            </Text>
          ) : null}
        </>
      ) : null}

      {photoUri ? (
        <View style={styles.photoActions}>
          {shareToFeed ? (
            <Button
              title="Нова снимка (камера)"
              variant="secondary"
              onPress={onTakePhoto}
              style={{ flex: 1 }}
            />
          ) : (
            <Button title="Смени" variant="secondary" onPress={onPickPhoto} style={{ flex: 1 }} />
          )}
          <Button
            title="Премахни"
            variant="ghost"
            onPress={onClearPhoto}
            style={{ flex: 1 }}
          />
        </View>
      ) : (
        <View style={styles.photoActions}>
          <Button
            title="От галерията"
            variant="secondary"
            onPress={onPickPhoto}
            style={{ flex: 1 }}
            disabled={shareToFeed}
          />
          <Button title="Снимай" variant="secondary" onPress={onTakePhoto} style={{ flex: 1 }} />
        </View>
      )}

      {!photoUri && shareToFeed ? (
        <Text style={[styles.muted, { marginTop: spacing.xs }]}>
          При включено публично споделяне добави снимка само през „Снимай".
        </Text>
      ) : null}

      {photoUri ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.label}>Още снимки (до 4)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm }}
          >
            {extraPhotoUris.map((uri, i) => (
              <View key={i} style={{ position: 'relative' }}>
                <Image
                  source={{ uri }}
                  style={{ width: 80, height: 80, borderRadius: radius.md }}
                  contentFit="cover"
                />
                <Pressable
                  onPress={() => onRemoveExtraPhoto(i)}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    backgroundColor: colors.danger,
                    borderRadius: 10,
                    width: 20,
                    height: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  hitSlop={4}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </Pressable>
              </View>
            ))}
            {extraPhotoUris.length < 4 ? (
              <Pressable
                onPress={onAddExtraPhoto}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={28} color={colors.primary} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </>
  );
}

type WeightEstimatorProps = {
  length: string;
  weight: string;
  speciesId: string;
  colors: AppColors;
  onAccept: (w: string) => void;
};

const K_MAP: Record<string, number> = {
  sharan: 3.4, karakuda: 3.0, amur: 2.2, tolstolob: 2.8, lin: 3.2,
  som: 1.5, shtuka: 0.55, kostur: 2.5, pastrava: 0.9, dagova: 1.0,
  mryana: 1.6, klen: 1.8,
};

function WeightEstimator({ length, weight, speciesId, colors, onAccept }: WeightEstimatorProps) {
  const lenVal = parseFloat(length.replace(',', '.'));
  if (!lenVal || lenVal <= 0 || weight) return null;
  const K = K_MAP[speciesId] ?? 2.5;
  const estimated = Math.round(((K * lenVal ** 3) / 100_000) * 100) / 100;
  if (estimated <= 0) return null;
  return (
    <Pressable
      onPress={() => onAccept(String(estimated))}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
      hitSlop={8}
    >
      <Ionicons name="calculator-outline" size={14} color={colors.primary} />
      <Text style={{ ...typography.small, color: colors.primary }}>≈ {estimated} кг — добави</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createAddCatchStyles(colors: AppColors, bottomInset: number) {
  return StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: spacing.xxl + bottomInset + 16 },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    title: { ...typography.h2, color: colors.text },
    label: { ...typography.bodyBold, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    input: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    row2: { flexDirection: 'row', gap: spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...typography.body, color: colors.text },
    chipTextActive: { color: colors.white, fontWeight: '600' },
    photoBox: {
      height: 200,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    photo: { width: '100%', height: '100%' },
    photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    photoText: { ...typography.body, color: colors.primary, marginTop: spacing.sm },
    photoActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    locRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    muted: { ...typography.body, color: colors.textMuted },
  });
}
