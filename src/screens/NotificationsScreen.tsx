import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyNotifications, markNotificationRead, markAllNotificationsRead, type SocialNotification } from '../services/socialFeed';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAppNavigation } from '../navigation/useAppNavigation';
import * as Haptics from 'expo-haptics';

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
      } else {
        // like / comment — navigate to the current user's own public profile where their catch is visible
        navigation.navigate('UserPublicProfile', { uid: user.uid, displayName: 'Моят профил' });
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
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
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
