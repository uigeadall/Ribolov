import React, { useCallback, useMemo, useState } from 'react';
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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { MenuRow } from '../components/MenuRow';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { shadowCard } from '../theme/shadows';
import { useAuth } from '../services/authContext';
import { updateProfile } from 'firebase/auth';
import { formatFirebaseError } from '../services/firebaseErrors';
import { ensureFirebase } from '../services/firebase';
import {
  getUserPublicSummary,
  pushUserProfilePublic,
  tryGetStoredProfileAvatarUrl,
  uploadProfileAvatar,
} from '../services/cloudSync';

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { colors, mode, toggleMode } = useTheme();
  const { user, configured, loading: authLoading, signOut, deleteAccount } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [delPassword, setDelPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [remotePhotoUrl, setRemotePhotoUrl] = useState<string | undefined>();
  const [pickedAvatarUri, setPickedAvatarUri] = useState<string | undefined>();
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
  }, [user?.uid, user?.displayName, user?.photoURL, configured, authLoading]);

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
      Alert.alert('Достъп', 'Нужен е достъп до снимките, за да избереш аватар.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,   // keeps base64 small; displayed at 76px so quality 0.5 looks fine
      base64: true,
    });
    if (!res.canceled && res.assets[0]) {
      const asset = res.assets[0];
      if (asset.base64) {
        // Store as data URL — no Firebase Storage needed, survives restart via Firestore
        setPickedAvatarUri(`data:image/jpeg;base64,${asset.base64}`);
      } else {
        setPickedAvatarUri(asset.uri);
      }
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
      if (pickedAvatarUri) {
        if (pickedAvatarUri.startsWith('data:')) {
          // base64 data URL — store directly in Firestore, no Firebase Storage needed
          patch.photoUrl = pickedAvatarUri;
        } else {
          patch.photoUrl = await uploadProfileAvatar(user.uid, pickedAvatarUri);
        }
        setRemotePhotoUrl(patch.photoUrl);
        setPickedAvatarUri(undefined);
        AsyncStorage.setItem(`@ribolov/profilePhoto/${user.uid}`, patch.photoUrl).catch(() => {});
      } else if (remotePhotoUrl?.trim()) {
        patch.photoUrl = remotePhotoUrl.trim();
      }
      await pushUserProfilePublic(user.uid, patch);
      const urlForAuth = patch.photoUrl?.trim();
      const fb = ensureFirebase();
      if (urlForAuth && fb?.auth.currentUser) {
        await updateProfile(fb.auth.currentUser, { photoURL: urlForAuth });
      }
      Alert.alert('Готово', 'Профилът е запазен.');
    } catch (e: unknown) {
      Alert.alert('Грешка', formatFirebaseError(e));
    } finally {
      setProfileSaving(false);
    }
  };

  const closeDeleteModal = () => {
    Keyboard.dismiss();
    setDeleteModalVisible(false);
    setDelPassword('');
  };

  const submitDeleteAccount = () => {
    if (!delPassword.trim()) {
      Alert.alert('Парола', 'Въведи текущата парола за потвърждение.');
      return;
    }
    Alert.alert('Изтриване на акаунт', 'Това изтрива облачни данни и локалния дневник. Необратимо.', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий завинаги',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAccount(delPassword);
            closeDeleteModal();
          } catch (e: unknown) {
            Alert.alert('Грешка', formatFirebaseError(e));
          }
        },
      },
    ]);
  };

  const openPublicPreview = () => {
    if (!user?.uid) return;
    navigation.navigate('UserPublicProfile', {
      uid: user.uid,
      displayName: displayName.trim() || user.displayName || undefined,
      photoUrlHint: avatarUri ?? undefined,
    });
  };

  const avatarUri = pickedAvatarUri ?? remotePhotoUrl ?? user?.photoURL ?? undefined;
  const initialLetter = (displayName || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle}>Профил</Text>
          <View style={styles.topBarRight}>
            <View style={styles.themeToggle}>
              <Pressable
                style={styles.themeIconHit}
                onPress={() => mode === 'dark' && toggleMode()}
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
                onPress={() => mode === 'light' && toggleMode()}
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
            <View style={styles.identityRow}>
              <Pressable
                onPress={configured ? pickProfileAvatar : undefined}
                disabled={!configured}
                accessibilityRole={configured ? 'button' : 'image'}
                accessibilityLabel={configured ? 'Промени снимка на профила' : 'Аватар'}
              >
                <View style={styles.avatarRing}>
                  <View style={styles.avatarInner}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" />
                    ) : (
                      <Text style={styles.avatarLetter}>{initialLetter}</Text>
                    )}
                  </View>
                  {configured ? (
                    <View style={styles.avatarBadge} pointerEvents="none">
                      <Ionicons name="camera" size={13} color={colors.white} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <View style={styles.identityTextCol}>
                <Text style={styles.identityName} numberOfLines={2}>
                  {displayName.trim() || user.displayName || 'Рибар'}
                </Text>
                {user.email ? (
                  <Text style={styles.identityEmail} numberOfLines={1}>
                    {user.email}
                  </Text>
                ) : null}
                {configured ? (
                  <Pressable style={styles.previewLink} onPress={openPublicPreview} hitSlop={8}>
                    <Ionicons name="eye-outline" size={15} color={colors.primary} />
                    <Text style={styles.previewLinkText}>Как те виждат другите</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}

          {!configured && user ? (
            <View style={styles.warnBanner}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.textMuted} />
              <Text style={styles.warnText}>
                Облакът не е активен — настрой Firebase, за да редактираш снимка и онлайн профил.
              </Text>
            </View>
          ) : null}

          {user && configured ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Публични данни</Text>
              <Text style={styles.panelSub}>Лента и профилът ти към другите.</Text>

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

          <Text style={styles.menuCardTitle}>Още</Text>
          <Card style={styles.menuCardWrap}>
            <MenuRow dense icon="stats-chart-outline" title="Статистики" onPress={() => navigation.navigate('Stats')} showDivider />
            <MenuRow dense icon="trophy-outline" title="Лични рекорди" onPress={() => navigation.navigate('PersonalBests')} showDivider />
            <MenuRow dense icon="people-outline" title="Клубове" onPress={() => navigation.navigate('Groups')} showDivider />
            <MenuRow dense icon="newspaper-outline" title="Лента" onPress={() => navigation.navigate('Feed')} showDivider />
            <MenuRow dense icon="images-outline" title="Класики и награди" onPress={() => navigation.navigate('Classics')} showDivider />
            <MenuRow dense icon="bookmark-outline" title="Запазени" onPress={() => navigation.navigate('SavedPosts')} showDivider />
            <MenuRow dense icon="notifications-outline" title="Известия" onPress={() => navigation.navigate('Notifications')} showDivider />
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
        <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={closeDeleteModal}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDeleteModal} accessibilityLabel="Затвори" />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Изтриване на акаунта</Text>
              <Text style={styles.modalHint}>
                Необратимо изчиства облака и локалните данни. Въведи паролата си:
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Парола"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={delPassword}
                onChangeText={setDelPassword}
                autoCapitalize="none"
              />
              <View style={styles.modalActions}>
                <Button title="Отказ" variant="ghost" onPress={closeDeleteModal} style={{ flex: 1 }} compact />
                <Button title="Изтрий" variant="danger" compact onPress={submitDeleteAccount} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}
