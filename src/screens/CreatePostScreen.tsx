import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { Screen } from '../components/Screen';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { useAppNavigation } from '../navigation/useAppNavigation';
import AsyncStorage from '../storage/kv';
import { createPost, getUserPublicSummary } from '../services/cloudSync';
import { searchUsersByName, type SearchUserResult } from '../services/userProfile';
import { logEvent } from '../services/analytics';
import { handleError } from '../utils/handleError';
import { notifyInfo } from '../utils/notify';
import { checkImageSize } from '../utils/imageSize';
import { useRoute, RouteProp } from '@react-navigation/native';
import type { FeedStackParamList } from '../navigation/types';

const MAX_TEXT = 2000;
const AUTOCOMPLETE_DEBOUNCE_MS = 250;

async function compressPhoto(uri: string): Promise<string> {
  try {
    const r = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
    );
    return r.uri;
  } catch {
    return uri;
  }
}

export default function CreatePostScreen() {
  const { colors, mode } = useTheme();
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<FeedStackParamList, 'CreatePost'>>();
  const { user, configured } = useAuth();
  const reshare = route.params?.reshare;

  const [text, setText] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [posting, setPosting] = useState(false);
  // 0..1 upload progress, surfaced as a thin bar at the top during posting.
  const [uploadProgress, setUploadProgress] = useState(0);
  // Synchronous guard so a sub-frame double-tap on "Сподели" can't fire
  // submit() twice before React commits setPosting(true) — would otherwise
  // create two duplicate posts.
  const submittingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<SearchUserResult[]>([]);
  // True from the moment the debounce timer fires until results arrive.
  // Drives the spinner in the autocomplete hint so users refining a mention
  // (typing more characters into an already-matched query) see "still
  // searching" feedback instead of an apparently-stale result list.
  const [mentionSearching, setMentionSearching] = useState(false);
  /** Resolved @mentions — handle (display name string) → uid */
  const [resolvedMentions, setResolvedMentions] = useState<Record<string, string>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  // Detect a @prefix the user is currently typing — only the segment ending at the cursor
  const detectMentionAtCursor = useCallback((value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    // Match an @ token that touches the cursor (not preceded by a letter/digit)
    const m = before.match(/(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.\-]{1,40})$/u);
    return m?.[1] ?? null;
  }, []);

  const onChangeText = (next: string) => {
    setText(next);
    const cursor = selectionRef.current.end;
    const q = detectMentionAtCursor(next, cursor);
    if (q && q.length >= 2 && configured) {
      setMentionQuery(q);
      setMentionSearching(true);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        searchUsersByName(q, { excludeUid: user?.uid, maxResults: 6 })
          .then((results) => {
            // Drop stale results — the user may have typed further characters
            // since this lookup started. Without this check, a slow network
            // can cause an older query's results to land AFTER a newer
            // query's results, briefly showing the wrong matches.
            if (q !== detectMentionAtCursor(text, selectionRef.current.end)) return;
            setMentionResults(results);
          })
          .catch(() => setMentionResults([]))
          .finally(() => setMentionSearching(false));
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    } else {
      setMentionQuery(null);
      setMentionResults([]);
      setMentionSearching(false);
    }
  };

  const insertMention = (u: SearchUserResult) => {
    const cursor = selectionRef.current.end;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    // Find the @prefix and replace it with @displayName + space
    const m = before.match(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.\-]{1,40})$/u);
    if (!m) return;
    const cleanName = u.displayName.replace(/\s+/g, '_');
    const insertion = `${m[1]}@${cleanName} `;
    const head = before.slice(0, before.length - m[0].length);
    const next = head + insertion + after;
    setText(next);
    setResolvedMentions((prev) => ({ ...prev, [cleanName]: u.uid }));
    setMentionQuery(null);
    setMentionResults([]);
    setMentionSearching(false);
    void Haptics.selectionAsync();
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notifyInfo('Достъп до галерията', 'Разреши достъп в настройките на телефона.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 });
    if (!r.canceled && r.assets[0]) {
      if (!checkImageSize(r.assets[0])) return;
      setPhotoUri(await compressPhoto(r.assets[0].uri));
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      notifyInfo('Достъп до камерата', 'Разреши достъп в настройките на телефона.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!r.canceled && r.assets[0]) {
      if (!checkImageSize(r.assets[0])) return;
      setPhotoUri(await compressPhoto(r.assets[0].uri));
    }
  };

  const submit = async () => {
    if (!user || posting || submittingRef.current) return;
    if (!text.trim() && !photoUri && !reshare) {
      notifyInfo('Празна публикация', 'Добави текст или снимка.');
      return;
    }
    submittingRef.current = true;
    setPosting(true);
    try {
      // Resolve which @handles correspond to known users. Iterating
      // resolvedMentions (instead of re-extracting via a strict
      // [\p{L}\p{N}_.\-] regex) means names containing characters outside
      // that set — parentheses, !, ?, emoji-adjacent text, etc. — still
      // resolve as long as the user inserted them from the autocomplete.
      const escapeRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      const mentionUids = Object.entries(resolvedMentions)
        .filter(([cleanName]) => {
          if (!cleanName) return false;
          // @cleanName must NOT be immediately preceded by a word char (so
          // it's a real mention boundary) and must NOT be followed by a
          // letter/digit/underscore (so "@John" in text doesn't match
          // resolvedMentions["John"] when the user actually typed "@Johnny").
          const re = new RegExp(
            `(?:^|[^\\p{L}\\p{N}_])@${escapeRegex(cleanName)}(?![\\p{L}\\p{N}_])`,
            'u',
          );
          return re.test(text);
        })
        .map(([, uid]) => uid);

      // Resolve the user's avatar URL. user.photoURL (Firebase Auth) is often
      // empty when the user uploaded their photo through Profile, since that
      // flow writes to users/{uid}.photoUrl in Firestore (and data: URLs are
      // never written to Auth). Try Auth → cached AsyncStorage → Firestore.
      // Only accept https:// URLs so a stale data: URL on Auth or in the
      // AsyncStorage cache doesn't get pinned onto the post doc — once on
      // the post, that data: URL can't be re-resolved (the lazy avatar fetch
      // skips re-fetching when ownerPhotoUrl is already set), so posts would
      // either render a giant base64 image or break entirely for other users.
      const isHttps = (u: string) => /^https?:\/\//i.test(u);
      const fromAuth = user.photoURL?.trim() || '';
      let ownerPhotoUrl = isHttps(fromAuth) ? fromAuth : '';
      if (!ownerPhotoUrl) {
        const cached = (await AsyncStorage.getItem(`@ribolov/profilePhoto/${user.uid}`).catch(() => null)) ?? '';
        if (isHttps(cached)) ownerPhotoUrl = cached;
      }
      if (!ownerPhotoUrl) {
        const summary = await getUserPublicSummary(user.uid).catch(() => null);
        const fromFs = summary?.photoUrl?.trim() ?? '';
        if (isHttps(fromFs)) ownerPhotoUrl = fromFs;
      }

      await createPost({
        ownerUid: user.uid,
        ownerName: user.displayName?.trim() || user.email?.trim() || 'Рибар',
        ownerPhotoUrl: ownerPhotoUrl || undefined,
        text,
        localPhotoUri: photoUri,
        mentionUids,
        reshareOf: reshare,
        onUploadProgress: (f) => setUploadProgress(f),
      });
      Toast.show({ type: 'success', text1: 'Публикувано', visibilityTime: 1800 });
      logEvent('post_shared', {
        has_photo: !!photoUri,
        has_reshare: !!reshare,
        text_length: text.length,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (e: unknown) {
      handleError(e);
    } finally {
      submittingRef.current = false;
      setPosting(false);
      setUploadProgress(0);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
    hero: { paddingTop: 16, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    heroTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'center' },
    postBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    postBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    body: { padding: spacing.lg, gap: spacing.md },
    inputCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    input: {
      minHeight: 140,
      fontSize: 16,
      color: colors.text,
      textAlignVertical: 'top',
      lineHeight: 22,
    },
    charCount: {
      ...typography.small,
      color: colors.textMuted,
      textAlign: 'right',
      marginTop: spacing.xs,
    },
    photoWrap: { borderRadius: radius.lg, overflow: 'hidden', position: 'relative' },
    photo: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceAlt },
    photoRemove: {
      position: 'absolute',
      top: 8, right: 8,
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center', justifyContent: 'center',
    },
    actionsRow: { flexDirection: 'row', gap: spacing.sm },
    actionBtn: {
      flex: 1,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    actionText: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    autocompleteCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    autocompleteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    avatarCircle: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { ...typography.bodyBold, color: colors.primary },
    rowName: { ...typography.bodyBold, color: colors.text },
    rowSub: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    hintRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 4,
    },
    hintText: { ...typography.small, color: colors.textMuted, lineHeight: 18 },
    reshareCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: mode === 'dark' ? 'rgba(74,168,232,0.04)' : 'rgba(21,112,184,0.03)',
    },
    reshareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm + 2,
      paddingBottom: 4,
    },
    reshareAvatar: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    reshareAvatarText: { fontSize: 12, fontWeight: '800', color: colors.primary },
    reshareName: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    reshareKind: { ...typography.small, color: colors.textMuted, fontSize: 10 },
    reshareBody: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    reshareText: { ...typography.body, color: colors.text, fontSize: 13, lineHeight: 18 },
    reshareCatchLine: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    reshareCatchMeta: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    resharePhoto: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceAlt },
  }), [colors, mode]);

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.heroTitle}>Нова публикация</Text>
          <View style={{ width: 40 }} />
        </LinearGradient>
        <View style={{ padding: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            За публикуване трябва да си влязъл в акаунт.
          </Text>
        </View>
      </Screen>
    );
  }

  const charsRemaining = MAX_TEXT - text.length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen padded={false} avoidKeyboard={false}>
        {/* Upload progress bar — visible during posting when a photo is
            uploading. Lets users on slow connections see something. */}
        {posting && uploadProgress > 0 && uploadProgress < 1 ? (
          <View style={{ height: 2, backgroundColor: colors.border }}>
            <View
              style={{
                height: 2,
                width: `${Math.round(uploadProgress * 100)}%`,
                backgroundColor: colors.primary,
              }}
            />
          </View>
        ) : null}
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.heroTitle}>{reshare ? 'Сподели' : 'Нова публикация'}</Text>
          <Pressable
            onPress={submit}
            disabled={posting || (!text.trim() && !photoUri && !reshare)}
            style={[styles.postBtn, (posting || (!text.trim() && !photoUri && !reshare)) && { opacity: 0.5 }]}
            hitSlop={8}
          >
            {posting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.postBtnText}>Сподели</Text>}
          </Pressable>
        </LinearGradient>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.inputCard}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={reshare ? 'Добави свой коментар (по избор)…' : `Какво се случва, ${user.displayName?.split(' ')[0] ?? 'рибарю'}?`}
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={onChangeText}
              onSelectionChange={(e) => {
                selectionRef.current = e.nativeEvent.selection;
              }}
              multiline
              maxLength={MAX_TEXT}
              autoFocus
            />
            <Text style={styles.charCount}>{charsRemaining} символа</Text>
          </View>

          {mentionResults.length > 0 ? (
            <View style={styles.autocompleteCard}>
              {/* Searching hint persists ABOVE the results list while a
                  refined query is in flight. Without this, users refining
                  a mention (typing more chars after a match) see the old
                  results with no signal that newer matches are coming. */}
              {mentionSearching ? (
                <View style={[styles.hintRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.hintText}>Търсене на „{mentionQuery}"…</Text>
                </View>
              ) : null}
              <FlatList
                data={mentionResults}
                keyExtractor={(u) => u.uid}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <Pressable style={styles.autocompleteRow} onPress={() => insertMention(item)}>
                    <View style={styles.avatarCircle}>
                      {item.photoUrl ? (
                        <Image source={{ uri: item.photoUrl }} style={{ width: 36, height: 36 }} contentFit="cover" />
                      ) : (
                        <Text style={styles.avatarText}>{(item.displayName ?? '?').slice(0, 1).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{item.displayName}</Text>
                      {item.city ? <Text style={styles.rowSub} numberOfLines={1}>{item.city}</Text> : null}
                    </View>
                    <Ionicons name="at" size={18} color={colors.primary} />
                  </Pressable>
                )}
              />
            </View>
          ) : mentionQuery ? (
            // No results yet (or none found). If we're mid-search, the
            // spinner clarifies "still looking"; once searching flips to
            // false and we still have no results, the same row reads as
            // "we looked, nothing matched".
            <View style={styles.hintRow}>
              {mentionSearching ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Ionicons name="search-outline" size={13} color={colors.textMuted} />
              )}
              <Text style={styles.hintText}>
                {mentionSearching
                  ? `Търсене на „${mentionQuery}"…`
                  : `Няма съвпадения за „${mentionQuery}"`}
              </Text>
            </View>
          ) : null}

          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
              <Pressable onPress={() => setPhotoUri(undefined)} style={styles.photoRemove} hitSlop={8}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : null}

          {reshare ? (
            <View style={styles.reshareCard}>
              <View style={styles.reshareHeader}>
                <View style={styles.reshareAvatar}>
                  {reshare.ownerPhotoUrl ? (
                    <Image source={{ uri: reshare.ownerPhotoUrl }} style={{ width: 28, height: 28 }} contentFit="cover" />
                  ) : (
                    <Text style={styles.reshareAvatarText}>{reshare.ownerName.slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reshareName} numberOfLines={1}>{reshare.ownerName}</Text>
                  <Text style={styles.reshareKind}>{reshare.kind === 'catch' ? 'Улов' : 'Публикация'}</Text>
                </View>
              </View>
              <View style={styles.reshareBody}>
                {reshare.kind === 'catch' ? (
                  <>
                    {reshare.speciesName ? (
                      <Text style={styles.reshareCatchLine}>
                        {reshare.speciesName}
                        {reshare.weightKg != null ? ` · ${reshare.weightKg} кг` : ''}
                      </Text>
                    ) : null}
                    {reshare.text ? <Text style={styles.reshareCatchMeta} numberOfLines={2}>{reshare.text}</Text> : null}
                  </>
                ) : (
                  reshare.text ? <Text style={styles.reshareText} numberOfLines={3}>{reshare.text}</Text> : null
                )}
              </View>
              {reshare.photoUri ? (
                <Image source={{ uri: reshare.photoUri }} style={styles.resharePhoto} contentFit="cover" />
              ) : null}
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable style={styles.actionBtn} onPress={() => void pickPhoto()}>
              <Ionicons name="image-outline" size={20} color={colors.primary} />
              <Text style={styles.actionText}>Галерия</Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => void takePhoto()}>
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
              <Text style={styles.actionText}>Камера</Text>
            </Pressable>
          </View>

          <View style={styles.hintRow}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
            <Text style={styles.hintText}>
              Използвай #хаштаг за теми и @име за споменаване на риболовци.
            </Text>
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
