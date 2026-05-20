import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  Platform,
  Modal,
  Keyboard,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { MenuRow } from '../components/MenuRow';
import { BadgeIcon } from '../components/BadgeIcon';
import { TrophyHero, TrophyHeroButton } from '../components/TrophyHero';
import { TrophyShelf } from '../components/TrophyShelf';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { accentPresets, type AccentTheme } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { shadowCard } from '../theme/shadows';
import { useAuth, type DeleteAccountCredential } from '../services/authContext';
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
  const { colors, mode, toggleMode, accent, setAccent } = useTheme();
  const { user, configured, loading: authLoading, signOut, deleteAccount } = useAuth();

  const [catches, setCatches] = useState<Catch[]>([]);
  useFocusEffect(useCallback(() => {
    catchesStore.list().then(setCatches).catch(() => {});
  }, []));

  const [nextTrip, setNextTrip] = useState<TripPlan | null>(null);
  const loadNextTrip = useCallback(async () => {
    const all = await tripsStore.list().catch(() => [] as TripPlan[]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = all
      .filter((t) => new Date(t.dateIso) >= today)
      .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());
    setNextTrip(upcoming[0] ?? null);
  }, []);
  useFocusEffect(useCallback(() => { void loadNextTrip(); }, [loadNextTrip]));

  const [publicPosts, setPublicPosts] = useState<CloudCatch[]>([]);
  useFocusEffect(useCallback(() => {
    if (!user?.uid || !configured) return;
    fetchPublicCatchesByOwner(user.uid, 24).then(setPublicPosts).catch(() => {});
  }, [user?.uid, configured]));

  const [friends, setFriends] = useState<{ uid: string; displayName: string; photoUrl?: string }[]>([]);
  const [myGroups, setMyGroups] = useState<Group[]>([]);

  const loadSocialData = useCallback(async () => {
    if (!user?.uid || !configured) return;
    try {
      const [list, groups] = await Promise.all([
        getFollowing(user.uid),
        fetchMyGroups(user.uid).catch(() => [] as Group[]),
      ]);

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
      setFriends(enriched);
      _socialDataCache = { uid: user.uid, friends: enriched, groups, at: Date.now(), friendUids: freshFriendUids };
    } catch {}
  }, [user?.uid, configured]);

  useFocusEffect(
    useCallback(() => { void loadSocialData(); }, [loadSocialData])
  );

  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [delPassword, setDelPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pubExpanded, setPubExpanded] = useState(false);
  const [accentPickerExpanded, setAccentPickerExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotePhotoUrl, setRemotePhotoUrl] = useState<string | undefined>();
  const [pickedAvatarUri, setPickedAvatarUri] = useState<string | undefined>();
  // Resized base64 data URL — small enough for Firestore, used for save + persistent display
  const [pickedAvatarDataUrl, setPickedAvatarDataUrl] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

  const loadRemoteProfile = useCallback(async () => {
    if (!configured) {
      setDisplayName('');
      setCity('');
      setBio('');
      setRemotePhotoUrl(undefined);
      setPickedAvatarUri(undefined);
      return;
    }
    if (authLoading) return;
    if (!user?.uid) {
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
    if (cached) setRemotePhotoUrl(cached);

    try {
      const s = await getUserPublicSummary(user.uid);
      let photo = (s?.photoUrl?.trim() || user.photoURL?.trim() || '').trim();
      if (!photo) photo = (await tryGetStoredProfileAvatarUrl(user.uid))?.trim() || '';
      if (photo) {
        setRemotePhotoUrl(photo);
        // Keep cache in sync with latest Firestore value
        AsyncStorage.setItem(cacheKey, photo).catch(() => {});
      }
      const dn =
        s?.displayName?.trim() && s.displayName !== 'Рибар'
          ? s.displayName.trim()
          : user.displayName?.trim() || '';
      setDisplayName(dn);
      setCity(s?.city ?? '');
      setBio(s?.bio ?? '');
    } catch {
      setDisplayName(user.displayName?.trim() || '');
      let photo = user.photoURL?.trim() || '';
      if (!photo) photo = cached || (await tryGetStoredProfileAvatarUrl(user.uid))?.trim() || '';
      if (photo) setRemotePhotoUrl(photo);
    } finally {
      setProfileLoading(false);
    }
  }, [user?.uid, configured, authLoading]);

  useFocusEffect(
    useCallback(() => {
      void loadRemoteProfile();
    }, [loadRemoteProfile])
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const onSignOut = () => {
    Alert.alert('Изход', 'Сигурен ли си?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изход', style: 'destructive', onPress: () => {
          if (user?.uid) AsyncStorage.removeItem(`@ribolov/profilePhoto/${user.uid}`).catch(() => {});
          _socialDataCache = null;
          signOut().catch(() => undefined);
        },
      },
    ]);
  };

  const pickProfileAvatar = async () => {
    if (!configured || !user) return;
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
    if (!res.canceled && res.assets[0]) {
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
      setPickedAvatarUri(manipulated.uri);
      setPickedAvatarDataUrl(
        manipulated.base64 ? `data:image/jpeg;base64,${manipulated.base64}` : null
      );
    }
  };

  const savePublicProfile = async () => {
    if (!user?.uid || !configured || profileSaving) return;
    setProfileSaving(true);
    try {
      const patch: { displayName: string; city: string; bio: string; photoUrl?: string } = {
        displayName: displayName.trim(),
        city: city.trim(),
        bio: bio.trim(),
      };
      let usedStorageUpload = false;
      if (pickedAvatarUri) {
        if (pickedAvatarDataUrl) {
          patch.photoUrl = pickedAvatarDataUrl;
        } else {
          patch.photoUrl = await uploadProfileAvatar(user.uid, pickedAvatarUri);
          usedStorageUpload = true;
        }
        setRemotePhotoUrl(patch.photoUrl);
        setPickedAvatarUri(undefined);
        setPickedAvatarDataUrl(null);
        AsyncStorage.setItem(`@ribolov/profilePhoto/${user.uid}`, patch.photoUrl).catch(() => {});
      } else if (remotePhotoUrl?.trim()) {
        patch.photoUrl = remotePhotoUrl.trim();
      }
      try {
        await pushUserProfilePublic(user.uid, patch);
      } catch (writeErr) {
        if (usedStorageUpload) {
          deleteProfileAvatar(user.uid).catch(() => {});
        }
        throw writeErr;
      }
      const urlForAuth = patch.photoUrl?.trim();
      const fb = ensureFirebase();
      if (urlForAuth && !urlForAuth.startsWith('data:') && fb?.auth.currentUser) {
        await updateProfile(fb.auth.currentUser, { photoURL: urlForAuth });
      }
      if (urlForAuth) {
        refreshOwnerPhotoOnPublicCatches(user.uid, urlForAuth).catch(() => {});
      }
      Toast.show({ type: 'success', text1: 'Готово', text2: 'Профилът е запазен.', visibilityTime: 2500 });
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setProfileSaving(false);
    }
  };

  const closeDeleteModal = () => {
    Keyboard.dismiss();
    setDeleteModalVisible(false);
    setDelPassword('');
  };

  const confirmAndDelete = useCallback((cred: DeleteAccountCredential) => {
    Alert.alert('Изтриване на акаунт', 'Това изтрива облачни данни и локалния дневник. Необратимо.', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий завинаги',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAccount(cred);
            closeDeleteModal();
          } catch (e: unknown) {
            handleError(e);
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
  const initialLetter = (displayName || user?.email || '?').slice(0, 1).toUpperCase();

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
          fontFamily: 'Nunito_700Bold',
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
          fontFamily: 'Nunito_800ExtraBold',
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
          fontFamily: 'Nunito_800ExtraBold',
          letterSpacing: -0.4,
          textAlign: 'center',
          marginBottom: 4,
        },
        heroCity: {
          color: 'rgba(255,255,255,0.65)',
          fontSize: 12,
          fontFamily: 'Nunito_600SemiBold',
          textAlign: 'center',
          marginBottom: 4,
        },
        heroBio: {
          color: 'rgba(255,255,255,0.55)',
          fontSize: 12,
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_800ExtraBold',
          letterSpacing: -0.5,
        },
        heroStatLabel: {
          color: 'rgba(255,255,255,0.6)',
          fontSize: 10,
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_700Bold',
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
          fontFamily: 'Nunito_600SemiBold',
        },
        heroNudgePct: {
          color: '#fff',
          fontSize: 11,
          fontFamily: 'Nunito_700Bold',
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
          fontFamily: 'Nunito_700Bold',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: colors.textMuted,
        },
        sectionLink: {
          fontSize: 12,
          fontFamily: 'Nunito_700Bold',
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
          fontFamily: 'Nunito_700Bold',
          color: colors.text,
          flex: 1,
          marginLeft: spacing.sm,
        },
        fieldLabel: {
          fontSize: 11,
          fontFamily: 'Nunito_700Bold',
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
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_700Bold',
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          marginBottom: 2,
        },
        tripTitle: {
          fontSize: 14,
          fontFamily: 'Nunito_800ExtraBold',
          color: '#fff',
        },
        tripDate: {
          fontSize: 11,
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_800ExtraBold',
        },
        friendName: {
          fontSize: 10,
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_700Bold',
          color: colors.text,
        },
        clubMeta: {
          fontSize: 11,
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_800ExtraBold',
          textAlign: 'center',
          letterSpacing: -0.4,
          marginBottom: spacing.sm,
        },
        guestSub: {
          color: 'rgba(255,255,255,0.62)',
          fontSize: 14,
          fontFamily: 'Nunito_600SemiBold',
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
          fontFamily: 'Nunito_800ExtraBold',
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

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadRemoteProfile().catch(() => {}); setRefreshing(false); }}
            tintColor={colors.primary}
          />
        }
      >

        {/* ════════════════════════════════════════
            GUEST STATE — hero gradient screen
        ════════════════════════════════════════ */}
        {!user ? (
          <View style={styles.guestHero}>
            <LinearGradient
              colors={heroGrad}
              start={{ x: 0.3, y: 0 }}
              end={{ x: 0.7, y: 1 }}
              style={styles.guestHeroBg}
              pointerEvents="none"
            />
            <View style={[styles.guestHeroInner, { paddingTop: insets.top + 48 }]}>
              <View style={styles.guestIconOuter}>
                <Ionicons name="fish-outline" size={44} color="rgba(255,255,255,0.9)" />
              </View>
              <Text style={styles.guestTitle}>Твоят риболовен профил</Text>
              <Text style={styles.guestSub}>
                Влез за синхронизация, лента и видимо име и снимка в профила.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.guestBtn, pressed && { opacity: 0.85 }]}
                onPress={() => navigation.navigate('Auth')}
                accessibilityRole="button"
                accessibilityLabel="Вход / Регистрация"
              >
                <LinearGradient
                  colors={['#F5A020', '#E05E00']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={styles.guestBtnInner}>
                  <Ionicons name="log-in-outline" size={20} color="#fff" />
                  <Text style={styles.guestBtnText}>Вход / Регистрация</Text>
                </View>
              </Pressable>
            </View>
          </View>

        ) : profileLoading ? (
          /* ── Loading state ── */
          <View style={{ flex: 1, minHeight: 400, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>

        ) : (
          <>
            {/* ════════════════════════════════════════
                TROPHY HERO — the angler's biggest catch fills the entire
                top-of-screen as a dramatic backdrop. Identity sits in a glass
                card overlapping the bottom. Falls back to a dawn-water gradient
                when there's no catch yet.
            ════════════════════════════════════════ */}
            <TrophyHero
              name={displayName.trim() || user.displayName || 'Рибар'}
              city={city.trim() || undefined}
              bio={bio.trim() || undefined}
              avatarUrl={avatarUri ?? undefined}
              initials={initialLetter}
              bestCatch={bestCatch ? {
                photoUri: bestCatch.photoUri,
                speciesName: bestCatch.speciesName,
                weightKg: bestCatch.weightKg,
                date: bestCatch.date,
              } : undefined}
              onPickAvatar={configured ? pickProfileAvatar : undefined}
              topLeft={
                <TrophyHeroButton
                  icon="menu-outline"
                  onPress={() => { void Haptics.selectionAsync(); setSettingsOpen(true); }}
                  accessibilityLabel="Меню"
                />
              }
              topRight={
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <TrophyHeroButton
                    icon="notifications-outline"
                    onPress={() => navigation.navigate('Notifications')}
                    accessibilityLabel="Известия"
                    badge={unreadNotifs}
                  />
                  <TrophyHeroButton
                    icon={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                    onPress={() => { void Haptics.selectionAsync(); toggleMode(); }}
                    accessibilityLabel={mode === 'dark' ? 'Светла тема' : 'Тъмна тема'}
                  />
                </View>
              }
            />

            {/* ── Stats card — three cells, clean borders, lives below the hero ── */}
            <View style={styles.statsCard}>
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

            {/* ── Action buttons — outline pill style now that the hero is calmer ── */}
            {configured ? (
              <View style={styles.actionsRow}>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => { void Haptics.selectionAsync(); setPubExpanded(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Редактирай профил"
                >
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                  <Text style={styles.actionBtnText}>Редактирай профил</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]}
                  onPress={openPublicPreview}
                  accessibilityRole="button"
                  accessibilityLabel="Публичен изглед"
                >
                  <Ionicons name="eye-outline" size={16} color={colors.primary} />
                  <Text style={styles.actionBtnText}>Публичен изглед</Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── Completion nudge — calmer card style ── */}
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

            {/* ── Trophy shelf — top 3 biggest catches with podium ribbons. ── */}
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

            {/* ════════════════════════════════════════
                WAVE CONTENT PANEL
            ════════════════════════════════════════ */}
            <View style={[styles.wave, { backgroundColor: waveColor }]}>

              {/* ── Public profile edit panel ── */}
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
                  <Ionicons name="cloud-offline-outline" size={18} color={colors.accent} />
                  <Text style={styles.warnText}>
                    Облакът не е активен — настрой Firebase, за да редактираш снимка и онлайн профил.
                  </Text>
                </View>
              ) : null}

              {/* ── Upcoming trip card ── */}
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
                    <Ionicons name="calendar-outline" size={22} color="#fff" />
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

              {/* ── Friends section ── */}
              <View style={styles.sectionWrap}>
                <View style={styles.sectionRow}>
                  <View style={styles.sectionLeft}>
                    <View style={styles.sectionAccent} />
                    <Text style={styles.sectionLabel}>Приятели</Text>
                  </View>
                  <Pressable onPress={() => navigation.navigate('Friends')} hitSlop={8}>
                    <Text style={styles.sectionLink}>Виж всички</Text>
                  </Pressable>
                </View>

                {friends.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.friendScroll}
                  >
                    {friends.map((f) => (
                      <Pressable
                        key={f.uid}
                        style={({ pressed }) => [styles.friendItem, pressed && { opacity: 0.7 }]}
                        onPress={() => navigation.navigate('UserPublicProfile', { uid: f.uid, displayName: f.displayName })}
                      >
                        <View style={styles.friendAvatar}>
                          {f.photoUrl ? (
                            <Image
                              source={{ uri: f.photoUrl }}
                              style={{ width: '100%', height: '100%', borderRadius: 30 }}
                              contentFit="cover"
                            />
                          ) : (
                            <Text style={styles.friendAvatarText}>
                              {(f.displayName || '?').slice(0, 1).toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.friendName} numberOfLines={1}>{f.displayName}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Pressable
                    onPress={() => navigation.navigate('Friends')}
                    style={[styles.emptySection, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}
                  >
                    <Ionicons name="people-outline" size={20} color={colors.primary} />
                    <Text style={[styles.emptySectionText, { flex: 1 }]}>Все още няма приятели — намери рибари</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* ── Public posts grid ── */}
              {publicPosts.length > 0 ? (
                <View style={[styles.sectionWrap, { marginBottom: spacing.md }]}>
                  <View style={styles.sectionRow}>
                    <View style={styles.sectionLeft}>
                      <View style={styles.sectionAccent} />
                      <Text style={styles.sectionLabel}>Публични улови</Text>
                    </View>
                    <Pressable onPress={() => (navigation as any).navigate('FeedTab', { screen: 'FeedList' })} hitSlop={8}>
                      <Text style={styles.sectionLink}>Към лентата</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginHorizontal: spacing.xl }}>
                    {publicPosts.map((post) => {
                      const size = (screenWidth - spacing.xl * 2 - 4) / 3;
                      return (
                        <Pressable
                          key={post.id}
                          onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: post.id } })}
                          style={{ width: size, height: size, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' }}
                        >
                          {post.photoUri ? (
                            <Image source={{ uri: post.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          ) : (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <Ionicons name="fish-outline" size={20} color={colors.textMuted} />
                              <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Nunito_600SemiBold' }} numberOfLines={1}>
                                {post.speciesName ?? ''}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* ── Clubs section ── */}
              <View style={[styles.sectionWrap, { marginBottom: spacing.xl }]}>
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
            {/* end wave */}
          </>
        )}
      </ScrollView>

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

              {/* Accent theme picker */}
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                  <Ionicons name="color-palette-outline" size={16} color={colors.primary} style={{ marginRight: spacing.xs }} />
                  <Text style={{ ...typography.bodyBold, fontSize: 14, color: colors.text }}>Цветова тема</Text>
                  {!accentPickerExpanded ? (
                    <Text style={{ ...typography.small, color: colors.textMuted, marginLeft: spacing.sm }}>
                      {accentPresets[accent].emoji} {accentPresets[accent].label}
                    </Text>
                  ) : null}
                  <Pressable onPress={() => { void Haptics.selectionAsync(); setAccentPickerExpanded((v) => !v); }} style={{ marginLeft: 'auto' }} hitSlop={8}>
                    <Ionicons name={accentPickerExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
                {accentPickerExpanded ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.sm, flexDirection: 'row', paddingBottom: spacing.sm }}
                  >
                    {(Object.keys(accentPresets) as AccentTheme[]).map((key) => {
                      const preset = accentPresets[key];
                      const selected = accent === key;
                      return (
                        <Pressable
                          key={key}
                          onPress={() => { void Haptics.selectionAsync(); setAccent(key); }}
                          accessibilityRole="button"
                          accessibilityLabel={preset.label}
                          accessibilityState={{ selected }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: spacing.xs,
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 20,
                            borderWidth: 1.5,
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.primarySurface : 'transparent',
                          }}
                        >
                          <Text style={{ fontSize: 15 }}>{preset.emoji}</Text>
                          <Text style={{
                            ...typography.small,
                            fontWeight: selected ? '700' : '400',
                            color: selected ? colors.primary : colors.textMuted,
                          }}>
                            {preset.label}
                          </Text>
                          {selected ? (
                            <Ionicons name="checkmark" size={14} color={colors.primary} />
                          ) : (
                            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: preset.light.primary }} />
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}
              </View>

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
    </Screen>
  );
}
