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
  Dimensions,
} from 'react-native';
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
import { ensureFirebase } from '../services/firebase';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import * as Haptics from 'expo-haptics';
import { useUnreadNotifCount } from '../hooks/useUnreadNotifCount';
import {
  getUserPublicSummary,
  pushUserProfilePublic,
  tryGetStoredProfileAvatarUrl,
  uploadProfileAvatar,
  deleteProfileAvatar,
  refreshOwnerPhotoOnPublicCatches,
} from '../services/cloudSync';
import { getFollowing } from '../services/social';
import { fetchMyGroups, type Group, CATEGORY_LABELS } from '../services/groups';

const SW = Dimensions.get('window').width;

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
  const { colors, mode, toggleMode, accent, setAccent } = useTheme();
  const { user, configured, loading: authLoading, signOut, deleteAccount } = useAuth();

  const [catches, setCatches] = useState<Catch[]>([]);
  useEffect(() => { catchesStore.list().then(setCatches).catch(() => {}); }, []);

  const [friends, setFriends] = useState<{ uid: string; displayName: string; photoUrl?: string }[]>([]);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  useEffect(() => {
    if (!user?.uid || !configured) return;
    getFollowing(user.uid).then(async (list) => {
      setFriends(list);
      const enriched = await Promise.all(
        list.map(async (f) => {
          const s = await getUserPublicSummary(f.uid).catch(() => null);
          return { ...f, photoUrl: s?.photoUrl ?? undefined };
        })
      );
      setFriends(enriched);
    }).catch(() => {});
    fetchMyGroups(user.uid).then(setMyGroups).catch(() => {});
  }, [user?.uid, configured]);

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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        scrollContent: {
          paddingBottom: spacing.xxl,
          backgroundColor: colors.background,
        },
        // ── Top bar ──
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.card,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          paddingTop: 0, // applied inline with insets
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.sm,
        },
        topBarCenter: {
          flex: 1,
          textAlign: 'center',
          ...typography.bodyBold,
          fontSize: 17,
          color: colors.text,
        },
        topBarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
        topBarIconHit: { padding: spacing.xs },
        notifBadgeWrap: { position: 'relative' },
        notifBadge: {
          position: 'absolute',
          top: 2,
          right: 2,
          minWidth: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: colors.danger,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 2,
        },
        notifBadgeText: {
          color: colors.white,
          fontSize: 9,
          fontWeight: '700',
          lineHeight: 14,
        },
        // ── Profile header ──
        profileHeader: {
          backgroundColor: colors.card,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.md,
        },
        headerRow1: { flexDirection: 'row', alignItems: 'center' },
        avatarWrap: {
          width: 90,
          height: 90,
          borderRadius: 45,
          backgroundColor: colors.primaryDark,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        },
        avatarImg: { width: '100%', height: '100%' },
        avatarLetter: { color: colors.white, fontSize: 34, fontWeight: '700' },
        avatarBadge: {
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: colors.card,
        },
        statsRow: {
          flex: 1,
          flexDirection: 'row',
          justifyContent: 'space-around',
          paddingLeft: spacing.md,
        },
        statCol: { alignItems: 'center' },
        statNum: { fontSize: 20, fontWeight: '700', color: colors.text },
        statLabel: { ...typography.small, color: colors.textMuted, marginTop: 2 },
        headerRow2: { marginTop: spacing.sm },
        headerName: { ...typography.bodyBold, fontSize: 15, color: colors.text },
        headerCity: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
        headerBio: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
        headerButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
        outlinedBtn: {
          flex: 1,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingVertical: 7,
        },
        outlinedBtnText: { ...typography.caption, fontWeight: '700', color: colors.text },
        // ── Photo grid ──
        gridDivider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginTop: spacing.sm,
        },
        gridCell: {
          width: SW / 3,
          height: SW / 3,
        },
        gridEmpty: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: spacing.xl,
          backgroundColor: colors.card,
        },
        gridEmptyText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
        // ── Completion nudge ──
        nudge: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.card },
        nudgeRow: { flexDirection: 'row', justifyContent: 'space-between' },
        nudgeText: { ...typography.small, color: colors.textMuted },
        nudgePercent: { ...typography.small, color: colors.primary, fontWeight: '700' },
        nudgeBar: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: spacing.xs },
        nudgeFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
        nudgeHint: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs, paddingBottom: spacing.sm },
        // ── Warnings ──
        warnBanner: {
          flexDirection: 'row',
          gap: spacing.sm,
          alignItems: 'flex-start',
          backgroundColor: mode === 'dark' ? 'rgba(255,193,7,0.12)' : 'rgba(255,193,7,0.18)',
          padding: spacing.md,
          borderRadius: radius.md,
          marginBottom: spacing.md,
          marginHorizontal: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        warnText: { ...typography.caption, color: colors.text, flex: 1, lineHeight: 18 },
        // ── Public profile edit panel ──
        panel: {
          backgroundColor: colors.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.cardEdge,
          padding: spacing.md,
          marginBottom: spacing.md,
          marginHorizontal: spacing.lg,
          ...shadowCard(mode),
        },
        panelTitle: { ...typography.bodyBold, fontSize: 15, color: colors.text },
        panelSub: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
        fieldLabel: {
          ...typography.small,
          fontWeight: '700',
          color: colors.textMuted,
          marginTop: spacing.sm,
          marginBottom: spacing.xs,
          letterSpacing: 0.3,
        },
        fieldLabelFirst: { marginTop: spacing.sm },
        input: {
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: Platform.OS === 'ios' ? spacing.sm + 4 : spacing.sm + 2,
          fontSize: 15,
          color: colors.text,
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
        // ── Social sections ──
        sectionWrap: {
          backgroundColor: colors.card,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          paddingBottom: spacing.md,
        },
        sectionHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        },
        sectionTitle: { ...typography.bodyBold, fontSize: 14, color: colors.text, flex: 1 },
        sectionAction: { ...typography.small, color: colors.primary, fontWeight: '600' },
        friendItem: { alignItems: 'center', marginLeft: spacing.lg, width: 60 },
        friendAvatar: {
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: colors.primaryDark,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.xs,
        },
        friendAvatarText: { color: colors.white, fontSize: 20, fontWeight: '700' },
        friendName: { ...typography.small, color: colors.text, textAlign: 'center', fontSize: 11 },
        emptySection: {
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
        },
        emptySectionText: { ...typography.caption, color: colors.textMuted },
        clubRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        clubIconWrap: {
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.sm,
        },
        clubName: { ...typography.bodyBold, fontSize: 14, color: colors.text, flex: 1 },
        clubMeta: { ...typography.small, color: colors.textMuted, marginTop: 2 },
        // ── Guest ──
        guestBlock: { alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
        guestIconWrap: {
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.sm,
        },
        guestTitle: { ...typography.bodyBold, fontSize: 17, color: colors.text, textAlign: 'center' },
        guestSub: {
          ...typography.caption,
          color: colors.textMuted,
          textAlign: 'center',
          marginTop: spacing.xs,
          lineHeight: 18,
          paddingHorizontal: spacing.sm,
        },
      }),
    [colors, mode]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const onSignOut = () => {
    Alert.alert('Изход', 'Сигурен ли си?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изход', style: 'destructive', onPress: () => {
          if (user?.uid) AsyncStorage.removeItem(`@ribolov/profilePhoto/${user.uid}`).catch(() => {});
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


  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Screen scroll={false} padded={false}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <Pressable
          onPress={() => { void Haptics.selectionAsync(); setSettingsOpen(true); }}
          style={styles.topBarIconHit}
          accessibilityRole="button"
          accessibilityLabel="Меню"
          hitSlop={8}
        >
          <Ionicons name="menu-outline" size={24} color={colors.text} />
        </Pressable>

        <Text style={styles.topBarCenter} numberOfLines={1}>
          {displayName.trim() || 'Рибар'}
        </Text>

        <View style={styles.topBarRight}>
          {/* Notifications bell with badge */}
          <Pressable
            onPress={() => navigation.navigate('Notifications')}
            style={[styles.topBarIconHit, styles.notifBadgeWrap]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Известия"
          >
            <Ionicons name="notifications-outline" size={23} color={colors.text} />
            {unreadNotifs > 0 ? (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</Text>
              </View>
            ) : null}
          </Pressable>

          {/* Light / dark toggle */}
          <Pressable
            onPress={() => { void Haptics.selectionAsync(); toggleMode(); }}
            style={styles.topBarIconHit}
            accessibilityRole="button"
            accessibilityLabel={mode === 'dark' ? 'Светла тема' : 'Тъмна тема'}
            hitSlop={8}
          >
            <Ionicons
              name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
              size={22}
              color={colors.text}
            />
          </Pressable>
        </View>
      </View>

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
        {/* ── Guest state ── */}
        {!user ? (
          <View style={styles.guestBlock}>
            <View style={styles.guestIconWrap}>
              <Ionicons name="fish-outline" size={26} color={colors.primary} />
            </View>
            <Text style={styles.guestTitle}>Твоят риболовен профил</Text>
            <Text style={styles.guestSub}>
              Влез за синхронизация, лента и видимо име и снимка в профила.
            </Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </View>
        ) : profileLoading ? (
          <View style={{ justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {/* ── Profile header ── */}
            <View style={styles.profileHeader}>
              {/* Row 1: Avatar + Stats */}
              <View style={styles.headerRow1}>
                <Pressable
                  onPress={configured ? pickProfileAvatar : undefined}
                  disabled={!configured}
                  accessibilityRole={configured ? 'button' : 'image'}
                  accessibilityLabel={configured ? 'Промени снимка на профила' : 'Аватар'}
                >
                  <View style={styles.avatarWrap}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" />
                    ) : (
                      <Text style={styles.avatarLetter}>{initialLetter}</Text>
                    )}
                    {configured ? (
                      <View style={styles.avatarBadge} pointerEvents="none">
                        <Ionicons name="camera" size={13} color={colors.white} />
                      </View>
                    ) : null}
                  </View>
                </Pressable>

                {/* Stats */}
                <View style={styles.statsRow}>
                  <View style={styles.statCol}>
                    <Text style={styles.statNum}>{catchStatsCount}</Text>
                    <Text style={styles.statLabel}>улова</Text>
                  </View>
                  <View style={styles.statCol}>
                    <Text style={styles.statNum}>{catchStatsSpecies}</Text>
                    <Text style={styles.statLabel}>вида</Text>
                  </View>
                  <View style={styles.statCol}>
                    <Text style={styles.statNum}>{catchStatsKg}</Text>
                    <Text style={styles.statLabel}>кг</Text>
                  </View>
                </View>
              </View>

              {/* Row 2: Name, city, bio */}
              <View style={styles.headerRow2}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {displayName.trim() || user.displayName || 'Рибар'}
                </Text>
                {city.trim() ? (
                  <Text style={styles.headerCity} numberOfLines={1}>📍 {city.trim()}</Text>
                ) : null}
                {bio.trim() ? (
                  <Text style={styles.headerBio} numberOfLines={2}>{bio.trim()}</Text>
                ) : null}
              </View>

              {/* Row 3: Action buttons */}
              {configured ? (
                <View style={styles.headerButtons}>
                  <Pressable
                    style={({ pressed }) => [styles.outlinedBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => { void Haptics.selectionAsync(); setPubExpanded(true); }}
                    accessibilityRole="button"
                    accessibilityLabel="Редактирай профил"
                  >
                    <Text style={styles.outlinedBtnText}>Редактирай профил</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.outlinedBtn, pressed && { opacity: 0.7 }]}
                    onPress={openPublicPreview}
                    accessibilityRole="button"
                    accessibilityLabel="Публичен изглед"
                  >
                    <Text style={styles.outlinedBtnText}>Публичен изглед</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Completion nudge — compact, inside header card */}
              {completionPct < 100 ? (
                <View style={styles.nudge}>
                  <View style={styles.nudgeRow}>
                    <Text style={styles.nudgeText}>Профил {completionPct}% завършен</Text>
                    <Text style={styles.nudgePercent}>{completionPct}%</Text>
                  </View>
                  <View style={styles.nudgeBar}>
                    <View style={[styles.nudgeFill, { width: `${completionPct}%` as `${number}%` }]} />
                  </View>
                  {completionHint ? (
                    <Text style={styles.nudgeHint}>{completionHint} →</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* ── Public profile edit (inline) ── */}
            {pubExpanded && configured ? (
              <View style={[styles.panel, { padding: 0, overflow: 'hidden', marginTop: spacing.sm }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md }}>
                  <Ionicons name="person-circle-outline" size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
                  <Text style={[styles.panelTitle, { flex: 1 }]}>Редактирай профил</Text>
                  <Pressable onPress={() => setPubExpanded(false)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
                <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Име</Text>
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
                  <Button title="Запази промените" onPress={savePublicProfile} loading={profileSaving} style={{ marginTop: spacing.md }} />
                </View>
              </View>
            ) : null}

            {/* ── Cloud warning ── */}
            {!configured ? (
              <View style={styles.warnBanner}>
                <Ionicons name="cloud-offline-outline" size={18} color={colors.textMuted} />
                <Text style={styles.warnText}>
                  Облакът не е активен — настрой Firebase, за да редактираш снимка и онлайн профил.
                </Text>
              </View>
            ) : null}

            {/* ── Friends ── */}
            <View style={styles.sectionWrap}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Приятели</Text>
                <Pressable onPress={() => navigation.navigate('Friends')} hitSlop={8}>
                  <Text style={styles.sectionAction}>Виж всички</Text>
                </Pressable>
              </View>
              {friends.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: spacing.lg }}
                >
                  {friends.map((f) => (
                    <Pressable
                      key={f.uid}
                      style={({ pressed }) => [styles.friendItem, pressed && { opacity: 0.7 }]}
                      onPress={() => navigation.navigate('UserPublicProfile', { uid: f.uid, displayName: f.displayName })}
                    >
                      <View style={styles.friendAvatar}>
                        {f.photoUrl ? (
                          <Image source={{ uri: f.photoUrl }} style={{ width: '100%', height: '100%', borderRadius: 26 }} contentFit="cover" />
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
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>Все още няма приятели — намери рибари от лентата!</Text>
                </View>
              )}
            </View>

            {/* ── Clubs ── */}
            <View style={[styles.sectionWrap, { marginTop: spacing.sm }]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Клубове</Text>
                <Pressable onPress={() => navigation.navigate('Groups')} hitSlop={8}>
                  <Text style={styles.sectionAction}>Виж всички</Text>
                </Pressable>
              </View>
              {myGroups.length > 0 ? (
                myGroups.map((g) => (
                  <Pressable
                    key={g.id}
                    style={({ pressed }) => [styles.clubRow, pressed && { opacity: 0.7 }]}
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
          </>
        )}
      </ScrollView>

      {/* ── Settings drawer (Modal bottom sheet) ── */}
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

              {/* Menu rows */}
              <View style={{ paddingHorizontal: spacing.xs, paddingVertical: 2, marginHorizontal: spacing.xs }}>
                <Text style={[styles.menuCardTitle, { paddingHorizontal: spacing.sm, paddingTop: spacing.sm }]}>Навигация</Text>
                <Card style={styles.menuCardWrap}>
                  <MenuRow dense icon="stats-chart-outline" title="Статистики" onPress={() => { setSettingsOpen(false); navigation.navigate('Stats'); }} showDivider />
                  <MenuRow dense icon="trophy-outline" title="Лични рекорди" onPress={() => { setSettingsOpen(false); navigation.navigate('PersonalBests'); }} showDivider />
                  <MenuRow dense icon="people-outline" title="Клубове" onPress={() => { setSettingsOpen(false); navigation.navigate('Groups'); }} showDivider />
                  <MenuRow dense icon="newspaper-outline" title="Лента" onPress={() => { setSettingsOpen(false); navigation.navigate('Feed'); }} showDivider />
                  <MenuRow dense icon="images-outline" title="Седмични и месечни класации" onPress={() => { setSettingsOpen(false); navigation.navigate('Classics'); }} showDivider />
                  <MenuRow dense icon="bookmark-outline" title="Запазени" onPress={() => { setSettingsOpen(false); navigation.navigate('SavedPosts'); }} showDivider />
                  <MenuRow dense icon="notifications-outline" title="Известия" onPress={() => { setSettingsOpen(false); navigation.navigate('Notifications'); }} showDivider rightBadge={unreadNotifs || undefined} />
                  <MenuRow dense icon="people-outline" title="Приятели" onPress={() => { setSettingsOpen(false); navigation.navigate('Friends'); }} showDivider />
                  <MenuRow dense icon="trophy-outline" title="Постижения" onPress={() => { setSettingsOpen(false); navigation.navigate('Achievements'); }} showDivider />
                  <MenuRow dense icon="calendar-outline" title="Излети" onPress={() => { setSettingsOpen(false); navigation.navigate('Trips'); }} showDivider />
                  <MenuRow dense icon="ribbon-outline" title="Турнири" onPress={() => { setSettingsOpen(false); navigation.navigate('Tournaments'); }} showDivider />
                  <MenuRow dense icon="podium-outline" title="Класирания" onPress={() => { setSettingsOpen(false); navigation.navigate('Leaderboard'); }} showDivider />
                  <MenuRow dense icon="chatbubbles-outline" title="Съобщения" onPress={() => { setSettingsOpen(false); navigation.navigate('Chats'); }} showDivider />
                  <MenuRow dense icon="bulb-outline" title="Инсайти" onPress={() => { setSettingsOpen(false); navigation.navigate('Insights'); }} showDivider />
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
