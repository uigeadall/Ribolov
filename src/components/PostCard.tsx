import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, Platform,
  TextInput, ActivityIndicator, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useTheme } from '../services/themeContext';
import { ActionSheet } from './ActionSheet';
import { radius, spacing, typography } from '../theme/typography';
import type { Post } from '../types';
import { RichText } from './RichText';
import { looksNonBulgarian, openTranslation } from '../utils/captionLanguage';
import { ImageViewer } from './ImageViewer';
import { SharePickerModal, buildPostSharedRef } from './SharePickerModal';
import { LikersSheet, useLikersSheet } from './LikersSheet';
import {
  subscribePostComments,
  addPostComment,
  deletePostComment,
} from '../services/posts';
import {
  subscribeMyReactionOnPost,
  togglePostReaction,
  fetchPostReactionSummary,
  fetchPostLikers,
} from '../services/socialReactions';
import { REACTIONS, type ReactionType, type ReactionSummaryItem } from '../services/socialTypes';
import type { FeedComment } from '../services/socialTypes';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAuth } from '../services/authContext';
import { CommentLikeButton } from './CommentLikeButton';
import { getImageVariant, ImageSize } from '../utils/imageVariants';

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
  /** Tapping the embedded reshare/quote card. Opens the original post or catch. */
  onPressReshareTarget?: (target: NonNullable<Post['reshareOf']>) => void;
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

function PostCardInner({
  post, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl,
  onPressAuthor, onPressHashtag, onPressMention, onDelete, onReshare, onPressReshareTarget,
}: Props) {
  const { colors, mode } = useTheme();
  const { configured } = useAuth();
  // Reaction state — replaces the old boolean `liked`. `myReaction === null`
  // means the user hasn't reacted. The picker fans out the 5 emoji options.
  const [myReaction, setMyReaction] = useState<ReactionType | null>(null);
  const [reactionSummary, setReactionSummary] = useState<ReactionSummaryItem[]>([]);
  const [likeCount, setLikeCount] = useState(post.likeCount ?? 0);
  const [likeBusy, setLikeBusy] = useState(false);
  // Synchronous busy lock — `likeBusy` state updates async via React's batched
  // setState, which means two rapid taps in the same render cycle both see
  // `likeBusy === false` and both pass the guard. The ref is read + written
  // synchronously inside `onPickReaction` so the second tap is rejected
  // immediately. Keeping the state too so we can still tint the button.
  const likeBusyRef = useRef(false);
  // Synchronous double-tap guard for the comment send button. The
  // `sendingComment` state lags one render so two rapid taps both saw
  // false and both fired `addPostComment`, posting the comment twice.
  // Same shape as `likeBusyRef` just above.
  const sendingCommentRef = useRef(false);
  const [showPicker, setShowPicker] = useState(false);
  const [shareToFriendOpen, setShareToFriendOpen] = useState(false);
  const pickerAnim = useRef(new Animated.Value(0)).current;
  const reactionScale = useRef(new Animated.Value(1)).current;
  const [viewerOpen, setViewerOpen] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Likers sheet — opens when the user taps the reaction-summary row.
  // The fetch is one-shot per open (no live subscription); good enough for a
  // detail surface that's only visible while the sheet is up.
  const likersSheet = useLikersSheet(() => fetchPostLikers(post.id));
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
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
    return subscribeMyReactionOnPost(post.id, myUid, setMyReaction);
  }, [post.id, myUid]);

  useEffect(() => {
    setLikeCount(post.likeCount ?? 0);
  }, [post.likeCount]);

  // Reaction summary — fetched once on mount + after every successful toggle.
  // Counts on this list can drift slightly from likeCount because the summary
  // is sampled to 50 docs; for low-volume posts they match exactly.
  const reloadReactionSummary = useCallback(() => {
    fetchPostReactionSummary(post.id).then(setReactionSummary).catch(() => {});
  }, [post.id]);
  useEffect(() => { reloadReactionSummary(); }, [reloadReactionSummary]);

  const openPicker = useCallback(() => {
    setShowPicker(true);
    Animated.spring(pickerAnim, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
  }, [pickerAnim]);

  const closePicker = useCallback(() => {
    Animated.timing(pickerAnim, { toValue: 0, duration: 160, useNativeDriver: true })
      .start(({ finished }) => { if (finished) setShowPicker(false); });
  }, [pickerAnim]);

  const animateReaction = useCallback(() => {
    Animated.sequence([
      Animated.spring(reactionScale, { toValue: 1.25, useNativeDriver: true, bounciness: 14 }),
      Animated.spring(reactionScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [reactionScale]);

  const onPickReaction = useCallback(async (reaction: ReactionType) => {
    if (!myUid || likeBusyRef.current) return;
    likeBusyRef.current = true;
    setLikeBusy(true);
    // Optimistic: assume the picked reaction will replace whatever's there.
    // If the user is removing the same reaction, the toggle returns null.
    const prev = myReaction;
    const same = prev === reaction;
    setMyReaction(same ? null : reaction);
    setLikeCount((c) => Math.max(0, c + (prev === null ? 1 : same ? -1 : 0)));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await togglePostReaction(post.id, myUid, post.ownerUid, myDisplayName, reaction);
      reloadReactionSummary();
    } catch {
      // Roll back optimistic delta on rate-limit/rules failure.
      setMyReaction(prev);
      setLikeCount((c) => Math.max(0, c + (prev === null ? -1 : same ? 1 : 0)));
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  }, [post.id, post.ownerUid, myUid, myDisplayName, myReaction, reloadReactionSummary]);

  // Lazy-subscribe to comments only when the user expands them (saves listener cost).
  useEffect(() => {
    if (!commentsOpen || !configured) return;
    commentsSubscribedRef.current = true;
    const unsub = subscribePostComments(post.id, setComments);
    return unsub;
  }, [commentsOpen, configured, post.id]);

  const onSendComment = useCallback(async () => {
    if (!myUid || sendingCommentRef.current) return;
    const text = commentDraft.trim();
    if (!text) return;
    const reply = replyingTo;
    sendingCommentRef.current = true;
    setSendingComment(true);
    try {
      await addPostComment(post.id, myUid, myDisplayName, text, reply ?? undefined);
      setCommentDraft('');
      setReplyingTo(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : 'Неуспешно изпращане', visibilityTime: 2400 });
    } finally {
      sendingCommentRef.current = false;
      setSendingComment(false);
    }
  }, [myUid, myDisplayName, commentDraft, post.id, replyingTo]);

  const onDeleteComment = useCallback((commentId: string) => {
    Alert.alert('Изтрий коментара', undefined, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          try { await deletePostComment(post.id, commentId); }
          catch { Toast.show({ type: 'error', text1: 'Неуспешно изтриване', visibilityTime: 2400 }); }
        },
      },
    ]);
  }, [post.id]);

  const openMenu = () => {
    if (!isMine || !onDelete) return;
    void Haptics.selectionAsync();
    ActionSheet.show({
      options: [
        {
          label: 'Изтрий публикацията',
          icon: 'trash-outline',
          destructive: true,
          onPress: () => onDelete(post),
        },
      ],
    });
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
              <Image source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }} style={{ width: 40, height: 40 }} contentFit="cover" />
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
            {/* "Виж превод" — only when post text looks foreign-language. */}
            {looksNonBulgarian(post.text) ? (
              <Pressable onPress={() => void openTranslation(post.text)} hitSlop={6} style={{ marginTop: 4 }}>
                <Text style={styles.expandToggle}>Виж превод</Text>
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
          <Image source={{ uri: getImageVariant(post.photoUri, ImageSize.feed) ?? post.photoUri }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
        </Pressable>
      ) : null}

      {/* Embedded reshared item */}
      {post.reshareOf ? (
        <Pressable
          style={styles.reshareCard}
          // Tap opens the original post/catch the quote is referencing, not
          // the original author's profile. Fall back to opening the author
          // if the parent didn't wire onPressReshareTarget (older callers).
          onPress={() => {
            const target = post.reshareOf!;
            if (onPressReshareTarget) onPressReshareTarget(target);
            else onPressAuthor(target.ownerUid, target.ownerName);
          }}
        >
          <View style={styles.reshareHeader}>
            <View style={styles.reshareAvatar}>
              {post.reshareOf.ownerPhotoUrl ? (
                <Image source={{ uri: getImageVariant(post.reshareOf.ownerPhotoUrl, ImageSize.avatar) ?? post.reshareOf.ownerPhotoUrl }} style={{ width: 24, height: 24 }} contentFit="cover" />
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
            <Image source={{ uri: getImageVariant(post.reshareOf.photoUri, ImageSize.feed) ?? post.reshareOf.photoUri }} style={styles.resharePhoto} contentFit="cover" />
          ) : null}
        </Pressable>
      ) : null}

      {/* Reaction picker (glass pill) — mounts between content and actions */}
      {showPicker && (
        <Animated.View
          style={{
            borderRadius: radius.xl,
            overflow: 'hidden',
            marginHorizontal: 12,
            marginTop: 8,
            opacity: pickerAnim,
            transform: [{ scale: pickerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: mode === 'dark' ? 0.35 : 0.14,
            shadowRadius: 14,
            elevation: 6,
          }}
        >
          <BlurView
            intensity={mode === 'dark' ? 68 : 80}
            tint={mode === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={mode === 'dark'
              ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)']
              : ['rgba(255,255,255,0.72)', 'rgba(255,255,255,0.30)']}
            start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[StyleSheet.absoluteFillObject, {
            borderRadius: radius.xl, borderWidth: 1,
            borderColor: mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.82)',
          }]} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }}>
            {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
              <Pressable
                key={type}
                onPress={() => { closePicker(); onPickReaction(type); }}
                style={{
                  alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4,
                  borderRadius: radius.md,
                  backgroundColor: myReaction === type
                    ? (mode === 'dark' ? 'rgba(255,255,255,0.18)' : colors.primarySurface)
                    : 'transparent',
                }}
              >
                <Text style={{ fontSize: 28 }}>{r.emoji}</Text>
                <Text style={{ ...typography.caption, color: myReaction === type ? colors.primary : colors.textMuted, marginTop: 2, fontSize: 10 }}>{r.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={closePicker} style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm }}>
              <Ionicons name="close-circle" size={22} color={mode === 'dark' ? 'rgba(255,255,255,0.45)' : colors.textMuted} />
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={styles.actionBtn}
          onPress={() => {
            if (!myUid) return;
            animateReaction();
            // Quick-tap reuses last reaction (or removes it if same).
            // Long-press opens the picker for a different reaction.
            if (myReaction) onPickReaction(myReaction);
            else openPicker();
          }}
          onLongPress={openPicker}
          delayLongPress={300}
          hitSlop={8}
          disabled={!myUid || likeBusy}
        >
          <Animated.View style={{ transform: [{ scale: reactionScale }] }}>
            {myReaction ? (
              <Text style={{ fontSize: 22 }}>{REACTIONS[myReaction].emoji}</Text>
            ) : (
              <Ionicons name="heart-outline" size={22} color={colors.text} />
            )}
          </Animated.View>
          {likeCount > 0 ? (
            <Text style={[styles.actionCount, myReaction && styles.actionCountActive]}>{likeCount}</Text>
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
        <Pressable
          style={styles.actionBtn}
          onPress={() => setShareToFriendOpen(true)}
          hitSlop={8}
          accessibilityLabel="Изпрати на приятел"
        >
          <Ionicons name="send-outline" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Reaction summary — top 3 emoji + count, taps to open the likers sheet. */}
      {likeCount > 0 && reactionSummary.length > 0 ? (
        <Pressable
          onPress={() => void likersSheet.openSheet()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.lg, marginTop: -4, marginBottom: spacing.xs }}
          hitSlop={6}
        >
          {reactionSummary.slice(0, 3).map((r) => (
            <Text key={r.type} style={{ fontSize: 13 }}>{r.emoji}</Text>
          ))}
          <Text style={{ ...typography.caption, color: colors.textMuted, marginLeft: 2 }}>
            {likeCount} {likeCount === 1 ? 'харесване' : 'харесвания'}
          </Text>
        </Pressable>
      ) : null}

      <LikersSheet
        visible={likersSheet.open}
        onClose={() => likersSheet.setOpen(false)}
        likeCount={likeCount}
        likers={likersSheet.likers}
        loading={likersSheet.loading}
        onPressUser={onPressAuthor}
      />

      {/* Lazy-mounted DM share sheet — only renders when opened, like FeedPost. */}
      {shareToFriendOpen && (
        <SharePickerModal
          visible
          onClose={() => setShareToFriendOpen(false)}
          sharedRef={buildPostSharedRef(post)}
        />
      )}

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
                const isReply = !!c.replyToId;
                return (
                  <View key={c.id} style={[styles.commentRow, isReply && { marginLeft: spacing.xl }]}>
                    {/* Tiny avatar — restores parity with FeedPost catches. */}
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: colors.primarySurface,
                      borderWidth: 1, borderColor: colors.border,
                      alignItems: 'center', justifyContent: 'center',
                      marginTop: 1, flexShrink: 0,
                    }}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 9 }}>
                        {c.authorName.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      {isReply ? (
                        <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 2, fontSize: 11 }}>
                          ↩ отговор на {c.replyToName}
                        </Text>
                      ) : null}
                      <Pressable onPress={() => onPressAuthor(c.authorUid, c.authorName)}>
                        <Text style={styles.commentAuthor}>{c.authorName}</Text>
                      </Pressable>
                      <Text style={styles.commentText}>{c.text}</Text>
                      {/* Inline action row — like / reply */}
                      {myUid ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 4 }}>
                          <CommentLikeButton
                            kind="post"
                            parentId={post.id}
                            commentId={c.id}
                            myUid={myUid}
                            myDisplayName={myDisplayName}
                            initialCount={c.likeCount ?? 0}
                          />
                          <Pressable onPress={() => setReplyingTo({ id: c.id, name: c.authorName })} hitSlop={8}>
                            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>Отговори</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                    {canDelete ? (
                      <Pressable onPress={() => onDeleteComment(c.id)} hitSlop={8} style={{ paddingTop: 2 }}>
                        <Ionicons name="trash-outline" size={14} color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {myUid ? (
            <>
              {replyingTo ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySurface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: spacing.sm, gap: spacing.sm }}>
                  <Ionicons name="return-down-forward-outline" size={14} color={colors.primary} />
                  <Text style={{ ...typography.caption, color: colors.primary, flex: 1 }}>Отговор на {replyingTo.name}</Text>
                  <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.commentComposer}>
                <TextInput
                  style={styles.commentInput}
                  placeholder={replyingTo ? `Отговор на ${replyingTo.name}…` : 'Напиши коментар…'}
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
            </>
          ) : null}
        </View>
      ) : null}

      {post.photoUri ? (
        <ImageViewer uri={post.photoUri} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
      ) : null}
    </View>
  );
}

export const PostCard = React.memo(PostCardInner);
