import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyNotifications, markNotificationRead, markAllNotificationsRead, type SocialNotification } from '../services/socialFeed';
import { followUser, isFollowingUser } from '../services/social';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAppNavigation } from '../navigation/useAppNavigation';
import * as Haptics from 'expo-haptics';

function formatNotifTime(createdAt: unknown): string {
  if (!createdAt) return '';
  let ms: number | null = null;
  if (typeof createdAt === 'object' && createdAt !== null && 'toMillis' in createdAt) {
    ms = (createdAt as { toMillis: () => number }).toMillis();
  } else if (typeof createdAt === 'number') {
    ms = createdAt;
  }
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Сега';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} д`;
  return new Date(ms).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

function NotifSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border }}>
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={13} width="72%" />
            <Skeleton height={10} width="45%" />
          </View>
          <Skeleton width={8} height={8} borderRadius={4} />
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    markAllText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
      opacity: 1,
    },
    rowUnread: { backgroundColor: colors.surfaceAlt },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatarImg: { width: 40, height: 40 },
    avatarText: { ...typography.bodyBold, color: colors.primary },
    body: { flex: 1, minWidth: 0 },
    line: { ...typography.body, color: colors.text },
    preview: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    meta: { ...typography.caption, color: colors.textMuted, marginTop: 6 },
    listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
    sep: { height: spacing.md },
  });
}

type NotifRowProps = {
  item: SocialNotification;
  myUid: string;
  onOpen: (n: SocialNotification) => void;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
};

function NotifRow({ item, myUid, onOpen, styles, colors }: NotifRowProps) {
  const avatarUrl = useAvatarUrl({
    ownerUid: item.actorUid,
    isMine: item.actorUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  const [followState, setFollowState] = useState<'idle' | 'busy' | 'done'>('idle');

  const verb =
    item.type === 'like'
      ? `реагира ${item.reactionEmoji ?? '❤️'} на твой улов`
      : item.type === 'comment'
        ? 'коментира твой улов'
        : 'те последва';
  const icon =
    item.type === 'like'
      ? 'heart'
      : item.type === 'comment'
        ? 'chatbubble-ellipses-outline'
        : 'person-add-outline';
  const initials = item.actorName.slice(0, 1).toUpperCase();

  const onFollowBack = useCallback(async () => {
    if (followState !== 'idle') return;
    setFollowState('busy');
    try {
      const already = await isFollowingUser(myUid, item.actorUid);
      if (!already) await followUser(myUid, item.actorUid, item.actorName);
      setFollowState('done');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setFollowState('idle');
    }
  }, [followState, myUid, item.actorUid, item.actorName]);

  return (
    <Pressable onPress={() => onOpen(item)}>
      <Card style={[styles.row, !item.read && styles.rowUnread]}>
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.line}>
            <Text style={{ fontWeight: '700' }}>{item.actorName}</Text> {verb}.
          </Text>
          {item.preview ? <Text style={styles.preview} numberOfLines={3}>{item.preview}</Text> : null}
          {item.catchId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <Ionicons name={icon} size={11} color={colors.textMuted} />
              <Text style={styles.meta} numberOfLines={1}>
                Улов #{item.catchId.slice(0, 8)}…
              </Text>
            </View>
          ) : null}
          {item.createdAt ? (
            <Text style={[styles.meta, { marginTop: 4 }]}>{formatNotifTime(item.createdAt)}</Text>
          ) : null}
          {item.type === 'follow' && (
            <Pressable
              onPress={(e) => { e.stopPropagation(); void onFollowBack(); }}
              disabled={followState !== 'idle'}
              style={{
                marginTop: spacing.sm,
                alignSelf: 'flex-start',
                paddingHorizontal: spacing.md,
                paddingVertical: 5,
                borderRadius: 20,
                backgroundColor: followState === 'done' ? colors.primarySurface : colors.primary,
                borderWidth: 1,
                borderColor: followState === 'done' ? colors.border : colors.primary,
                opacity: followState === 'busy' ? 0.6 : 1,
              }}
              hitSlop={8}
            >
              <Text style={{ ...typography.small, fontWeight: '700', color: followState === 'done' ? colors.primary : colors.white }}>
                {followState === 'done' ? '✓ Последван' : 'Последвай'}
              </Text>
            </Pressable>
          )}
        </View>
        {!item.read ? (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 }} />
        ) : (
          <View style={{ width: 8 }} />
        )}
      </Card>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, configured } = useAuth();

  const { data, loading, setData } = useFirestoreSubscription<SocialNotification[]>(
    (cb) => {
      if (!configured || !user?.uid) { cb([]); return () => {}; }
      return subscribeMyNotifications(user.uid, cb);
    },
    [configured, user?.uid],
  );
  const items = data ?? [];
  const unreadCount = items.filter((n) => !n.read).length;

  const onOpen = useCallback(
    (n: SocialNotification) => {
      if (!user?.uid) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!n.read) {
        setData((prev) => prev ? prev.map((item) => item.id === n.id ? { ...item, read: true } : item) : prev);
        markNotificationRead(user.uid, n.id).catch(() => {});
      }
      if (n.type === 'follow') {
        navigation.navigate('UserPublicProfile', { uid: n.actorUid, displayName: n.actorName });
      } else if (n.catchId) {
        // like / comment — go directly to the catch in the logbook tab
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigation.navigate as any)('LogbookTab', {
          screen: 'CatchDetail',
          params: { id: n.catchId },
        });
      } else {
        navigation.navigate('UserPublicProfile', { uid: user.uid, displayName: user.displayName ?? 'Моят профил' });
      }
    },
    [navigation, user?.uid, setData]
  );

  const onMarkAll = useCallback(() => {
    if (!user?.uid || unreadCount === 0) return;
    setData((prev) => prev ? prev.map((n) => ({ ...n, read: true })) : prev);
    markAllNotificationsRead(user.uid).catch(() => {
      Alert.alert('Грешка', 'Неуспешно маркиране.');
    });
  }, [user?.uid, unreadCount, setData]);

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
          <Text style={styles.title}>Известия</Text>
        </View>
        <EmptyState icon="notifications-outline" title="Налични след вход" subtitle="Влез с Firebase акаунт, за да виждаш известия от лентата." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Известия</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={onMarkAll} style={styles.markAllBtn} hitSlop={8}>
            <Ionicons name="checkmark-done-outline" size={18} color={colors.primary} />
            <Text style={styles.markAllText}>Всички прочетени</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <NotifSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="Няма известия"
          subtitle="Когато някой хареса или коментира твой улов, или те последва, ще се появи тук."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <NotifRow
              item={item}
              myUid={user.uid}
              onOpen={onOpen}
              styles={styles}
              colors={colors}
            />
          )}
        />
      )}
    </Screen>
  );
}
