import React, { useMemo } from 'react';
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
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { FeedItem } from '../services/catchSync';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { Card } from './Card';
import { REACTIONS, type ReactionType } from '../services/socialFeed';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';

function feedStyles(colors: AppColors) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
    avatar: {
      width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    avatarImg: { width: 40, height: 40 },
    avatarText: { color: colors.white, fontWeight: '700', fontSize: 16 },
    meta: { flex: 1 },
    name: { ...typography.bodyBold, color: colors.text },
    date: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    photoTitle: { ...typography.bodyBold, color: colors.primary, fontSize: 17, lineHeight: 24, marginBottom: spacing.xs },
    species: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
    stats: { ...typography.body, color: colors.textMuted },
    notes: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
    photo: { width: '100%', height: 220, borderRadius: radius.md, marginTop: spacing.sm, backgroundColor: colors.surfaceAlt },
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
};

export function FeedPost({ item, myUid, myDisplayName, myPhotoUrl, resolvedAvatarUrl, socialEnabled, isVisible = true, onPressAuthor }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => feedStyles(colors), [colors]);

  const ownerName = item.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const isMine = Boolean(myUid && item.ownerUid === myUid);

  const avatarUrl = useAvatarUrl({
    ownerUid: item.ownerUid, isMine, myPhotoUrl,
    resolvedAvatarUrl, ownerPhotoUrl: item.ownerPhotoUrl,
  });

  const social = useFeedPostSocial({ item, myUid, myDisplayName, ownerName, socialEnabled, isVisible });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Card>
        <Pressable onPress={() => onPressAuthor(item.ownerUid, ownerName)} style={styles.header}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={[styles.avatarImg, { backgroundColor: colors.primary }]} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
          <View style={styles.meta}>
            <Text style={styles.name}>{isMine ? myDisplayName : ownerName}</Text>
            <Text style={styles.date}>{item.date}{item.location?.name ? ` · ${item.location.name}` : ''}</Text>
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
          <Image source={{ uri: item.photoUri }} style={[styles.photo, { backgroundColor: colors.surfaceAlt }]} contentFit="cover" cachePolicy="memory-disk" transition={200} />
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
              <Pressable onPress={() => social.myReaction ? social.onPickReaction(social.myReaction) : social.setReactionPickerOpen(true)} onLongPress={() => social.setReactionPickerOpen(true)} disabled={social.likeBusy} style={styles.socialBtn} hitSlop={8} delayLongPress={300}>
                {social.likeBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={{ fontSize: 22 }}>{social.myReaction ? REACTIONS[social.myReaction].emoji : '🤍'}</Text>
                )}
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
              <View style={styles.socialBtn}>
                <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
                <Text style={styles.socialLbl}>{social.comments.length}</Text>
              </View>
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

            <View style={styles.commentsWrap}>
              {social.comments.map((c) => {
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
            </View>

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
      </Card>
    </KeyboardAvoidingView>
  );
}
