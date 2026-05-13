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
          <Pressable onPress={() => setViewerUri(item.photoUri!)}>
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
              {/* Author overlay at bottom of photo */}
              <Pressable style={styles.photoOverlay} onPress={() => onPressAuthor(item.ownerUid, ownerName)}>
                <View style={styles.avatar}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <Text style={styles.avatarText}>{initials}</Text>
                  )}
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
        {item.location?.latitude != null && item.location.longitude != null ? (
          <Pressable
            style={styles.loc}
            hitSlop={8}
            onPress={() => {
              const coords = `${item.location!.latitude.toFixed(6)}, ${item.location!.longitude.toFixed(6)}`;
              Clipboard.setString(coords);
              if (Platform.OS === 'android') ToastAndroid.show('Координатите са копирани', ToastAndroid.SHORT);
            }}
          >
            <Ionicons name="location-outline" size={14} color={colors.primary} />
            <Text style={styles.locText} numberOfLines={1}>
              {item.location.latitude.toFixed(4)}, {item.location.longitude.toFixed(4)}
            </Text>
            <Ionicons name="copy-outline" size={12} color={colors.textMuted} />
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
            {/* ── Reaction picker popup ── */}
            <Modal visible={social.reactionPickerOpen} transparent animationType="fade" onRequestClose={() => social.setReactionPickerOpen(false)}>
              <Pressable style={{ flex: 1 }} onPress={() => social.setReactionPickerOpen(false)}>
                <View style={{ position: 'absolute', bottom: 120, left: spacing.lg, right: spacing.lg, backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-around', padding: spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 }}>
                  {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
                    <Pressable key={type} onPress={() => social.onPickReaction(type)} style={{ alignItems: 'center', padding: spacing.sm, borderRadius: radius.md, backgroundColor: social.myReaction === type ? colors.primarySurface : 'transparent' }}>
                      <Text style={{ fontSize: 28 }}>{r.emoji}</Text>
                      <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 10 }}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </Pressable>
            </Modal>

            <View style={styles.socialRow}>
              <Pressable
                onPress={() => {
                  animateReaction();
                  if (social.myReaction) social.onPickReaction(social.myReaction);
                  else social.setReactionPickerOpen(true);
                }}
                onLongPress={() => social.setReactionPickerOpen(true)}
                disabled={social.likeBusy}
                style={[styles.socialBtn, social.likeBusy && { opacity: 0.5 }]}
                hitSlop={8}
                delayLongPress={300}
              >
                <Animated.Text style={{ fontSize: 22, transform: [{ scale: reactionScale }] }}>
                  {social.myReaction ? REACTIONS[social.myReaction].emoji : '🤍'}
                </Animated.Text>
              </Pressable>

              <Pressable onPress={social.openLikers} disabled={social.likeCount === 0} hitSlop={8} style={[styles.socialBtn, { gap: 2 }]}>
                {social.reactionSummary.slice(0, 3).map((r) => (
                  <Text key={r.type} style={{ fontSize: 14 }}>{r.emoji}</Text>
                ))}
                {social.likeCount > 0 && (
                  <Text style={[social.myReaction ? styles.likedLbl : styles.socialLbl, { marginLeft: 2 }]}>{social.likeCount}</Text>
                )}
              </Pressable>

              <Pressable onPress={social.onReportCatch} style={styles.socialBtn} hitSlop={8} accessibilityLabel="Докладвай публикацията">
                <Ionicons name="flag-outline" size={20} color={colors.textMuted} />
              </Pressable>
              <Pressable style={styles.socialBtn} onPress={() => setCommentsOpen((v) => !v)} hitSlop={8}>
                <Ionicons name={commentsOpen ? 'chatbubble' : 'chatbubble-outline'} size={20} color={commentsOpen ? colors.primary : colors.textMuted} />
                {social.allComments.length > 0 && <Text style={[styles.socialLbl, commentsOpen && { color: colors.primary }]}>{social.allComments.length}</Text>}
              </Pressable>
              <Pressable onPress={social.onShare} style={styles.socialBtn} hitSlop={8}>
                <Ionicons name="share-outline" size={22} color={colors.primary} />
              </Pressable>
              <Pressable onPress={social.onToggleSave} disabled={social.saveBusy} style={styles.socialBtn} hitSlop={8}>
                {social.saveBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name={social.saved ? 'bookmark' : 'bookmark-outline'} size={22} color={social.saved ? colors.primary : colors.textMuted} />
                )}
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
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
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

            <Modal visible={social.likersOpen} animationType="slide" transparent onRequestClose={() => social.setLikersOpen(false)}>
              <Pressable style={styles.modalBackdrop} onPress={() => social.setLikersOpen(false)}>
                <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.modalTitle}>Харесали ({social.likeCount})</Text>
                  {social.likersLoading ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                  ) : (
                    <FlatList
                      data={social.likers}
                      keyExtractor={(x) => x.uid}
                      style={{ maxHeight: 360 }}
                      renderItem={({ item: liker }) => (
                        <Pressable style={styles.likerRow} onPress={() => { social.setLikersOpen(false); onPressAuthor(liker.uid, liker.displayName); }}>
                          <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                          <Text style={styles.likerName}>{liker.displayName}</Text>
                          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        </Pressable>
                      )}
                      ListEmptyComponent={<Text style={{ ...typography.body, color: colors.textMuted }}>Няма видими харесвания.</Text>}
                    />
                  )}
                  <Pressable onPress={() => social.setLikersOpen(false)} style={{ marginTop: spacing.md, alignItems: 'center' }}>
                    <Text style={{ ...typography.bodyBold, color: colors.primary }}>Затвори</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          </>
        ) : null}
        </View>
      </Card>
    </KeyboardAvoidingView>
  );
}
