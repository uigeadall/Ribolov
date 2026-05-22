import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Clipboard,
  Linking,
  ToastAndroid,
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
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { looksNonBulgarian, openTranslation } from '../utils/captionLanguage';
import type { FeedItem } from '../services/catchSync';
import { RichText } from './RichText';
import { ActionSheet, type ActionSheetOption } from './ActionSheet';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { REACTIONS, type ReactionType } from '../services/socialFeed';
import { formatTimeAgo } from '../utils/formatCatchDate';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';
import { ImageViewer } from './ImageViewer';
import { SharePickerModal, buildCatchSharedRef } from './SharePickerModal';
import { CommentLikeButton } from './CommentLikeButton';
import { getImageVariant, ImageSize } from '../utils/imageVariants';
import * as Haptics from 'expo-haptics';

function feedStyles(colors: AppColors) {
  return StyleSheet.create({
    // Outer wrapper — Instagram-style, no radius, no shadow, full-width
    postWrap: {
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // ── Header ──
    postHeader: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: { width: 32, height: 32 },
    avatarText: { color: colors.white, fontFamily: 'Nunito_700Bold', fontSize: 13 },
    headerMeta: { flex: 1 },
    headerName: { fontWeight: '700', color: colors.text, fontSize: 14 },
    headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
    // ── No-photo fallback banner ──
    noBanner: {
      width: '100%',
      height: 160,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noBannerEmoji: { fontSize: 52, opacity: 0.35 },
    noBannerSpecies: { ...typography.h3, color: colors.primary, marginTop: 8 },
    // ── Action bar ──
    actionBar: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    // ── Below action bar ──
    metaWrap: { paddingHorizontal: 12 },
    likeCountText: { fontWeight: '700', color: colors.text, fontSize: 13 },
    captionWrap: { marginTop: 2 },
    captionName: { fontWeight: '700', color: colors.text, fontSize: 13 },
    captionText: { color: colors.text, fontSize: 13 },
    viewCommentsBtn: { marginTop: 4 },
    viewCommentsText: { color: colors.textMuted, fontSize: 13 },
    timestamp: { color: colors.textMuted, fontSize: 11, marginTop: 4, marginBottom: 8 },
    loc: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    locText: { color: colors.primary, fontWeight: '600', fontSize: 11 },
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
};

function FeedPostInner({ item, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl, socialEnabled, isVisible = true, onPressAuthor, onPressCatch, onDeletePhoto, onRemovePost, onReshare, onPressHashtag, onPressMention }: Props) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [shareToFriendOpen, setShareToFriendOpen] = useState(false);
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

  const social = useFeedPostSocial({ item, myUid, myDisplayName, ownerName, socialEnabled, isVisible });
  const reactionScale = useRef(new Animated.Value(1)).current;
  const pickerAnim = useRef(new Animated.Value(0)).current;

  const showPicker = social.reactionPickerOpen;
  const openPicker = () => {
    social.setReactionPickerOpen(true);
    Animated.spring(pickerAnim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
  };
  const closePicker = () => {
    Animated.timing(pickerAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      social.setReactionPickerOpen(false);
    });
  };

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
          setViewerUri(item.photoUri);
        }
      }, 280);
    }
  }

  const sheetPanY = useRef(new Animated.Value(0)).current;
  const sheetPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: Animated.event([null, { dy: sheetPanY }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80) {
          sheetPanY.setValue(0);
          social.setLikersOpen(false);
        } else {
          Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: false, speed: 20, bounciness: 6 }).start();
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
      ActionSheet.show({
        options: [
          {
            label: 'Докладвай',
            icon: 'flag-outline',
            destructive: true,
            onPress: social.onReportCatch,
          },
        ],
      });
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

  const photoHeight = Math.round(screenWidth * (5 / 4));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.postWrap}>

        {/* ── Post Header ── */}
        <View style={styles.postHeader}>
          {/* Avatar + author info — pressable */}
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
            onPress={() => onPressAuthor(item.ownerUid, displayName)}
          >
            <View style={{ position: 'relative' }}>
              {isRecent && (
                <View style={{
                  position: 'absolute', top: -2.5, left: -2.5,
                  width: 37, height: 37, borderRadius: 18.5,
                  borderWidth: 2.5, borderColor: colors.primary,
                }} />
              )}
              <View style={styles.avatar}>
                {avatarUrl ? (
                  <Image source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
              </View>
            </View>
            <View style={styles.headerMeta}>
              <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {[
                  item.location?.name ?? null,
                  formatTimeAgo(item.date),
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Pressable>
          {/* More (···) button */}
          <Pressable
            onPress={openMoreMenu}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Опции"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* ── Photo area ── */}
        {/* Multi-photo carousel: wraps the existing primary-photo block as page
            0 so its double-tap-to-like + bookmark + error-fallback behavior is
            preserved unchanged. Pages 1..N are `extraPhotoUris` and tap to open
            the full-screen viewer. When there are no extras, scrollEnabled=false
            and the dots row hides — visually identical to the single-photo case. */}
        {item.photoUri && carouselPhotos.length > 1 ? (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={160}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                if (idx !== currentPhotoIdx) setCurrentPhotoIdx(idx);
              }}
            >
              {/* Page 0 — primary photo with double-tap-to-like overlay. */}
              <View style={{ width: screenWidth }}>
                <Pressable onPress={handlePhotoPress}>
                  <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
                    <Image
                      source={{ uri: (() => {
                        const sized = getImageVariant(item.photoUri, ImageSize.feed) ?? item.photoUri;
                        return imageRetryNonce > 0 ? `${sized}#r=${imageRetryNonce}` : sized;
                      })() }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      cachePolicy="memory-disk"
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
                <Pressable
                  key={`extra-${i}`}
                  onPress={() => setViewerUri(uri)}
                  style={{ width: screenWidth }}
                >
                  <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
                    <Image
                      source={{ uri: getImageVariant(uri, ImageSize.feed) ?? uri }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      cachePolicy="memory-disk"
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
              <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Nunito_700Bold' }}>
                {currentPhotoIdx + 1}/{carouselPhotos.length}
              </Text>
            </View>
          </View>
        ) : item.photoUri ? (
          <Pressable onPress={handlePhotoPress}>
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
                    const sized = getImageVariant(item.photoUri, ImageSize.feed) ?? item.photoUri;
                    return imageRetryNonce > 0 ? `${sized}#r=${imageRetryNonce}` : sized;
                  })() }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  cachePolicy="memory-disk"
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
          /* No-photo fallback banner */
          <View style={styles.noBanner}>
            <Text style={styles.noBannerEmoji}>🐟</Text>
            <Text style={styles.noBannerSpecies}>{item.speciesName}</Text>
          </View>
        )}

        {/* Lazy-mount: ImageViewer constructs 5 Animated.Values + a PanResponder
            on mount. Without this guard every FeedPost in the list paid for a
            full-screen image viewer the user may never open. */}
        {viewerUri ? (
          <ImageViewer uri={viewerUri} visible onClose={() => setViewerUri(null)} />
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
            {/* ── Reaction picker (glass pill) — shown between photo and action bar ── */}
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
                {/* Glass rim */}
                <View style={[StyleSheet.absoluteFillObject, {
                  borderRadius: radius.xl, borderWidth: 1,
                  borderColor: mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.82)',
                }]} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }}>
                  {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
                    <Pressable
                      key={type}
                      onPress={() => { closePicker(); social.onPickReaction(type); }}
                      style={{
                        alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4,
                        borderRadius: radius.md,
                        backgroundColor: social.myReaction === type
                          ? (mode === 'dark' ? 'rgba(255,255,255,0.18)' : colors.primarySurface)
                          : 'transparent',
                      }}
                    >
                      <Text style={{ fontSize: 28 }}>{r.emoji}</Text>
                      <Text style={{ ...typography.caption, color: social.myReaction === type ? colors.primary : colors.textMuted, marginTop: 2, fontSize: 10 }}>{r.label}</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={closePicker} style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm }}>
                    <Ionicons name="close-circle" size={22} color={mode === 'dark' ? 'rgba(255,255,255,0.45)' : colors.textMuted} />
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* ── Action bar ── */}
            <View style={styles.actionBar}>
              <View style={styles.actionGroup}>
                {/* Like */}
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
                  style={social.likeBusy ? { opacity: 0.5 } : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={social.myReaction ? 'Промени реакцията' : 'Хареса'}
                  accessibilityState={{ selected: !!social.myReaction }}
                >
                  <Animated.View style={{ transform: [{ scale: reactionScale }] }}>
                    {social.myReaction ? (
                      <Text style={{ fontSize: 26 }}>{REACTIONS[social.myReaction].emoji}</Text>
                    ) : (
                      <Ionicons name="heart-outline" size={26} color={colors.text} />
                    )}
                  </Animated.View>
                </Pressable>
                {/* Comment */}
                <Pressable
                  onPress={() => setCommentsOpen((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Коментари"
                >
                  <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
                </Pressable>
                {/* Quote-reshare within the app (new post quoting this one) */}
                {onReshare ? (
                  <Pressable
                    onPress={() => onReshare(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Сподели в лентата"
                  >
                    <Ionicons name="repeat-outline" size={26} color={colors.text} />
                  </Pressable>
                ) : null}
                {/* Send to friend via DM */}
                <Pressable
                  onPress={() => setShareToFriendOpen(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Изпрати на приятел"
                >
                  <Ionicons name="send-outline" size={24} color={colors.text} />
                </Pressable>
                {/* Share externally */}
                <Pressable
                  onPress={social.onShare}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Сподели външно"
                >
                  <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
                </Pressable>
              </View>
              {/* Bookmark — right side */}
              <Pressable
                onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); social.onToggleSave(); }}
                disabled={social.saveBusy}
                hitSlop={8}
                style={{ marginLeft: 'auto' }}
                accessibilityRole="button"
                accessibilityLabel={social.saved ? 'Премахни от запазени' : 'Запази'}
                accessibilityState={{ selected: social.saved }}
              >
                {social.saveBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name={social.saved ? 'bookmark' : 'bookmark-outline'} size={24} color={colors.text} />
                )}
              </Pressable>
            </View>

            {/* ── Below action bar ── */}
            <View style={styles.metaWrap}>
              {/* Like count */}
              {social.likeCount > 0 && (
                <Pressable onPress={social.openLikers} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {social.reactionSummary.slice(0, 3).map((r) => (
                    <Text key={r.type} style={{ fontSize: 13 }}>{r.emoji}</Text>
                  ))}
                  <Text style={styles.likeCountText}>{social.likeCount} {social.likeCount === 1 ? 'харесване' : 'харесвания'}</Text>
                </Pressable>
              )}

              {/* Caption: bold username + catch info */}
              <Text style={[styles.captionWrap]} numberOfLines={commentsOpen ? undefined : 3}>
                <Text style={styles.captionName}>{displayName} </Text>
                <Text style={styles.captionText}>{captionBody}</Text>
              </Text>

              {/* Notes — rendered separately so #hashtags and @mentions are tappable */}
              {item.notes ? (
                <RichText
                  text={item.notes}
                  style={[styles.captionText, { marginTop: 4 }]}
                  linkStyle={{ color: colors.primary, fontWeight: '600' }}
                  numberOfLines={commentsOpen ? undefined : 3}
                  onPressHashtag={onPressHashtag}
                  onPressMention={onPressMention}
                />
              ) : null}
              {/* "Виж превод" — only when notes look foreign-language. Opens
                  the system translation flow (Google Translate app → Apple
                  Translate → web fallback). See utils/captionLanguage.ts. */}
              {item.notes && looksNonBulgarian(item.notes) ? (
                <Pressable onPress={() => void openTranslation(item.notes!)} hitSlop={6} style={{ marginTop: 4 }}>
                  <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '600' }}>
                    Виж превод
                  </Text>
                </Pressable>
              ) : null}

              {/* Location pill (inline, compact) */}
              {(item.location?.name || (item.location?.latitude != null && item.location.longitude != null)) ? (
                <Pressable
                  style={styles.loc}
                  hitSlop={8}
                  onPress={() => {
                    const coords = `${item.location!.latitude?.toFixed(6) ?? ''}, ${item.location!.longitude?.toFixed(6) ?? ''}`;
                    Clipboard.setString(item.location!.name ?? coords);
                    // Cross-platform confirmation. The previous Android-only
                    // ToastAndroid call left iOS users with no feedback that
                    // the copy actually happened.
                    if (Platform.OS === 'android') {
                      ToastAndroid.show('Копирано', ToastAndroid.SHORT);
                    } else {
                      Toast.show({ type: 'success', text1: 'Копирано', visibilityTime: 1200 });
                    }
                  }}
                >
                  <Ionicons name="location" size={12} color={colors.primary} />
                  <Text style={styles.locText} numberOfLines={1}>
                    {item.location!.name
                      ? item.location!.name
                      : `${item.location!.latitude!.toFixed(4)}, ${item.location!.longitude!.toFixed(4)}`}
                  </Text>
                </Pressable>
              ) : null}

              {/* View all comments tap */}
              {social.allComments.length > 0 && !commentsOpen && (
                <Pressable style={styles.viewCommentsBtn} onPress={() => setCommentsOpen(true)}>
                  <Text style={styles.viewCommentsText}>
                    Виж всички {social.allComments.length} {social.allComments.length === 1 ? 'коментар' : 'коментара'}
                  </Text>
                </Pressable>
              )}
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
                              <Pressable onPress={() => social.setEditingComment({ id: c.id, text: c.text })} hitSlop={8}>
                                <Ionicons name="pencil-outline" size={13} color={colors.textMuted} />
                              </Pressable>
                            )}
                            {canDelete && (
                              <Pressable onPress={() => social.onDeleteComment(c.id)} hitSlop={8}>
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
                    <Pressable onPress={() => social.setReplyingTo(null)} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                )}

                <View style={styles.composer}>
                  <TextInput
                    style={styles.input}
                    placeholder={social.replyingTo ? `Отговор на ${social.replyingTo.name}…` : 'Коментар…'}
                    placeholderTextColor={colors.textMuted}
                    value={social.draft}
                    onChangeText={social.setDraft}
                    maxLength={2000}
                    editable={!social.sendBusy}
                  />
                  <Pressable onPress={social.onSendComment} disabled={social.sendBusy || !social.draft.trim()} hitSlop={8}>
                    {social.sendBusy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="send" size={22} color={social.draft.trim() ? colors.primary : colors.textMuted} />
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            {/* ── Timestamp ── */}
            <View style={{ paddingHorizontal: 12 }}>
              <Text style={styles.timestamp}>{formatTimeAgo(item.date)}</Text>
            </View>

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
                    <Text style={styles.modalTitle}>Харесали ({social.likeCount})</Text>
                    {social.likersLoading ? (
                      <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                    ) : (
                      <FlatList
                        data={social.likers}
                        keyExtractor={(x) => x.uid}
                        style={{ maxHeight: 360 }}
                        renderItem={({ item: liker }) => (
                          <Pressable style={styles.likerRow} onPress={() => { sheetPanY.setValue(0); social.setLikersOpen(false); onPressAuthor(liker.uid, liker.displayName); }}>
                            <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                            <Text style={styles.likerName}>{liker.displayName}</Text>
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
          /* Social disabled: just show caption below the photo */
          <View style={styles.metaWrap}>
            <Text style={[styles.captionWrap]} numberOfLines={3}>
              <Text style={styles.captionName}>{displayName} </Text>
              <Text style={styles.captionText}>{captionBody}</Text>
            </Text>
            {item.notes ? (
              <RichText
                text={item.notes}
                style={[styles.captionText, { marginTop: 4 }]}
                linkStyle={{ color: colors.primary, fontWeight: '600' }}
                numberOfLines={3}
                onPressHashtag={onPressHashtag}
                onPressMention={onPressMention}
              />
            ) : null}
            {(item.location?.name || (item.location?.latitude != null && item.location.longitude != null)) ? (
              <Pressable
                style={styles.loc}
                hitSlop={8}
                onPress={() => {
                  const coords = `${item.location!.latitude?.toFixed(6) ?? ''}, ${item.location!.longitude?.toFixed(6) ?? ''}`;
                  Clipboard.setString(item.location!.name ?? coords);
                  if (Platform.OS === 'android') ToastAndroid.show('Копирано', ToastAndroid.SHORT);
                }}
              >
                <Ionicons name="location" size={12} color={colors.primary} />
                <Text style={styles.locText} numberOfLines={1}>
                  {item.location!.name
                    ? item.location!.name
                    : `${item.location!.latitude!.toFixed(4)}, ${item.location!.longitude!.toFixed(4)}`}
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.timestamp}>{formatTimeAgo(item.date)}</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Memoized export — FeedScreen recreates renderItem identity on every viewability
    tick (visibleIds is in its deps), which without memo would re-render every visible
    card N times per scroll. Shallow compare suffices: callback props come from
    useCallback in FeedScreen, item refs come from a useMemo'd data array, and
    avatarMap is one-shot once an avatar resolves. */
export const FeedPost = React.memo(FeedPostInner);
