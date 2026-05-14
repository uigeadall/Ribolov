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
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { FeedItem } from '../services/catchSync';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { Card } from './Card';
import { REACTIONS, type ReactionType } from '../services/socialFeed';
import { formatTimeAgo } from '../utils/formatCatchDate';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';
import { ImageViewer } from './ImageViewer';
import * as Haptics from 'expo-haptics';

function feedStyles(colors: AppColors) {
  return StyleSheet.create({
    // Photo-first card: no padding on the card itself, photo is full-bleed
    cardInner: { padding: spacing.lg, paddingTop: spacing.sm },
    // Full-bleed photo at the top
    photoWrap: {
      width: '100%',
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
    },
    // Author overlay at the bottom of the photo
    photoOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
    avatar: {
      width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
    },
    avatarImg: { width: 32, height: 32 },
    avatarText: { color: colors.white, fontFamily: 'DMSans_700Bold', fontSize: 13 },
    meta: { flex: 1 },
    name: { ...typography.bodyBold, color: '#fff', fontSize: 13 },
    date: { ...typography.small, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
    // No-photo fallback banner
    noBanner: {
      backgroundColor: colors.primarySurface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 90,
    },
    noBannerEmoji: { fontSize: 44, opacity: 0.35 },
    noBannerAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
    headerName: { ...typography.bodyBold, color: colors.text },
    headerDate: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    // Content below photo
    photoTitle: { ...typography.bodyBold, color: colors.primary, fontSize: 16, lineHeight: 22, marginBottom: spacing.xs, marginTop: spacing.sm },
    species: { ...typography.h3, color: colors.text, marginBottom: 2 },
    stats: { ...typography.body, color: colors.textMuted },
    notes: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
    loc: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
    locText: { ...typography.caption, color: colors.primary, flex: 1 },
    socialRow: {
      flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
      gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    socialBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    socialLbl: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
    likedLbl: { ...typography.caption, color: colors.danger, fontWeight: '700' },
    commentsWrap: { marginTop: spacing.md },
    commentRow: { marginBottom: spacing.sm },
    commentAuthor: { ...typography.caption, fontWeight: '700', color: colors.text },
    commentText: { ...typography.body, color: colors.text, marginTop: 2 },
    composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    input: {
      flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      paddingHorizontal: spacing.sm, paddingVertical: Platform.OS === 'ios' ? 10 : 6,
      color: colors.text, backgroundColor: colors.background, ...typography.body,
    },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      padding: spacing.lg, maxHeight: '70%', borderWidth: 1, borderColor: colors.border,
    },
    modalTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
    likerRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
      gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
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
  const { colors } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [photoHeight, setPhotoHeight] = useState(260);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const hasExtra = !!(item.bait || (item as Record<string, unknown>).technique || (item as Record<string, unknown>).spotName);

  const ownerName = item.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const isMine = Boolean(myUid && item.ownerUid === myUid);

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

  // Double-tap to like
  const lastTapTimeRef = useRef(0);
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0.4)).current;
  const heartY = useRef(new Animated.Value(0)).current;

  const isRecent = useMemo(() => {
    const ms = Date.parse(item.date);
    return !isNaN(ms) && Date.now() - ms < 86_400_000;
  }, [item.date]);

  function handlePhotoPress() {
    const now = Date.now();
    if (now - lastTapTimeRef.current < 320) {
      lastTapTimeRef.current = 0;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (socialEnabled && !social.myReaction && !social.likeBusy) {
        social.onPickReaction('heart');
        animateReaction();
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Card style={{ padding: 0 }}>
        {/* ── Photo-first: full-bleed image with author overlay ── */}
        {item.photoUri ? (
          <Pressable onPress={handlePhotoPress}>
            <View style={[styles.photoWrap, { height: photoHeight }]}>
              <Image
                source={{ uri: item.photoUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0) setPhotoHeight(Math.round(w * 0.75));
                }}
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
              {/* Author overlay at bottom of photo */}
              <Pressable style={styles.photoOverlay} onPress={() => onPressAuthor(item.ownerUid, ownerName)}>
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
                <View style={styles.meta}>
                  <Text style={styles.name} numberOfLines={1}>{isMine ? myDisplayName : ownerName}</Text>
                  <Text style={styles.date}>{formatTimeAgo(item.date)}{item.location?.name ? ` · ${item.location.name}` : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
          </Pressable>
        ) : (
          // No-photo fallback: species banner with author
          <Pressable onPress={() => onPressAuthor(item.ownerUid, ownerName)} style={styles.noBanner}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.h3, color: colors.primary }} numberOfLines={1}>{item.speciesName}</Text>
              {item.weightKg != null && (
                <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{item.weightKg} кг{item.lengthCm != null ? ` · ${item.lengthCm} см` : ''}</Text>
              )}
              <View style={styles.noBannerAuthorRow}>
                <View style={[styles.avatar, { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border }]}>
                  {avatarUrl
                    ? <Image source={{ uri: avatarUrl }} style={{ width: 22, height: 22 }} contentFit="cover" cachePolicy="memory-disk" />
                    : <Text style={{ ...typography.small, color: colors.white, fontWeight: '700' }}>{initials}</Text>}
                </View>
                <Text style={{ ...typography.caption, color: colors.textMuted }}>{isMine ? myDisplayName : ownerName}</Text>
                <Text style={{ ...typography.caption, color: colors.textMuted }}>· {formatTimeAgo(item.date)}</Text>
              </View>
            </View>
            <Text style={styles.noBannerEmoji}>🐟</Text>
          </Pressable>
        )}
        <ImageViewer uri={viewerUri ?? ''} visible={!!viewerUri} onClose={() => setViewerUri(null)} />

        {/* ── Content below photo ── */}
        <View style={styles.cardInner}>
        {item.photoTitle ? <Text style={styles.photoTitle}>{item.photoTitle}</Text> : null}
        <Pressable onPress={() => onPressCatch?.(item)} disabled={!onPressCatch} hitSlop={4}>
          <Text style={styles.species}>{item.speciesName}</Text>
        </Pressable>
        <Text style={styles.stats}>
          {item.weightKg != null ? `${item.weightKg} кг` : '— кг'}
          {item.lengthCm != null ? ` · ${item.lengthCm} см` : ''}
          {item.released ? ' · пуснат' : ''}
        </Text>
        {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
        {(item.location?.name || (item.location?.latitude != null && item.location.longitude != null)) ? (
          <Pressable
            style={[styles.loc, { backgroundColor: colors.primarySurface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: 'flex-start' }]}
            hitSlop={8}
            onPress={() => {
              const coords = `${item.location!.latitude?.toFixed(6) ?? ''}, ${item.location!.longitude?.toFixed(6) ?? ''}`;
              Clipboard.setString(item.location!.name ?? coords);
              if (Platform.OS === 'android') ToastAndroid.show('Копирано', ToastAndroid.SHORT);
            }}
          >
            <Ionicons name="location" size={13} color={colors.primary} />
            <Text style={[styles.locText, { color: colors.primary, fontWeight: '600', fontSize: 12 }]} numberOfLines={1}>
              {item.location!.name
                ? item.location!.name
                : `${item.location!.latitude!.toFixed(4)}, ${item.location!.longitude!.toFixed(4)}`}
            </Text>
          </Pressable>
        ) : null}

        {hasExtra ? (
          <>
            <Pressable onPress={() => setDetailsOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs }} hitSlop={8}>
              <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.primary} />
              <Text style={{ ...typography.caption, color: colors.primary }}>{detailsOpen ? 'По-малко' : 'Повече детайли'}</Text>
            </Pressable>
            {detailsOpen ? (
              <View style={{ marginTop: spacing.xs, gap: 4 }}>
                {item.bait ? <Text style={{ ...typography.caption, color: colors.textMuted }}>🪱 Примамка: <Text style={{ color: colors.text }}>{item.bait}</Text></Text> : null}
                {(item as Record<string, unknown>).technique ? <Text style={{ ...typography.caption, color: colors.textMuted }}>🎣 Техника: <Text style={{ color: colors.text }}>{String((item as Record<string, unknown>).technique)}</Text></Text> : null}
                {(item as Record<string, unknown>).spotName ? <Text style={{ ...typography.caption, color: colors.textMuted }}>📍 Спот: <Text style={{ color: colors.text }}>{String((item as Record<string, unknown>).spotName)}</Text></Text> : null}
              </View>
            ) : null}
          </>
        ) : null}

        {socialEnabled ? (
          <>
            {/* ── Inline reaction picker ── */}
            {showPicker && (
              <Animated.View
                style={{
                  flexDirection: 'row', justifyContent: 'space-around',
                  backgroundColor: colors.card, borderRadius: radius.xl,
                  borderWidth: 1, borderColor: colors.border,
                  paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
                  marginTop: spacing.sm,
                  opacity: pickerAnim,
                  transform: [{ scale: pickerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
                  shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
                }}
              >
                {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
                  <Pressable
                    key={type}
                    onPress={() => { closePicker(); social.onPickReaction(type); }}
                    style={{
                      alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4,
                      borderRadius: radius.md,
                      backgroundColor: social.myReaction === type ? colors.primarySurface : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>{r.emoji}</Text>
                    <Text style={{ ...typography.caption, color: social.myReaction === type ? colors.primary : colors.textMuted, marginTop: 2, fontSize: 10 }}>{r.label}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={closePicker} style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm }}>
                  <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                </Pressable>
              </Animated.View>
            )}

            <View style={styles.socialRow}>
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  animateReaction();
                  if (social.myReaction) social.onPickReaction(social.myReaction);
                  else openPicker();
                }}
                onLongPress={openPicker}
                disabled={social.likeBusy}
                style={[styles.socialBtn, social.likeBusy && { opacity: 0.5 }]}
                hitSlop={8}
                delayLongPress={300}
              >
                <Animated.View style={{ transform: [{ scale: reactionScale }] }}>
                  {social.myReaction ? (
                    <Text style={{ fontSize: 22 }}>{REACTIONS[social.myReaction].emoji}</Text>
                  ) : (
                    <Ionicons name="heart-outline" size={22} color={colors.textMuted} />
                  )}
                </Animated.View>
              </Pressable>

              <Pressable onPress={social.openLikers} disabled={social.likeCount === 0} hitSlop={8} style={[styles.socialBtn, { gap: 2 }]}>
                {social.reactionSummary.slice(0, 3).map((r) => (
                  <Text key={r.type} style={{ fontSize: 14 }}>{r.emoji}</Text>
                ))}
                {social.likeCount > 0 && (
                  <Text style={[social.myReaction ? styles.likedLbl : styles.socialLbl, { marginLeft: 2 }]}>{social.likeCount}</Text>
                )}
              </Pressable>

              <Pressable style={styles.socialBtn} onPress={() => setCommentsOpen((v) => !v)} hitSlop={8}>
                <Ionicons name={commentsOpen ? 'chatbubble' : 'chatbubble-outline'} size={20} color={commentsOpen ? colors.primary : colors.textMuted} />
                {social.allComments.length > 0 && <Text style={[styles.socialLbl, commentsOpen && { color: colors.primary }]}>{social.allComments.length}</Text>}
              </Pressable>
              <Pressable onPress={social.onShare} style={styles.socialBtn} hitSlop={8}>
                <Ionicons name="share-outline" size={22} color={colors.primary} />
              </Pressable>
              <Pressable onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); social.onToggleSave(); }} disabled={social.saveBusy} style={styles.socialBtn} hitSlop={8}>
                {social.saveBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name={social.saved ? 'bookmark' : 'bookmark-outline'} size={22} color={social.saved ? colors.primary : colors.textMuted} />
                )}
              </Pressable>
              <Pressable onPress={openMoreMenu} style={[styles.socialBtn, { marginLeft: 'auto' }]} hitSlop={8}>
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            {commentsOpen && <View style={styles.commentsWrap}>
              {social.allComments.map((c) => {
                const isReply = !!c.replyToId;
                const isMyComment = myUid === c.authorUid;
                const canDelete = isMyComment || isMine;
                const isEditing = social.editingComment?.id === c.id;

                return (
                  <View key={c.id} style={[styles.commentRow, isReply && { marginLeft: spacing.xl }]}>
                    {isReply && (
                      <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 2 }}>
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
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                        <View style={{
                          width: 26, height: 26, borderRadius: 13,
                          backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.border,
                          alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0,
                        }}>
                          <Text style={{ ...typography.small, color: colors.primary, fontWeight: '700', fontSize: 10 }}>
                            {c.authorName.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={styles.commentAuthor}>{c.authorName}</Text>
                            {c.editedAt ? (
                              <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10 }}>(редактиран)</Text>
                            ) : c.createdAt ? (
                              <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10 }}>{formatTimeAgo(c.createdAt)}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.commentText}>{c.text}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.sm, paddingTop: 2 }}>
                          {myUid && (
                            <Pressable onPress={() => social.setReplyingTo({ id: c.id, name: c.authorName })} hitSlop={8}>
                              <Text style={{ ...typography.caption, color: colors.primary }}>Отговори</Text>
                            </Pressable>
                          )}
                          {isMyComment && (
                            <Pressable onPress={() => social.setEditingComment({ id: c.id, text: c.text })} hitSlop={8}>
                              <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
                            </Pressable>
                          )}
                          {canDelete && (
                            <Pressable onPress={() => social.onDeleteComment(c.id)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={14} color={colors.danger} />
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
            </View>}

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
        ) : null}
        </View>
      </Card>
    </KeyboardAvoidingView>
  );
}
