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
  subscribeMyReactionOnCatch,
  fetchCatchLikeCount,
  fetchReactionSummary,
  toggleCatchReaction,
  subscribeCatchComments,
  addCatchComment,
  editCatchComment,
  deleteCatchComment,
  subscribeCatchSaved,
  toggleSaveCatch,
  fetchCatchLikers,
  REACTIONS,
  type ReactionType,
  type ReactionSummaryItem,
  type FeedComment,
  type CatchLiker,
} from '../services/socialFeed';
import { submitContentReport } from '../services/contentReports';
import { getUserPublicSummary } from '../services/cloudSync';

const AVATAR_TTL_MS = 5 * 60 * 1000;
const _avatarCache = new Map<string, { url: string; fetchedAt: number }>();

function getCachedAvatar(uid: string): string | undefined {
  const entry = _avatarCache.get(uid);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > AVATAR_TTL_MS) {
    _avatarCache.delete(uid);
    return undefined;
  }
  return entry.url;
}

function setCachedAvatar(uid: string, url: string): void {
  _avatarCache.set(uid, { url, fetchedAt: Date.now() });
}

type Props = {
  item: FeedItem;
  myUid?: string;
  myDisplayName: string;
  myPhotoUrl?: string;
  resolvedAvatarUrl?: string;
  socialEnabled?: boolean;
  isVisible?: boolean;
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

export function FeedPost({ item, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl, socialEnabled, isVisible = true, onPressAuthor }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);
  const ownerName = item.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const isMine = Boolean(myUid && item.ownerUid === myUid);
  // Resolved avatar: live myPhotoUrl for own posts, stored ownerPhotoUrl for others,
  // with a lazy Firestore fallback when the document field is missing.
  const storedAvatar = resolvedAvatarUrl?.trim() || item.ownerPhotoUrl?.trim();
  const [fetchedAvatar, setFetchedAvatar] = useState<string>(() => getCachedAvatar(item.ownerUid) ?? '');

  useEffect(() => {
    // Skip per-post fetch when parent already resolved the avatar
    if (isMine || storedAvatar) return;
    const cached = getCachedAvatar(item.ownerUid);
    if (cached) { setFetchedAvatar(cached); return; }
    setFetchedAvatar('');
    getUserPublicSummary(item.ownerUid)
      .then((s) => {
        const p = s?.photoUrl?.trim();
        if (p) { setCachedAvatar(item.ownerUid, p); setFetchedAvatar(p); }
      })
      .catch(() => {});
  }, [item.ownerUid, isMine, storedAvatar]);

  const avatarUrl = (isMine ? myPhotoUrl?.trim() : undefined) || storedAvatar || fetchedAvatar;

  const [myReaction, setMyReaction] = useState<ReactionType | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionSummary, setReactionSummary] = useState<ReactionSummaryItem[]>([]);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [editingComment, setEditingComment] = useState<{ id: string; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);

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
    if (!socialEnabled || !myUid || !catchId || !isVisible) return;
    let cancelled = false;
    void (async () => {
      const [lc, summary] = await Promise.all([
        fetchCatchLikeCount(catchId),
        fetchReactionSummary(catchId),
      ]);
      if (!cancelled) { setLikeCount(lc); setReactionSummary(summary); }
    })();
    return () => { cancelled = true; };
  }, [socialEnabled, myUid, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return () => {};
    const unsub = subscribeMyReactionOnCatch(catchId, myUid, setMyReaction);
    return unsub;
  }, [socialEnabled, myUid, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !catchId || !isVisible) return () => {};
    const unsub = subscribeCatchComments(catchId, setComments);
    return unsub;
  }, [socialEnabled, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return () => {};
    const unsub = subscribeCatchSaved(myUid, catchId, setSaved);
    return unsub;
  }, [socialEnabled, myUid, catchId, isVisible]);

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

  const onPickReaction = useCallback(async (reaction: ReactionType) => {
    if (!socialEnabled || !myUid || likeBusyRef.current) return;
    setReactionPickerOpen(false);
    likeBusyRef.current = true;
    setLikeBusy(true);
    const prev = myReaction;
    try {
      const next = await toggleCatchReaction(catchId, myUid, item.ownerUid, myDisplayName, reaction);
      // Update count: +1 if new reaction, -1 if removed, 0 if changed
      if (!prev && next) setLikeCount((n) => n + 1);
      else if (prev && !next) setLikeCount((n) => Math.max(0, n - 1));
      // Refresh summary
      const summary = await fetchReactionSummary(catchId);
      setReactionSummary(summary);
    } catch (e) {
      Alert.alert('Реакция', e instanceof Error ? e.message : 'Неуспешно действие.');
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  }, [socialEnabled, myUid, catchId, item.ownerUid, myDisplayName, myReaction]);

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

  const onSaveEdit = useCallback(async () => {
    if (!editingComment || editBusy) return;
    const trimmed = editingComment.text.trim();
    if (!trimmed) return;
    setEditBusy(true);
    try {
      await editCatchComment(catchId, editingComment.id, trimmed);
      setEditingComment(null);
    } catch (e) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно редактиране.');
    } finally {
      setEditBusy(false);
    }
  }, [catchId, editingComment, editBusy]);

  const onDeleteComment = useCallback((commentId: string) => {
    Alert.alert('Изтриване', 'Изтриване на коментара?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCatchComment(catchId, commentId);
          } catch (e) {
            Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изтриване.');
          }
        },
      },
    ]);
  }, [catchId]);

  const onSendComment = useCallback(async () => {
    if (!socialEnabled || !myUid || sendBusyRef.current) return;
    const t = draft.trim();
    if (!t) return;
    sendBusyRef.current = true;
    setSendBusy(true);
    const reply = replyingTo;
    try {
      await addCatchComment(catchId, myUid, myDisplayName, t, item.ownerUid, reply ?? undefined);
      setDraft('');
      setReplyingTo(null);
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
              <Image
                source={{ uri: avatarUrl }}
                style={[styles.avatarImg, { backgroundColor: colors.primary }]}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
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
          <Image
            source={{ uri: item.photoUri }}
            style={[styles.photo, { backgroundColor: colors.surfaceAlt }]}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
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
            {/* ── Reaction picker popup ── */}
            <Modal visible={reactionPickerOpen} transparent animationType="fade" onRequestClose={() => setReactionPickerOpen(false)}>
              <Pressable style={{ flex: 1 }} onPress={() => setReactionPickerOpen(false)}>
                <View style={{ position: 'absolute', bottom: 120, left: spacing.lg, right: spacing.lg, backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-around', padding: spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 }}>
                  {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
                    <Pressable key={type} onPress={() => onPickReaction(type)} style={{ alignItems: 'center', padding: spacing.sm, borderRadius: radius.md, backgroundColor: myReaction === type ? colors.primarySurface : 'transparent' }}>
                      <Text style={{ fontSize: 28 }}>{r.emoji}</Text>
                      <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 10 }}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </Pressable>
            </Modal>

            <View style={styles.socialRow}>
              {/* Reaction button — tap to toggle current/default, long-press for picker */}
              <Pressable
                onPress={() => myReaction ? onPickReaction(myReaction) : setReactionPickerOpen(true)}
                onLongPress={() => setReactionPickerOpen(true)}
                disabled={likeBusy}
                style={styles.socialBtn}
                hitSlop={8}
                delayLongPress={300}
              >
                {likeBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={{ fontSize: 22 }}>{myReaction ? REACTIONS[myReaction].emoji : '🤍'}</Text>
                )}
              </Pressable>

              {/* Reaction summary — top 3 emojis + total count */}
              <Pressable onPress={openLikers} disabled={likeCount === 0} hitSlop={8} style={[styles.socialBtn, { gap: 2 }]}>
                {reactionSummary.slice(0, 3).map((r) => (
                  <Text key={r.type} style={{ fontSize: 14 }}>{r.emoji}</Text>
                ))}
                {likeCount > 0 && (
                  <Text style={[myReaction ? styles.likedLbl : styles.socialLbl, { marginLeft: 2 }]}>{likeCount}</Text>
                )}
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
              {comments.map((c) => {
                const isReply = !!c.replyToId;
                const isMyComment = myUid === c.authorUid;
                const canDelete = isMyComment || isMine;
                const isEditing = editingComment?.id === c.id;

                return (
                  <View key={c.id} style={[styles.commentRow, isReply && { marginLeft: spacing.xl }]}>
                    {isReply && (
                      <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 2 }}>
                        ↩ отговор на {c.replyToName}
                      </Text>
                    )}

                    {isEditing ? (
                      /* ── Inline edit mode ── */
                      <View style={{ gap: spacing.xs }}>
                        <TextInput
                          value={editingComment.text}
                          onChangeText={(t) => setEditingComment({ id: c.id, text: t })}
                          style={[styles.input, { flex: undefined }]}
                          autoFocus
                          multiline
                          maxLength={2000}
                          editable={!editBusy}
                        />
                        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                          <Pressable
                            onPress={onSaveEdit}
                            disabled={editBusy || !editingComment.text.trim()}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                          >
                            {editBusy
                              ? <ActivityIndicator size="small" color={colors.primary} />
                              : <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                            <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700' }}>Запази</Text>
                          </Pressable>
                          <Pressable onPress={() => setEditingComment(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
                            <Text style={{ ...typography.caption, color: colors.textMuted }}>Отказ</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      /* ── Normal display ── */
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={styles.commentAuthor}>{c.authorName}</Text>
                            {c.editedAt ? (
                              <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10 }}>(редактиран)</Text>
                            ) : null}
                          </View>
                          <Text style={styles.commentText}>{c.text}</Text>
                        </View>

                        {/* Action buttons */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.sm, paddingTop: 2 }}>
                          {myUid && (
                            <Pressable onPress={() => setReplyingTo({ id: c.id, name: c.authorName })} hitSlop={8}>
                              <Text style={{ ...typography.caption, color: colors.primary }}>Отговори</Text>
                            </Pressable>
                          )}
                          {isMyComment && (
                            <Pressable onPress={() => setEditingComment({ id: c.id, text: c.text })} hitSlop={8}>
                              <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
                            </Pressable>
                          )}
                          {canDelete && (
                            <Pressable onPress={() => onDeleteComment(c.id)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={14} color={colors.danger} />
                            </Pressable>
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}

              {/* Reply-to badge */}
              {replyingTo && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySurface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs, gap: spacing.sm }}>
                  <Ionicons name="return-down-forward-outline" size={14} color={colors.primary} />
                  <Text style={{ ...typography.caption, color: colors.primary, flex: 1 }}>Отговор на {replyingTo.name}</Text>
                  <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              )}

              <View style={styles.composer}>
                <TextInput
                  style={styles.input}
                  placeholder={replyingTo ? `Отговор на ${replyingTo.name}…` : 'Коментар…'}
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
