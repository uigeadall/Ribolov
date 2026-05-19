import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActionSheetIOS, Alert, Platform,
  TextInput, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { Post } from '../types';
import { RichText } from './RichText';
import { ImageViewer } from './ImageViewer';
import {
  subscribePostLike,
  togglePostLike,
  subscribePostComments,
  addPostComment,
  deletePostComment,
} from '../services/posts';
import type { FeedComment } from '../services/socialTypes';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAuth } from '../services/authContext';

type Props = {
  post: Post;
  myUid?: string;
  myDisplayName: string;
  myPhotoUrl?: string;
  resolvedAvatarUrl?: string;
  onPressAuthor: (uid: string, displayName: string) => void;
  onPressHashtag: (tag: string) => void;
  onPressMention: (handle: string) => void;
  onDelete?: (post: Post) => void;
  onReshare?: (post: Post) => void;
};

function formatPostDate(iso: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'сега';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} д`;
  return new Date(ms).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

export function PostCard({
  post, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl,
  onPressAuthor, onPressHashtag, onPressMention, onDelete, onReshare,
}: Props) {
  const { colors } = useTheme();
  const { configured } = useAuth();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount ?? 0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const commentsSubscribedRef = useRef(false);

  const isMine = Boolean(myUid && post.ownerUid === myUid);
  const ownerName = post.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const displayName = isMine ? myDisplayName : ownerName;

  const avatarUrl = useAvatarUrl({
    ownerUid: post.ownerUid,
    isMine,
    myPhotoUrl,
    resolvedAvatarUrl,
    ownerPhotoUrl: post.ownerPhotoUrl,
  });

  useEffect(() => {
    if (!myUid) return;
    return subscribePostLike(post.id, myUid, setLiked);
  }, [post.id, myUid]);

  useEffect(() => {
    setLikeCount(post.likeCount ?? 0);
  }, [post.likeCount]);

  // Lazy-subscribe to comments only when the user expands them (saves listener cost).
  useEffect(() => {
    if (!commentsOpen || !configured) return;
    commentsSubscribedRef.current = true;
    const unsub = subscribePostComments(post.id, setComments);
    return unsub;
  }, [commentsOpen, configured, post.id]);

  const onSendComment = useCallback(async () => {
    if (!myUid || sendingComment) return;
    const text = commentDraft.trim();
    if (!text) return;
    setSendingComment(true);
    try {
      await addPostComment(post.id, myUid, myDisplayName, text);
      setCommentDraft('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      setSendingComment(false);
    }
  }, [myUid, myDisplayName, commentDraft, sendingComment, post.id]);

  const onDeleteComment = useCallback((commentId: string) => {
    Alert.alert('Изтрий коментара', undefined, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          try { await deletePostComment(post.id, commentId); }
          catch { Alert.alert('Грешка', 'Неуспешно изтриване.'); }
        },
      },
    ]);
  }, [post.id]);

  const onToggleLike = useCallback(async () => {
    if (!myUid || likeBusy) return;
    setLikeBusy(true);
    // Optimistic
    setLiked((v) => !v);
    setLikeCount((c) => Math.max(0, c + (liked ? -1 : 1)));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await togglePostLike(post.id, myUid, myDisplayName);
    } catch {
      // Rollback
      setLiked((v) => !v);
      setLikeCount((c) => Math.max(0, c + (liked ? 1 : -1)));
    } finally {
      setLikeBusy(false);
    }
  }, [post.id, myUid, myDisplayName, liked, likeBusy]);

  const openMenu = () => {
    if (!isMine || !onDelete) return;
    void Haptics.selectionAsync();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Изтрий публикацията', 'Отказ'], cancelButtonIndex: 1, destructiveButtonIndex: 0 },
        (idx) => { if (idx === 0) onDelete(post); },
      );
    } else {
      Alert.alert('Опции', undefined, [
        { text: 'Изтрий публикацията', style: 'destructive', onPress: () => onDelete(post) },
        { text: 'Отказ', style: 'cancel' },
      ]);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: 8,
      gap: 10,
    },
    avatar: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { ...typography.bodyBold, color: colors.primary },
    headerCenter: { flex: 1, minWidth: 0 },
    authorName: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
    metaText: { ...typography.small, color: colors.textMuted, fontSize: 11 },
    iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    body: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    text: {
      ...typography.body,
      color: colors.text,
      lineHeight: 22,
    },
    link: {
      color: colors.primary,
      fontWeight: '600',
    },
    expandToggle: {
      ...typography.small,
      color: colors.primary,
      fontWeight: '700',
      marginTop: 4,
    },
    photoWrap: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceAlt },
    photo: { width: '100%', height: '100%' },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      gap: spacing.lg,
    },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    actionCount: { ...typography.small, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    actionCountActive: { color: '#E53935' },
    // Comments
    commentsPanel: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    commentsEmpty: {
      ...typography.small,
      color: colors.textMuted,
      paddingVertical: spacing.sm,
      textAlign: 'center',
    },
    commentRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    commentAuthor: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    commentText: { ...typography.body, color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 1 },
    commentComposer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
    },
    commentInput: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 8 : 6,
      color: colors.text,
      fontSize: 13,
      maxHeight: 100,
    },
    reshareCard: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    reshareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 4,
    },
    reshareAvatar: {
      width: 24, height: 24, borderRadius: 12,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    reshareAvatarText: { fontSize: 11, fontWeight: '800', color: colors.primary },
    reshareName: { ...typography.bodyBold, color: colors.text, fontSize: 12 },
    reshareBody: { paddingHorizontal: 10, paddingBottom: 8 },
    reshareText: { ...typography.body, color: colors.text, fontSize: 13, lineHeight: 18 },
    reshareCatchLine: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    reshareCatchMeta: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    resharePhoto: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceAlt },
  }), [colors]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => onPressAuthor(post.ownerUid, displayName)} hitSlop={6}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: 40, height: 40 }} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
        </Pressable>
        <Pressable style={styles.headerCenter} onPress={() => onPressAuthor(post.ownerUid, displayName)} hitSlop={6}>
          <Text style={styles.authorName} numberOfLines={1}>{displayName}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{formatPostDate(post.date)}</Text>
            {post.hashtags && post.hashtags.length > 0 ? (
              <>
                <Text style={styles.metaText}>·</Text>
                <Text style={styles.metaText} numberOfLines={1}>#{post.hashtags[0]}</Text>
              </>
            ) : null}
          </View>
        </Pressable>
        {isMine && onDelete ? (
          <Pressable onPress={openMenu} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Body text with hashtags/mentions — truncated at 5 lines / 280 chars unless expanded */}
      {post.text ? (() => {
        const TRUNCATE_LIMIT = 280;
        const LINE_LIMIT = 5;
        const isLong = post.text.length > TRUNCATE_LIMIT || (post.text.match(/\n/g)?.length ?? 0) >= LINE_LIMIT;
        return (
          <View style={styles.body}>
            <RichText
              text={post.text}
              style={styles.text}
              linkStyle={styles.link}
              onPressHashtag={onPressHashtag}
              onPressMention={onPressMention}
              numberOfLines={!textExpanded && isLong ? LINE_LIMIT : undefined}
            />
            {isLong ? (
              <Pressable onPress={() => setTextExpanded((v) => !v)} hitSlop={6}>
                <Text style={styles.expandToggle}>
                  {textExpanded ? 'По-малко' : 'Виж повече'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })() : null}

      {/* Photo */}
      {post.photoUri ? (
        <Pressable
          style={styles.photoWrap}
          onPress={() => { setViewerOpen(true); }}
        >
          <Image source={{ uri: post.photoUri }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
        </Pressable>
      ) : null}

      {/* Embedded reshared item */}
      {post.reshareOf ? (
        <Pressable
          style={styles.reshareCard}
          onPress={() => onPressAuthor(post.reshareOf!.ownerUid, post.reshareOf!.ownerName)}
        >
          <View style={styles.reshareHeader}>
            <View style={styles.reshareAvatar}>
              {post.reshareOf.ownerPhotoUrl ? (
                <Image source={{ uri: post.reshareOf.ownerPhotoUrl }} style={{ width: 24, height: 24 }} contentFit="cover" />
              ) : (
                <Text style={styles.reshareAvatarText}>{post.reshareOf.ownerName.slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.reshareName} numberOfLines={1}>{post.reshareOf.ownerName}</Text>
            <Ionicons name={post.reshareOf.kind === 'catch' ? 'fish-outline' : 'document-text-outline'} size={12} color={colors.textMuted} />
          </View>
          <View style={styles.reshareBody}>
            {post.reshareOf.kind === 'catch' ? (
              <>
                {post.reshareOf.speciesName ? (
                  <Text style={styles.reshareCatchLine}>
                    {post.reshareOf.speciesName}
                    {post.reshareOf.weightKg != null ? ` · ${post.reshareOf.weightKg} кг` : ''}
                  </Text>
                ) : null}
                {post.reshareOf.text ? <Text style={styles.reshareCatchMeta} numberOfLines={2}>{post.reshareOf.text}</Text> : null}
              </>
            ) : (
              post.reshareOf.text ? <Text style={styles.reshareText} numberOfLines={4}>{post.reshareOf.text}</Text> : null
            )}
          </View>
          {post.reshareOf.photoUri ? (
            <Image source={{ uri: post.reshareOf.photoUri }} style={styles.resharePhoto} contentFit="cover" />
          ) : null}
        </Pressable>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={onToggleLike} hitSlop={8} disabled={!myUid}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={22}
            color={liked ? '#E53935' : colors.text}
          />
          {likeCount > 0 ? (
            <Text style={[styles.actionCount, liked && styles.actionCountActive]}>{likeCount}</Text>
          ) : null}
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => setCommentsOpen((v) => !v)}
          hitSlop={8}
        >
          <Ionicons
            name={commentsOpen ? 'chatbubble' : 'chatbubble-outline'}
            size={20}
            color={commentsOpen ? colors.primary : colors.text}
          />
          {(post.commentCount ?? 0) > 0 ? (
            <Text style={styles.actionCount}>{post.commentCount}</Text>
          ) : null}
        </Pressable>
        {onReshare ? (
          <Pressable style={styles.actionBtn} onPress={() => onReshare(post)} hitSlop={8}>
            <Ionicons name="repeat-outline" size={22} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      {/* Comments panel */}
      {commentsOpen ? (
        <View style={styles.commentsPanel}>
          {comments.length === 0 ? (
            <Text style={styles.commentsEmpty}>
              {commentsSubscribedRef.current ? 'Все още няма коментари. Бъди първи!' : 'Зареждане…'}
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {comments.map((c) => {
                const canDelete = myUid && (c.authorUid === myUid || post.ownerUid === myUid);
                return (
                  <View key={c.id} style={styles.commentRow}>
                    <View style={{ flex: 1 }}>
                      <Pressable onPress={() => onPressAuthor(c.authorUid, c.authorName)}>
                        <Text style={styles.commentAuthor}>{c.authorName}</Text>
                      </Pressable>
                      <Text style={styles.commentText}>{c.text}</Text>
                    </View>
                    {canDelete ? (
                      <Pressable onPress={() => onDeleteComment(c.id)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={14} color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {myUid ? (
            <View style={styles.commentComposer}>
              <TextInput
                style={styles.commentInput}
                placeholder="Напиши коментар…"
                placeholderTextColor={colors.textMuted}
                value={commentDraft}
                onChangeText={setCommentDraft}
                maxLength={2000}
                multiline
                editable={!sendingComment}
              />
              <Pressable
                onPress={onSendComment}
                disabled={sendingComment || !commentDraft.trim()}
                hitSlop={8}
              >
                {sendingComment ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons
                    name="send"
                    size={20}
                    color={commentDraft.trim() ? colors.primary : colors.textMuted}
                  />
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {post.photoUri ? (
        <ImageViewer uri={post.photoUri} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
      ) : null}
    </View>
  );
}
