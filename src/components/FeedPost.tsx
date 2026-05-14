import React, { useMemo, useRef, useState } from 'react';
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
  ToastAndroid,
  Animated,
  PanResponder,
  ActionSheetIOS,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { FeedItem } from '../services/catchSync';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { REACTIONS, type ReactionType } from '../services/socialFeed';
import { formatTimeAgo } from '../utils/formatCatchDate';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';
import { ImageViewer } from './ImageViewer';
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
    avatarText: { color: colors.white, fontFamily: 'DMSans_700Bold', fontSize: 13 },
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
};

export function FeedPost({ item, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl, socialEnabled, isVisible = true, onPressAuthor, onPressCatch }: Props) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

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
      setTimeout(() => {
        if (Date.now() - lastTapTimeRef.current >= 280) {
          setViewerUri(item.photoUri!);
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
    const options = isMine
      ? ['Докладвай', 'Отказ']
      : ['Докладвай', 'Отказ'];
    const cancelIdx = options.length - 1;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIdx, destructiveButtonIndex: 0 },
        (idx) => { if (idx === 0) social.onReportCatch(); }
      );
    } else {
      Alert.alert('Опции', undefined, [
        { text: 'Докладвай', style: 'destructive', onPress: social.onReportCatch },
        { text: 'Отказ', style: 'cancel' },
      ]);
    }
  };

  const animateReaction = () => {
    Animated.sequence([
      Animated.spring(reactionScale, { toValue: 1.35, useNativeDriver: true, speed: 60, bounciness: 14 }),
      Animated.spring(reactionScale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }),
    ]).start();
  };

  // Caption text assembled inline
  const captionBody = [
    item.speciesName,
    item.weightKg != null ? `${item.weightKg} кг` : null,
    item.lengthCm != null ? `${item.lengthCm} см` : null,
    item.released ? 'пуснат' : null,
    item.notes ? `— ${item.notes}` : null,
  ].filter(Boolean).join(' · ').replace(' · —', ' —');

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
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
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
          <Pressable onPress={openMoreMenu} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* ── Photo area ── */}
        {item.photoUri ? (
          <Pressable onPress={handlePhotoPress}>
            <View style={{ width: '100%', height: photoHeight, backgroundColor: colors.surfaceAlt }}>
              <Image
                source={{ uri: item.photoUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
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

        <ImageViewer uri={viewerUri ?? ''} visible={!!viewerUri} onClose={() => setViewerUri(null)} />

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
                <Pressable onPress={() => setCommentsOpen((v) => !v)} hitSlop={8}>
                  <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
                </Pressable>
                {/* Share */}
                <Pressable onPress={social.onShare} hitSlop={8}>
                  <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
                </Pressable>
              </View>
              {/* Bookmark — right side */}
              <Pressable
                onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); social.onToggleSave(); }}
                disabled={social.saveBusy}
                hitSlop={8}
                style={{ marginLeft: 'auto' }}
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

              {/* Location pill (inline, compact) */}
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
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.sm, paddingTop: 2 }}>
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

            {/* ── Likers modal ── */}
            <Modal
              visible={social.likersOpen}
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
          </>
        ) : (
          /* Social disabled: just show caption below the photo */
          <View style={styles.metaWrap}>
            <Text style={[styles.captionWrap]} numberOfLines={3}>
              <Text style={styles.captionName}>{displayName} </Text>
              <Text style={styles.captionText}>{captionBody}</Text>
            </Text>
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
