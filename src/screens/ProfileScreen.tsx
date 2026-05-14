import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
import { LiquidBlobBg } from '../components/LiquidBlobBg';
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

type ProfileTopBarProps = {
  mode: 'light' | 'dark';
  user: { uid?: string } | null;
  styles: { topBar: object; topBarTitle: object; topBarRight: object; themeToggle: object; themeIconHit: object; topBarSignOut: object; topBarSignOutText: object };
  onToggleMode: () => void;
  onSignOut: () => void;
};

const ProfileTopBar = React.memo(function ProfileTopBar({
  mode, user, styles, onToggleMode, onSignOut,
}: ProfileTopBarProps) {
  return (
    <View style={styles.topBar}>
      <Text style={styles.topBarTitle}>Профил</Text>
      <View style={styles.topBarRight}>
        <View style={styles.themeToggle}>
          <Pressable
            style={styles.themeIconHit}
            onPress={() => { if (mode === 'dark') { void Haptics.selectionAsync(); onToggleMode(); } }}
            accessibilityRole="button"
            accessibilityLabel="Светла тема"
            hitSlop={8}
          >
            <Ionicons
              name="sunny-outline"
              size={22}
              color={mode === 'light' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'}
            />
          </Pressable>
          <Pressable
            style={styles.themeIconHit}
            onPress={() => { if (mode === 'light') { void Haptics.selectionAsync(); onToggleMode(); } }}
            accessibilityRole="button"
            accessibilityLabel="Тъмна тема"
            hitSlop={8}
          >
            <Ionicons
              name="moon-outline"
              size={21}
              color={mode === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'}
            />
          </Pressable>
        </View>
        {user ? (
          <Pressable style={styles.topBarSignOut} onPress={onSignOut} hitSlop={12}>
            <Text style={styles.topBarSignOutText}>Изход</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

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

export default function ProfileScreen() {
  const navigation = useAppNavigation();
  const { colors, mode, toggleMode } = useTheme();
  const { user, configured, loading: authLoading, signOut, deleteAccount } = useAuth();

  const [catches, setCatches] = useState<Catch[]>([]);
  useEffect(() => { catchesStore.list().then(setCatches).catch(() => {}); }, []);

  const BADGES = useMemo(() => [
    { id: 'first', emoji: '🎣', label: 'Първи улов', earned: catches.length >= 1 },
    { id: 'ten', emoji: '🏅', label: '10 улова', earned: catches.length >= 10 },
    { id: 'fifty', emoji: '🥇', label: '50 улова', earned: catches.length >= 50 },
    { id: 'century', emoji: '💯', label: '100 улова', earned: catches.length >= 100 },
    { id: 'species5', emoji: '🐠', label: '5 вида', earned: new Set(catches.map((c) => c.speciesId)).size >= 5 },
    { id: 'tenkg', emoji: '⚖️', label: '10 кг', earned: catches.reduce((s, c) => s + (c.weightKg ?? 0), 0) >= 10 },
    { id: 'release', emoji: '♻️', label: 'Пуснал риба', earned: catches.some((c) => c.released) },
    { id: 'photo5', emoji: '📸', label: 'Фотограф', earned: catches.filter((c) => c.photoUri).length >= 5 },
  ], [catches]);

  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [delPassword, setDelPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pubExpanded, setPubExpanded] = useState(false);
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
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.primary,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm + 2,
        },
        topBarTitle: { ...typography.bodyBold, fontSize: 17, color: colors.white },
        topBarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
        themeToggle: { flexDirection: 'row', alignItems: 'center', gap: 2 },
        themeIconHit: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
        topBarSignOut: { paddingVertical: spacing.xs, paddingLeft: spacing.xs },
        topBarSignOutText: { ...typography.bodyBold, fontSize: 14, color: 'rgba(255,255,255,0.92)' },
        bodyPad: { paddingHorizontal: spacing.lg },
        identityRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: spacing.md,
        },
        avatarRing: {
          width: 76,
          height: 76,
          borderRadius: 38,
          padding: 3,
          backgroundColor: colors.card,
          position: 'relative',
          ...shadowCard(mode),
        },
        avatarInner: {
          flex: 1,
          borderRadius: 35,
          overflow: 'hidden',
          backgroundColor: colors.primaryDark,
          alignItems: 'center',
          justifyContent: 'center',
        },
        avatarImg: { width: '100%', height: '100%' },
        avatarLetter: { color: colors.white, fontSize: 28, fontWeight: '700' },
        avatarBadge: {
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: colors.card,
        },
        identityTextCol: { flex: 1, minWidth: 0 },
        identityName: { ...typography.bodyBold, fontSize: 18, color: colors.text },
        identityEmail: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
        previewLink: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          marginTop: spacing.sm,
          paddingVertical: 2,
        },
        previewLinkText: { ...typography.small, fontWeight: '700', color: colors.primary },
        guestBlock: {
          alignItems: 'center',
          paddingVertical: spacing.lg,
        },
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
        warnBanner: {
          flexDirection: 'row',
          gap: spacing.sm,
          alignItems: 'flex-start',
          backgroundColor: mode === 'dark' ? 'rgba(255,193,7,0.12)' : 'rgba(255,193,7,0.18)',
          padding: spacing.md,
          borderRadius: radius.md,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
        },
        warnText: { ...typography.caption, color: colors.text, flex: 1, lineHeight: 18 },
        panel: {
          backgroundColor: colors.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.cardEdge,
          padding: spacing.md,
          marginBottom: spacing.md,
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
        fieldLabelFirst: {
          marginTop: spacing.sm,
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
        },
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
    [colors, mode]
  );

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
      // Resize to 80×80 — ~2-4 KB base64, safe to embed in Firestore catch documents
      const manipulated = await ImageManipulator.manipulateAsync(
        picked.uri,
        [{ resize: { width: 80, height: 80 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      setPickedAvatarUri(manipulated.uri);        // file URI → shown by expo-image immediately
      setPickedAvatarDataUrl(                      // data URL → stored in Firestore on save
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
          // Fallback: upload to Firebase Storage
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
        // If Storage was used and Firestore write failed, clean up the orphaned file
        if (usedStorageUpload) {
          deleteProfileAvatar(user.uid).catch(() => {});
        }
        throw writeErr;
      }
      const urlForAuth = patch.photoUrl?.trim();
      const fb = ensureFirebase();
      // Firebase Auth photoURL has a ~1 KB limit — skip it for base64 data URLs
      if (urlForAuth && !urlForAuth.startsWith('data:') && fb?.auth.currentUser) {
        await updateProfile(fb.auth.currentUser, { photoURL: urlForAuth });
      }
      // Update ownerPhotoUrl on all existing public catches (best-effort, non-blocking)
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

  const unreadNotifs = useUnreadNotifCount(user?.uid);
  const avatarUri = pickedAvatarUri ?? remotePhotoUrl ?? user?.photoURL ?? undefined;
  const initialLetter = (displayName || user?.email || '?').slice(0, 1).toUpperCase();

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
        <ProfileTopBar
          mode={mode}
          user={user}
          styles={styles}
          onToggleMode={toggleMode}
          onSignOut={onSignOut}
        />

        <View style={styles.bodyPad}>
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
            <View style={[styles.identityRow, { justifyContent: 'center', paddingVertical: spacing.md }]}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <LinearGradient
              colors={[colors.primaryDark, colors.primary, colors.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, marginHorizontal: -spacing.lg, overflow: 'hidden' }}
            >
              <LiquidBlobBg />
              <Pressable
                onPress={configured ? pickProfileAvatar : undefined}
                disabled={!configured}
                accessibilityRole={configured ? 'button' : 'image'}
                accessibilityLabel={configured ? 'Промени снимка на профила' : 'Аватар'}
              >
                <View style={{ width: 96, height: 96, borderRadius: 48, padding: 3, backgroundColor: 'rgba(255,255,255,0.3)', position: 'relative' }}>
                  <View style={{ flex: 1, borderRadius: 45, overflow: 'hidden', backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' }}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    ) : (
                      <Text style={{ color: colors.white, fontSize: 36, fontWeight: '700' }}>{initialLetter}</Text>
                    )}
                  </View>
                  {configured ? (
                    <View style={[styles.avatarBadge, { width: 30, height: 30, borderRadius: 15 }]} pointerEvents="none">
                      <Ionicons name="camera" size={15} color={colors.white} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <Text style={{ ...typography.h2, color: '#fff', marginTop: spacing.md, letterSpacing: -0.3 }} numberOfLines={1}>
                {displayName.trim() || user.displayName || 'Рибар'}
              </Text>
              {user.email ? (
                <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.72)', marginTop: 2 }} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
              {configured ? (
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }} onPress={openPublicPreview} hitSlop={8}>
                  <Ionicons name="eye-outline" size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={{ ...typography.small, fontWeight: '700', color: 'rgba(255,255,255,0.9)' }}>Как те виждат другите</Text>
                </Pressable>
              ) : null}
            </LinearGradient>
          )}

          {/* ── Achievements compact row ── */}
          {catches.length > 0 && (() => {
            const earned = BADGES.filter((b) => b.earned);
            const pct = (earned.length / BADGES.length) * 100;
            return (
              <Pressable
                onPress={() => { void Haptics.selectionAsync(); navigation.navigate('Achievements'); }}
                style={({ pressed }) => ({
                  marginTop: spacing.md,
                  marginBottom: spacing.xs,
                  backgroundColor: colors.card,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.cardEdge,
                  padding: spacing.md,
                  opacity: pressed ? 0.75 : 1,
                  ...shadowCard(mode),
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                  <Ionicons name="trophy-outline" size={15} color={colors.primary} style={{ marginRight: spacing.xs }} />
                  <Text style={{ ...typography.bodyBold, fontSize: 13, color: colors.text, flex: 1 }}>Постижения</Text>
                  <Text style={{ ...typography.small, color: colors.textMuted, marginRight: spacing.xs }}>
                    {earned.length}/{BADGES.length}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </View>
                <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden', marginBottom: spacing.sm }}>
                  <View style={{ width: `${pct}%`, height: 4, backgroundColor: colors.primary, borderRadius: 2 }} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {earned.slice(0, 5).map((b) => (
                    <Text key={b.id} style={{ fontSize: 18 }}>{b.emoji}</Text>
                  ))}
                  {earned.length === 0 && (
                    <Text style={{ ...typography.caption, color: colors.textMuted }}>Още няма спечелени — започни да ловиш!</Text>
                  )}
                </View>
              </Pressable>
            );
          })()}

          {!configured && user ? (
            <View style={styles.warnBanner}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.textMuted} />
              <Text style={styles.warnText}>
                Облакът не е активен — настрой Firebase, за да редактираш снимка и онлайн профил.
              </Text>
            </View>
          ) : null}

          {user && configured ? (
            <View style={[styles.panel, { padding: 0, overflow: 'hidden' }]}>
              <Pressable
                onPress={() => { void Haptics.selectionAsync(); setPubExpanded((v) => !v); }}
                style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md }}
              >
                <Ionicons name="person-circle-outline" size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.panelTitle}>Публичен профил</Text>
                  {!pubExpanded && (displayName.trim() || city.trim()) ? (
                    <Text style={styles.panelSub} numberOfLines={1}>
                      {[displayName.trim(), city.trim()].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name={pubExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>

              {pubExpanded ? (
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
              ) : null}
            </View>
          ) : null}

          <Text style={styles.menuCardTitle}>Още</Text>
          <Card style={styles.menuCardWrap}>
            <MenuRow dense icon="stats-chart-outline" title="Статистики" onPress={() => navigation.navigate('Stats')} showDivider />
            <MenuRow dense icon="trophy-outline" title="Лични рекорди" onPress={() => navigation.navigate('PersonalBests')} showDivider />
            <MenuRow dense icon="people-outline" title="Клубове" onPress={() => navigation.navigate('Groups')} showDivider />
            <MenuRow dense icon="newspaper-outline" title="Лента" onPress={() => navigation.navigate('Feed')} showDivider />
            <MenuRow dense icon="images-outline" title="Седмични и месечни класации" onPress={() => navigation.navigate('Classics')} showDivider />
            <MenuRow dense icon="bookmark-outline" title="Запазени" onPress={() => navigation.navigate('SavedPosts')} showDivider />
            <MenuRow dense icon="notifications-outline" title="Известия" onPress={() => navigation.navigate('Notifications')} showDivider rightBadge={unreadNotifs || undefined} />
            <MenuRow dense icon="people-outline" title="Приятели" onPress={() => navigation.navigate('Friends')} showDivider />
            <MenuRow dense icon="trophy-outline" title="Постижения" onPress={() => navigation.navigate('Achievements')} showDivider />
            <MenuRow dense icon="calendar-outline" title="Излети" onPress={() => navigation.navigate('Trips')} showDivider />
            <MenuRow dense icon="ribbon-outline" title="Турнири" onPress={() => navigation.navigate('Tournaments')} showDivider />
            <MenuRow dense icon="podium-outline" title="Класирания" onPress={() => navigation.navigate('Leaderboard')} showDivider />
            <MenuRow dense icon="chatbubbles-outline" title="Съобщения" onPress={() => navigation.navigate('Chats')} showDivider />
            <MenuRow dense icon="bulb-outline" title="Инсайти" onPress={() => navigation.navigate('Insights')} showDivider />
            <MenuRow
              dense
              icon="document-text-outline"
              title="Правна информация"
              onPress={() => navigation.navigate('LegalInfo')}
              showDivider={!!user}
            />
            {user ? (
              <MenuRow
                dense
                destructive
                icon="trash-outline"
                title="Изтриване на акаунта"
                onPress={() => setDeleteModalVisible(true)}
              />
            ) : null}
          </Card>
        </View>
      </ScrollView>

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
