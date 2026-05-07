import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Share,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { FeedItem } from '../services/cloudSync';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { Card } from './Card';
import {
  subscribeMyLikeOnCatch,
  fetchCatchLikeCount,
  toggleCatchLike,
  subscribeCatchComments,
  addCatchComment,
  subscribeCatchSaved,
  toggleSaveCatch,
  fetchCatchLikers,
  type FeedComment,
  type CatchLiker,
} from '../services/socialFeed';
import { submitContentReport } from '../services/contentReports';

type Props = {
  item: FeedItem;
  myUid?: string;
  myDisplayName: string;
  socialEnabled?: boolean;
  onPressAuthor: (authorUid: string, displayName: string) => void;
};

function feedStyles(colors: AppColors) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: { width: 40, height: 40 },
    avatarText: { color: colors.white, fontWeight: '700', fontSize: 16 },
    meta: { flex: 1 },
    name: { ...typography.bodyBold, color: colors.text },
    date: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    photoTitle: {
      ...typography.bodyBold,
      color: colors.primary,
      fontSize: 17,
      lineHeight: 24,
      marginBottom: spacing.xs,
    },
    species: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
    stats: { ...typography.body, color: colors.textMuted },
    notes: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
    photo: {
      width: '100%',
      height: 220,
      borderRadius: radius.md,
      marginTop: spacing.sm,
      backgroundColor: colors.surfaceAlt,
    },
    loc: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: spacing.sm,
    },
    locText: { ...typography.caption, color: colors.primary, flex: 1 },
    socialRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.md,
      marginTop: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    socialBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    socialLbl: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
    likedLbl: { ...typography.caption, color: colors.danger, fontWeight: '700' },
    commentsWrap: { marginTop: spacing.md },
    commentRow: { marginBottom: spacing.sm },
    commentAuthor: { ...typography.caption, fontWeight: '700', color: colors.text },
    commentText: { ...typography.body, color: colors.text, marginTop: 2 },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: Platform.OS === 'ios' ? 10 : 6,
      color: colors.text,
      backgroundColor: colors.background,
      ...typography.body,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      maxHeight: '70%',
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
    likerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    likerName: { ...typography.body, color: colors.text, flex: 1 },
  });
}

export type { FeedItem };

export function FeedPost({ item, myUid, myDisplayName, socialEnabled, onPressAuthor }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);
  const ownerName = item.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const isMine = Boolean(myUid && item.ownerUid === myUid);
  const avatarUrl = item.ownerPhotoUrl?.trim();

  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [draft, setDraft] = useState('');
  const [sendBusy, setSendBusy] = useState(false);

  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const [likersOpen, setLikersOpen] = useState(false);
  const [likers, setLikers] = useState<CatchLiker[]>([]);
  const [likersLoading, setLikersLoading] = useState(false);

  const likeBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const sendBusyRef = useRef(false);
  const likersRequestIdRef = useRef(0);

  const catchId = item.id;

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId) return;
    let cancelled = false;
    void (async () => {
      const lc = await fetchCatchLikeCount(catchId);
      if (!cancelled) setLikeCount(lc);
    })();
    return () => {
      cancelled = true;
    };
  }, [socialEnabled, myUid, catchId]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId) return () => {};
    const unsub = subscribeMyLikeOnCatch(catchId, myUid, setLiked);
    return unsub;
  }, [socialEnabled, myUid, catchId]);

  useEffect(() => {
    if (!socialEnabled || !catchId) return () => {};
    const unsub = subscribeCatchComments(catchId, setComments);
    return unsub;
  }, [socialEnabled, catchId]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId) return () => {};
    const unsub = subscribeCatchSaved(myUid, catchId, setSaved);
    return unsub;
  }, [socialEnabled, myUid, catchId]);

  const openLikers = useCallback(async () => {
    if (likeCount === 0) return;
    setLikersOpen(true);
    setLikersLoading(true);
    const requestId = ++likersRequestIdRef.current;
    try {
      const result = await fetchCatchLikers(catchId);
      if (requestId === likersRequestIdRef.current) {
        setLikers(result);
      }
    } finally {
      if (requestId === likersRequestIdRef.current) {
        setLikersLoading(false);
      }
    }
  }, [catchId, likeCount]);

  const onToggleLike = useCallback(async () => {
    if (!socialEnabled || !myUid || likeBusyRef.current) return;
    likeBusyRef.current = true;
    setLikeBusy(true);
    try {
      const next = await toggleCatchLike(catchId, myUid, item.ownerUid, myDisplayName);
      setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)));
    } catch (e) {
      Alert.alert('Харесване', e instanceof Error ? e.message : 'Неуспешно действие.');
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  }, [socialEnabled, myUid, catchId, item.ownerUid, myDisplayName]);

  const onToggleSave = useCallback(async () => {
    if (!socialEnabled || !myUid || saveBusyRef.current) return;
    saveBusyRef.current = true;
    setSaveBusy(true);
    try {
      await toggleSaveCatch(myUid, catchId);
    } finally {
      saveBusyRef.current = false;
      setSaveBusy(false);
    }
  }, [socialEnabled, myUid, catchId]);

  const onShare = useCallback(async () => {
    const lines = [
      item.photoTitle ? `«${item.photoTitle}»` : null,
      `🎣 ${ownerName}: ${item.speciesName}`,
      item.weightKg != null ? `${item.weightKg} кг` : null,
      item.notes ? item.notes.slice(0, 400) : null,
      item.photoUri ?? null,
    ].filter(Boolean) as string[];
    try {
      await Share.share({ message: lines.join('\n'), title: 'Улов от Ribolov' });
    } catch {
      /* отказано споделяне */
    }
  }, [ownerName, item.photoTitle, item.speciesName, item.weightKg, item.notes, item.photoUri]);

  const onReportCatch = useCallback(() => {
    const uid = myUid;
    if (!socialEnabled || !uid) return;
    const send = (reason: string) => {
      void (async () => {
        try {
          await submitContentReport({
            reporterUid: uid,
            targetType: 'catch',
            catchId,
            reason,
          });
          Alert.alert('Благодарим', 'Сигналът е изпратен за преглед.');
        } catch {
          Alert.alert('Грешка', 'Неуспешно изпращане.');
        }
      })();
    };
    Alert.alert('Докладвай публикация', 'Избери приблизителна причина', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Спам / измама', onPress: () => send('Спам или измама') },
      { text: 'Неприлично съдържание', onPress: () => send('Неприлично или обидно съдържание') },
      { text: 'Друго нарушение', onPress: () => send('Друго нарушение на правилата') },
    ]);
  }, [socialEnabled, myUid, catchId]);

  const onSendComment = useCallback(async () => {
    if (!socialEnabled || !myUid || sendBusyRef.current) return;
    const t = draft.trim();
    if (!t) return;
    sendBusyRef.current = true;
    setSendBusy(true);
    try {
      await addCatchComment(catchId, myUid, myDisplayName, t, item.ownerUid);
      setDraft('');
    } catch (e) {
      Alert.alert('Коментар', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      sendBusyRef.current = false;
      setSendBusy(false);
    }
  }, [socialEnabled, myUid, draft, catchId, item.ownerUid, myDisplayName]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Card>
        <Pressable onPress={() => onPressAuthor(item.ownerUid, ownerName)} style={styles.header}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
          <View style={styles.meta}>
            <Text style={styles.name}>{isMine ? myDisplayName : ownerName}</Text>
            <Text style={styles.date}>
              {item.date}
              {item.location?.name ? ` · ${item.location.name}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        {item.photoTitle ? <Text style={styles.photoTitle}>{item.photoTitle}</Text> : null}
        <Text style={styles.species}>{item.speciesName}</Text>
        <Text style={styles.stats}>
          {item.weightKg != null ? `${item.weightKg} кг` : '— кг'}
          {item.lengthCm != null ? ` · ${item.lengthCm} см` : ''}
          {item.released ? ' · пуснат' : ''}
        </Text>
        {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={styles.photo} contentFit="cover" />
        ) : null}
        {item.location?.latitude != null && item.location.longitude != null ? (
          <View style={styles.loc}>
            <Ionicons name="location-outline" size={14} color={colors.primary} />
            <Text style={styles.locText} numberOfLines={1}>
              {item.location.latitude.toFixed(4)}, {item.location.longitude.toFixed(4)}
            </Text>
          </View>
        ) : null}

        {socialEnabled ? (
          <>
            <View style={styles.socialRow}>
              <Pressable onPress={onToggleLike} disabled={likeBusy} style={styles.socialBtn} hitSlop={8}>
                {likeBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.danger : colors.textMuted} />
                )}
              </Pressable>
              <Pressable onPress={openLikers} disabled={likeCount === 0} hitSlop={8} style={styles.socialBtn}>
                <Text style={liked ? styles.likedLbl : styles.socialLbl}>{likeCount}</Text>
              </Pressable>
              <Pressable onPress={onReportCatch} style={styles.socialBtn} hitSlop={8} accessibilityLabel="Докладвай публикацията">
                <Ionicons name="flag-outline" size={20} color={colors.textMuted} />
              </Pressable>
              <View style={styles.socialBtn}>
                <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
                <Text style={styles.socialLbl}>{comments.length}</Text>
              </View>
              <Pressable onPress={onShare} style={styles.socialBtn} hitSlop={8}>
                <Ionicons name="share-outline" size={22} color={colors.primary} />
              </Pressable>
              <Pressable onPress={onToggleSave} disabled={saveBusy} style={styles.socialBtn} hitSlop={8}>
                {saveBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={saved ? colors.primary : colors.textMuted} />
                )}
              </Pressable>
            </View>

            <View style={styles.commentsWrap}>
              {comments.map((c) => (
                <View key={c.id} style={styles.commentRow}>
                  <Text style={styles.commentAuthor}>{c.authorName}</Text>
                  <Text style={styles.commentText}>{c.text}</Text>
                </View>
              ))}
              <View style={styles.composer}>
                <TextInput
                  style={styles.input}
                  placeholder="Коментар…"
                  placeholderTextColor={colors.textMuted}
                  value={draft}
                  onChangeText={setDraft}
                  maxLength={2000}
                  editable={!sendBusy}
                />
                <Pressable onPress={onSendComment} disabled={sendBusy || !draft.trim()} hitSlop={8}>
                  {sendBusy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="send" size={22} color={draft.trim() ? colors.primary : colors.textMuted} />
                  )}
                </Pressable>
              </View>
            </View>

            <Modal visible={likersOpen} animationType="slide" transparent onRequestClose={() => setLikersOpen(false)}>
              <Pressable style={styles.modalBackdrop} onPress={() => setLikersOpen(false)}>
                <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.modalTitle}>Харесали ({likeCount})</Text>
                  {likersLoading ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                  ) : (
                    <FlatList
                      data={likers}
                      keyExtractor={(x) => x.uid}
                      style={{ maxHeight: 360 }}
                      renderItem={({ item: liker }) => (
                        <Pressable
                          style={styles.likerRow}
                          onPress={() => {
                            setLikersOpen(false);
                            onPressAuthor(liker.uid, liker.displayName);
                          }}
                        >
                          <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                          <Text style={styles.likerName}>{liker.displayName}</Text>
                          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        </Pressable>
                      )}
                      ListEmptyComponent={
                        <Text style={{ ...typography.body, color: colors.textMuted }}>Няма видими харесвания.</Text>
                      }
                    />
                  )}
                  <Pressable onPress={() => setLikersOpen(false)} style={{ marginTop: spacing.md, alignItems: 'center' }}>
                    <Text style={{ ...typography.bodyBold, color: colors.primary }}>Затвори</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          </>
        ) : null}
      </Card>
    </KeyboardAvoidingView>
  );
}
