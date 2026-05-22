import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { LogbookStackParamList } from '../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { BanPeriodCard } from '../components/BanPeriodCard';
import { TripPickerModal } from '../components/TripPickerModal';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { Skeleton } from '../components/Skeleton';
import { catchesStore, tripsStore, gearStore, newId, recentBaitsStore, recentSpeciesStore } from '../storage/storage';
import { speciesList } from '../data/species';
import { Achievement, Catch, GearItem, TripPlan } from '../types';
import { useAuth } from '../services/authContext';
import { doc, getDoc } from 'firebase/firestore';
import { pushCatch, ensureCatchPhotoUploadedForCloud, deleteStoragePath } from '../services/cloudSync';
import { ensureFirebase } from '../services/firebase';
import { enqueueCatchSync } from '../services/catchSyncQueue';
import { checkBanPeriod } from '../services/notifications';
import { checkNewPersonalBest } from '../services/personalBests';
import { checkForNewUnlocks } from '../services/achievements';
import { AchievementUnlockModal } from '../components/AchievementUnlockModal';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { isRemoteImageUri, formatCatchDate } from '../utils/formatCatchDate';
import DateTimePicker from '@react-native-community/datetimepicker';
import { handleError } from '../utils/handleError';
import { notifyInfo, notifyError } from '../utils/notify';
import { checkImageSize } from '../utils/imageSize';
import { fetchWeather } from '../services/weather';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { haversineKm } from '../services/leaderboards';
import * as Haptics from 'expo-haptics';

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
  enterLeaderboard: boolean;
  photoUri: string | undefined;
  locationCoords: { lat: number; lon: number } | null;
  locationName: string;
  cameraVerifiedPhoto: boolean;
  extraPhotoUris: string[];
  tripId: string | undefined;
  /** Catch date as ISO string. Previously hardcoded to `new Date()` at save time
      which meant users couldn't log a catch from yesterday. */
  date: string;
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
  | { type: 'SET_ENTER_LEADERBOARD'; payload: boolean }
  | { type: 'SET_PHOTO'; payload: { uri: string | undefined; cameraVerified: boolean } }
  | { type: 'CLEAR_PHOTO' }
  | { type: 'SET_LOCATION'; payload: { coords: { lat: number; lon: number }; name: string } }
  | { type: 'ADD_EXTRA_PHOTO'; payload: string }
  | { type: 'REMOVE_EXTRA_PHOTO'; payload: number }
  | { type: 'SET_TRIP'; payload: string | undefined }
  | { type: 'SET_DATE'; payload: string }
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
    case 'SET_ENTER_LEADERBOARD': return { ...state, enterLeaderboard: action.payload };
    case 'SET_PHOTO': return { ...state, photoUri: action.payload.uri, cameraVerifiedPhoto: action.payload.cameraVerified };
    case 'CLEAR_PHOTO': return { ...state, photoUri: undefined, photoTitle: '', cameraVerifiedPhoto: false };
    case 'SET_LOCATION': return { ...state, locationCoords: action.payload.coords, locationName: action.payload.name };
    case 'ADD_EXTRA_PHOTO': return { ...state, extraPhotoUris: [...state.extraPhotoUris, action.payload] };
    case 'REMOVE_EXTRA_PHOTO': return { ...state, extraPhotoUris: state.extraPhotoUris.filter((_, i) => i !== action.payload) };
    case 'SET_TRIP': return { ...state, tripId: action.payload };
    case 'SET_DATE': return { ...state, date: action.payload };
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
  const duplicateCatchId = route.params?.duplicateCatchId;
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createAddCatchStyles(colors), [colors]);
  const { user, configured } = useAuth();

  const [form, baseDispatch] = useReducer(formReducer, {
    speciesId: speciesList[0].id,
    weight: '',
    length: '',
    bait: '',
    notes: '',
    photoTitle: '',
    released: false,
    shareToFeed: false,
    enterLeaderboard: true,
    photoUri: undefined,
    locationCoords: prefill ? { lat: prefill.latitude, lon: prefill.longitude } : null,
    locationName: prefill?.name ?? '',
    cameraVerifiedPhoto: false,
    extraPhotoUris: [],
    tripId: undefined,
    date: new Date().toISOString(),
  });

  const [lastCatch, setLastCatch] = useState<Catch | null>(null);
  const [suggestedSpecies, setSuggestedSpecies] = useState<string | null>(null);

  const [recentBaits, setRecentBaits] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Synchronous double-tap guard. `saving` state updates via React's batched
  // re-render, so two taps in the same JS tick both see `disabled={false}`
  // and both fire `save()`. With the same catchIdRef both writes target the
  // same doc (no duplicate catches) but the side effects (PB alert, achievement
  // unlock modal, toast, recent-baits push, background sync) all fire twice.
  // The ref is read + set synchronously inside save() so the second tap bails
  // immediately.
  const savingRef = useRef(false);
  const [unlockedNow, setUnlockedNow] = useState<Achievement[]>([]);
  const [editLoaded, setEditLoaded] = useState(!editCatchId);
  const [initialCatch, setInitialCatch] = useState<Catch | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Gear picker — loaded once on mount. Tapping the backpack icon next to the
  // bait field opens a sheet of the user's saved tackle (gearStore). Selecting
  // an item populates the bait input with the gear name. Lets users reuse
  // logged tackle instead of retyping bait names each catch.
  const [gearList, setGearList] = useState<GearItem[]>([]);
  const [gearPickerOpen, setGearPickerOpen] = useState(false);
  // Collapsible "more details" — expanded by default for new catches, collapsed
  // when editing (assumption: editor knows the catch and wants summary first).
  const [detailsOpen, setDetailsOpen] = useState(!editCatchId);
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
    recentBaitsStore.get().then(setRecentBaits);
    gearStore.list().then(setGearList).catch(() => setGearList([]));
  }, []);

  // Every user-driven dispatch trips the dirty flag — covers species
  // changes, trip selection, share-to-feed toggles, location picks, date
  // edits, extra photos, etc. that the previous per-field useEffect
  // didn't track. LOAD_CATCH is deliberately excluded because it fires
  // from the edit/duplicate prefill, not from user interaction.
  const dispatch = useCallback((action: FormAction) => {
    if (action.type !== 'LOAD_CATCH') {
      formDirtyRef.current = true;
    }
    baseDispatch(action);
  }, []);

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

  // Single mount-time read of all catches. Replaces four separate effects that
  // each called catchesStore.list() — for fresh open, edit, duplicate, last-catch
  // preview, and species suggestion. The cache makes repeat reads cheap, but
  // having one source of truth per render is clearer and shaves AsyncStorage IO.
  useEffect(() => {
    let alive = true;
    catchesStore.list().then((list) => {
      if (!alive) return;

      if (list.length > 0) {
        // Coalesce NaN to 0 so a single catch with a malformed `date` doesn't
        // make the comparator nondeterministic and silently swap order.
        const sorted = [...list].sort(
          (a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0),
        );
        setLastCatch(sorted[0]);

        // Suggested species — most-frequent species name, gated at ≥2 catches.
        // Only meaningful for fresh-open (not edit/duplicate flows).
        if (!editCatchId && !duplicateCatchId) {
          const freq: Record<string, number> = {};
          list.forEach((c) => { if (c.speciesName) freq[c.speciesName] = (freq[c.speciesName] ?? 0) + 1; });
          const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
          if (top && top[1] >= 2) setSuggestedSpecies(top[0]);
        }
      }

      if (editCatchId) {
        const c = list.find((x) => x.id === editCatchId);
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
            enterLeaderboard: c.enterLeaderboard ?? true,
            photoUri: c.photoUri,
            extraPhotoUris: c.extraPhotoUris ?? [],
            cameraVerifiedPhoto: isRemoteImageUri(c.photoUri) || c.photoTakenWithAppCamera === true,
            locationCoords: c.location
              ? { lat: c.location.latitude, lon: c.location.longitude }
              : null,
            locationName: c.location?.name ?? '',
            tripId: c.tripId,
            date: c.date ?? new Date().toISOString(),
          },
        });
        if (c.conditions) conditionsRef.current = c.conditions;
        setEditLoaded(true);
      } else if (duplicateCatchId) {
        const c = list.find((x) => x.id === duplicateCatchId);
        if (c) {
          dispatch({
            type: 'LOAD_CATCH',
            payload: {
              speciesId: speciesList.some((s) => s.id === c.speciesId) ? c.speciesId : speciesList[0].id,
              bait: c.bait ?? '',
              locationCoords: c.location ? { lat: c.location.latitude, lon: c.location.longitude } : null,
              locationName: c.location?.name ?? '',
            },
          });
        }
      }
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [editCatchId, duplicateCatchId, navigation]);

  useEffect(() => {
    if (!form.locationCoords) return;
    // When editing, only invalidate cached conditions if the user actually
    // moved the catch. Otherwise the prefill from initialCatch.conditions
    // stays in place as a fallback when the network fetch fails — losing
    // those originally-saved conditions on a slow connection would be a
    // worse outcome than slightly stale conditions on the new spot.
    const initLoc = initialCatch?.location;
    const movedFromInitial =
      !!initLoc &&
      (Math.abs(initLoc.latitude - form.locationCoords.lat) > 1e-6 ||
        Math.abs(initLoc.longitude - form.locationCoords.lon) > 1e-6);
    if (movedFromInitial) {
      conditionsRef.current = null;
    }
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
  }, [form.locationCoords, initialCatch?.location]);

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
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notifyInfo('Нужно е разрешение', 'Разреши достъп до галерията, за да добавиш снимка.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      if (!checkImageSize(result.assets[0])) return;
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
      notifyInfo('Достъп до камерата', 'Разреши достъп до камерата в настройките на телефона.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      if (!checkImageSize(result.assets[0])) return;
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
      notifyInfo('Достъп до галерията', 'Разреши достъп до галерията в настройките на телефона.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      if (!checkImageSize(result.assets[0])) return;
      dispatch({
        type: 'ADD_EXTRA_PHOTO',
        payload: await compressPhoto(result.assets[0].uri),
      });
    }
  };

  const grabLocation = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      notifyInfo('Нужно е разрешение', 'Разреши достъп до локацията.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    const lat = loc.coords.latitude;
    const lon = loc.coords.longitude;
    let name = '';
    try {
      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (places[0]) {
        const p = places[0];
        name = [p.name, p.city ?? p.region].filter(Boolean).join(', ');
      }
    } catch {}

    // Prefer the actual water body name if within range
    const nearestDam = DAMS
      .map((d) => ({ name: d.name, km: haversineKm(lat, lon, d.latitude, d.longitude) }))
      .filter((d) => d.km <= 5)
      .sort((a, b) => a.km - b.km)[0];
    const nearestRiver = RIVERS
      .map((r) => ({ name: r.name, km: haversineKm(lat, lon, r.latitude, r.longitude) }))
      .filter((r) => r.km <= 3)
      .sort((a, b) => a.km - b.km)[0];
    const waterBody = nearestDam ?? nearestRiver;
    if (waterBody) name = waterBody.name;

    dispatch({
      type: 'SET_LOCATION',
      payload: { coords: { lat, lon }, name },
    });
  };

  const syncCatchToCloud = async (
    catchItem: Catch,
    sharePublic: boolean
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!user) return { ok: true };
    try {
      let toSync = catchItem;
      const newLocalUri =
        catchItem.photoUri?.trim() && !/^https?:\/\//i.test(catchItem.photoUri.trim());
      // Capture the previous storage path BEFORE upload so we can clean it up after.
      // Only delete if we're replacing with a new local photo OR the photo was cleared,
      // and the new path will differ from the old one.
      const oldStoragePath = initialCatch?.photoStoragePath;
      const photoWasReplaced =
        oldStoragePath &&
        (newLocalUri || !catchItem.photoUri) &&
        oldStoragePath !== catchItem.photoStoragePath;

      if (newLocalUri) {
        toSync = await ensureCatchPhotoUploadedForCloud(catchItem, user.uid);
      }
      await pushCatch(toSync, user.uid, user.displayName ?? user.email ?? 'Рибар', sharePublic);
      await catchesStore.save({ ...toSync, syncedToCloud: true });

      // After successful sync, delete the orphaned previous photo from Storage.
      if (photoWasReplaced && oldStoragePath && oldStoragePath !== toSync.photoStoragePath) {
        void deleteStoragePath(oldStoragePath);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!form.speciesId) return;
    const trimmedPhotoTitle = form.photoTitle.trim().slice(0, 120);
    const uri = form.photoUri?.trim();
    savingRef.current = true;
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
      date: form.date,
      bait: form.bait || undefined,
      notes: form.notes || undefined,
      ...(form.photoUri && trimmedPhotoTitle ? { photoTitle: trimmedPhotoTitle } : {}),
      released: form.released,
      enterLeaderboard: form.shareToFeed ? form.enterLeaderboard : undefined,
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
      // When editing, only fall back to the originally-saved conditions if
      // the user hasn't moved the catch — otherwise we'd persist conditions
      // belonging to a different lat/lon when the live weather fetch fails.
      conditions: conditionsRef.current ?? (
        initialCatch?.location && form.locationCoords &&
        Math.abs(initialCatch.location.latitude - form.locationCoords.lat) < 1e-6 &&
        Math.abs(initialCatch.location.longitude - form.locationCoords.lon) < 1e-6
          ? initialCatch.conditions
          : undefined
      ),
    };

    try {
      await catchesStore.save(item);
      // Save succeeded — the form is no longer dirty, so the beforeRemove guard won't trigger
      // when the achievement modal is dismissed.
      formDirtyRef.current = false;

      const allCatches = await catchesStore.list();
      const pb = checkNewPersonalBest(item, allCatches);
      const achCtx = { firebaseConfigured: configured, userLoggedIn: !!user, uid: user?.uid };
      const newUnlocks = await checkForNewUnlocks(allCatches, achCtx);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (form.bait.trim()) void recentBaitsStore.push(form.bait).then(() => recentBaitsStore.get().then(setRecentBaits));
      void recentSpeciesStore.push(form.speciesId);

      Toast.show({
        type: 'success',
        text1: editCatchId ? 'Уловът е обновен' : 'Уловът е записан',
        visibilityTime: 2000,
      });

      if (pb.isNew && !editCatchId) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        const pbMsg =
          pb.field === 'both'
            ? 'Нов личен рекорд по тегло и дължина! 🏆'
            : pb.field === 'weight'
            ? 'Нов личен рекорд по тегло! 🏆'
            : 'Нов личен рекорд по дължина! 🏆';
        // If there are no achievement unlocks to show, the alert is the only
        // thing keeping the user on this screen — fire the goBack on Alert
        // dismissal so the alert doesn't orphan onto LogbookScreen after the
        // screen unmounts.
        if (newUnlocks.length === 0) {
          Alert.alert('Личен рекорд!', `${item.speciesName} — ${pbMsg}`, [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
        } else {
          // Chain: dismiss PB alert FIRST, then mount AchievementUnlockModal.
          // The earlier code mounted both at once and they stacked visually —
          // the OS Alert obscured the achievement modal.
          Alert.alert('Личен рекорд!', `${item.speciesName} — ${pbMsg}`, [
            { text: 'OK', onPress: () => setUnlockedNow(newUnlocks) },
          ]);
        }
      } else if (newUnlocks.length > 0) {
        setUnlockedNow(newUnlocks);
      } else {
        navigation.goBack();
      }

      // Cloud sync runs in the background — does not block navigation
      if (user) {
        void (async () => {
          const sync = await syncCatchToCloud(item, form.shareToFeed);
          if (!sync.ok) {
            console.error('[CatchSync] failed:', sync.message);
            await enqueueCatchSync(item.id, form.shareToFeed).catch(() => {});
          }
        })();
      } else if (form.shareToFeed) {
        notifyInfo('Нужен е акаунт', 'За да споделиш публично, влез/регистрирай се в Профил.');
      }
    } catch (e: unknown) {
      handleError(e);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (editCatchId && !editLoaded) {
    // Skeleton mirrors the actual edit-form's structure (photo hero block,
    // then a stack of input rows) so the eye sees the layout forming
    // instead of an unspecific spinner. Read is local (AsyncStorage), so
    // this typically flashes for <300ms — the skeleton keeps the flash
    // from looking like a content jump.
    return (
      <Screen padded={false}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={220} borderRadius={radius.lg} />
          <Skeleton height={48} borderRadius={radius.md} />
          <Skeleton height={48} borderRadius={radius.md} />
          <Skeleton height={48} borderRadius={radius.md} />
          <Skeleton height={120} borderRadius={radius.md} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} {...keyboardAwareScrollProps}>

        {/* ── PHOTO HERO ── */}
        <PhotoSection
          photoUri={form.photoUri}
          shareToFeed={form.shareToFeed}
          colors={colors}
          styles={styles}
          onPickPhoto={() => void pickPhoto()}
          onTakePhoto={() => void takePhoto()}
          onClearPhoto={() => dispatch({ type: 'CLEAR_PHOTO' })}
          onNavigationBack={() => navigation.goBack()}
        />

        {/* ── SHEET (overlaps hero, white card, curved top) ── */}
        <View style={styles.sheet}>

          {/* CHIPS — repeat last + suggested species */}
          {!editCatchId && lastCatch ? (
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                dispatch({
                  type: 'LOAD_CATCH',
                  payload: {
                    speciesId: speciesList.some((s) => s.id === lastCatch.speciesId)
                      ? lastCatch.speciesId
                      : speciesList[0].id,
                    weight: lastCatch.weightKg != null ? String(lastCatch.weightKg) : '',
                    length: lastCatch.lengthCm != null ? String(lastCatch.lengthCm) : '',
                    bait: lastCatch.bait ?? '',
                    notes: lastCatch.notes ?? '',
                    released: !!lastCatch.released,
                    locationCoords: lastCatch.location
                      ? { lat: lastCatch.location.latitude, lon: lastCatch.location.longitude }
                      : null,
                    locationName: lastCatch.location?.name ?? '',
                    photoUri: undefined,
                    cameraVerifiedPhoto: false,
                  },
                });
                // LOAD_CATCH is excluded from the dispatch-level dirty-tracker
                // because it normally fires from the edit/duplicate prefill,
                // which isn't a user interaction. This chip *is* a user
                // interaction — mark the form dirty so the unsaved-changes
                // warning fires if the user navigates away without saving.
                formDirtyRef.current = true;
              }}
              style={styles.chipPill}
            >
              <Text style={styles.chipPillText} numberOfLines={1}>
                {'🔁 Като последния — ' + lastCatch.speciesName + (lastCatch.weightKg != null ? ' ' + lastCatch.weightKg + 'кг' : '')}
              </Text>
            </Pressable>
          ) : null}

          {suggestedSpecies && form.speciesId === speciesList[0].id && !editCatchId ? (
            <Pressable
              onPress={() => {
                const matched = speciesList.find((s) => s.nameBg === suggestedSpecies);
                if (matched) dispatch({ type: 'SET_SPECIES', payload: matched.id });
                setSuggestedSpecies(null);
              }}
              style={styles.chipPill}
            >
              <Ionicons name="bulb-outline" size={15} color={colors.primary} />
              <Text style={[styles.chipPillText, { flex: 1 }]}>
                Препоръчан вид:{' '}
                <Text style={{ color: colors.primary, fontFamily: 'Nunito_700Bold' }}>{suggestedSpecies}</Text>
              </Text>
              <Pressable onPress={() => setSuggestedSpecies(null)} hitSlop={8}>
                <Ionicons name="close-outline" size={15} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          ) : null}

          {/* ════════════════════════════════════════
              ① SUMMARY CARD — the only "must fill" section.
              Species + weight + length + date + released, all together.
          ════════════════════════════════════════ */}
          <View style={styles.summaryCard}>
            {/* Species — tap to change */}
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={styles.summarySpeciesRow}
              accessibilityRole="button"
              accessibilityLabel="Промени вид"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.summarySpeciesName}>{selectedSpecies.nameBg}</Text>
                <Text style={styles.summarySpeciesLatin}>{selectedSpecies.nameLatin}</Text>
              </View>
              <View style={styles.summarySpeciesPill}>
                <Ionicons name="swap-horizontal" size={13} color={colors.primary} />
                <Text style={styles.summarySpeciesPillText}>Промени</Text>
              </View>
            </Pressable>

            <View style={styles.summaryDivider} />

            {/* Weight + Length tiles */}
            <View style={styles.summaryMetricsRow}>
              <View style={styles.summaryMetric}>
                <Text style={styles.summaryMetricLabel}>Тегло</Text>
                <View style={styles.summaryMetricInputRow}>
                  <TextInput
                    value={form.weight}
                    onChangeText={(v) => dispatch({ type: 'SET_WEIGHT', payload: v })}
                    placeholder="—"
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                    style={styles.summaryMetricInput}
                    placeholderTextColor={colors.border}
                  />
                  <Text style={styles.summaryMetricUnit}>кг</Text>
                </View>
                <WeightEstimator
                  length={form.length}
                  weight={form.weight}
                  speciesId={form.speciesId}
                  colors={colors}
                  onAccept={(w) => dispatch({ type: 'SET_WEIGHT', payload: w })}
                />
              </View>
              <View style={styles.summaryMetricVDivider} />
              <View style={styles.summaryMetric}>
                <Text style={styles.summaryMetricLabel}>Дължина</Text>
                <View style={styles.summaryMetricInputRow}>
                  <TextInput
                    value={form.length}
                    onChangeText={(v) => dispatch({ type: 'SET_LENGTH', payload: v })}
                    placeholder="—"
                    keyboardType="decimal-pad"
                    style={styles.summaryMetricInput}
                    placeholderTextColor={colors.border}
                  />
                  <Text style={styles.summaryMetricUnit}>см</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryDivider} />

            {/* Date — new! tap-to-pick */}
            <Pressable
              onPress={() => setDatePickerOpen((v) => !v)}
              style={styles.summaryDateRow}
              accessibilityRole="button"
              accessibilityLabel="Промени дата"
            >
              <View style={styles.summaryRowIcon}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryRowLabel}>Дата</Text>
                <Text style={styles.summaryRowValue}>{formatCatchDate(form.date)}</Text>
              </View>
              <Ionicons name={datePickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>

            {datePickerOpen ? (
              <View style={styles.datePickerWrap}>
                <DateTimePicker
                  value={new Date(form.date)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  themeVariant={mode === 'dark' ? 'dark' : 'light'}
                  accentColor={colors.primary}
                  textColor={colors.text}
                  maximumDate={new Date()}
                  locale="bg"
                  onChange={(e, picked) => {
                    if (Platform.OS === 'android') setDatePickerOpen(false);
                    if (e.type === 'set' && picked) {
                      dispatch({ type: 'SET_DATE', payload: picked.toISOString() });
                    }
                  }}
                />
                {Platform.OS === 'ios' ? (
                  <Pressable onPress={() => setDatePickerOpen(false)} style={styles.datePickerDone} hitSlop={8}>
                    <Text style={styles.datePickerDoneText}>Готово</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.summaryDivider} />

            {/* Released toggle inline — the most-toggled switch belongs here */}
            <View style={styles.summarySwitchRow}>
              <View style={styles.summaryRowIcon}>
                <Ionicons name="refresh-circle-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryRowLabel}>Пуснат обратно</Text>
                <Text style={styles.summaryRowSub}>Catch &amp; release</Text>
              </View>
              <Switch
                value={form.released}
                onValueChange={(v) => dispatch({ type: 'SET_RELEASED', payload: v })}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </View>

          <BanPeriodCard speciesName={selectedSpecies.nameBg} banInfo={banInfo} />

          {/* ════════════════════════════════════════
              ② SHARING CARD — pulled up so the engagement hook is visible.
              Public-feed + leaderboard live here.
          ════════════════════════════════════════ */}
          <View style={styles.sharingCard}>
            <View style={styles.sharingHeader}>
              <View style={styles.sharingAccent} />
              <Text style={styles.sharingTitle}>Споделяне</Text>
            </View>

            <View style={styles.summarySwitchRow}>
              <View style={styles.summaryRowIcon}>
                <Ionicons name="earth-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryRowLabel}>Сподели в лентата</Text>
                <Text style={styles.summaryRowSub}>
                  {user ? 'Видим за всички.' : 'Изисква акаунт.'}
                </Text>
              </View>
              <Switch
                value={form.shareToFeed}
                onValueChange={(v) => {
                  if (!v) {
                    dispatch({ type: 'SET_SHARE_TO_FEED', payload: false });
                    dispatch({ type: 'SET_ENTER_LEADERBOARD', payload: false });
                    return;
                  }
                  dispatch({ type: 'SET_SHARE_TO_FEED', payload: true });
                  dispatch({ type: 'SET_ENTER_LEADERBOARD', payload: true });
                }}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>

            {form.shareToFeed ? (
              <>
                <View style={styles.summaryDivider} />
                <View style={styles.summarySwitchRow}>
                  <View style={styles.summaryRowIcon}>
                    <Ionicons name="trophy-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.summaryRowLabel}>Участвай в класацията</Text>
                    <Text style={styles.summaryRowSub}>Седмична и месечна класация.</Text>
                  </View>
                  <Switch
                    value={form.enterLeaderboard}
                    onValueChange={(v) => dispatch({ type: 'SET_ENTER_LEADERBOARD', payload: v })}
                    trackColor={{ true: colors.primary, false: colors.border }}
                  />
                </View>
              </>
            ) : null}
          </View>

          {/* ════════════════════════════════════════
              ③ MORE DETAILS — collapsed by default when editing.
              Bait, location, notes, trip, extra photos all hide behind one tap.
          ════════════════════════════════════════ */}
          <Pressable
            onPress={() => setDetailsOpen((v) => !v)}
            style={styles.detailsToggle}
            accessibilityRole="button"
            accessibilityLabel={detailsOpen ? 'Скрий повече детайли' : 'Покажи повече детайли'}
          >
            <Text style={styles.detailsToggleText}>Повече детайли</Text>
            <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
          </Pressable>

          {detailsOpen ? (
            <>
              {/* Bait + recents */}
              <View style={styles.detailCard}>
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="leaf-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput
                        value={form.bait}
                        onChangeText={(v) => dispatch({ type: 'SET_BAIT', payload: v })}
                        placeholder="Стръв / примамка..."
                        returnKeyType="next"
                        style={styles.detailInput}
                        placeholderTextColor={colors.textMuted}
                      />
                      {gearList.length > 0 ? (
                        <Pressable
                          onPress={() => setGearPickerOpen(true)}
                          hitSlop={8}
                          style={styles.detailButton}
                          accessibilityLabel="Избери от твоето оборудване"
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Ionicons name="briefcase-outline" size={14} color={colors.primary} />
                            <Text style={styles.detailButtonText}>Оборудване</Text>
                          </View>
                        </Pressable>
                      ) : null}
                    </View>
                    {recentBaits.length > 0 && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 6, paddingTop: 8, paddingBottom: 4 }}
                        keyboardShouldPersistTaps="handled"
                      >
                        {recentBaits.map((b) => (
                          <Pressable
                            key={b}
                            onPress={() => dispatch({ type: 'SET_BAIT', payload: b })}
                            style={[styles.baitPill, form.bait === b && styles.baitPillActive]}
                          >
                            <Text style={[styles.baitPillText, form.bait === b && styles.baitPillTextActive]}>{b}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </View>

                <View style={styles.detailDivider} />

                {/* Location */}
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="location-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={form.locationCoords ? styles.detailInput : [styles.detailInput, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {form.locationCoords
                        ? (form.locationName || `${form.locationCoords.lat.toFixed(4)}, ${form.locationCoords.lon.toFixed(4)}`)
                        : 'Без координати'}
                    </Text>
                  </View>
                  <Pressable onPress={() => void grabLocation()} style={styles.detailButton}>
                    <Text style={styles.detailButtonText}>{form.locationCoords ? 'Обнови' : 'Маркирай'}</Text>
                  </Pressable>
                </View>

                <View style={styles.detailDivider} />

                {/* Notes */}
                <View style={[styles.detailRow, { alignItems: 'flex-start' }]}>
                  <View style={[styles.detailIcon, { marginTop: 2 }]}>
                    <Ionicons name="create-outline" size={18} color={colors.primary} />
                  </View>
                  <TextInput
                    value={form.notes}
                    onChangeText={(v) => dispatch({ type: 'SET_NOTES', payload: v })}
                    placeholder="Бележки — условия, час, какво е работило..."
                    multiline
                    style={[styles.detailInput, { height: 80, textAlignVertical: 'top', flex: 1 }]}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>

              {/* Trip picker — only when user has trips */}
              {trips.length > 0 ? (
                <>
                  <View style={styles.detailCard}>
                    <Pressable onPress={() => setTripPickerOpen(true)} style={styles.detailRow}>
                      <View style={styles.detailIcon}>
                        <Ionicons name="briefcase-outline" size={18} color={colors.primary} />
                      </View>
                      <Text style={[styles.detailInput, !form.tripId && { color: colors.textMuted }]}>
                        {form.tripId ? (trips.find((t) => t.id === form.tripId)?.title ?? 'Излет') : 'Избери излет (по избор)'}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <TripPickerModal
                    visible={tripPickerOpen}
                    trips={trips}
                    selectedTripId={form.tripId}
                    onSelect={(id) => dispatch({ type: 'SET_TRIP', payload: id })}
                    onClose={() => setTripPickerOpen(false)}
                  />
                </>
              ) : null}

              {/* Extra photos — only relevant when there's a primary photo */}
              {form.photoUri ? (
                <View style={styles.detailCard}>
                  <TextInput
                    value={form.photoTitle}
                    onChangeText={(t) => dispatch({ type: 'SET_PHOTO_TITLE', payload: t })}
                    placeholder="Заглавие на снимката (по избор)"
                    style={styles.photoMetaInput}
                    placeholderTextColor={colors.textMuted}
                  />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingTop: 10 }}
                  >
                    {form.extraPhotoUris.map((uri, i) => (
                      <View key={i} style={{ position: 'relative' }}>
                        <Image source={{ uri }} style={{ width: 64, height: 64, borderRadius: 12 }} contentFit="cover" />
                        <Pressable
                          onPress={() => dispatch({ type: 'REMOVE_EXTRA_PHOTO', payload: i })}
                          hitSlop={4}
                          style={{
                            position: 'absolute',
                            top: -5,
                            right: -5,
                            backgroundColor: colors.danger,
                            borderRadius: 9,
                            width: 18,
                            height: 18,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons name="close" size={11} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                    {form.extraPhotoUris.length < 4 && (
                      <Pressable
                        onPress={() => void addExtraPhoto()}
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 12,
                          backgroundColor: colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: colors.border,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="add" size={24} color={colors.primary} />
                      </Pressable>
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </>
          ) : null}

          {/* ── SAVE BUTTON ── primary app colour, not the old Material blue */}
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={{ borderRadius: 20, overflow: 'hidden', marginTop: 16 }}
          >
            <LinearGradient
              colors={[colors.primary, colors.primaryDark ?? colors.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveBtn}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnText}>{editCatchId ? 'Запази промените' : 'Запази улова'}</Text>
              }
            </LinearGradient>
          </Pressable>

        </View>
        {/* end sheet */}

      </ScrollView>

      <AchievementUnlockModal
        visible={unlockedNow.length > 0}
        achievements={unlockedNow}
        onClose={() => {
          setUnlockedNow([]);
          navigation.goBack();
        }}
      />

      <SpeciesPicker
        visible={pickerOpen}
        selectedId={form.speciesId}
        onSelect={(id) => dispatch({ type: 'SET_SPECIES', payload: id })}
        onClose={() => setPickerOpen(false)}
      />

      <Modal
        visible={gearPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGearPickerOpen(false)}
      >
        <View style={styles.gearSheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setGearPickerOpen(false)} />
          <View style={[styles.gearSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.gearSheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.gearSheetTitle, { color: colors.text }]}>Избери от оборудването</Text>
            <FlatList
              data={gearList}
              keyExtractor={(g) => g.id}
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 18 }} />
              )}
              style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    dispatch({ type: 'SET_BAIT', payload: item.name });
                    setGearPickerOpen(false);
                  }}
                  style={styles.gearRow}
                >
                  <View style={[styles.gearRowIcon, { backgroundColor: colors.primarySurface }]}>
                    <Ionicons name="briefcase-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.gearRowName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                    {item.notes ? (
                      <Text style={[styles.gearRowNotes, { color: colors.textMuted }]} numberOfLines={1}>{item.notes}</Text>
                    ) : null}
                  </View>
                  {form.bait === item.name ? (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  ) : null}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>

    </Screen>
  );
}

// ─── PhotoSection sub-component ───────────────────────────────────────────────

type PhotoSectionProps = {
  photoUri: string | undefined;
  shareToFeed: boolean;
  colors: AppColors;
  styles: ReturnType<typeof createAddCatchStyles>;
  onPickPhoto: () => void;
  onTakePhoto: () => void;
  onClearPhoto: () => void;
  onNavigationBack: () => void;
};

function PhotoSection({
  photoUri,
  shareToFeed,
  colors,
  styles,
  onPickPhoto,
  onTakePhoto,
  onClearPhoto,
  onNavigationBack,
}: PhotoSectionProps) {
  return (
    <View style={styles.heroBox}>
      {/* Back button — absolute top-left */}
      <Pressable onPress={onNavigationBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Назад" style={styles.heroBack}>
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>

      {photoUri ? (
        <>
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
            style={styles.heroTopGrad}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
            style={styles.heroBottomGrad}
          >
            <View style={styles.heroPhotoActions}>
              <Pressable
                onPress={shareToFeed ? onTakePhoto : onPickPhoto}
                style={styles.heroPhotoBtn}
              >
                <Ionicons name={shareToFeed ? 'camera' : 'image'} size={14} color="#111" />
                <Text style={styles.heroPhotoBtnText}>Смени</Text>
              </Pressable>
              <Pressable onPress={onClearPhoto} style={styles.heroPhotoBtnDark}>
                <Ionicons name="trash-outline" size={14} color="#fff" />
                <Text style={styles.heroPhotoBtnDarkText}>Премахни</Text>
              </Pressable>
            </View>
          </LinearGradient>
        </>
      ) : (
        <>
          {/* Outdoorsy dawn-water gradient — matches the rest of the redesigned screens.
              Replaces the old hardcoded Material blue that clashed with the new palette. */}
          <LinearGradient
            colors={['#0A3A57', '#1F6F92', '#0E4D64']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.heroPlaceholderInner}>
            <Ionicons name="fish-outline" size={48} color="rgba(255,255,255,0.7)" />
            <Text style={styles.heroPlaceholderText}>Сними улова</Text>
            <Text style={styles.heroPlaceholderSub}>Снимка не е задължителна, но прави спомена по-силен.</Text>
            <View style={styles.heroEmptyActions}>
              <Pressable onPress={onTakePhoto} style={styles.heroPrimaryBtn}>
                <Ionicons name="camera" size={18} color="#0E4D64" />
                <Text style={styles.heroPrimaryBtnText}>Камера</Text>
              </Pressable>
              {!shareToFeed && (
                <Pressable onPress={onPickPhoto} style={styles.heroSecondaryBtn}>
                  <Ionicons name="images-outline" size={18} color="#fff" />
                  <Text style={styles.heroSecondaryBtnText}>Галерия</Text>
                </Pressable>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ─── WeightEstimator sub-component ───────────────────────────────────────────

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

function createAddCatchStyles(colors: AppColors) {
  return StyleSheet.create({

    // ── Hero box ──
    heroBox: {
      width: '100%',
      height: 320,
      overflow: 'hidden',
      backgroundColor: '#0E4D64',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // New empty-state container — replaces the old shutter button + grid overlay.
    heroPlaceholderInner: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 8,
    },
    heroPlaceholderSub: {
      fontSize: 12,
      fontFamily: 'Nunito_400Regular',
      color: 'rgba(255,255,255,0.65)',
      textAlign: 'center',
      paddingHorizontal: 16,
      marginBottom: 14,
    },
    heroEmptyActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    heroPrimaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#fff',
      borderRadius: 22,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    heroPrimaryBtnText: {
      fontSize: 14,
      fontFamily: 'Nunito_700Bold',
      color: '#0E4D64',
    },
    heroSecondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 22,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.6)',
    },
    heroSecondaryBtnText: {
      fontSize: 14,
      fontFamily: 'Nunito_700Bold',
      color: '#fff',
    },
    heroBack: {
      position: 'absolute',
      top: 52,
      left: 16,
      zIndex: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroDots: {
      position: 'absolute',
      top: 60,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      zIndex: 10,
    },
    heroDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.3)',
    },
    heroDotActive: {
      backgroundColor: 'rgba(255,255,255,0.7)',
    },
    heroDotCurrent: {
      width: 18,
      borderRadius: 3,
      backgroundColor: '#fff',
    },
    heroTopGrad: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 100,
    },
    heroBottomGrad: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingBottom: 16,
      paddingHorizontal: 16,
      paddingTop: 40,
    },
    heroPhotoActions: {
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'flex-end',
    },
    heroPhotoBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(255,255,255,0.92)',
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    heroPhotoBtnText: {
      fontSize: 12,
      fontFamily: 'Nunito_700Bold',
      color: '#111',
    },
    heroPhotoBtnDark: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    heroPhotoBtnDarkText: {
      fontSize: 12,
      fontFamily: 'Nunito_700Bold',
      color: '#fff',
    },
    heroGrid: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.06)',
      margin: 20,
    },
    heroShutter: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroShutterOuter: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.8)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroShutterInner: {
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: 'rgba(255,255,255,0.9)',
    },
    heroPlaceholderText: {
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
      color: 'rgba(255,255,255,0.9)',
      marginTop: 14,
      letterSpacing: 0.3,
    },
    heroGalleryLink: {
      position: 'absolute',
      bottom: 18,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    heroGalleryLinkText: {
      fontSize: 12,
      fontFamily: 'Nunito_400Regular',
      color: 'rgba(255,255,255,0.7)',
      textDecorationLine: 'underline',
    },

    // ── Sheet ──
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      marginTop: -28,
      paddingTop: 24,
      paddingHorizontal: 20,
      paddingBottom: 8,
    },

    // ── Chips ──
    chipPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.primarySurface,
      borderColor: colors.primary,
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      alignSelf: 'flex-start',
      marginBottom: 10,
    },
    chipPillText: {
      fontSize: 13,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.text,
    },

    // ── Species block ──
    speciesBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      marginTop: 4,
    },
    speciesName: {
      fontSize: 26,
      fontFamily: 'Nunito_800ExtraBold',
      color: colors.text,
      lineHeight: 30,
    },
    speciesLatin: {
      fontSize: 13,
      fontFamily: 'Nunito_400Regular',
      color: colors.textMuted,
      fontStyle: 'italic',
      marginTop: 2,
    },
    speciesChangeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.primarySurface,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    speciesChangeBtnText: {
      fontSize: 13,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.primary,
    },

    // ── Photo meta card ──
    photoMetaCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      marginBottom: 16,
    },
    photoMetaInput: {
      fontSize: 14,
      fontFamily: 'Nunito_400Regular',
      color: colors.text,
      padding: 0,
    },

    // ── Metric tiles ──
    metricRow: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: 18,
      marginVertical: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 1,
    },
    metricTile: {
      flex: 1,
      paddingVertical: 20,
      paddingHorizontal: 18,
    },
    metricTileDivider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
    metricTileLabel: {
      fontSize: 11,
      fontFamily: 'Nunito_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    metricTileInput: {
      fontSize: 32,
      fontFamily: 'Nunito_800ExtraBold',
      color: colors.text,
      padding: 0,
      minWidth: 60,
      letterSpacing: -0.5,
    },
    metricTileUnit: {
      fontSize: 16,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.textMuted,
      marginBottom: 5,
    },

    // ── Detail card (bait / location / notes / trip) ──
    detailCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      marginBottom: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 6,
      elevation: 1,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    detailIcon: {
      width: 32,
      alignItems: 'center',
      marginRight: 10,
    },
    detailInput: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Nunito_400Regular',
      color: colors.text,
      padding: 0,
    },
    detailDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: 16,
    },
    detailButton: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: colors.primarySurface,
      borderWidth: 1,
      borderColor: colors.primary,
      marginLeft: 8,
    },
    detailButtonText: {
      fontSize: 12,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.primary,
    },

    // ── Bait pills ──
    baitPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 16,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    baitPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    baitPillText: {
      fontSize: 12,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.text,
    },
    baitPillTextActive: {
      color: '#fff',
    },

    // ── Gear picker sheet ──
    gearSheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    gearSheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 24,
      borderTopWidth: 1,
    },
    gearSheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 10,
      marginBottom: 8,
    },
    gearSheetTitle: {
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 12,
    },
    gearRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 18,
      paddingVertical: 14,
    },
    gearRowIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gearRowName: {
      fontSize: 15,
      fontFamily: 'Nunito_700Bold',
    },
    gearRowNotes: {
      fontSize: 12,
      fontFamily: 'Nunito_400Regular',
      marginTop: 2,
    },

    // ── Switch rows ──
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    switchLabel: {
      fontSize: 15,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.text,
    },
    switchSub: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 1,
    },

    // ════════════════════════════════════════════════════════════════════
    // New 2026 redesign styles
    // ════════════════════════════════════════════════════════════════════

    // ── Summary card — hero card under the photo, combines species + metrics + date + released ──
    summaryCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      marginTop: 4,
      marginBottom: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
    },
    summarySpeciesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 14,
      gap: 12,
    },
    summarySpeciesName: {
      fontSize: 24,
      fontFamily: 'Nunito_800ExtraBold',
      color: colors.text,
      lineHeight: 28,
      letterSpacing: -0.3,
    },
    summarySpeciesLatin: {
      fontSize: 12,
      fontFamily: 'Nunito_400Regular',
      color: colors.textMuted,
      fontStyle: 'italic',
      marginTop: 2,
    },
    summarySpeciesPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primarySurface,
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    summarySpeciesPillText: {
      fontSize: 12,
      fontFamily: 'Nunito_700Bold',
      color: colors.primary,
    },
    summaryDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: 18,
    },
    summaryMetricsRow: {
      flexDirection: 'row',
      paddingHorizontal: 4,
    },
    summaryMetric: {
      flex: 1,
      paddingVertical: 16,
      paddingHorizontal: 14,
    },
    summaryMetricVDivider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
    summaryMetricLabel: {
      fontSize: 11,
      fontFamily: 'Nunito_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    summaryMetricInputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
    },
    summaryMetricInput: {
      fontSize: 30,
      fontFamily: 'Nunito_800ExtraBold',
      color: colors.text,
      padding: 0,
      minWidth: 56,
      letterSpacing: -0.5,
    },
    summaryMetricUnit: {
      fontSize: 14,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.textMuted,
      marginBottom: 5,
    },
    summaryDateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 14,
      gap: 12,
    },
    summarySwitchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 14,
      gap: 12,
    },
    summaryRowIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryRowLabel: {
      fontSize: 11,
      fontFamily: 'Nunito_700Bold',
      color: colors.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    summaryRowValue: {
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
      color: colors.text,
      marginTop: 2,
    },
    summaryRowSub: {
      fontSize: 12,
      fontFamily: 'Nunito_400Regular',
      color: colors.textMuted,
      marginTop: 2,
    },

    // ── Date picker (inline calendar) ──
    datePickerWrap: {
      paddingHorizontal: 8,
      paddingBottom: 8,
    },
    datePickerDone: {
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    datePickerDoneText: {
      fontSize: 14,
      fontFamily: 'Nunito_700Bold',
      color: colors.primary,
    },

    // ── Sharing card — promoted above details ──
    sharingCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      marginBottom: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
    },
    sharingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 8,
    },
    sharingAccent: {
      width: 4,
      height: 18,
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
    sharingTitle: {
      fontSize: 15,
      fontFamily: 'Nunito_700Bold',
      color: colors.text,
    },

    // ── Details collapsible toggle ──
    detailsToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      marginBottom: 4,
    },
    detailsToggleText: {
      fontSize: 14,
      fontFamily: 'Nunito_700Bold',
      color: colors.primary,
      letterSpacing: 0.2,
    },

    // ── Save button ──
    saveBtn: {
      height: 60,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
    },
    saveBtnText: {
      fontSize: 18,
      fontFamily: 'Nunito_800ExtraBold',
      color: '#fff',
      letterSpacing: 0.2,
    },

    // ── Misc (kept for WeightEstimator and any residual uses) ──
    mutedText: {
      ...typography.small,
      color: colors.textMuted,
    },
  });
}
