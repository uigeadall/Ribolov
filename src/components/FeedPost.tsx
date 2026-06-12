import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Modal,
  FlatList,
  Linking,
  Animated,
  PanResponder,
  ScrollView,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { looksNonBulgarian, openTranslation } from '../utils/captionLanguage';
import type { FeedItem } from '../services/catchSync';
import { RichText } from './RichText';
import { ActionSheet, type ActionSheetOption } from './ActionSheet';
import { useTheme } from '../services/themeContext';
import { ThemedTextInput } from './ThemedTextInput';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { REACTIONS, type ReactionType } from '../services/socialFeed';
import { formatTimeAgo } from '../utils/formatCatchDate';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { ReactionPicker } from './ReactionPicker';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';
import { useFeedItemVisibility } from '../hooks/useFeedItemVisibility';
import { ImageViewer } from './ImageViewer';
import { FeedVideoPlayer } from './FeedVideoPlayer';
import { SharePickerModal, buildCatchSharedRef } from './SharePickerModal';
import { CommentLikeButton } from './CommentLikeButton';
import { getImageVariant, ImageSize } from '../utils/imageVariants';
import * as Haptics from 'expo-haptics';

function feedStyles(colors: AppColors) {
  return StyleSheet.create({
    // Outer wrapper — FishAngler/Facebook-style stacked card: header row
    // (avatar + name block + ⋯), edge-to-edge media, species pill, caption,
    // action bar, comments. A single hairline divides one post from the next.
    postWrap: {
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingTop: 12,
      paddingBottom: 4,
    },
    contentCol: {
      minWidth: 0, // prevents flexbox overflow on long words / URLs
    },
    // Horizontal inset for text content — media stays edge-to-edge.
    padded: {
      paddingHorizontal: 14,
    },
    // ── Header row (avatar + two-line name block + more menu) ──
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      marginBottom: 6,
    },
    headerTextCol: {
      flex: 1,
      minWidth: 0,
    },
    headerMeta: {
      color: colors.textMuted,
      fontSize: 12.5,
      marginTop: 1,
    },
    // ── Species pill — sits under the photo, FishAngler tag style ──
    speciesPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.navy,
      // Hairline keeps the navy pill visible on dark cards (navy-on-navy).
      borderWidth: 1,
      borderColor: colors.cardEdge,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 5,
      marginTop: 10,
      marginHorizontal: 14,
    },
    speciesPillText: {
      color: colors.onNavy,
      fontSize: 12,
      fontFamily: 'Manrope_700Bold',
    },
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
    avatarText: { color: colors.white, fontFamily: 'Manrope_700Bold', fontSize: 15 },
    headerName: { fontWeight: '700', color: colors.text, fontSize: 15 },
    headerSep: { color: colors.textMuted, fontSize: 14 },
    headerTime: { color: colors.textMuted, fontSize: 14 },
    // No-photo banner removed — text-only posts in the X layout don't get
    // a fish-illustration placeholder; the species line above is the
    // content.
    // ── Action bar — X style: a single row of icon + count cells spread
    // across the content column width. Each cell is a touch target with the
    // icon on the left and the count beside it. No bookmark on the far
    // right (kept inline as the last cell). marginTop reserves a bit of
    // breathing room from the photo / caption above. */
    actionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
      paddingTop: 6,
      paddingHorizontal: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
    // ── Below action bar ──
    metaWrap: { marginTop: 4 },
    // Kept only the styles still consumed by the active render paths. The
    // old Instagram-style caption / location pill / repeated-timestamp
    // styles were removed when the body restructured to text-first.
    captionText: { color: colors.text, fontSize: 15, lineHeight: 20 },
    // ── Comments (inline) ──
    commentsWrap: { paddingHorizontal: 12, paddingBottom: 4 },
    commentRow: { marginBottom: 6 },
    commentAuthor: { fontWeight: '700', color: colors.text, fontSize: 12 },
    commentText: { color: colors.text, fontSize: 12, marginTop: 1 },
    composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
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
    // ── Likers modal ──
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
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

/* ── Photo grid tile ─────────────────────────────────────────
   One cell of the 2-4 photo X-style grid. flex:1 so the tile expands to
   share row/column space; `recyclingKey` is stable per (post, index) so
   expo-image's recycler treats it correctly during list churn. Tap opens
   the fullscreen viewer at the tile's photo index — passed in as onPress
   from the parent. */
type PhotoGridTileProps = {
  uri: string;
  onPress: () => void;
  id: string;
};

const PhotoGridTile = React.memo(function PhotoGridTile({ uri, onPress, id }: PhotoGridTileProps) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: '#1a1a1a' }}>
      <Image
        source={{ uri: getImageVariant(uri, ImageSize.feed) ?? uri }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
        recyclingKey={id}
      />
    </Pressable>
  );
});

type Props = {
  item: FeedItem;
  myUid?: string;
  myDisplayName: string;
  myPhotoUrl?: string;
  resolvedAvatarUrl?: string;
  socialEnabled?: boolean;
  isVisible?: boolean;
  onPressAuthor: (authorUid: string, displayName: string) => void;
  onPressCatch?: (item: FeedItem) => void;
  onDeletePhoto?: (item: FeedItem) => void;
  onRemovePost?: (item: FeedItem) => void;
  onReshare?: (item: FeedItem) => void;
  onPressHashtag?: (tag: string) => void;
  onPressMention?: (handle: string) => void;
  /** Negative-feedback hooks for the For You ranker. When provided, the
      "⋯" menu surfaces "Не ме интересува" and "Скрий автора" options that
      persist the demotion + refresh the ranker. */
  onMarkNotInterested?: (item: FeedItem) => void;
  onHideAuthor?: (authorUid: string, displayName: string) => void;
  /** Long-press handler — wired by FeedScreen to open PeekPreview. We
      bubble the FeedItem up rather than mounting the modal inside the
      card so the peek lives outside the FlashList recycler. */
  onLongPressCatch?: (item: FeedItem) => void;
};

function FeedPostInner({ item, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl, socialEnabled, isVisible: isVisibleProp, onPressAuthor, onPressCatch, onDeletePhoto, onRemovePost, onReshare, onPressHashtag, onPressMention, onMarkNotInterested, onHideAuthor, onLongPressCatch }: Props) {
  // Visibility resolution: when rendered inside FeedScreen the prop is
  // undefined and we read live visibility from the pub-sub. When rendered
  // outside the feed list (e.g. catch detail), the parent passes
  // `isVisible={true}` explicitly so we don't subscribe to a pub-sub that
  // has no entries for this id.
  const pubSubVisible = useFeedItemVisibility(item.id);
  const isVisible = isVisibleProp !== undefined ? isVisibleProp : pubSubVisible;
  const { colors, mode } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  // FishAngler-style stacked card: media runs edge-to-edge, so the photo
  // carousel pages the full screen width.
  const contentWidth = screenWidth;
  const [commentsOpen, setCommentsOpen] = useState(false);
  // True when commentsOpen was set via the quick-reply stub (so the
  // composer input should autofocus on mount). Reset to false after a
  // single render so re-opening the panel via the chat icon doesn't
  // grab keyboard unexpectedly.
  const [quickReplyFocused, setQuickReplyFocused] = useState(false);
  // Natural aspect ratio (width / height) of the primary photo. Defaults to
  // Index into the combined carouselPhotos list when the viewer is open;
  // null means closed. Tracking the index (not the URI) lets the ImageViewer
  // open on the same page the user tapped AND keeps the user in-context
  // when they swipe through the rest in the fullscreen viewer.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [shareToFriendOpen, setShareToFriendOpen] = useState(false);
  // Likers sheet filter — null means "all reactions", otherwise the
  // ReactionType the user tapped (heart / fire / trophy / fish / wow).
  // Filters the FlatList client-side from the already-loaded social.likers.
  const [likersFilter, setLikersFilter] = useState<ReactionType | null>(null);
  // Image-load error state — flips when expo-image fails to fetch the photoUri.
  // A common failure mode is a published catch whose photoUri is still a local
  // file:// URI because the background upload never completed; we treat that as
  // an immediate error rather than waiting for the load attempt.
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageRetryNonce, setImageRetryNonce] = useState(0);
  useEffect(() => { setImageError(null); }, [item.photoUri, imageRetryNonce]);
  const photoLooksLocal = item.photoUri ? item.photoUri.startsWith('file://') : false;
  // Carousel page index. Page 0 is the primary photoUri (with double-tap-to-like
  // behavior); pages 1..N are extraPhotoUris (tap-to-zoom only).
  const [currentPhotoIdx, setCurrentPhotoIdx] = useState(0);
  const carouselPhotos = useMemo<string[]>(() => {
    if (!item.photoUri) return [];
    return [item.photoUri, ...(item.extraPhotoUris ?? [])];
  }, [item.photoUri, item.extraPhotoUris]);

  // Clamp the index when the photo set shrinks. Without this, a user who
  // scrolled to page 3 of a 4-photo carousel would see "4/2" in the
  // counter chip + out-of-range dots after the post is edited down to
  // 2 photos (or extraPhotoUris updates on a snapshot refresh).
  useEffect(() => {
    if (currentPhotoIdx >= carouselPhotos.length && carouselPhotos.length > 0) {
      setCurrentPhotoIdx(carouselPhotos.length - 1);
    }
  }, [carouselPhotos.length, currentPhotoIdx]);

  const ownerName = item.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const isMine = Boolean(myUid && item.ownerUid === myUid);
  const displayName = isMine ? myDisplayName : ownerName;

  const avatarUrl = useAvatarUrl({
    ownerUid: item.ownerUid, isMine, myPhotoUrl,
    resolvedAvatarUrl, ownerPhotoUrl: item.ownerPhotoUrl,
  });

  const social = useFeedPostSocial({ item, myUid, myDisplayName, ownerName, socialEnabled, isVisible, commentsOpen });
  // Reset the likers filter when the sheet closes so a freshly-opened
  // sheet on the next post starts on "Всички" instead of inheriting the
  // previous selection.
  useEffect(() => { if (!social.likersOpen) setLikersFilter(null); }, [social.likersOpen]);
  // Memoize the filtered likers — without this the FlatList prop changes
  // identity on every parent re-render, defeating the recycler's diff.
  const filteredLikers = useMemo(
    () => likersFilter ? social.likers.filter((l) => l.reaction === likersFilter) : social.likers,
    [likersFilter, social.likers],
  );
  const reactionScale = useRef(new Animated.Value(1)).current;

  // The shared ReactionPicker owns its own enter/exit animation now;
  // openPicker / closePicker just toggle the visibility flag.
  const showPicker = social.reactionPickerOpen;
  const openPicker = () => social.setReactionPickerOpen(true);
  const closePicker = () => social.setReactionPickerOpen(false);

  // Double-tap to like / save
  const lastTapTimeRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0.4)).current;
  const heartY = useRef(new Animated.Value(0)).current;
  const bookmarkOpacity = useRef(new Animated.Value(0)).current;

  const isRecent = useMemo(() => {
    const ms = Date.parse(item.date);
    return !isNaN(ms) && Date.now() - ms < 86_400_000;
  }, [item.date]);

  function handlePhotoPress() {
    const now = Date.now();
    if (now - lastTapTimeRef.current < 320) {
      lastTapTimeRef.current = 0;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (socialEnabled && !social.likeBusy) {
        if (!social.myReaction) {
          social.onPickReaction('heart');
          animateReaction();
        } else {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          void social.onToggleSave();
          bookmarkOpacity.setValue(1);
          Animated.sequence([
            Animated.delay(400),
            Animated.timing(bookmarkOpacity, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]).start();
        }
      }
      heartOpacity.setValue(1);
      heartScale.setValue(0.4);
      heartY.setValue(0);
      Animated.parallel([
        Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }),
        Animated.sequence([
          Animated.delay(550),
          Animated.parallel([
            Animated.timing(heartOpacity, { toValue: 0, duration: 450, useNativeDriver: true }),
            Animated.timing(heartY, { toValue: -70, duration: 450, useNativeDriver: true }),
          ]),
        ]),
      ]).start();
    } else {
      lastTapTimeRef.current = now;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        if (!mountedRef.current || !item.photoUri) return;
        if (Date.now() - lastTapTimeRef.current >= 280) {
          setViewerIndex(0);
        }
      }, 280);
    }
  }

  const sheetPanY = useRef(new Animated.Value(0)).current;
  const sheetPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      // Drive translateY natively — Android benefits enormously from skipping
      // the JS thread during drag. The transform target reads `sheetPanY` as
      // translateY, so the native event mapping is valid.
      onPanResponderMove: Animated.event([null, { dy: sheetPanY }], { useNativeDriver: true }),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80) {
          sheetPanY.setValue(0);
          social.setLikersOpen(false);
        } else {
          Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
        }
      },
    })
  ).current;

  const openMoreMenu = () => {
    void Haptics.selectionAsync();
    if (isMine) {
      const options: ActionSheetOption[] = [];
      if (item.photoUri) {
        options.push({
          label: 'Изтрий снимката',
          icon: 'image-outline',
          destructive: true,
          onPress: () => onDeletePhoto?.(item),
        });
      }
      options.push({
        label: 'Премахни от лентата',
        icon: 'eye-off-outline',
        destructive: true,
        onPress: () => onRemovePost?.(item),
      });
      ActionSheet.show({ options });
    } else {
      // Non-owner menu now also surfaces For You training options when
      // the parent screen wires the callbacks (FeedScreen does; profile /
      // detail screens don't, since the ranker doesn't reach there).
      const options: ActionSheetOption[] = [];
      if (onMarkNotInterested) {
        options.push({
          label: 'Не ме интересува',
          icon: 'thumbs-down-outline',
          onPress: () => onMarkNotInterested(item),
        });
      }
      if (onHideAuthor) {
        options.push({
          label: `Скрий ${displayName}`,
          icon: 'eye-off-outline',
          onPress: () => onHideAuthor(item.ownerUid, displayName),
        });
      }
      options.push({
        label: 'Докладвай',
        icon: 'flag-outline',
        destructive: true,
        onPress: social.onReportCatch,
      });
      ActionSheet.show({ options });
    }
  };

  const animateReaction = () => {
    Animated.sequence([
      Animated.spring(reactionScale, { toValue: 1.35, useNativeDriver: true, speed: 60, bounciness: 14 }),
      Animated.spring(reactionScale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }),
    ]).start();
  };

  // Caption metadata (species, weight, length, released). Notes render
  // separately below so hashtags/mentions inside them can be tappable.
  const captionBody = [
    item.speciesName,
    item.weightKg != null ? `${item.weightKg} кг` : null,
    item.lengthCm != null ? `${item.lengthCm} см` : null,
    item.released ? 'пуснат' : null,
  ].filter(Boolean).join(' · ');

  // Fixed square media window (Instagram-style center-crop). Cell heights
  // must be deterministic: the previous natural-ratio approach re-measured
  // each card on image onLoad, and FlashList's scroll offsets (computed
  // from the first measurement) left big blank gaps when scrolling back up.
  // The uncropped photo is one tap away in the fullscreen viewer.
  const photoHeight = contentWidth;

  return (
    // No per-cell KeyboardAvoidingView: it was wrapping every card in the
    // list, so each one ran its own keyboard listener + layout recalculation
    // when the keyboard appeared (e.g. opening a composer on ONE card moved
    // all of them). Keyboard avoidance for the composer is handled at the
    // screen level (FeedScreen's keyboardAwareScrollProps) and the comment
    // modal's own Modal+ScrollView handles the rest.
    /* Outer Pressable handles the peek long-press. We delegate to the
       host screen via onLongPressCatch — peek state lives there so the
       modal renders outside the FlashList recycler. delayLongPress of
       450ms is a little longer than the system default (500ms feels
       like a delay; ~450ms feels "instant if held"). Inner Pressables
       (avatar, action buttons, photo carousel) still handle their own
       taps normally — the responder system gives precedence to the
       inner node on tap and routes only sustained holds to the outer. */
      <Pressable
        onLongPress={onLongPressCatch ? () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onLongPressCatch(item);
        } : undefined}
        delayLongPress={450}
        // android_disableSound + no pressed style: the outer container
        // shouldn't react to a tap. We rely on inner Pressables for
        // tap feedback.
        android_disableSound
      >
      <View style={styles.postWrap}>

        {/* ── Header row (FishAngler style) — avatar, bold "Name при Water"
            line with a muted time line under it, ⋯ menu at the far right.
            The "recent" ring (a primary-coloured halo for catches < 24h
            old) wraps the avatar so it still reads at a glance. */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => onPressAuthor(item.ownerUid, displayName)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Профил на ${displayName}`}
          >
            <View style={{ position: 'relative' }}>
              {isRecent && (
                <View style={{
                  position: 'absolute', top: -3, left: -3,
                  width: 46, height: 46, borderRadius: 23,
                  borderWidth: 2.5, borderColor: colors.primary,
                }} />
              )}
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
            </View>
          </Pressable>
          <Pressable
            onPress={() => onPressAuthor(item.ownerUid, displayName)}
            style={styles.headerTextCol}
            hitSlop={4}
          >
            <Text style={styles.headerName} numberOfLines={1}>
              {displayName}
              {item.location?.name ? <Text style={styles.headerTime}> при </Text> : null}
              {item.location?.name ?? ''}
            </Text>
            <Text style={styles.headerMeta} numberOfLines={1}>{formatTimeAgo(item.date)}</Text>
          </Pressable>
          <Pressable
            onPress={openMoreMenu}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Опции"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* ── Content column — media first (FishAngler order), then the
            species pill, then the caption, then actions + comments. */}
        <View style={styles.contentCol}>

        {/* ── Media area ──
            Branch order matters and reflects priority:
            0. Video → inline 15s player (preferred when present; the user
               chose to attach a clip, that's the primary content)
            1. 2-4 photos → X-style grid (most common multi-photo case)
            2. 5+ photos → swipeable carousel (rare; carousels at 5+ tiles
               are easier to navigate than a 3×2 grid that hides photos)
            3. 1 photo → standalone with full error-fallback + double-tap UI
            4. 0 photos → null (text-only post) */}
        {item.videoUri ? (
          // Inline 15s video. Aspect ratio defaults to 4:5 (vertical-leaning
          // since most phone-shot fishing clips are portrait); we don't have
          // a load-time hook for video natural ratio yet, so the box stays
          // 4:5 and contentFit="cover" inside the player crops to fit.
          // `playing` is driven by the card's visibility — exactly one
          // feed video plays at a time. Tap opens the catch detail.
          <View style={{
            marginTop: 8,
            borderRadius: 0,
            overflow: 'hidden',
            width: contentWidth,
            height: Math.round(contentWidth * (5 / 4)),
            backgroundColor: '#000',
          }}>
            <FeedVideoPlayer
              uri={item.videoUri}
              posterUri={item.videoThumbnailUri}
              playing={isVisible}
              width={contentWidth}
              height={Math.round(contentWidth * (5 / 4))}
              onPress={() => onPressCatch?.(item)}
            />
          </View>
        ) : carouselPhotos.length >= 2 && carouselPhotos.length <= 4 ? (
          // X-style photo grid. 16:9 container width; 2-photo split is
          // side-by-side, 3-photo is left-large + 2-stacked, 4-photo is
          // 2×2. Tap any tile to open the viewer at that index. The 2px
          // gaps come from the parent's gap prop on Android/iOS RN ≥0.71.
          <View style={{
            marginTop: 8,
            borderRadius: 0,
            overflow: 'hidden',
            width: contentWidth,
            height: Math.round(contentWidth * (9 / 16)),
            flexDirection: 'row',
            gap: 2,
            backgroundColor: colors.surfaceAlt,
          }}>
            {/* 2 photos: each takes flex 1, full height. */}
            {carouselPhotos.length === 2 ? (
              <>
                <PhotoGridTile uri={carouselPhotos[0]} onPress={() => setViewerIndex(0)} id={`${item.id}-0`} />
                <PhotoGridTile uri={carouselPhotos[1]} onPress={() => setViewerIndex(1)} id={`${item.id}-1`} />
              </>
            ) : carouselPhotos.length === 3 ? (
              <>
                {/* Left column: 1 tile full height. */}
                <PhotoGridTile uri={carouselPhotos[0]} onPress={() => setViewerIndex(0)} id={`${item.id}-0`} />
                {/* Right column: 2 tiles stacked. */}
                <View style={{ flex: 1, gap: 2 }}>
                  <PhotoGridTile uri={carouselPhotos[1]} onPress={() => setViewerIndex(1)} id={`${item.id}-1`} />
                  <PhotoGridTile uri={carouselPhotos[2]} onPress={() => setViewerIndex(2)} id={`${item.id}-2`} />
                </View>
              </>
            ) : (
              // 4 photos: 2×2 grid (two columns, each with two stacked tiles).
              <>
                <View style={{ flex: 1, gap: 2 }}>
                  <PhotoGridTile uri={carouselPhotos[0]} onPress={() => setViewerIndex(0)} id={`${item.id}-0`} />
                  <PhotoGridTile uri={carouselPhotos[2]} onPress={() => setViewerIndex(2)} id={`${item.id}-2`} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <PhotoGridTile uri={carouselPhotos[1]} onPress={() => setViewerIndex(1)} id={`${item.id}-1`} />
                  <PhotoGridTile uri={carouselPhotos[3]} onPress={() => setViewerIndex(3)} id={`${item.id}-3`} />
                </View>
              </>
            )}
          </View>
        ) : carouselPhotos.length >= 5 ? (
          // X-style media block: rounded 18px corners, clipped, no edge-to-edge
          // bleed. The carousel pages the content column width (not the screen
          // width) so the photo sits inside the right column. marginTop pads
          // off the caption above.
          <View style={{ marginTop: 8, overflow: 'hidden' }}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={160}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, contentWidth));
                if (idx !== currentPhotoIdx) setCurrentPhotoIdx(idx);
              }}
            >
              {/* Page 0 — primary photo with double-tap-to-like overlay. */}
              <View style={{ width: contentWidth }}>
                <Pressable onPress={handlePhotoPress}>
                  <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
                    <Image
                      source={{ uri: (() => {
                        const sized = getImageVariant(item.photoUri, ImageSize.feed) ?? item.photoUri ?? '';
                        if (imageRetryNonce === 0 || !sized) return sized;
                        // Query param, not fragment: expo-image's underlying
                        // native cache (SDWebImage / Glide) strips URL
                        // fragments before generating the cache key, so
                        // `foo.jpg#r=1` collides with `foo.jpg` and the
                        // retry would silently serve the cached failure.
                        const sep = sized.includes('?') ? '&' : '?';
                        return `${sized}${sep}r=${imageRetryNonce}`;
                      })() }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={250}
                      recyclingKey={item.id}
                      onError={(e) => setImageError(e?.error ?? 'unknown')}
                    />
                    {/* Double-tap heart + bookmark — kept on the primary page only. */}
                    <Animated.Text
                      style={{
                        position: 'absolute', alignSelf: 'center', top: '30%',
                        fontSize: 90, pointerEvents: 'none',
                        opacity: heartOpacity,
                        transform: [{ scale: heartScale }, { translateY: heartY }],
                      }}
                    >
                      ❤️
                    </Animated.Text>
                    <Animated.Text
                      style={{
                        position: 'absolute', alignSelf: 'center', top: '30%',
                        fontSize: 90, pointerEvents: 'none',
                        opacity: bookmarkOpacity,
                      }}
                    >
                      🔖
                    </Animated.Text>
                  </View>
                </Pressable>
              </View>
              {/* Pages 1..N — extra photos, tap to zoom. No double-tap; viewer
                  handles the fullscreen swipe/zoom itself. */}
              {(item.extraPhotoUris ?? []).map((uri, i) => (
                // +1 offset: index 0 is the primary photo, extras occupy 1..N.
                <Pressable
                  key={`extra-${i}`}
                  onPress={() => setViewerIndex(i + 1)}
                  style={{ width: contentWidth }}
                >
                  <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
                    <Image
                      source={{ uri: getImageVariant(uri, ImageSize.feed) ?? uri }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={250}
                      recyclingKey={`${item.id}-extra-${i}`}
                    />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            {/* Dots indicator — only when there's more than one page. */}
            <View
              style={{
                position: 'absolute',
                bottom: 10,
                left: 0,
                right: 0,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 5,
              }}
              pointerEvents="none"
            >
              {carouselPhotos.map((_, i) => {
                const active = i === currentPhotoIdx;
                return (
                  <View
                    key={i}
                    style={{
                      width: active ? 16 : 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: active ? '#fff' : 'rgba(255,255,255,0.55)',
                    }}
                  />
                );
              })}
            </View>
            {/* Page counter chip (top-right) — quick at-a-glance "2/4". */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                backgroundColor: 'rgba(0,0,0,0.55)',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Manrope_700Bold' }}>
                {currentPhotoIdx + 1}/{carouselPhotos.length}
              </Text>
            </View>
          </View>
        ) : item.photoUri ? (
          // Single-photo case — same X-style rounded media block as the
          // carousel branch. marginTop pads off the caption above; overflow
          // hidden clips the image content to the 18px corners.
          <Pressable onPress={handlePhotoPress} style={{ marginTop: 8, overflow: 'hidden' }}>
            <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
              {imageError || photoLooksLocal ? (
                // Fallback for unreachable URIs (failed upload, expired URL, etc.).
                // Without this the surfaceAlt background would just show as a giant
                // blank rectangle and the user would have no idea what went wrong.
                <View style={{
                  flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingHorizontal: 24,
                }}>
                  <Ionicons name="fish-outline" size={48} color={colors.textMuted} />
                  <Text style={{ ...typography.caption, color: colors.textMuted, textAlign: 'center' }}>
                    {photoLooksLocal
                      ? 'Снимката още не е качена в облака.'
                      : 'Снимката не е достъпна.'}
                  </Text>
                  {/* Show the start of the URL — usually identifies the hostname
                      so you can tell at a glance whether it's a Firebase Storage
                      URL, a Cloudinary URL, or something else weird. */}
                  {item.photoUri && !photoLooksLocal && __DEV__ ? (
                    // Dev-only path display so we can debug image-load failures
                    // without polluting the production UX.
                    <Text
                      style={{ ...typography.small, color: colors.textMuted, fontSize: 10, opacity: 0.7, textAlign: 'center' }}
                      numberOfLines={3}
                    >
                      {(() => {
                        const m = item.photoUri.match(/\/o\/([^?]+)/);
                        const path = m ? decodeURIComponent(m[1]) : item.photoUri;
                        return path.slice(0, 140);
                      })()}
                    </Text>
                  ) : null}
                  {imageError && !photoLooksLocal ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <Pressable
                        onPress={() => setImageRetryNonce((n) => n + 1)}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 6,
                          borderRadius: 14,
                          backgroundColor: colors.primarySurface,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="refresh" size={12} color={colors.primary} />
                        <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 12 }}>
                          Опитай отново
                        </Text>
                      </Pressable>
                      {item.photoUri ? (
                        <Pressable
                          onPress={() => {
                            // Open the URL in the system browser — quickest way
                            // to tell whether the URL itself is broken vs an
                            // expo-image / native-fetch issue.
                            void Linking.openURL(item.photoUri!);
                          }}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 6,
                            borderRadius: 14,
                            backgroundColor: colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: colors.border,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          hitSlop={8}
                        >
                          <Ionicons name="open-outline" size={12} color={colors.text} />
                          <Text style={{ ...typography.caption, color: colors.text, fontWeight: '700', fontSize: 12 }}>
                            Виж в браузър
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : (
                <Image
                  // Bump the source URI with a no-op cache-bust query string when
                  // the user taps retry, so expo-image refetches instead of
                  // serving the cached failed response. Request the 800px
                  // variant — covers full-width feed renders without paying
                  // 1200×1200 bandwidth costs.
                  source={{ uri: (() => {
                    const sized = getImageVariant(item.photoUri, ImageSize.feed) ?? item.photoUri ?? '';
                    if (imageRetryNonce === 0 || !sized) return sized;
                    // Query param (not fragment) — native image caches strip
                    // fragments before keying, so a `#r=N` retry collides
                    // with the cached failed response.
                    const sep = sized.includes('?') ? '&' : '?';
                    return `${sized}${sep}r=${imageRetryNonce}`;
                  })() }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={250}
                  recyclingKey={item.id}
                  onError={(e) => {
                    const message = e?.error ?? 'unknown';
                    if (__DEV__) {
                      // eslint-disable-next-line no-console
                      console.warn('[FeedPost] image failed to load', { catchId: item.id, photoUri: item.photoUri, error: message });
                    }
                    setImageError(message);
                  }}
                />
              )}
              {/* Floating double-tap heart */}
              <Animated.Text
                style={{
                  position: 'absolute', alignSelf: 'center', top: '30%',
                  fontSize: 90, pointerEvents: 'none',
                  opacity: heartOpacity,
                  transform: [{ scale: heartScale }, { translateY: heartY }],
                }}
              >
                ❤️
              </Animated.Text>
              {/* Floating double-tap bookmark */}
              <Animated.Text
                style={{
                  position: 'absolute', alignSelf: 'center', top: '30%',
                  fontSize: 90, pointerEvents: 'none',
                  opacity: bookmarkOpacity,
                }}
              >
                🔖
              </Animated.Text>
            </View>
          </Pressable>
        ) : (
          /* X-style "text-only" post: no photo, no banner. The species +
              weight line above already carries the content. Nothing to
              render here — keeps text-only posts compact. */
          null
        )}

        {/* ── Species tag pill — FishAngler's signature element: the catch
            summary as a navy pill right under the photo. Text-only posts
            keep it too (it's the only species surface then). */}
        {captionBody ? (
          <View style={styles.speciesPill}>
            <Ionicons name="fish" size={13} color={colors.onNavy} />
            <Text style={styles.speciesPillText} numberOfLines={1}>{captionBody}</Text>
          </View>
        ) : null}

        {/* Caption — the user's own words, under the species tag. Hashtags
            and @mentions stay tappable inside RichText. */}
        {item.notes ? (
          <View style={[styles.padded, { marginTop: captionBody ? 8 : 10 }]}>
            <RichText
              text={item.notes}
              style={{ color: colors.text, fontSize: 15, lineHeight: 20 }}
              linkStyle={{ color: colors.primary }}
              numberOfLines={commentsOpen ? undefined : 6}
              onPressHashtag={onPressHashtag}
              onPressMention={onPressMention}
            />
          </View>
        ) : null}

        {/* Lazy-mount: ImageViewer constructs 5 Animated.Values + a PanResponder
            on mount. Without this guard every FeedPost in the list paid for a
            full-screen image viewer the user may never open. */}
        {viewerIndex !== null && carouselPhotos.length > 0 ? (
          <ImageViewer
            uris={carouselPhotos}
            initialIndex={viewerIndex}
            visible
            onClose={() => setViewerIndex(null)}
          />
        ) : null}

        {/* Lazy-mount: the share picker subscribes to Firestore and mounts a
            FlatList on open. Rendering one per FeedPost preemptively meant N
            instances in memory, dragging feed scroll perf into the floor. */}
        {shareToFriendOpen && (
          <SharePickerModal
            visible
            onClose={() => setShareToFriendOpen(false)}
            sharedRef={buildCatchSharedRef(item)}
          />
        )}

        {socialEnabled ? (
          <>
            {/* ── Reaction picker (glass pill) — shared component. See
                src/components/ReactionPicker.tsx for the polish rationale
                (selection haptic, bigger labels, auto-close on idle). ── */}
            <ReactionPicker
              visible={showPicker}
              myReaction={social.myReaction}
              onPick={(type) => { closePicker(); social.onPickReaction(type); }}
              onAutoClose={closePicker}
            />

            {/* ── Action bar — X (Twitter) style ──
                Five cells spread across the content column: reply, repost,
                like, send-to-friend, bookmark/share. Each shows an outline
                icon with its count inline (count omitted when zero). The
                icons are smaller (18px) than the old Instagram-style 24-26px
                so they read as text-like rather than dominant UI. */}
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
                {social.commentCount > 0 ? (
                  <Text style={styles.actionCount}>{social.commentCount}</Text>
                ) : null}
              </Pressable>

              {/* Quote-reshare within the app (new post quoting this one).
                  When the host screen doesn't support reshare (rare — most
                  call sites pass it), the cell is omitted so the row stays
                  visually balanced. */}
              {onReshare ? (
                <Pressable
                  onPress={() => onReshare(item)}
                  hitSlop={8}
                  android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
                  accessibilityRole="button"
                  accessibilityLabel="Сподели в лентата"
                  style={styles.actionCell}
                >
                  <Ionicons name="repeat-outline" size={20} color={colors.textMuted} />
                </Pressable>
              ) : null}

              {/* Like — taps the current reaction off, long-press opens the
                  multi-reaction picker. Count is the total likes (heart +
                  fire + trophy + …). The active reaction emoji replaces the
                  outline heart when set; X uses a red filled heart, we honour
                  the user's chosen reaction instead since the app's identity
                  is multi-reactions. */}
              {/* Heart icon (toggle / change reaction) — long-press opens the
                  reaction picker, single-tap toggles or re-applies. */}
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  animateReaction();
                  if (social.myReaction) social.onPickReaction(social.myReaction);
                  else openPicker();
                }}
                onLongPress={openPicker}
                disabled={social.likeBusy}
                hitSlop={8}
                delayLongPress={300}
                android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
                accessibilityRole="button"
                accessibilityLabel={social.myReaction ? 'Промени реакцията' : 'Хареса'}
                accessibilityState={{ selected: !!social.myReaction }}
                style={[styles.actionCell, social.likeBusy && { opacity: 0.5 }]}
              >
                <Animated.View style={{ transform: [{ scale: reactionScale }] }}>
                  {social.myReaction ? (
                    <Text style={{ fontSize: 18 }}>{REACTIONS[social.myReaction].emoji}</Text>
                  ) : (
                    <Ionicons name="heart-outline" size={18} color={colors.textMuted} />
                  )}
                </Animated.View>
              </Pressable>
              {/* Like count — separate tap target so tapping the number
                  opens the likers sheet (who reacted) without firing the
                  reaction toggle on the heart. The previous unified cell
                  meant users had no way to see who liked a post. */}
              {social.likeCount > 0 ? (
                <Pressable
                  onPress={social.openLikers}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Виж кой е харесал"
                  style={{ paddingVertical: 4, paddingHorizontal: 4, marginRight: 2 }}
                >
                  <Text
                    style={[
                      styles.actionCount,
                      social.myReaction ? { color: colors.text, fontWeight: '600' } : null,
                    ]}
                  >
                    {social.likeCount}
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

              {/* Bookmark — last cell; toggles saved state. Replaces the
                  old hard-right alignment so the row distributes evenly. */}
              <Pressable
                onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); social.onToggleSave(); }}
                disabled={social.saveBusy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={social.saved ? 'Премахни от запазени' : 'Запази'}
                accessibilityState={{ selected: social.saved }}
                style={styles.actionCell}
              >
                {social.saveBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons
                    name={social.saved ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={social.saved ? colors.primary : colors.textMuted}
                  />
                )}
              </Pressable>
            </View>

            {/* ── Below action bar ──
                X-style trims the post foot to just notes (when present) and
                the "view comments" affordance. The species line, like
                count, and location chip have already rendered above the
                photo (text-first layout), so they don't reappear here. */}
            <View style={styles.metaWrap}>
              {/* Notes already rendered above the photo (X text-first
                  layout). Below the photo only carries auxiliary actions:
                  translation prompt, view-all-comments link. */}
              {item.notes && looksNonBulgarian(item.notes) ? (
                <Pressable onPress={() => void openTranslation(item.notes!)} hitSlop={6} style={{ marginTop: 2 }}>
                  <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>
                    Виж превод
                  </Text>
                </Pressable>
              ) : null}

              {/* "View all comments" uses the denormalized commentCount —
                  it's accurate without us subscribing to the comments
                  subcollection on every visible card. */}
              {social.commentCount > 0 && !commentsOpen && (
                <Pressable onPress={() => setCommentsOpen(true)} style={{ marginTop: 4 }}>
                  <Text style={{ fontSize: 13, color: colors.textMuted }}>
                    Виж всички {social.commentCount} {social.commentCount === 1 ? 'коментар' : 'коментара'}
                  </Text>
                </Pressable>
              )}

              {/* Quick-reply inline composer — single-tap path to "drop a
                  comment without opening the full thread." Mirrors X's
                  "Post your reply" affordance. We don't auto-focus the
                  input (would steal keyboard from the user scrolling past)
                  but the whole row is a single tap target that lands the
                  cursor + opens the comments panel atomically.
                  Visible only when:
                    - social is enabled (we have someone to send to)
                    - user is signed in (myUid present)
                    - comments are NOT already open (full composer takes over) */}
              {socialEnabled && myUid && !commentsOpen ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 8,
                    paddingTop: 8,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  }}
                >
                  <Pressable
                    onPress={() => {
                      setQuickReplyFocused(true);
                      setCommentsOpen(true);
                    }}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      backgroundColor: colors.background,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Напиши отговор"
                  >
                    <Text style={{ fontSize: 13, color: colors.textMuted }}>
                      Отговори на {displayName}…
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {/* ── Inline comments section ── */}
            {commentsOpen && (
              <View style={styles.commentsWrap}>
                {social.allComments.map((c) => {
                  const isReply = !!c.replyToId;
                  const isMyComment = myUid === c.authorUid;
                  const canDelete = isMyComment || isMine;
                  const isEditing = social.editingComment?.id === c.id;

                  return (
                    <View key={c.id} style={[styles.commentRow, isReply && { marginLeft: spacing.xl }]}>
                      {isReply && (
                        <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 2, fontSize: 11 }}>
                          ↩ отговор на {c.replyToName}
                        </Text>
                      )}
                      {isEditing ? (
                        <View style={{ gap: spacing.xs }}>
                          <TextInput
                            value={social.editingComment!.text}
                            onChangeText={(t) => social.setEditingComment({ id: c.id, text: t })}
                            style={[styles.input, { flex: undefined }]}
                            autoFocus multiline maxLength={2000} editable={!social.editBusy}
                          />
                          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                            <Pressable onPress={social.onSaveEdit} disabled={social.editBusy || !social.editingComment!.text.trim()} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              {social.editBusy
                                ? <ActivityIndicator size="small" color={colors.primary} />
                                : <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700' }}>Запази</Text>
                            </Pressable>
                            <Pressable onPress={() => social.setEditingComment(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
                              <Text style={{ ...typography.caption, color: colors.textMuted }}>Отказ</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                          {/* Small avatar 22×22 */}
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
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Text style={styles.commentAuthor}>{c.authorName}</Text>
                              {c.editedAt ? (
                                <Text style={{ color: colors.textMuted, fontSize: 10 }}>(редактиран)</Text>
                              ) : c.createdAt ? (
                                <Text style={{ color: colors.textMuted, fontSize: 10 }}>{formatTimeAgo(c.createdAt)}</Text>
                              ) : null}
                            </View>
                            <Text style={styles.commentText}>{c.text}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.sm, paddingTop: 2 }}>
                            {/* Skip the like button on optimistic placeholders
                                (id starts with "temp-") — the comment doc
                                doesn't exist yet, so a like write would 404. */}
                            {myUid && !c.id.startsWith('temp-') && (
                              <CommentLikeButton
                                kind="catch"
                                parentId={item.id}
                                commentId={c.id}
                                myUid={myUid}
                                myDisplayName={myDisplayName}
                                initialCount={c.likeCount ?? 0}
                              />
                            )}
                            {myUid && (
                              <Pressable onPress={() => social.setReplyingTo({ id: c.id, name: c.authorName })} hitSlop={8}>
                                <Text style={{ color: colors.primary, fontSize: 11 }}>Отговори</Text>
                              </Pressable>
                            )}
                            {isMyComment && (
                              <Pressable onPress={() => social.setEditingComment({ id: c.id, text: c.text })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Редактирай коментара">
                                <Ionicons name="pencil-outline" size={13} color={colors.textMuted} />
                              </Pressable>
                            )}
                            {canDelete && (
                              <Pressable onPress={() => social.onDeleteComment(c.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Изтрий коментара">
                                <Ionicons name="trash-outline" size={13} color={colors.danger} />
                              </Pressable>
                            )}
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}

                {social.replyingTo && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySurface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs, gap: spacing.sm }}>
                    <Ionicons name="return-down-forward-outline" size={14} color={colors.primary} />
                    <Text style={{ ...typography.caption, color: colors.primary, flex: 1 }}>Отговор на {social.replyingTo.name}</Text>
                    <Pressable onPress={() => social.setReplyingTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Откажи отговора">
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                )}

                <View style={styles.composer}>
                  <ThemedTextInput
                    style={styles.input}
                    placeholder={social.replyingTo ? `Отговор на ${social.replyingTo.name}…` : 'Коментар…'}
                    placeholderTextColor={colors.textMuted}
                    value={social.draft}
                    onChangeText={social.setDraft}
                    maxLength={2000}
                    editable={!social.sendBusy}
                    autoFocus={quickReplyFocused}
                    onBlur={() => setQuickReplyFocused(false)}
                  />
                  <Pressable onPress={social.onSendComment} disabled={social.sendBusy || !social.draft.trim()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Изпрати коментар">
                    {social.sendBusy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="send" size={22} color={social.draft.trim() ? colors.primary : colors.textMuted} />
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            {/* Timestamp removed — already shown next to the name in the
                header (X-style). Repeating it under every post was visual
                noise once the header carries the time. */}

            {/* ── Likers modal ── Lazy-mounted: the Modal + its FlatList + Animated.View
                + PanResponder reconcile on every FeedPost render when always-mounted,
                even though they're invisible. Gate on likersOpen to skip the entire tree. */}
            {social.likersOpen && (
              <Modal
                visible
                animationType="slide"
                transparent
                onRequestClose={() => { sheetPanY.setValue(0); social.setLikersOpen(false); }}
              >
                <Pressable style={styles.modalBackdrop} onPress={() => { sheetPanY.setValue(0); social.setLikersOpen(false); }}>
                  <Animated.View
                    style={[styles.modalSheet, { transform: [{ translateY: sheetPanY }] }]}
                    {...sheetPanResponder.panHandlers}
                  >
                    {/* Drag handle */}
                    <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
                      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
                    </View>
                    <Text style={styles.modalTitle}>Реакции ({social.likeCount})</Text>
                    {/* Per-type reaction breakdown chips. Shows ALL reaction
                        types that have at least one count, sorted by count
                        desc. Tap a chip to filter the liker list to that
                        reaction; tap "Всички" to clear. Empty state: no
                        chips rendered when nobody has reacted. */}
                    {social.reactionSummary.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
                        <Pressable
                          onPress={() => setLikersFilter(null)}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: colors.border,
                            backgroundColor: likersFilter === null ? colors.primarySurface : 'transparent',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: likersFilter === null ? colors.primary : colors.text }}>
                            Всички {social.likeCount}
                          </Text>
                        </Pressable>
                        {social.reactionSummary.map((r) => {
                          const active = likersFilter === r.type;
                          return (
                            <Pressable
                              key={r.type}
                              onPress={() => setLikersFilter(active ? null : r.type)}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: active ? colors.primary : colors.border,
                                backgroundColor: active ? colors.primarySurface : 'transparent',
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Text style={{ fontSize: 14 }}>{r.emoji}</Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: active ? colors.primary : colors.text }}>
                                {r.count}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                    {social.likersLoading ? (
                      <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                    ) : (
                      <FlatList
                        data={filteredLikers}
                        keyExtractor={(x) => x.uid}
                        style={{ maxHeight: 360 }}
                        renderItem={({ item: liker }) => (
                          <Pressable style={styles.likerRow} onPress={() => { sheetPanY.setValue(0); social.setLikersOpen(false); onPressAuthor(liker.uid, liker.displayName); }}>
                            <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                            <Text style={styles.likerName}>{liker.displayName}</Text>
                            {/* Per-liker reaction emoji — shows which reaction
                                THIS person picked. Hidden when missing
                                (legacy likes with no reaction field default
                                to heart). */}
                            {liker.reaction ? (
                              <Text style={{ fontSize: 18, marginRight: 6 }}>{REACTIONS[liker.reaction].emoji}</Text>
                            ) : (
                              <Text style={{ fontSize: 18, marginRight: 6 }}>❤️</Text>
                            )}
                            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                          </Pressable>
                        )}
                        ListEmptyComponent={<Text style={{ ...typography.body, color: colors.textMuted }}>Няма видими харесвания.</Text>}
                      />
                    )}
                    <Pressable onPress={() => { sheetPanY.setValue(0); social.setLikersOpen(false); }} style={{ marginTop: spacing.md, alignItems: 'center' }}>
                      <Text style={{ ...typography.bodyBold, color: colors.primary }}>Затвори</Text>
                    </Pressable>
                  </Animated.View>
                </Pressable>
              </Modal>
            )}
          </>
        ) : (
          /* Social disabled (preview / no-auth contexts). Tweet body
              (notes + caption + location) is rendered above the photo in
              the text-first layout, so nothing renders here. */
          null
        )}
        </View>{/* /contentCol */}
      </View>
      </Pressable>
  );
}

/** Memoized export — FeedScreen recreates renderItem identity on every viewability
    tick (visibleIds is in its deps), which without memo would re-render every visible
    card N times per scroll. Shallow compare suffices: callback props come from
    useCallback in FeedScreen, item refs come from a useMemo'd data array, and
    avatarMap is one-shot once an avatar resolves. */
export const FeedPost = React.memo(FeedPostInner);
