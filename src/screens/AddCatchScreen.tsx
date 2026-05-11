import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
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

function createAddCatchStyles(colors: AppColors) {
  return StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
    banCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.danger + '15',
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.danger + '44',
    },
    banTitle: { ...typography.bodyBold, color: colors.danger },
    banText: { ...typography.caption, color: colors.danger, marginTop: 2 },
  });
}

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

export default function AddCatchScreen() {
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<LogbookStackParamList, 'AddCatch'>>();
  const prefill = route.params?.prefillLocation;
  const editCatchId = route.params?.editCatchId;
  const { colors } = useTheme();
  const styles = useMemo(() => createAddCatchStyles(colors), [colors]);
  const { user, configured } = useAuth();
  const [speciesId, setSpeciesId] = useState<string>(speciesList[0].id);
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [bait, setBait] = useState('');
  const [notes, setNotes] = useState('');
  const [photoTitle, setPhotoTitle] = useState('');
  const [released, setReleased] = useState(false);
  const [shareToFeed, setShareToFeed] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lon: number } | null>(
    prefill ? { lat: prefill.latitude, lon: prefill.longitude } : null
  );
  const [locationName, setLocationName] = useState(prefill?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [unlockedNow, setUnlockedNow] = useState<Achievement[]>([]);
  const [editLoaded, setEditLoaded] = useState(!editCatchId);
  /** За публични постове с локален файл — само камерата е позволена */
  const [cameraVerifiedPhoto, setCameraVerifiedPhoto] = useState(false);
  const [initialCatch, setInitialCatch] = useState<Catch | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [extraPhotoUris, setExtraPhotoUris] = useState<string[]>([]);
  const [tripId, setTripId] = useState<string | undefined>();
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const formDirtyRef = useRef(false);
  const conditionsRef = useRef<Catch['conditions'] | null>(null);
  // Stable ID for this form instance — never changes between retries so a
  // failed save followed by a retry always writes to the same record,
  // preventing duplicate entries.
  const catchIdRef = useRef<string>(editCatchId ?? newId());

  const selectedSpecies = useMemo(() => speciesList.find((s) => s.id === speciesId)!, [speciesId]);
  const banInfo = useMemo(() => checkBanPeriod(selectedSpecies?.banPeriod), [selectedSpecies]);

  useEffect(() => {
    tripsStore.list().then(setTrips);
  }, []);

  useEffect(() => {
    if (weight || length || bait || notes || photoUri) formDirtyRef.current = true;
  }, [weight, length, bait, notes, photoUri]);

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
        Alert.alert('Грешка', 'Записът не е намерен.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }
      setInitialCatch(c);
      setSpeciesId(speciesList.some((s) => s.id === c.speciesId) ? c.speciesId : speciesList[0].id);
      setWeight(c.weightKg != null ? String(c.weightKg) : '');
      setLength(c.lengthCm != null ? String(c.lengthCm) : '');
      setBait(c.bait ?? '');
      setNotes(c.notes ?? '');
      setPhotoTitle(c.photoTitle ?? '');
      setReleased(!!c.released);
      setPhotoUri(c.photoUri);
      const remote = isRemoteImageUri(c.photoUri);
      setCameraVerifiedPhoto(remote || c.photoTakenWithAppCamera === true);
      if (c.location) {
        setLocationCoords({ lat: c.location.latitude, lon: c.location.longitude });
        setLocationName(c.location.name ?? '');
      } else {
        setLocationCoords(null);
        setLocationName('');
      }
      if (c.tripId) setTripId(c.tripId);
      if (c.conditions) conditionsRef.current = c.conditions;
      setEditLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [editCatchId, navigation]);

  useEffect(() => {
    if (!locationCoords) return;
    let cancelled = false;
    fetchWeather(locationCoords.lat, locationCoords.lon).then((snap) => {
      if (cancelled) return;
      conditionsRef.current = {
        temperatureC: snap.temperatureC,
        pressureHpa: snap.pressureHpa,
        windKmh: snap.windKmh,
        moonPhase: snap.moonPhase,
        moonPhaseName: snap.moonPhaseName,
        fishingRating: snap.fishingRating,
      };
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [locationCoords]);

  useEffect(() => {
    if (!editCatchId || !configured || !user) return;
    const fb = ensureFirebase();
    if (!fb) return;
    let cancelled = false;
    void getDoc(doc(fb.db, 'publicCatches', editCatchId)).then((snap) => {
      if (!cancelled && snap.exists()) setShareToFeed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editCatchId, configured, user]);

  const pickPhoto = async () => {
    if (shareToFeed) {
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
      setPhotoUri(await compressPhoto(result.assets[0].uri));
      setCameraVerifiedPhoto(false);
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
      setPhotoUri(await compressPhoto(result.assets[0].uri));
      setCameraVerifiedPhoto(true);
    }
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

  const addExtraPhoto = async () => {
    if (extraPhotoUris.length >= 4) return;
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
      const compressed = await compressPhoto(result.assets[0].uri);
      setExtraPhotoUris((prev) => [...prev, compressed]);
    }
  };

  const grabLocation = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нужно е разрешение', 'Разреши достъп до локацията.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    setLocationCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude });
    try {
      const places = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (places[0]) {
        const p = places[0];
        const name = [p.name, p.city ?? p.region].filter(Boolean).join(', ');
        if (name) setLocationName(name);
      }
    } catch {}
  };

  const save = async () => {
    if (!speciesId) return;
    const trimmedPhotoTitle = photoTitle.trim().slice(0, 120);
    const uri = photoUri?.trim();
    if (
      shareToFeed &&
      uri &&
      !isRemoteImageUri(uri) &&
      !cameraVerifiedPhoto
    ) {
      Alert.alert(
        'Нужна е камерата',
        'За публично споделяне и участие в класиките снимката не може да е от галерията. Направи я с камерата в приложението или изключи публичното споделяне.'
      );
      return;
    }

    setSaving(true);
    const id = catchIdRef.current;
    const photoTakenWithAppCamera =
      !uri ? undefined : isRemoteImageUri(uri) ? initialCatch?.photoTakenWithAppCamera ?? false : cameraVerifiedPhoto;

    const item: Catch = {
      id,
      speciesId,
      speciesName: selectedSpecies.nameBg,
      weightKg: weight ? parseFloat(weight.replace(',', '.')) : undefined,
      lengthCm: length ? parseFloat(length.replace(',', '.')) : undefined,
      date: initialCatch?.date ?? new Date().toISOString(),
      bait: bait || undefined,
      notes: notes || undefined,
      ...(photoUri && trimmedPhotoTitle ? { photoTitle: trimmedPhotoTitle } : {}),
      released,
      photoUri,
      extraPhotoUris: extraPhotoUris.length > 0 ? extraPhotoUris : undefined,
      photoTakenWithAppCamera,
      ...(uri &&
      initialCatch?.photoUri?.trim() === uri &&
      isRemoteImageUri(uri) &&
      initialCatch.photoStoragePath
        ? { photoStoragePath: initialCatch.photoStoragePath }
        : {}),
      location: locationCoords
        ? { latitude: locationCoords.lat, longitude: locationCoords.lon, name: locationName || undefined }
        : undefined,
      ...(tripId ? { tripId } : {}),
      conditions: conditionsRef.current ?? initialCatch?.conditions ?? undefined,
    };
    try {
      await catchesStore.save(item);
      if (user) {
        const sync = await syncCatchToCloud(item, shareToFeed);
        if (!sync.ok) {
          await enqueueCatchSync(item.id, shareToFeed);
          Alert.alert(
            'Облачна грешка',
            `Уловът е записан локално. Синхронизацията ще се повтори автоматично при връзка. Подробности: ${sync.message}\n\nМожеш да опиташ и ръчно.`,
            [
              { text: 'OK', style: 'cancel' },
              {
                text: 'Опитай отново',
                onPress: async () => {
                  const again = await syncCatchToCloud(item, shareToFeed);
                  if (again.ok) Alert.alert('Готово', 'Уловът е синхронизиран с облака.');
                  else Alert.alert('Пак неуспех', again.message);
                },
              },
            ]
          );
        }
      } else if (shareToFeed) {
        Alert.alert('Нужен е акаунт', 'За да споделиш публично, влез/регистрирай се в Профил.');
      }
      const allCatches = await catchesStore.list();

      // Check for new personal best
      const pb = checkNewPersonalBest(item, allCatches);
      if (pb.isNew && !editCatchId) {
        const pbMsg =
          pb.field === 'both' ? 'Нов личен рекорд по тегло и дължина! 🏆'
          : pb.field === 'weight' ? 'Нов личен рекорд по тегло! 🏆'
          : 'Нов личен рекорд по дължина! 🏆';
        Alert.alert('Личен рекорд!', `${item.speciesName} — ${pbMsg}`);
      }

      const achCtx = { firebaseConfigured: configured, userLoggedIn: !!user, uid: user?.uid };
      const newUnlocks = await checkForNewUnlocks(allCatches, achCtx);
      Toast.show({ type: 'success', text1: editCatchId ? 'Уловът е обновен' : 'Уловът е записан', visibilityTime: 2000 });
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

  const closeUnlockModal = () => {
    setUnlockedNow([]);
    navigation.goBack();
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

        <Pressable
          onPress={() => {
            if (photoUri && shareToFeed) void takePhoto();
            else if (photoUri) void pickPhoto();
            else void takePhoto();
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
              onChangeText={(t) => setPhotoTitle(t.slice(0, 120))}
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
              <Button title="Нова снимка (камера)" variant="secondary" onPress={takePhoto} style={{ flex: 1 }} />
            ) : (
              <Button title="Смени" variant="secondary" onPress={pickPhoto} style={{ flex: 1 }} />
            )}
            <Button
              title="Премахни"
              variant="ghost"
              onPress={() => {
                setPhotoUri(undefined);
                setPhotoTitle('');
                setCameraVerifiedPhoto(false);
              }}
              style={{ flex: 1 }}
            />
          </View>
        ) : (
          <View style={styles.photoActions}>
            <Button title="От галерията" variant="secondary" onPress={pickPhoto} style={{ flex: 1 }} disabled={shareToFeed} />
            <Button title="Снимай" variant="secondary" onPress={takePhoto} style={{ flex: 1 }} />
          </View>
        )}
        {!photoUri && shareToFeed ? (
          <Text style={[styles.muted, { marginTop: spacing.xs }]}>
            При включено публично споделяне добави снимка само през „Снимай”.
          </Text>
        ) : null}

        {photoUri ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.label}>Още снимки (до 4)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {extraPhotoUris.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: radius.md }} contentFit="cover" />
                  <Pressable
                    onPress={() => setExtraPhotoUris((p) => p.filter((_, idx) => idx !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: colors.danger, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
                    hitSlop={4}
                  >
                    <Ionicons name="close" size={12} color={colors.white} />
                  </Pressable>
                </View>
              ))}
              {extraPhotoUris.length < 4 ? (
                <Pressable
                  onPress={addExtraPhoto}
                  style={{ width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="add" size={28} color={colors.primary} />
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        <Text style={styles.label}>Вид риба</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
        >
          <View>
            <Text style={{ ...typography.bodyBold, color: colors.text }}>{selectedSpecies.nameBg}</Text>
            <Text style={{ ...typography.small, color: colors.textMuted, fontStyle: 'italic' }}>
              {selectedSpecies.nameLatin}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </Pressable>
        <SpeciesPicker
          visible={pickerOpen}
          selectedId={speciesId}
          onSelect={setSpeciesId}
          onClose={() => setPickerOpen(false)}
        />

        {banInfo.active ? (
          <View style={styles.banCard}>
            <Ionicons name="warning" size={20} color="#9C2222" />
            <View style={{ flex: 1 }}>
              <Text style={styles.banTitle}>Забранен период!</Text>
              <Text style={styles.banText}>
                {selectedSpecies.nameBg} е със забрана от {banInfo.from} до {banInfo.to}.
                {banInfo.note ? ` (${banInfo.note})` : ''} Уловената риба трябва да се пусне обратно.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Тегло (кг)</Text>
            <TextInput
              value={weight}
              onChangeText={setWeight}
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
              value={length}
              onChangeText={setLength}
              placeholder="напр. 45"
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={colors.textMuted}
            />
            {/* Inline weight estimator — appears when length entered but weight is empty */}
            {(() => {
              const lenVal = parseFloat(length.replace(',', '.'));
              if (!lenVal || lenVal <= 0 || weight) return null;
              // Fulton's K for selected species (approximate)
              const K_MAP: Record<string, number> = {
                sharan: 3.4, karakuda: 3.0, amur: 2.2, tolstolob: 2.8, lin: 3.2,
                som: 1.5, shtuka: 0.55, kostur: 2.5, pastrava: 0.9, dagova: 1.0,
                mryana: 1.6, klen: 1.8,
              };
              const K = K_MAP[speciesId] ?? 2.5;
              const estimated = Math.round((K * lenVal ** 3) / 100_000 * 100) / 100;
              if (estimated <= 0) return null;
              return (
                <Pressable
                  onPress={() => setWeight(String(estimated))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                  hitSlop={8}
                >
                  <Ionicons name="calculator-outline" size={14} color={colors.primary} />
                  <Text style={{ ...typography.small, color: colors.primary }}>
                    ≈ {estimated} кг — добави
                  </Text>
                </Pressable>
              );
            })()}
          </View>
        </View>

        <Text style={styles.label}>Стръв / примамка</Text>
        <TextInput
          value={bait}
          onChangeText={setBait}
          placeholder="напр. царевица, червей, воблер..."
          returnKeyType="next"
          style={styles.input}
          placeholderTextColor={colors.textMuted}
        />

        <Card style={{ marginTop: spacing.md }}>
          <View style={styles.locRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Локация</Text>
              {locationCoords ? (
                <Text style={styles.muted}>
                  {locationName || `${locationCoords.lat.toFixed(4)}, ${locationCoords.lon.toFixed(4)}`}
                </Text>
              ) : (
                <Text style={styles.muted}>Без координати</Text>
              )}
            </View>
            <Button title={locationCoords ? 'Обнови' : 'Маркирай'} variant="secondary" onPress={grabLocation} />
          </View>
        </Card>

        <Text style={styles.label}>Бележки</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Условия, час, какво е работило..."
          multiline
          numberOfLines={4}
          style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
          placeholderTextColor={colors.textMuted}
        />

        {/* Trip picker */}
        {trips.length > 0 ? (
          <>
            <Text style={[styles.label, { marginTop: spacing.md }]}>Излет (по избор)</Text>
            <Pressable
              onPress={() => setTripPickerOpen(true)}
              style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: undefined, paddingVertical: spacing.sm + 2 }]}
            >
              <Text style={{ color: tripId ? colors.text : colors.textMuted, fontSize: 16 }}>
                {tripId ? (trips.find((t) => t.id === tripId)?.title ?? 'Излет') : 'Не е избран'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </Pressable>
            <Modal visible={tripPickerOpen} transparent animationType="slide" onRequestClose={() => setTripPickerOpen(false)}>
              <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setTripPickerOpen(false)} />
              <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, maxHeight: '60%' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <Text style={{ ...typography.h3, color: colors.text }}>Избери излет</Text>
                  <Pressable onPress={() => setTripPickerOpen(false)} hitSlop={8}>
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </Pressable>
                </View>
                <FlatList
                  data={[{ id: '', title: 'Без излет', dateIso: '' }, ...trips]}
                  keyExtractor={(t) => t.id || 'none'}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => { setTripId(item.id || undefined); setTripPickerOpen(false); }}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
                    >
                      <View>
                        <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.title}</Text>
                        {item.dateIso ? <Text style={{ ...typography.caption, color: colors.textMuted }}>{new Date(item.dateIso).toLocaleDateString('bg-BG')}</Text> : null}
                      </View>
                      {(tripId ?? '') === item.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                    </Pressable>
                  )}
                />
              </View>
            </Modal>
          </>
        ) : null}

        <View style={[styles.row2, { alignItems: 'center', marginTop: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Пуснат обратно</Text>
            <Text style={styles.muted}>Catch & release</Text>
          </View>
          <Switch
            value={released}
            onValueChange={setReleased}
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
            value={shareToFeed}
            onValueChange={(v) => {
              if (!v) {
                setShareToFeed(false);
                return;
              }
              if (photoUri?.trim() && !isRemoteImageUri(photoUri) && !cameraVerifiedPhoto) {
                Alert.alert(
                  'Галерията не се ползва за класики',
                  'За публично споделяне трябва снимка от камерата. Премахни текущата снимка или я заснеми отново с „Снимай“.',
                  [{ text: 'OK', style: 'cancel' }]
                );
                return;
              }
              setShareToFeed(true);
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        <Button title={editCatchId ? 'Запази промените' : 'Запази улова'} onPress={save} loading={saving} style={{ marginTop: spacing.xl }} />
      </ScrollView>

      <AchievementUnlockModal
        visible={unlockedNow.length > 0}
        achievements={unlockedNow}
        onClose={closeUnlockModal}
      />
    </Screen>
  );
}
