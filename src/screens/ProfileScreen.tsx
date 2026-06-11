import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  Alert,
  TextInput,
  ActivityIndicator,
  Platform,
  Modal,
  Keyboard,
  Share,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '../storage/kv';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { MenuRow } from '../components/MenuRow';
import { BadgeIcon } from '../components/BadgeIcon';
import { FacebookProfileHero, FacebookHeroButton } from '../components/FacebookProfileHero';
import { ImageViewer } from '../components/ImageViewer';
import { getImageVariant, ImageSize } from '../utils/imageVariants';
import { ProfileTabs, type ProfileTabKey } from '../components/ProfileTabs';
import { TrophyShelf } from '../components/TrophyShelf';
import { FeedPost } from '../components/FeedPost';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { shadowCard } from '../theme/shadows';
import { useAuth, type DeleteAccountCredential } from '../services/authContext';
import { buildInviteShareMessage } from '../services/referral';
import { countMyInvites } from '../services/referralStats';
import { logEvent } from '../services/analytics';
import { GoogleSignInSection } from '../components/GoogleSignInButton';
import { AppleSignInSection } from '../components/AppleSignInSection';
import { updateProfile } from 'firebase/auth';
import { handleError } from '../utils/handleError';
import { checkImageSize } from '../utils/imageSize';
import { ensureFirebase } from '../services/firebase';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { catchesStore, tripsStore } from '../storage/storage';
import type { Catch, TripPlan } from '../types';
import * as Haptics from 'expo-haptics';
import { useUnreadNotifCount } from '../hooks/useUnreadNotifCount';
import {
  getUserPublicSummary,
  pushUserProfilePublic,
  tryGetStoredProfileAvatarUrl,
  uploadProfileAvatar,
  deleteProfileAvatar,
  refreshOwnerPhotoOnPublicCatches,
  refreshOwnerDisplayName,
  fetchPublicCatchesByOwner,
  type CloudCatch,
} from '../services/cloudSync';
import { getFollowing } from '../services/social';
import { fetchMyGroups, type Group, CATEGORY_LABELS } from '../services/groups';

let _socialDataCache: { uid: string; friends: { uid: string; displayName: string; photoUrl?: string }[]; groups: Group[]; at: number; friendUids: string } | null = null;
const SOCIAL_CACHE_TTL = 5 * 60 * 1000;

const WAVE = 32;

// ─── DeleteAccountModal ────────────────────────────────────────────────────────

type DeleteAccountModalProps = {
  visible: boolean;
  provider: string;
  configured: boolean;
  delPassword: string;
  colors: AppColors;
  styles: { modalBackdrop: object; modalCard: object; modalTitle: object; modalHint: object; modalInput: object; modalActions: object };
  onChangePassword: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onSocialCredential: (cred: DeleteAccountCredential) => void;
};

const DeleteAccountModal = React.memo(function DeleteAccountModal({
  visible, provider, configured, delPassword, colors, styles, onChangePassword, onClose, onSubmit, onSocialCredential,
}: DeleteAccountModalProps) {
  const isSocial = provider === 'google.com' || provider === 'apple.com';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="Затвори" />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Изтриване на акаунта</Text>
          <Text style={styles.modalHint}>
            {isSocial
              ? 'Необратимо изчиства облака и локалните данни. Потвърди самоличността си, за да продължиш.'
              : 'Необратимо изчиства облака и локалните данни. Въведи паролата си:'}
          </Text>
          {provider === 'google.com' ? (
            <GoogleSignInSection
              disabled={!configured}
              onIdToken={async (idToken) => onSocialCredential({ provider: 'google', idToken })}
            />
          ) : provider === 'apple.com' ? (
            <AppleSignInSection
              disabled={!configured}
              onAppleTokens={async (idToken, rawNonce) => onSocialCredential({ provider: 'apple', idToken, rawNonce })}
            />
          ) : (
            <TextInput
              style={styles.modalInput}
              placeholder="Парола"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={delPassword}
              onChangeText={onChangePassword}
              autoCapitalize="none"
            />
          )}
          <View style={styles.modalActions}>
            <Button title="Отказ" variant="ghost" onPress={onClose} style={{ flex: 1 }} compact />
            {!isSocial ? (
              <Button title="Изтрий" variant="danger" compact onPress={onSubmit} style={{ flex: 1 }} />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
});

// ─── Main component ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, mode, toggleMode } = useTheme();
  const { user, configured, loading: authLoading, signOut, deleteAccount } = useAuth();

  // Defensive redirect: if the user lands on Profile while signed out — most
  // commonly because they signed out from within Profile itself — bounce
  // them straight to Auth. The Profile tab's tabPress listener catches the
  // tab-tap path, but a sign-out from inside this screen doesn't trigger
  // a tab press; this effect covers that case so we never render the old
  // "useless guest splash" again.
  useEffect(() => {
    if (configured && !authLoading && !user) {
      (navigation as any).navigate('Auth');
    }
  }, [configured, authLoading, user, navigation]);

  const [catches, setCatches] = useState<Catch[]>([]);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    catchesStore.list()
      .then((list) => { if (!cancelled) setCatches(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []));

  const [nextTrip, setNextTrip] = useState<TripPlan | null>(null);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      const all = await tripsStore.list().catch(() => [] as TripPlan[]);
      if (cancelled) return;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const upcoming = all
        .filter((t) => new Date(t.dateIso) >= today)
        .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());
      setNextTrip(upcoming[0] ?? null);
    })();
    return () => { cancelled = true; };
  }, []));

  const [publicPosts, setPublicPosts] = useState<CloudCatch[]>([]);
  useFocusEffect(useCallback(() => {
    if (!user?.uid || !configured) {
      setPublicPosts([]);
      return;
    }
    let cancelled = false;
    const ownerUid = user.uid;
    fetchPublicCatchesByOwner(ownerUid, 24)
      .then((posts) => { if (!cancelled) setPublicPosts(posts); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid, configured]));

  const [friends, setFriends] = useState<{ uid: string; displayName: string; photoUrl?: string }[]>([]);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  // Count of users who signed up via my invite link. Surfaced as the
  // subtitle on the "Покани приятел" row so users see their referral
  // progress at a glance. Single getCountFromServer call = 1 read,
  // safe on every profile mount.
  const [inviteCount, setInviteCount] = useState<number>(0);
  useEffect(() => {
    if (!user?.uid || !configured) { setInviteCount(0); return; }
    let cancelled = false;
    countMyInvites(user.uid).then((n) => { if (!cancelled) setInviteCount(n); });
    return () => { cancelled = true; };
  }, [user?.uid, configured]);

  const loadSocialData = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!user?.uid || !configured) {
      if (!isCancelled()) {
        setFriends([]);
        setMyGroups([]);
      }
      return;
    }
    try {
      const [list, groups] = await Promise.all([
        getFollowing(user.uid),
        fetchMyGroups(user.uid).catch(() => [] as Group[]),
      ]);
      if (isCancelled()) return;

      // Compare current follow graph against cached one — if unchanged within TTL, reuse photos.
      const freshFriendUids = list.map((f) => f.uid).sort().join(',');
      if (
        _socialDataCache &&
        _socialDataCache.uid === user.uid &&
        _socialDataCache.friendUids === freshFriendUids &&
        Date.now() - _socialDataCache.at < SOCIAL_CACHE_TTL
      ) {
        setFriends(_socialDataCache.friends);
        setMyGroups(groups);
        return;
      }

      setMyGroups(groups);
      setFriends(list);
      const enriched = await Promise.all(
        list.map(async (f) => {
          const s = await getUserPublicSummary(f.uid).catch(() => null);
          return { ...f, photoUrl: s?.photoUrl ?? undefined };
        })
      );
      if (isCancelled()) return;
      setFriends(enriched);
      _socialDataCache = { uid: user.uid, friends: enriched, groups, at: Date.now(), friendUids: freshFriendUids };
    } catch {}
  }, [user?.uid, configured]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadSocialData(() => cancelled);
      return () => { cancelled = true; };
    }, [loadSocialData])
  );

  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [delPassword, setDelPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  // Synchronous busy guards for handlers whose `disabled` UI state lags one
  // render. Pattern repeated across the app — PostCard reactions, AddCatch
  // save, NewSpotModal save, story handlePost. Without these, two rapid
  // taps both see the state flag as `false` and both invoke the async
  // pipeline.
  const profileSavingRef = useRef(false);
  const avatarSavingRef = useRef(false);
  const deletingAccountRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pubExpanded, setPubExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Active tab in the new Facebook-style profile layout.
  const [activeTab, setActiveTab] = useState<ProfileTabKey>('posts');
  const [remotePhotoUrl, setRemotePhotoUrl] = useState<string | undefined>();
  const [pickedAvatarUri, setPickedAvatarUri] = useState<string | undefined>();
  // Resized base64 data URL — small enough for Firestore, used for save + persistent display
  const [pickedAvatarDataUrl, setPickedAvatarDataUrl] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  // Photo-grid viewer state. Tapping a grid cell used to navigate to
  // CatchDetail — that's still reachable via the Posts tab + Logbook — but
  // for a photo-browsing surface the right gesture is "open big, swipe to
  // next, pinch to zoom" which the multi-photo ImageViewer now supports.
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  // `editingRef` mirrors `pubExpanded` so loadRemoteProfile can skip text-field
  // writes mid-edit without making `pubExpanded` a dep of the callback (which
  // would cause every editor open/close to re-trigger a Firestore fetch).
  const editingRef = useRef(false);
  useEffect(() => { editingRef.current = pubExpanded; }, [pubExpanded]);

  const loadRemoteProfile = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!configured) {
      if (isCancelled()) return;
      setDisplayName('');
      setCity('');
      setBio('');
      setRemotePhotoUrl(undefined);
      setPickedAvatarUri(undefined);
      return;
    }
    if (authLoading) return;
    if (!user?.uid) {
      if (isCancelled()) return;
      setDisplayName('');
      setCity('');
      setBio('');
      setRemotePhotoUrl(undefined);
      setPickedAvatarUri(undefined);
      return;
    }
    setProfileLoading(true);

    // Show locally-cached photo instantly while Firestore loads
    const cacheKey = `@ribolov/profilePhoto/${user.uid}`;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (isCancelled()) return;
    if (cached) setRemotePhotoUrl(cached);

    try {
      const s = await getUserPublicSummary(user.uid);
      if (isCancelled()) return;
      let photo = (s?.photoUrl?.trim() || user.photoURL?.trim() || '').trim();
      if (!photo) photo = (await tryGetStoredProfileAvatarUrl(user.uid))?.trim() || '';
      if (isCancelled()) return;
      if (photo) {
        setRemotePhotoUrl(photo);
        // Keep cache in sync with latest Firestore value
        AsyncStorage.setItem(cacheKey, photo).catch(() => {});
      }
      // Skip text-field overwrites if the user is currently editing — otherwise
      // a focus-refresh wipes the in-progress displayName/city/bio they typed.
      // Photo is fine to refresh either way (it auto-saves, not user-editable
      // as text). getUserPublicSummary now returns empty string when missing,
      // so this simplifies to "use Firestore value if present, else fall back
      // to Auth user.displayName".
      if (!editingRef.current) {
        const dn = s?.displayName?.trim() || user.displayName?.trim() || '';
        setDisplayName(dn);
        setCity(s?.city ?? '');
        setBio(s?.bio ?? '');
      }
    } catch {
      if (isCancelled()) return;
      if (!editingRef.current) {
        setDisplayName(user.displayName?.trim() || '');
      }
      let photo = user.photoURL?.trim() || '';
      if (!photo) photo = cached || (await tryGetStoredProfileAvatarUrl(user.uid))?.trim() || '';
      if (isCancelled()) return;
      if (photo) setRemotePhotoUrl(photo);
    } finally {
      if (!isCancelled()) setProfileLoading(false);
    }
  }, [user?.uid, configured, authLoading]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadRemoteProfile(() => cancelled);
      return () => { cancelled = true; };
    }, [loadRemoteProfile])
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const onSignOut = () => {
    Alert.alert('Изход', 'Сигурен ли си?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изход', style: 'destructive', onPress: () => {
          // The avatar cache is keyed by uid (`@ribolov/profilePhoto/${uid}`)
          // so it can't leak to a different user — removing it on sign-out
          // just gives same-user re-sign-in a blank avatar until Firestore
          // returns. Account-switch wiping is handled by onAuthStateChanged.
          _socialDataCache = null;
          signOut().catch(() => undefined);
        },
      },
    ]);
  };

  const pickProfileAvatar = async () => {
    if (!configured || !user) return;
    if (avatarSavingRef.current) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'info', text1: 'Достъп до снимките', text2: 'Разреши достъп в настройките на устройството.', visibilityTime: 3000 });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (res.canceled || !res.assets[0]) return;
    const picked = res.assets[0];
    // Pre-check before ImageManipulator loads the full file into memory —
    // a huge source image can OOM-crash on low-end Android devices even
    // though the resized output ends up small.
    if (!checkImageSize(picked)) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      picked.uri,
      [{ resize: { width: 80, height: 80 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    // Optimistic UI — show the new avatar immediately while we upload it.
    const localUri = manipulated.uri;
    const dataUrl = manipulated.base64 ? `data:image/jpeg;base64,${manipulated.base64}` : null;
    setPickedAvatarUri(localUri);
    setPickedAvatarDataUrl(dataUrl);

    // Snapshot previous remote URL so we can roll back if persistence fails.
    const previousRemote = remotePhotoUrl;
    let usedStorageUpload = false;
    avatarSavingRef.current = true;
    try {
      // Persist independently of the displayName/city/bio form. The user
      // explicitly asked: a new photo should save itself, the text fields
      // still require an explicit save (those involve trims/validation
      // worth confirming).
      let photoUrl: string;
      if (dataUrl) {
        photoUrl = dataUrl;
      } else {
        photoUrl = await uploadProfileAvatar(user.uid, localUri);
        usedStorageUpload = true;
      }
      await pushUserProfilePublic(user.uid, { photoUrl });

      // Mirror everywhere the rest of the app reads the avatar from.
      setRemotePhotoUrl(photoUrl);
      setPickedAvatarUri(undefined);
      setPickedAvatarDataUrl(null);
      // Don't cache base64 data URLs — they can be several MB and bloating
      // AsyncStorage with them slows EVERY storage read (especially on
      // Android where AsyncStorage backs onto SharedPreferences). Only
      // cache https:// URLs; the next render falls back to the in-memory
      // state `remotePhotoUrl` until the next app launch hydrates from
      // Firestore.
      if (!photoUrl.startsWith('data:')) {
        AsyncStorage.setItem(`@ribolov/profilePhoto/${user.uid}`, photoUrl).catch(() => {});
      }

      const fb = ensureFirebase();
      if (!photoUrl.startsWith('data:') && fb?.auth.currentUser) {
        await updateProfile(fb.auth.currentUser, { photoURL: photoUrl }).catch(() => {});
      }
      refreshOwnerPhotoOnPublicCatches(user.uid, photoUrl).catch(() => {});

      Toast.show({ type: 'success', text1: 'Снимката е запазена', visibilityTime: 1800 });
    } catch (e) {
      // Roll back the optimistic state so the old avatar comes back.
      setPickedAvatarUri(undefined);
      setPickedAvatarDataUrl(null);
      setRemotePhotoUrl(previousRemote);
      if (usedStorageUpload) {
        // Best-effort cleanup if Storage upload succeeded but Firestore
        // write failed. Mirrors the original savePublicProfile behavior.
        deleteProfileAvatar(user.uid).catch(() => {});
      }
      handleError(e);
    } finally {
      avatarSavingRef.current = false;
    }
  };

  const savePublicProfile = async () => {
    if (!user?.uid || !configured) return;
    // Synchronous guard — `profileSaving` state lags so two rapid taps both
    // see it as false. Without this, both taps fire the Firestore write +
    // both show the success toast.
    if (profileSavingRef.current) return;
    // Empty displayName would write `""` to Firestore. The rest of the app
    // falls back to "Рибар" in that case, but the profile
    // looks broken (the public-profile header shows no name) and mention
    // autocomplete returns the user with an empty label.
    if (!displayName.trim()) {
      Alert.alert('Име', 'Въведи име за профила.');
      return;
    }
    profileSavingRef.current = true;
    setProfileSaving(true);
    try {
      // Text-only save. The avatar persists itself inside `pickProfileAvatar`
      // immediately after the user picks, so we don't need to handle it here.
      // We deliberately omit `photoUrl` from the patch — omitting (rather
      // than passing the current remote URL) means Firestore leaves the field
      // untouched, which is the right behavior whether the avatar was just
      // updated, never set, or unchanged.
      const newDisplayName = displayName.trim();
      const previousDisplayName = (user.displayName ?? '').trim();
      const patch = {
        displayName: newDisplayName,
        city: city.trim(),
        bio: bio.trim(),
      };
      await pushUserProfilePublic(user.uid, patch);
      // Display-name fanout — propagate the new name to every place that
      // stored a snapshot at publish time. Skipped when nothing changed so
      // a city/bio-only save doesn't trigger a (potentially) 500-row write.
      // Runs in the background so the success toast can fire immediately;
      // worst case a refresh-after-rename briefly shows the old name on
      // older catches until the fanout finishes.
      if (newDisplayName && newDisplayName !== previousDisplayName) {
        void refreshOwnerDisplayName(user.uid, newDisplayName).catch(() => undefined);
      }
      Toast.show({ type: 'success', text1: 'Готово', text2: 'Профилът е запазен.', visibilityTime: 2500 });
    } catch (e: unknown) {
      handleError(e);
    } finally {
      profileSavingRef.current = false;
      setProfileSaving(false);
    }
  };

  const closeDeleteModal = () => {
    Keyboard.dismiss();
    setDeleteModalVisible(false);
    setDelPassword('');
  };

  const confirmAndDelete = useCallback((cred: DeleteAccountCredential) => {
    if (deletingAccountRef.current) return;
    Alert.alert('Изтриване на акаунт', 'Това изтрива облачни данни и локалния дневник. Необратимо.', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий завинаги',
        style: 'destructive',
        onPress: async () => {
          // The Alert button can be tapped twice on a hot device (debouncing
          // is platform-defined and not guaranteed). Without this ref, two
          // taps fire two parallel deleteAccount calls — both attempt
          // reauth + cascade + auth.deleteUser, and the second hits
          // auth/user-not-found after the first wins, surfacing as a
          // confusing error toast right after the cascade succeeds.
          if (deletingAccountRef.current) return;
          deletingAccountRef.current = true;
          try {
            await deleteAccount(cred);
            closeDeleteModal();
          } catch (e: unknown) {
            handleError(e);
          } finally {
            deletingAccountRef.current = false;
          }
        },
      },
    ]);
  }, [deleteAccount, closeDeleteModal]);

  const submitDeleteAccount = () => {
    if (!delPassword.trim()) {
      Alert.alert('Парола', 'Въведи текущата парола за потвърждение.');
      return;
    }
    confirmAndDelete({ provider: 'password', password: delPassword });
  };

  const openPublicPreview = () => {
    if (!user?.uid) return;
    navigation.navigate('UserPublicProfile', {
      uid: user.uid,
      displayName: displayName.trim() || user.displayName || undefined,
      photoUrlHint: avatarUri ?? undefined,
    });
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const unreadNotifs = useUnreadNotifCount(user?.uid);
  const avatarUri = pickedAvatarUri ?? remotePhotoUrl ?? user?.photoURL ?? undefined;
  const initialLetter = (displayName || '?').slice(0, 1).toUpperCase();

  const hasPhoto = !!(avatarUri);
  const hasDisplayName = !!(displayName.trim() && displayName.trim() !== user?.email);
  const hasCatch = catches.length > 0;
  const hasSyncedCatch = catches.some((c) => c.syncedToCloud === true);
  const completionPct =
    (hasPhoto ? 25 : 0) +
    (hasDisplayName ? 25 : 0) +
    (hasCatch ? 25 : 0) +
    (hasSyncedCatch ? 25 : 0);
  const completionHint = !hasPhoto
    ? 'Добави профилна снимка'
    : !hasDisplayName
    ? 'Добави своето име'
    : !hasCatch
    ? 'Запиши първия улов'
    : !hasSyncedCatch
    ? 'Сподели улов публично'
    : null;

  const catchStatsCount = catches.length;
  const catchStatsSpecies = new Set(catches.map((c) => c.speciesId)).size;
  const catchStatsKg = catches.reduce((s, c) => s + (c.weightKg ?? 0), 0).toFixed(1);

  // Personal-best catch — drives the TrophyHero backdrop + PR badge.
  const bestCatch = useMemo(() => {
    let best: Catch | null = null;
    for (const c of catches) {
      if (typeof c.weightKg !== 'number') continue;
      if (!best || (c.weightKg ?? 0) > (best.weightKg ?? 0)) best = c;
    }
    return best;
  }, [catches]);

  // ── Design tokens ───────────────────────────────────────────────────────────

  const heroGrad: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#4EAEE0', '#1E7CC4', '#0D559A'];

  const waveColor  = mode === 'dark' ? '#080E1A' : '#F2F8FF';
  const cardBg     = mode === 'dark' ? '#0E1E35' : '#FFFFFF';
  const cardBorder = mode === 'dark' ? 'rgba(74,168,232,0.15)' : 'rgba(21,112,184,0.10)';

  // ── Styles ──────────────────────────────────────────────────────────────────

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // ── Scroll ──
        scrollContent: {
          paddingBottom: spacing.xxl,
        },

        // ── New: stats card below the redesigned hero ──
        statsCard: {
          flexDirection: 'row',
          marginHorizontal: spacing.lg,
          marginTop: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: spacing.md,
        },
        statCell: { flex: 1, alignItems: 'center' },
        statDivider: {
          width: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginVertical: 4,
        },
        statNum: { ...typography.h2, color: colors.text, fontSize: 20, fontWeight: '800' },
        statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 11 },

        // ── New: action row (Edit / Preview) ──
        actionsRow: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
        },
        actionBtn: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          height: 42,
          borderRadius: radius.pill,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        },
        actionBtnText: { ...typography.bodyBold, color: colors.primary, fontSize: 13 },

        // ── New: completion nudge as a calm card ──
        nudgeCard: {
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.lg,
          backgroundColor: colors.primarySurface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
        nudgeText: { ...typography.caption, color: colors.text, flex: 1, fontSize: 12 },
        nudgePct: { ...typography.caption, color: colors.primary, fontWeight: '800', fontSize: 12 },
        nudgeBarBg: {
          height: 5,
          borderRadius: 3,
          backgroundColor: colors.border,
          marginTop: spacing.xs,
          overflow: 'hidden',
        },
        nudgeBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },

        // ── Hero ──
        hero: {
          paddingBottom: WAVE + 64,
          overflow: 'hidden',
        },
        heroBg: { ...StyleSheet.absoluteFillObject },
        heroInner: {
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.xs,
        },

        // ── Hero top bar ──
        heroBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.lg,
        },
        heroMenuBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: 'rgba(255,255,255,0.18)',
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        heroBarCenter: {
          color: '#fff',
          fontSize: 13,
          fontFamily: 'Manrope_700Bold',
          letterSpacing: 2.2,
          textTransform: 'uppercase',
          opacity: 0.6,
        },
        heroBarRight: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        heroBarIconBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.22)',
          alignItems: 'center',
          justifyContent: 'center',
        },

        // ── Hero avatar section ──
        heroAvatarSection: {
          alignItems: 'center',
          paddingTop: spacing.sm,
          paddingBottom: spacing.md,
        },
        avatarRingWrap: {
          width: 108,
          height: 108,
          borderRadius: 54,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.4)',
          shadowColor: '#4AA8E8',
          shadowOffset: { width: 0, height: 0 },
          shadowRadius: 12,
          shadowOpacity: 0.6,
          elevation: 10,
          marginBottom: spacing.sm,
        },
        avatarInner: {
          width: 100,
          height: 100,
          borderRadius: 50,
          backgroundColor: '#0D559A',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        },
        avatarImg: { width: '100%', height: '100%' },
        avatarLetter: {
          color: '#fff',
          fontSize: 38,
          fontFamily: 'Manrope_800ExtraBold',
        },
        avatarBadge: {
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.6)',
        },
        heroDisplayName: {
          color: '#fff',
          fontSize: 22,
          fontFamily: 'Manrope_800ExtraBold',
          letterSpacing: -0.4,
          textAlign: 'center',
          marginBottom: 4,
        },
        heroCity: {
          color: 'rgba(255,255,255,0.65)',
          fontSize: 12,
          fontFamily: 'Manrope_600SemiBold',
          textAlign: 'center',
          marginBottom: 4,
        },
        heroBio: {
          color: 'rgba(255,255,255,0.55)',
          fontSize: 12,
          fontFamily: 'Manrope_600SemiBold',
          textAlign: 'center',
          lineHeight: 17,
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.sm,
        },

        // ── Hero stats strip (glass panel) ──
        heroStatsPanel: {
          flexDirection: 'row',
          backgroundColor: 'rgba(255,255,255,0.10)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.22)',
          borderRadius: 18,
          paddingVertical: 12,
          marginBottom: spacing.sm,
        },
        heroStatItem: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        heroStatDivider: {
          width: 1,
          height: 28,
          backgroundColor: 'rgba(255,255,255,0.25)',
          alignSelf: 'center',
        },
        heroStatNum: {
          color: '#fff',
          fontSize: 22,
          fontFamily: 'Manrope_800ExtraBold',
          letterSpacing: -0.5,
        },
        heroStatLabel: {
          color: 'rgba(255,255,255,0.6)',
          fontSize: 10,
          fontFamily: 'Manrope_600SemiBold',
          marginTop: 2,
        },

        // ── Hero action buttons ──
        heroActions: {
          flexDirection: 'row',
          gap: spacing.sm,
          marginTop: spacing.xs,
          marginBottom: spacing.sm,
        },
        heroActionBtn: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          backgroundColor: 'rgba(255,255,255,0.15)',
          borderRadius: 20,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.3)',
          paddingVertical: 10,
        },
        heroActionBtnText: {
          color: '#fff',
          fontSize: 12,
          fontFamily: 'Manrope_700Bold',
        },

        // ── Hero completion nudge ──
        heroNudge: {
          marginTop: spacing.sm,
        },
        heroNudgeRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        },
        heroNudgeText: {
          color: 'rgba(255,255,255,0.65)',
          fontSize: 11,
          fontFamily: 'Manrope_600SemiBold',
        },
        heroNudgePct: {
          color: '#fff',
          fontSize: 11,
          fontFamily: 'Manrope_700Bold',
        },
        heroNudgeBarBg: {
          height: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(255,255,255,0.18)',
        },
        heroNudgeBarFill: {
          height: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(255,255,255,0.8)',
        },

        // ── Wave content panel ──
        wave: {
          borderTopLeftRadius: WAVE,
          borderTopRightRadius: WAVE,
          marginTop: -WAVE,
          paddingTop: spacing.xl,
        },

        // ── Section headers ──
        sectionRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.sm,
          marginTop: spacing.md,
        },
        sectionLeft: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        sectionAccent: {
          width: 3,
          height: 16,
          borderRadius: 2,
          backgroundColor: colors.primary,
        },
        sectionLabel: {
          fontSize: 11,
          fontFamily: 'Manrope_700Bold',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: colors.textMuted,
        },
        sectionLink: {
          fontSize: 12,
          fontFamily: 'Manrope_700Bold',
          color: colors.primary,
        },

        // ── Public profile edit panel ──
        panel: {
          backgroundColor: cardBg,
          borderWidth: 1.5,
          borderColor: cardBorder,
          borderRadius: 22,
          marginHorizontal: spacing.xl,
          marginBottom: spacing.xl,
          padding: spacing.lg,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.2,
          shadowRadius: 16,
          elevation: 8,
        },
        panelTitleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: spacing.md,
        },
        panelTitle: {
          fontSize: 15,
          fontFamily: 'Manrope_700Bold',
          color: colors.text,
          flex: 1,
          marginLeft: spacing.sm,
        },
        fieldLabel: {
          fontSize: 11,
          fontFamily: 'Manrope_700Bold',
          color: colors.textMuted,
          marginTop: spacing.sm,
          marginBottom: spacing.xs,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        },
        input: {
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: Platform.OS === 'ios' ? spacing.sm + 4 : spacing.sm + 2,
          fontSize: 15,
          color: colors.text,
          fontFamily: 'Manrope_600SemiBold',
        },

        // ── Cloud warning banner ──
        warnBanner: {
          flexDirection: 'row',
          gap: spacing.sm,
          alignItems: 'flex-start',
          backgroundColor: mode === 'dark' ? 'rgba(245,137,10,0.10)' : 'rgba(245,137,10,0.12)',
          padding: spacing.md,
          borderRadius: 18,
          marginBottom: spacing.md,
          marginHorizontal: spacing.xl,
          borderWidth: 1,
          borderColor: 'rgba(245,137,10,0.30)',
        },
        warnText: {
          ...typography.caption,
          color: colors.text,
          flex: 1,
          lineHeight: 18,
        },

        // ── Upcoming trip card ──
        tripCard: {
          flexDirection: 'row',
          alignItems: 'center',
          marginHorizontal: spacing.xl,
          marginBottom: spacing.md,
          borderRadius: 22,
          overflow: 'hidden',
          padding: spacing.md,
          gap: spacing.sm,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 14,
          elevation: 8,
        },
        tripGradBg: { ...StyleSheet.absoluteFillObject },
        tripIconWrap: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        },
        tripLabel: {
          fontSize: 9,
          fontFamily: 'Manrope_700Bold',
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          marginBottom: 2,
        },
        tripTitle: {
          fontSize: 14,
          fontFamily: 'Manrope_800ExtraBold',
          color: '#fff',
        },
        tripDate: {
          fontSize: 11,
          fontFamily: 'Manrope_600SemiBold',
          color: 'rgba(255,255,255,0.6)',
          marginTop: 2,
        },

        // ── Friends section ──
        sectionWrap: {
          marginBottom: spacing.sm,
        },
        friendScroll: {
          paddingLeft: spacing.xl,
          paddingRight: spacing.md,
        },
        friendItem: {
          alignItems: 'center',
          marginRight: spacing.md,
          width: 68,
        },
        friendAvatar: {
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.primaryDark,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.xs,
          borderWidth: 2,
          borderColor: cardBorder,
          overflow: 'hidden',
        },
        friendAvatarText: {
          color: '#fff',
          fontSize: 22,
          fontFamily: 'Manrope_800ExtraBold',
        },
        friendName: {
          fontSize: 10,
          fontFamily: 'Manrope_600SemiBold',
          color: colors.text,
          textAlign: 'center',
        },
        emptySection: {
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.md,
        },
        emptySectionText: {
          ...typography.caption,
          color: colors.textMuted,
        },

        // ── Clubs section ──
        clubCard: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.sm + 2,
          backgroundColor: cardBg,
          borderWidth: 1,
          borderColor: cardBorder,
          borderRadius: 18,
          marginHorizontal: spacing.xl,
          marginBottom: spacing.sm,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 4,
        },
        clubIconWrap: {
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.sm,
        },
        clubName: {
          fontSize: 14,
          fontFamily: 'Manrope_700Bold',
          color: colors.text,
        },
        clubMeta: {
          fontSize: 11,
          fontFamily: 'Manrope_600SemiBold',
          color: colors.textMuted,
          marginTop: 2,
        },

        // ── Guest hero ──
        guestHero: {
          flex: 1,
          minHeight: 500,
        },
        guestHeroBg: { ...StyleSheet.absoluteFillObject },
        guestHeroInner: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.xl,
          paddingTop: 80,
          paddingBottom: 48,
        },
        guestIconOuter: {
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.3)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        },
        guestTitle: {
          color: '#fff',
          fontSize: 24,
          fontFamily: 'Manrope_800ExtraBold',
          textAlign: 'center',
          letterSpacing: -0.4,
          marginBottom: spacing.sm,
        },
        guestSub: {
          color: 'rgba(255,255,255,0.62)',
          fontSize: 14,
          fontFamily: 'Manrope_600SemiBold',
          textAlign: 'center',
          lineHeight: 20,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.xl,
        },
        guestBtn: {
          borderRadius: 28,
          overflow: 'hidden',
          alignSelf: 'stretch',
          shadowColor: '#F5890A',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 14,
          elevation: 8,
        },
        guestBtnInner: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          paddingVertical: 16,
          paddingHorizontal: spacing.xl,
        },
        guestBtnText: {
          color: '#fff',
          fontSize: 16,
          fontFamily: 'Manrope_800ExtraBold',
          letterSpacing: -0.2,
        },

        // ── Modal ──
        modalBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.48)',
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
        },
        modalCard: {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: colors.cardEdge,
          zIndex: 2,
          ...shadowCard(mode),
        },
        modalTitle: { ...typography.bodyBold, fontSize: 17, color: colors.danger },
        modalHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
        modalInput: {
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
          fontSize: 15,
          color: colors.text,
          marginTop: spacing.md,
        },
        modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },

        // ── Settings drawer ──
        settingsBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'flex-end',
        },
        settingsSheet: {
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingBottom: 32,
          maxHeight: '88%',
          ...shadowCard(mode),
        },
        settingsHandle: {
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
          alignSelf: 'center',
          marginTop: spacing.sm,
          marginBottom: spacing.xs,
        },
        settingsHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        settingsTitle: { ...typography.bodyBold, fontSize: 16, color: colors.text, flex: 1 },
        settingsCloseBtn: { padding: spacing.xs },
        settingsSignOut: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          padding: spacing.md,
          paddingHorizontal: spacing.lg,
        },
        settingsSignOutText: { ...typography.bodyBold, fontSize: 15, color: colors.danger },
        settingsDivider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginHorizontal: spacing.lg,
          marginVertical: spacing.xs,
        },
        menuCardTitle: {
          ...typography.small,
          fontWeight: '700',
          color: colors.textMuted,
          marginBottom: 2,
          marginLeft: spacing.xs,
          letterSpacing: 0.5,
          fontSize: 11,
        },
        menuCardWrap: {
          paddingVertical: 2,
          paddingHorizontal: spacing.xs,
          marginBottom: spacing.sm,
        },
      }),
    [colors, mode, cardBg, cardBorder]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  // Header content (everything that used to be in the ScrollView): the
  // guest hero, the loading state, and the entire logged-in profile body
  // EXCEPT the posts-tab list — that flows into FlatList data instead.
  const renderProfileHeader = () => (
    <>
  {/* Signed-out state renders nothing — the useEffect at the top redirects
      to Auth, which removes the old guest "Вход / Регистрация" splash. */}
  {!user ? null : profileLoading ? (
    /* ── Loading state ── */
    <View style={{ flex: 1, minHeight: 400, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>

  ) : (
    <>
      {/* ════════════════════════════════════════
          FACEBOOK-STYLE HERO — wide cover (best-catch photo or dawn-water
          gradient), avatar overlapping bottom-left, name + meta left-aligned
          below, action buttons row inside the hero.
      ════════════════════════════════════════ */}
      <FacebookProfileHero
        name={displayName.trim() || user.displayName || 'Рибар'}
        city={city.trim() || undefined}
        bio={bio.trim() || undefined}
        coverUrl={bestCatch?.photoUri}
        avatarUrl={avatarUri ?? undefined}
        initials={initialLetter}
        metaItems={[
          // Hero meta intentionally lean — catches + kg used to appear here
          // AND in the Info tab's stats card, which was redundant and forced
          // the eye to scan the same numbers twice. The Info tab now owns the
          // detailed breakdown; the hero just carries city for identity.
          city.trim() || undefined,
        ]}
        onPickAvatar={configured ? pickProfileAvatar : undefined}
        topLeft={
          <FacebookHeroButton
            // settings-outline (gear) reads as "preferences + secondary nav"
            // much faster than the hamburger this used to be — users were
            // missing the settings drawer entirely on first visit. The drawer
            // contents themselves haven't changed; just the entry-point icon.
            icon="settings-outline"
            onPress={() => { void Haptics.selectionAsync(); setSettingsOpen(true); }}
            accessibilityLabel="Настройки"
          />
        }
        topRight={
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <FacebookHeroButton
              icon="notifications-outline"
              onPress={() => navigation.navigate('Notifications')}
              accessibilityLabel="Известия"
              badge={unreadNotifs}
            />
            <FacebookHeroButton
              icon={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
              onPress={() => { void Haptics.selectionAsync(); toggleMode(); }}
              accessibilityLabel={mode === 'dark' ? 'Светла тема' : 'Тъмна тема'}
            />
          </View>
        }
        actions={
          configured ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable
                onPress={() => { void Haptics.selectionAsync(); setPubExpanded(true); }}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  height: 40,
                  borderRadius: 8,
                  backgroundColor: pressed ? colors.primaryDark : colors.primary,
                })}
                accessibilityRole="button"
                accessibilityLabel="Редактирай профил"
              >
                <Ionicons name="create" size={16} color="#fff" />
                <Text style={{ ...typography.bodyBold, color: '#fff', fontSize: 14 }}>
                  Редактирай
                </Text>
              </Pressable>
              <Pressable
                onPress={openPublicPreview}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  height: 40,
                  borderRadius: 8,
                  backgroundColor: pressed ? colors.border : colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                })}
                accessibilityRole="button"
                accessibilityLabel="Виж публичен изглед"
              >
                <Ionicons name="eye-outline" size={16} color={colors.text} />
                <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 14 }}>
                  Виж публично
                </Text>
              </Pressable>
            </View>
          ) : null
        }
      />

      {/* ── Completion nudge — sits above the tabs as a one-time onboarding cue. ── */}
      {completionPct < 100 ? (
        <View style={styles.nudgeCard}>
          <View style={styles.nudgeRow}>
            <Ionicons name="rocket-outline" size={16} color={colors.primary} />
            <Text style={styles.nudgeText}>
              {completionHint ? completionHint : `Профил ${completionPct}% завършен`}
            </Text>
            <Text style={styles.nudgePct}>{completionPct}%</Text>
          </View>
          <View style={styles.nudgeBarBg}>
            <View style={[styles.nudgeBarFill, { width: `${completionPct}%` as `${number}%` }]} />
          </View>
        </View>
      ) : null}

      {/* ── Edit panel — collapsible, shown when user taps "Редактирай" ── */}
      {pubExpanded && configured ? (
        <View style={styles.panel}>
          <View style={styles.panelTitleRow}>
            <Ionicons name="person-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.panelTitle}>Редактирай профил</Text>
            <Pressable onPress={() => setPubExpanded(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.fieldLabel}>Име</Text>
          <TextInput
            style={styles.input}
            placeholder="Как да те виждат другите"
            placeholderTextColor={colors.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
          />
          <Text style={styles.fieldLabel}>Град или регион</Text>
          <TextInput
            style={styles.input}
            placeholder="Напр. Балчик"
            placeholderTextColor={colors.textMuted}
            value={city}
            onChangeText={setCity}
          />
          <Text style={styles.fieldLabel}>За теб</Text>
          <TextInput
            style={[styles.input, { minHeight: 72, textAlignVertical: 'top', paddingTop: spacing.sm + 4 }]}
            placeholder="Кратко представяне…"
            placeholderTextColor={colors.textMuted}
            value={bio}
            onChangeText={setBio}
            multiline
          />
          <Button
            title="Запази промените"
            onPress={savePublicProfile}
            loading={profileSaving}
            style={{ marginTop: spacing.md }}
          />
        </View>
      ) : null}

      {/* ── Cloud warning banner ── */}
      {!configured ? (
        <View style={styles.warnBanner}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.warning} />
          <Text style={styles.warnText}>
            Облакът не е активен — настрой Firebase, за да редактираш снимка и онлайн профил.
          </Text>
        </View>
      ) : null}

      {/* ── Tabs — sticky-style segmented control ── */}
      <ProfileTabs active={activeTab} onChange={setActiveTab} />

      {/* ════════════════════════════════════════
          TAB CONTENT
      ════════════════════════════════════════ */}
      <View style={[styles.wave, { backgroundColor: waveColor, marginTop: 0, paddingTop: spacing.lg }]}>

        {/* ─────────── POSTS TAB ───────────
            When there are posts they flow into the outer FlatList's
            `data` so each FeedPost only mounts when scrolled into view
            — critical for users with 50+ public catches. Only the
            empty-state branch stays in the header. */}
        {activeTab === 'posts' && publicPosts.length === 0 ? (
          // Warm-card empty state — mirrors the Logbook's first-catch screen
          // so the entry point to AddCatch feels consistent across surfaces.
          // The bare "icon + text + pill" version this replaced read as a
          // dismissable system message; this version reads as an invitation.
          <View style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.lg }}>
            <View style={{
              width: 80, height: 80, borderRadius: 40,
              backgroundColor: colors.primarySurface,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: colors.border,
            }}>
              <Ionicons name="fish" size={38} color={colors.primary} />
            </View>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ ...typography.h3, color: colors.text, textAlign: 'center' }}>
                Започни да споделяш улови
              </Text>
              <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.md, lineHeight: 22 }}>
                Сподели любимите си улови с общността — ще се появяват тук и в лентата.
              </Text>
            </View>
            <Pressable
              onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} })}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.xl,
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: pressed ? colors.primaryDark : colors.primary,
                flexDirection: 'row', alignItems: 'center', gap: 8,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 10,
                elevation: 6,
              })}
              accessibilityRole="button"
              accessibilityLabel="Запиши улов"
            >
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={{ ...typography.bodyBold, color: '#fff', fontSize: 15 }}>Запиши улов</Text>
            </Pressable>
          </View>
        ) : null}

        {/* ─────────── PHOTOS TAB — trophy shelf + photo grid ─────────── */}
        {activeTab === 'photos' ? (
          <View>
            <TrophyShelf
              catches={catches.map((c) => ({
                id: c.id,
                speciesName: c.speciesName,
                weightKg: c.weightKg,
                photoUri: c.photoUri,
                date: c.date,
              }))}
              onPressCatch={(id) =>
                (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id } })
              }
            />
            {catches.filter((c) => c.photoUri).length === 0 ? (
              <View style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm }}>
                <Ionicons name="images-outline" size={40} color={colors.textMuted} />
                <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center' }}>
                  Все още няма качени снимки.
                </Text>
                <Pressable
                  onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} })}
                  style={({ pressed }) => ({
                    marginTop: spacing.md,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: 10,
                    borderRadius: radius.pill,
                    backgroundColor: pressed ? colors.primaryDark : colors.primary,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Сподели първата си риба"
                >
                  <Text style={{ ...typography.bodyBold, color: '#fff', fontSize: 13 }}>
                    Сподели първата си риба
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <View style={[styles.sectionWrap, { marginTop: spacing.lg }]}>
                <View style={styles.sectionRow}>
                  <View style={styles.sectionLeft}>
                    <View style={styles.sectionAccent} />
                    <Text style={styles.sectionLabel}>Всички снимки</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginHorizontal: spacing.xl }}>
                  {catches.filter((c) => c.photoUri).map((c, i) => {
                    const size = (screenWidth - spacing.xl * 2 - 4) / 3;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setPhotoViewerIndex(i)}
                        style={{ width: size, height: size, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' }}
                        accessibilityRole="button"
                        accessibilityLabel={`Виж снимка от улов на ${c.speciesName}`}
                      >
                        <Image source={{ uri: getImageVariant(c.photoUri!, ImageSize.gridThumb) ?? c.photoUri! }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        ) : null}

        {/* ─────────── INFO TAB — bio, city, stats, upcoming trip, clubs ─────────── */}
        {activeTab === 'info' ? (
          <View>
            {/* Stats card */}
            <View style={[styles.statsCard, { marginTop: 0 }]}>
              <View style={styles.statCell}>
                <Text style={styles.statNum}>{catchStatsCount}</Text>
                <Text style={styles.statLbl}>улова</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statNum}>{catchStatsSpecies}</Text>
                <Text style={styles.statLbl}>вида</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statNum}>{catchStatsKg}</Text>
                <Text style={styles.statLbl}>кг</Text>
              </View>
            </View>

            {/* Upcoming trip card (only when there's a trip). Reuses
                the same dark gradient + icon-wrap styles from before. */}
            {nextTrip ? (
              <Pressable
                style={({ pressed }) => [styles.tripCard, pressed && { opacity: 0.8 }]}
                onPress={() => navigation.navigate('Trips')}
                accessibilityRole="button"
                accessibilityLabel="Следващ излет"
              >
                <LinearGradient
                  colors={['#0A1E38', '#0D2240']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tripGradBg}
                />
                <View style={styles.tripIconWrap}>
                  <Ionicons name="calendar-outline" size={22} color={colors.onAccent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripLabel}>СЛЕДВАЩ ИЗЛЕТ</Text>
                  <Text style={styles.tripTitle} numberOfLines={1}>{nextTrip.title}</Text>
                  <Text style={styles.tripDate}>
                    {new Date(nextTrip.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.5)" />
              </Pressable>
            ) : null}

            {/* Clubs section */}
            <View style={[styles.sectionWrap, { marginBottom: spacing.xl, marginTop: spacing.lg }]}>
              <View style={styles.sectionRow}>
                <View style={styles.sectionLeft}>
                  <View style={styles.sectionAccent} />
                  <Text style={styles.sectionLabel}>Клубове</Text>
                </View>
                <Pressable onPress={() => navigation.navigate('Groups')} hitSlop={8}>
                  <Text style={styles.sectionLink}>Виж всички</Text>
                </Pressable>
              </View>

              {myGroups.length > 0 ? (
                myGroups.map((g) => (
                  <Pressable
                    key={g.id}
                    style={({ pressed }) => [styles.clubCard, pressed && { opacity: 0.75 }]}
                    onPress={() => navigation.navigate('GroupDetail', { groupId: g.id, groupName: g.name })}
                  >
                    <View style={styles.clubIconWrap}>
                      <Ionicons name="people-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clubName} numberOfLines={1}>{g.name}</Text>
                      <Text style={styles.clubMeta}>{CATEGORY_LABELS[g.category]} · {g.memberCount} члена</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>Все още не членуваш в клуб — намери такъв в секция Клубове!</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {/* ─────────── FRIENDS TAB — Facebook 2-col grid ─────────── */}
        {activeTab === 'friends' ? (
          <View style={styles.sectionWrap}>
            <View style={styles.sectionRow}>
              <View style={styles.sectionLeft}>
                <View style={styles.sectionAccent} />
                <Text style={styles.sectionLabel}>
                  Приятели{friends.length > 0 ? ` · ${friends.length}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => navigation.navigate('Friends')} hitSlop={8}>
                <Text style={styles.sectionLink}>Виж всички</Text>
              </Pressable>
            </View>

            {friends.length > 0 ? (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  paddingHorizontal: spacing.xl,
                  gap: spacing.md,
                }}
              >
                {friends.map((f) => {
                  // Two columns with a single gap of size spacing.md between them.
                  const cellWidth = (screenWidth - spacing.xl * 2 - spacing.md) / 2;
                  return (
                    <Pressable
                      key={f.uid}
                      onPress={() =>
                        navigation.navigate('UserPublicProfile', {
                          uid: f.uid,
                          displayName: f.displayName,
                        })
                      }
                      style={({ pressed }) => ({
                        width: cellWidth,
                        backgroundColor: colors.card,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: colors.border,
                        overflow: 'hidden',
                        opacity: pressed ? 0.85 : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={f.displayName}
                    >
                      <View
                        style={{
                          width: '100%',
                          aspectRatio: 1,
                          backgroundColor: colors.surfaceAlt,
                        }}
                      >
                        {f.photoUrl ? (
                          <Image
                            source={{ uri: f.photoUrl }}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={{
                              flex: 1,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: colors.primaryDark,
                            }}
                          >
                            <Text
                              style={{
                                color: '#fff',
                                fontSize: 44,
                                fontFamily: 'Manrope_800ExtraBold',
                              }}
                            >
                              {(f.displayName || '?').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                        <Text
                          style={{
                            ...typography.bodyBold,
                            color: colors.text,
                            fontSize: 14,
                          }}
                          numberOfLines={1}
                        >
                          {f.displayName}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Pressable
                onPress={() => navigation.navigate('Friends')}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  marginHorizontal: spacing.xl,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: pressed ? colors.surfaceAlt : colors.primarySurface,
                  borderWidth: 1,
                  borderColor: colors.border,
                })}
                accessibilityRole="button"
                accessibilityLabel="Намери приятели"
              >
                <Ionicons name="people-outline" size={20} color={colors.primary} />
                <Text style={[styles.emptySectionText, { flex: 1, color: colors.text }]}>
                  Все още няма приятели — намери рибари
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
        ) : null}

      </View>
      {/* end wave */}
    </>
  )}
    </>
  );


  // Posts-tab catches stream into FlatList data so each FeedPost mounts only
  // when scrolled into range. Other tabs use an empty data array; their
  // content is rendered as a static block inside the ListHeader. This is the
  // fix for the profile-screen stall when a user has 50+ public catches.
  const postsData = user && !profileLoading && activeTab === 'posts' ? publicPosts : [];

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={postsData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <FishingRefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadRemoteProfile().catch(() => {}); setRefreshing(false); }}
          />
        }
        // Virtualization knobs — render a small window around the viewport
        // and recycle off-screen rows.
        windowSize={5}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        removeClippedSubviews
        renderItem={({ item }) => (
          <FeedPost
            item={item}
            myUid={user?.uid}
            myDisplayName={user?.displayName ?? 'Аз'}
            socialEnabled={Boolean(configured && user)}
            onPressAuthor={(authorUid, name) => {
              if (authorUid === user?.uid) return;
              (navigation as any).navigate('UserPublicProfile', { uid: authorUid, displayName: name });
            }}
            onPressCatch={(c) =>
              (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })
            }
          />
        )}
        ListHeaderComponent={renderProfileHeader()}
      />


      {/* ════════════════════════════════════════
          SETTINGS DRAWER (Modal bottom sheet) — UNCHANGED
      ════════════════════════════════════════ */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.settingsBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setSettingsOpen(false)} accessibilityLabel="Затвори" />
          <View style={styles.settingsSheet}>
            <View style={styles.settingsHandle} />
            {/* Header */}
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>Настройки</Text>
              <Pressable style={styles.settingsCloseBtn} onPress={() => setSettingsOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Затвори">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Sign out */}
              {user ? (
                <Pressable
                  style={({ pressed }) => [styles.settingsSignOut, pressed && { opacity: 0.7 }]}
                  onPress={() => { setSettingsOpen(false); onSignOut(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Изход"
                >
                  <Ionicons name="log-out-outline" size={20} color={colors.danger} />
                  <Text style={styles.settingsSignOutText}>Изход</Text>
                </Pressable>
              ) : null}

              <View style={styles.settingsDivider} />

              {/* Menu rows — grouped into 4 logical sections so the previous
                  flat list of 16+ items no longer feels overwhelming. */}
              <View style={{ paddingHorizontal: spacing.xs, paddingVertical: 2, marginHorizontal: spacing.xs }}>

                {/* ── Моят риболов — personal stats, achievements, saved content ── */}
                <Text style={[styles.menuCardTitle, { paddingHorizontal: spacing.sm, paddingTop: spacing.sm }]}>Моят риболов</Text>
                <Card style={styles.menuCardWrap}>
                  <MenuRow dense icon="calendar-outline" title="Излети" onPress={() => { setSettingsOpen(false); navigation.navigate('Trips'); }} showDivider />
                  <MenuRow dense icon="trophy-outline" title="Лични рекорди" onPress={() => { setSettingsOpen(false); navigation.navigate('PersonalBests'); }} showDivider />
                  <MenuRow dense icon="ribbon-outline" title="Постижения" onPress={() => { setSettingsOpen(false); navigation.navigate('Achievements'); }} showDivider />
                  <MenuRow dense icon="stats-chart-outline" title="Статистики" onPress={() => { setSettingsOpen(false); navigation.navigate('Stats'); }} showDivider />
                  <MenuRow dense icon="bulb-outline" title="Инсайти" onPress={() => { setSettingsOpen(false); navigation.navigate('Insights'); }} showDivider />
                  <MenuRow dense icon="bookmark-outline" title="Запазени" onPress={() => { setSettingsOpen(false); navigation.navigate('SavedPosts'); }} />
                </Card>

                {/* ── Социални — people, clubs, messages ── */}
                <Text style={[styles.menuCardTitle, { paddingHorizontal: spacing.sm, paddingTop: spacing.md }]}>Социални</Text>
                <Card style={styles.menuCardWrap}>
                  <MenuRow
                    dense
                    icon="gift-outline"
                    title="Покани приятел"
                    subtitle={
                      inviteCount === 0
                        ? 'Сподели Риболов с приятели'
                        : inviteCount === 1
                          ? '1 приятел се регистрира'
                          : `${inviteCount} приятели се регистрираха`
                    }
                    onPress={() => {
                      setSettingsOpen(false);
                      if (!user) return;
                      // Fire-and-forget — Share.share resolves with a result
                      // we don't need to inspect; the OS sheet handles its
                      // own cancellation UI. Errors (rare — only thrown when
                      // the system can't open the sheet at all) we swallow.
                      void Share.share({ message: buildInviteShareMessage(user.uid) }).catch(() => undefined);
                      // Fires when the user opens the OS share sheet — not
                      // when they actually pick a recipient (Share.share's
                      // result doesn't tell us reliably across platforms).
                      // Combined with downstream `acceptPendingReferral`
                      // in authContext we can compute the conversion funnel
                      // (sends → installs → signups) without per-platform
                      // share-result inspection.
                      logEvent('referral_invite_sent');
                    }}
                    showDivider
                  />
                  {user ? (
                    <MenuRow
                      dense
                      icon="eye-outline"
                      title="Виж как ме виждат другите"
                      onPress={() => {
                        setSettingsOpen(false);
                        // Opens THIS user's own public profile screen so they
                        // can audit what strangers see (avatar, name, bio,
                        // city, catches grid, follower count). Cheap trust
                        // signal — eliminates the "wait, what's actually on
                        // my profile?" question without making them sign out.
                        (navigation as any).navigate('UserPublicProfile', {
                          uid: user.uid,
                          displayName: user.displayName ?? '',
                        });
                      }}
                      showDivider
                    />
                  ) : null}
                  <MenuRow dense icon="people-outline" title="Приятели" onPress={() => { setSettingsOpen(false); navigation.navigate('Friends'); }} showDivider />
                  <MenuRow dense icon="people-circle-outline" title="Клубове" onPress={() => { setSettingsOpen(false); navigation.navigate('Groups'); }} showDivider />
                  <MenuRow dense icon="chatbubbles-outline" title="Съобщения" onPress={() => { setSettingsOpen(false); navigation.navigate('Chats'); }} showDivider />
                  <MenuRow dense icon="notifications-outline" title="Известия" onPress={() => { setSettingsOpen(false); navigation.navigate('Notifications'); }} rightBadge={unreadNotifs || undefined} />
                </Card>

                {/* ── Класации — competition / leaderboards ── */}
                <Text style={[styles.menuCardTitle, { paddingHorizontal: spacing.sm, paddingTop: spacing.md }]}>Класации</Text>
                <Card style={styles.menuCardWrap}>
                  <MenuRow dense icon="trophy-outline" title="Турнири" onPress={() => { setSettingsOpen(false); navigation.navigate('Tournaments'); }} showDivider />
                  <MenuRow dense icon="podium-outline" title="Класирания" onPress={() => { setSettingsOpen(false); navigation.navigate('Leaderboard'); }} showDivider />
                  <MenuRow dense icon="images-outline" title="Седмични и месечни класации" onPress={() => { setSettingsOpen(false); navigation.navigate('Classics'); }} />
                </Card>

                {/* ── Настройки — preferences / legal / destructive ── */}
                <Text style={[styles.menuCardTitle, { paddingHorizontal: spacing.sm, paddingTop: spacing.md }]}>Настройки</Text>
                <Card style={styles.menuCardWrap}>
                  <MenuRow dense icon="settings-outline" title="Настройки за известия" onPress={() => { setSettingsOpen(false); navigation.navigate('NotificationPreferences'); }} showDivider />
                  {Platform.OS === 'ios' ? (
                    <MenuRow dense icon="apps-outline" title="Икона на приложението" onPress={() => { setSettingsOpen(false); navigation.navigate('AppIconPicker'); }} showDivider />
                  ) : null}
                  <MenuRow
                    dense
                    icon="document-text-outline"
                    title="Правна информация"
                    onPress={() => { setSettingsOpen(false); navigation.navigate('LegalInfo'); }}
                    showDivider={!!user}
                  />
                  {user ? (
                    <MenuRow
                      dense
                      destructive
                      icon="trash-outline"
                      title="Изтриване на акаунта"
                      onPress={() => { setSettingsOpen(false); setDeleteModalVisible(true); }}
                    />
                  ) : null}
                </Card>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Delete account modal ── */}
      {user ? (
        <DeleteAccountModal
          visible={deleteModalVisible}
          provider={user.providerData[0]?.providerId ?? 'password'}
          configured={configured}
          delPassword={delPassword}
          colors={colors}
          styles={styles}
          onChangePassword={setDelPassword}
          onClose={closeDeleteModal}
          onSubmit={submitDeleteAccount}
          onSocialCredential={confirmAndDelete}
        />
      ) : null}

      {/* ── Photo grid viewer ── Lazy-mount: building the URI list every
          render is cheap, but the viewer's PanResponder + Animated values
          aren't — only mount when the user actually opens a photo. */}
      {photoViewerIndex !== null ? (
        <ImageViewer
          uris={catches.filter((c) => c.photoUri).map((c) => c.photoUri!)}
          initialIndex={photoViewerIndex}
          visible
          onClose={() => setPhotoViewerIndex(null)}
        />
      ) : null}
    </Screen>
  );
}
