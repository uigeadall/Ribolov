import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, Platform,
  TextInput, ActivityIndicator, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useTheme } from '../services/themeContext';
import { ThemedTextInput } from './ThemedTextInput';
import { ActionSheet } from './ActionSheet';
import { radius, spacing, typography } from '../theme/typography';
import type { Post } from '../types';
import { RichText } from './RichText';
import { looksNonBulgarian, openTranslation } from '../utils/captionLanguage';
import { ImageViewer } from './ImageViewer';
import { FeedVideoPlayer } from './FeedVideoPlayer';
import { useFeedItemVisibility } from '../hooks/useFeedItemVisibility';
import { useWindowDimensions } from 'react-native';
import { SharePickerModal, buildPostSharedRef } from './SharePickerModal';
import { LikersSheet, useLikersSheet } from './LikersSheet';
import { formatTimeAgo } from '../utils/formatCatchDate';
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
import { ReactionPicker } from './ReactionPicker';
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

function PostCardInner({
  post, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl,
  onPressAuthor, onPressHashtag, onPressMention, onDelete, onReshare, onPressReshareTarget,
}: Props) {
  const { colors, mode } = useTheme();
  const { configured } = useAuth();
  // Visibility for inline video autoplay — same pub-sub the FeedPost uses,
  // so at most one video plays at a time across the whole feed regardless
  // of whether the visible card is a catch or a standalone post.
  const isVisible = useFeedItemVisibility(post.id);
  const { width: screenWidth } = useWindowDimensions();
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
  // pickerAnim was kept on this component to drive the inline picker's
  // enter/exit animation. The shared ReactionPicker now owns its own
  // Animated.Value internally, so the parent just toggles `showPicker`.
  const reactionScale = useRef(new Animated.Value(1)).current;
  const [viewerOpen, setViewerOpen] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Adaptive photo aspect ratio — matches FeedPost. Defaults to 4/3 so
  // expo-image gets a non-zero pixel size on first render, then onLoad
  // updates to the photo's natural ratio. Reset on post.id change so a
  // recycled cell doesn't briefly render at the previous post's ratio.
  const [photoAspectRatio, setPhotoAspectRatio] = useState<number>(4 / 3);
  useEffect(() => { setPhotoAspectRatio(4 / 3); }, [post.id]);
  // Width of the right content column once the avatar (40), gap (12), and
  // wrapper horizontal padding (14 each side) are deducted — same math as
  // FeedPost so media inside catches and posts sits at identical sizes.
  const contentWidth = Math.max(0, screenWidth - 14 - 40 - 12 - 14);
  const photoHeight = Math.min(
    Math.round(contentWidth * 1.5),
    Math.round(contentWidth / photoAspectRatio),
  );
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

  // Reaction summary — read inline from the post doc's denormalized
  // `reactionCounts` map (maintained atomically by togglePostReaction). Saves
  // the per-card fetchPostReactionSummary call that previously read up to 50
  // like docs. `fetchPostReactionSummary` is reserved for legacy posts
  // missing the field, and only fired in that fallback effect below.
  const inlineSummaryFromCounts = useMemo<ReactionSummaryItem[] | null>(() => {
    const counts = post.reactionCounts;
    if (!counts) return null;
    const out: ReactionSummaryItem[] = [];
    for (const [type, count] of Object.entries(counts) as [ReactionType, number][]) {
      if (typeof count === 'number' && count > 0) {
        out.push({ type, emoji: REACTIONS[type].emoji, count });
      }
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }, [post.reactionCounts]);

  const reloadReactionSummary = useCallback(() => {
    // Only network-fetch when the denormalized counts aren't on the doc —
    // i.e. legacy posts created before this field existed.
    if (inlineSummaryFromCounts !== null) {
      setReactionSummary(inlineSummaryFromCounts);
      return;
    }
    fetchPostReactionSummary(post.id).then(setReactionSummary).catch(() => {});
  }, [post.id, inlineSummaryFromCounts]);
  useEffect(() => { reloadReactionSummary(); }, [reloadReactionSummary]);

  const openPicker = useCallback(() => setShowPicker(true), []);
  const closePicker = useCallback(() => setShowPicker(false), []);

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
    const prevSummary = reactionSummary;
    setMyReaction(same ? null : reaction);
    setLikeCount((c) => Math.max(0, c + (prev === null ? 1 : same ? -1 : 0)));
    // Optimistic per-type summary update. Mirrors the post-doc transaction so
    // the emoji breakdown moves the moment the user taps — we no longer fire
    // a fetchPostReactionSummary read after the toggle. The next feed
    // refresh (which carries the updated reactionCounts inline) is the
    // ultimate source of truth.
    setReactionSummary(() => {
      let updated = prevSummary.map((r) => ({ ...r }));
      if (prev) {
        const idx = updated.findIndex((r) => r.type === prev);
        if (idx >= 0) {
          updated[idx].count -= 1;
          if (updated[idx].count <= 0) updated = updated.filter((r) => r.type !== prev);
        }
      }
      if (!same) {
        const idx = updated.findIndex((r) => r.type === reaction);
        if (idx >= 0) updated[idx].count += 1;
        else updated.push({ type: reaction, emoji: REACTIONS[reaction].emoji, count: 1 });
        updated.sort((a, b) => b.count - a.count);
      }
      return updated;
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await togglePostReaction(post.id, myUid, post.ownerUid, myDisplayName, reaction);
    } catch {
      // Roll back optimistic delta on rate-limit/rules failure.
      setMyReaction(prev);
      setLikeCount((c) => Math.max(0, c + (prev === null ? -1 : same ? 1 : 0)));
      setReactionSummary(prevSummary);
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  }, [post.id, post.ownerUid, myUid, myDisplayName, myReaction, reactionSummary]);

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
    // Mirror of FeedPost's two-column layout — avatar in the LEFT column,
    // everything else (header, body, media, actions, comments) inside the
    // right contentCol. Previously PostCard was a single-column Instagram-
    // style stack; posts now read visually identical to catches in the feed.
    postWrap: {
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 4,
      gap: 12,
    },
    avatarCol: { width: 40, alignItems: 'center' },
    contentCol: { flex: 1, minWidth: 0 },
    postHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 2,
    },
    avatar: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    avatarImg: { width: 40, height: 40 },
    avatarText: { color: colors.white, fontFamily: 'Manrope_700Bold', fontSize: 15 },
    headerName: { fontWeight: '700', color: colors.text, fontSize: 15 },
    headerSep: { color: colors.textMuted, fontSize: 14 },
    headerTime: { color: colors.textMuted, fontSize: 14 },
    text: {
      ...typography.body,
      color: colors.text,
      lineHeight: 22,
      marginTop: 2,
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
    actionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      paddingRight: 12,
    },
    actionCell: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingRight: 6,
    },
    actionCount: {
      fontSize: 13,
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    // ── Comments ──
    // No paddingHorizontal — contentCol already provides the left indent.
    commentsPanel: {
      paddingBottom: spacing.sm,
      paddingTop: spacing.sm,
      marginTop: spacing.sm,
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
    // ── Reshare card ──
    // Inside contentCol now, so paddingHorizontal is dropped — the column
    // itself provides the indent. Kept the leading primary-color bar that
    // preserves the "quoted" semantic without making the reshare look
    // smaller than the surrounding feed item.
    reshareCard: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: 4,
    },
    reshareQuoteBar: {
      position: 'absolute',
      left: 0, top: 8, bottom: 8,
      width: 3,
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
    reshareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: spacing.md,
      paddingBottom: 8,
      paddingLeft: spacing.sm,
    },
    reshareAvatar: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    reshareAvatarText: { ...typography.bodyBold, color: colors.primary, fontSize: 12 },
    reshareName: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    reshareBody: { paddingBottom: spacing.sm, paddingLeft: spacing.sm },
    reshareText: { ...typography.body, color: colors.text, fontSize: 13, lineHeight: 18 },
    reshareCatchLine: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    reshareCatchMeta: { ...typography.small, color: colors.textMuted, marginTop: 2 },
    resharePhoto: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceAlt, borderRadius: 12 },
  }), [colors]);

  return (
    <View style={styles.postWrap}>
      {/* ── Avatar column — sits to the left of everything. Tapping it
          opens the author's profile. Mirror of FeedPost's avatarCol. ── */}
      <Pressable
        onPress={() => onPressAuthor(post.ownerUid, displayName)}
        style={styles.avatarCol}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Профил на ${displayName}`}
      >
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image
              source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }}
              style={styles.avatarImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
              recyclingKey={avatarUrl}
            />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>
      </Pressable>

      {/* ── Right content column — header, body, media, actions, comments ── */}
      <View style={styles.contentCol}>
        {/* X-style header — one tight line of text. Name and time, with
            optional first-hashtag chip between them when present. */}
        <View style={styles.postHeader}>
          <Pressable
            onPress={() => onPressAuthor(post.ownerUid, displayName)}
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4, minWidth: 0 }}
            hitSlop={4}
          >
            <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.headerSep}>·</Text>
            {post.hashtags && post.hashtags.length > 0 ? (
              <>
                <Text style={styles.headerTime} numberOfLines={1}>#{post.hashtags[0]}</Text>
                <Text style={styles.headerSep}>·</Text>
              </>
            ) : null}
            <Text style={styles.headerTime} numberOfLines={1}>{formatTimeAgo(post.date)}</Text>
          </Pressable>
          {isMine && onDelete ? (
            <Pressable
              onPress={openMenu}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Опции"
            >
              <Ionicons name="ellipsis-horizontal" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Body text with hashtags/mentions — truncated at 5 lines / 280 chars unless expanded */}
        {post.text ? (() => {
          const TRUNCATE_LIMIT = 280;
          const LINE_LIMIT = 5;
          const isLong = post.text.length > TRUNCATE_LIMIT || (post.text.match(/\n/g)?.length ?? 0) >= LINE_LIMIT;
          return (
            <View>
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

        {/* Inline video player — takes precedence over the photo when both
            present. Sized to contentWidth so it matches the FeedPost catch
            video footprint exactly. */}
        {post.videoUri ? (
          <View style={{
            marginTop: 8,
            borderRadius: 18,
            overflow: 'hidden',
            width: contentWidth,
            height: Math.round(contentWidth * (5 / 4)),
            backgroundColor: '#000',
          }}>
            <FeedVideoPlayer
              uri={post.videoUri}
              posterUri={post.videoThumbnailUri}
              playing={isVisible}
              width={contentWidth}
              height={Math.round(contentWidth * (5 / 4))}
            />
          </View>
        ) : null}

        {/* Photo — sized to contentWidth + adaptive aspect ratio (same as
            FeedPost). Tap opens fullscreen viewer. */}
        {post.photoUri ? (
          <Pressable
            onPress={() => setViewerOpen(true)}
            style={{ marginTop: 8, borderRadius: 18, overflow: 'hidden' }}
          >
            <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
              <Image
                source={{ uri: getImageVariant(post.photoUri, ImageSize.feed) ?? post.photoUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={250}
                recyclingKey={post.id}
                onLoad={(e) => {
                  const { width, height } = e.source;
                  if (width && height) setPhotoAspectRatio(width / height);
                }}
              />
            </View>
          </Pressable>
        ) : null}

        {/* Embedded reshared item — sized to peer with FeedPost. The leading
            primary-color bar preserves the "quoted" semantic. */}
        {post.reshareOf ? (
          <ReshareCard
            reshareOf={post.reshareOf}
            myUid={myUid}
            styles={{
              container: styles.reshareCard,
              quoteBar: styles.reshareQuoteBar,
              header: styles.reshareHeader,
              avatar: styles.reshareAvatar,
              avatarText: styles.reshareAvatarText,
              name: styles.reshareName,
              body: styles.reshareBody,
              text: styles.reshareText,
              catchLine: styles.reshareCatchLine,
              catchMeta: styles.reshareCatchMeta,
              photo: styles.resharePhoto,
            }}
            colors={colors}
            onPress={() => {
              const target = post.reshareOf!;
              if (onPressReshareTarget) onPressReshareTarget(target);
              else onPressAuthor(target.ownerUid, target.ownerName);
            }}
          />
        ) : null}

        {/* Reaction picker (glass pill) — shared with FeedPost. */}
        <ReactionPicker
          visible={showPicker}
          myReaction={myReaction}
          onPick={(type) => { closePicker(); onPickReaction(type); }}
          onAutoClose={closePicker}
        />

        {/* ── Action bar — X (Twitter) style ──
            Mirror of FeedPost: 4 cells (comment, repost, like split into
            heart + count, send). No save action — savedPosts isn't backed
            by Firestore yet. Icons sized 18-20px to read as text-like
            rather than dominant UI. */}
        <View style={styles.actionBar}>
          {/* Comment */}
          <Pressable
            onPress={() => setCommentsOpen((v) => !v)}
            hitSlop={8}
            android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
            accessibilityRole="button"
            accessibilityLabel="Коментари"
            style={styles.actionCell}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
            {(post.commentCount ?? 0) > 0 ? (
              <Text style={styles.actionCount}>{post.commentCount}</Text>
            ) : null}
          </Pressable>

          {/* Quote-reshare */}
          {onReshare ? (
            <Pressable
              onPress={() => onReshare(post)}
              hitSlop={8}
              android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
              accessibilityRole="button"
              accessibilityLabel="Сподели в лентата"
              style={styles.actionCell}
            >
              <Ionicons name="repeat-outline" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}

          {/* Like — heart icon as its own tap target */}
          <Pressable
            onPress={() => {
              if (!myUid) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              animateReaction();
              if (myReaction) onPickReaction(myReaction);
              else openPicker();
            }}
            onLongPress={openPicker}
            disabled={!myUid || likeBusy}
            hitSlop={8}
            delayLongPress={300}
            android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
            accessibilityRole="button"
            accessibilityLabel={myReaction ? 'Промени реакцията' : 'Хареса'}
            accessibilityState={{ selected: !!myReaction }}
            style={[styles.actionCell, likeBusy && { opacity: 0.5 }]}
          >
            <Animated.View style={{ transform: [{ scale: reactionScale }] }}>
              {myReaction ? (
                <Text style={{ fontSize: 18 }}>{REACTIONS[myReaction].emoji}</Text>
              ) : (
                <Ionicons name="heart-outline" size={18} color={colors.textMuted} />
              )}
            </Animated.View>
          </Pressable>
          {/* Like count — separate tap target opens the likers sheet so a
              count tap doesn't fire the reaction toggle. */}
          {likeCount > 0 ? (
            <Pressable
              onPress={() => void likersSheet.openSheet()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Виж кой е харесал"
              style={{ paddingVertical: 4, paddingHorizontal: 4, marginRight: 2 }}
            >
              <Text
                style={[
                  styles.actionCount,
                  myReaction ? { color: colors.text, fontWeight: '600' } : null,
                ]}
              >
                {likeCount}
              </Text>
            </Pressable>
          ) : null}

          {/* Send to friend via DM */}
          <Pressable
            onPress={() => setShareToFriendOpen(true)}
            hitSlop={8}
            android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
            accessibilityRole="button"
            accessibilityLabel="Изпрати на приятел"
            style={styles.actionCell}
          >
            <Ionicons name="paper-plane-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Comments panel — inside contentCol so the left-column avatar
            indent applies to comments too (matches FeedPost). */}
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
                        <Pressable onPress={() => onDeleteComment(c.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Изтрий коментара" style={{ paddingTop: 2 }}>
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
                    <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Откажи отговора">
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.commentComposer}>
                  <ThemedTextInput
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
      </View>

      {/* Modals — placed at the postWrap level so they overlay the whole
          screen rather than getting clipped by contentCol. RN Modals
          portal to the root regardless, but keeping them visually
          out-of-tree-flow here is the clearer code structure. */}
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

      {post.photoUri ? (
        <ImageViewer uri={post.photoUri} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
      ) : null}
    </View>
  );
}

export const PostCard = React.memo(PostCardInner);

// ─── ReshareCard ─────────────────────────────────────────────────────────────
// Pulled out of PostCard's render so it can call `useAvatarUrl` for the
// reshare AUTHOR — not the post author. Previously the reshare displayed only
// `reshareOf.ownerPhotoUrl` (a snapshot from the original publish time); if
// that field was empty when the reshare was created, the avatar fell back to
// the initial "M" forever, even after the original author uploaded a photo.
// useAvatarUrl lazy-fetches the current users/{uid}.photoUrl with a 5-minute
// cache, so the reshare picks up the author's latest avatar without us having
// to re-fanout on every avatar change.
type ReshareCardProps = {
  reshareOf: import('../types').ResharedRef;
  myUid?: string;
  colors: ReturnType<typeof useTheme>['colors'];
  styles: {
    container: object;
    quoteBar: object;
    header: object;
    avatar: object;
    avatarText: object;
    name: object;
    body: object;
    text: object;
    catchLine: object;
    catchMeta: object;
    photo: object;
  };
  onPress: () => void;
};

function ReshareCard({ reshareOf, myUid, colors, styles, onPress }: ReshareCardProps) {
  const avatarUrl = useAvatarUrl({
    ownerUid: reshareOf.ownerUid,
    isMine: reshareOf.ownerUid === myUid,
    // myPhotoUrl is intentionally omitted — when MY post reshares MY OWN
    // catch, the lazy Firestore fetch path catches it via getUserPublicSummary
    // and we get the same image. Passing myPhotoUrl here would couple this
    // helper to the outer component's prop wiring for no real gain.
    ownerPhotoUrl: reshareOf.ownerPhotoUrl,
  });
  return (
    <Pressable style={styles.container} onPress={onPress}>
      <View style={styles.quoteBar} />
      <View style={styles.header}>
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image
              source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }}
              style={{ width: 40, height: 40 }}
              contentFit="cover"
            />
          ) : (
            <Text style={styles.avatarText as object}>{reshareOf.ownerName.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <Text style={[styles.name as object, { flex: 1 }]} numberOfLines={1}>{reshareOf.ownerName}</Text>
        <Ionicons name={reshareOf.kind === 'catch' ? 'fish-outline' : 'document-text-outline'} size={14} color={colors.textMuted} />
      </View>
      <View style={styles.body}>
        {reshareOf.kind === 'catch' ? (
          <>
            {reshareOf.speciesName ? (
              <Text style={styles.catchLine as object}>
                {reshareOf.speciesName}
                {reshareOf.weightKg != null ? ` · ${reshareOf.weightKg} кг` : ''}
              </Text>
            ) : null}
            {reshareOf.text ? <Text style={styles.catchMeta as object} numberOfLines={2}>{reshareOf.text}</Text> : null}
          </>
        ) : (
          reshareOf.text ? <Text style={styles.text as object} numberOfLines={4}>{reshareOf.text}</Text> : null
        )}
      </View>
      {reshareOf.photoUri ? (
        <Image
          source={{ uri: getImageVariant(reshareOf.photoUri, ImageSize.feed) ?? reshareOf.photoUri }}
          style={styles.photo}
          contentFit="cover"
        />
      ) : null}
    </Pressable>
  );
}
