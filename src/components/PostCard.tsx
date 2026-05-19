import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActionSheetIOS, Alert, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { Post } from '../types';
import { RichText } from './RichText';
import { ImageViewer } from './ImageViewer';
import { subscribePostLike, togglePostLike } from '../services/posts';
import { useAvatarUrl } from '../hooks/useAvatarUrl';

type Props = {
  post: Post;
  myUid?: string;
  myDisplayName: string;
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
  post, myUid, myDisplayName, resolvedAvatarUrl,
  onPressAuthor, onPressHashtag, onPressMention, onDelete, onReshare,
}: Props) {
  const { colors } = useTheme();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount ?? 0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const isMine = Boolean(myUid && post.ownerUid === myUid);
  const ownerName = post.ownerName || 'Рибар';
  const initials = ownerName.slice(0, 1).toUpperCase();
  const displayName = isMine ? myDisplayName : ownerName;

  const avatarUrl = useAvatarUrl({
    ownerUid: post.ownerUid,
    isMine,
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

      {/* Body text with hashtags/mentions */}
      {post.text ? (
        <View style={styles.body}>
          <RichText
            text={post.text}
            style={styles.text}
            linkStyle={styles.link}
            onPressHashtag={onPressHashtag}
            onPressMention={onPressMention}
          />
        </View>
      ) : null}

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
        {onReshare ? (
          <Pressable style={styles.actionBtn} onPress={() => onReshare(post)} hitSlop={8}>
            <Ionicons name="repeat-outline" size={22} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      {post.photoUri ? (
        <ImageViewer uri={post.photoUri} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
      ) : null}
    </View>
  );
}
