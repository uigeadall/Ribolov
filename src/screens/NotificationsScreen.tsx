import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyNotifications, markNotificationRead, type SocialNotification } from '../services/socialFeed';

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
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
      opacity: 1,
    },
    rowUnread: { backgroundColor: colors.surfaceAlt },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    body: { flex: 1, minWidth: 0 },
    line: { ...typography.body, color: colors.text },
    preview: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    meta: { ...typography.caption, color: colors.textMuted, marginTop: 6 },
    listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
    sep: { height: spacing.md },
  });
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, configured } = useAuth();

  const [items, setItems] = useState<SocialNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!configured || !user?.uid) {
      setLoading(false);
      return () => {};
    }
    const unsub = subscribeMyNotifications(user.uid, (next) => {
      setItems(next);
      setLoading(false);
    });
    return unsub;
  }, [configured, user?.uid]);

  const onOpen = useCallback(
    async (n: SocialNotification) => {
      if (!user?.uid) return;
      if (!n.read) {
        await markNotificationRead(user.uid, n.id).catch(() => undefined);
      }
      navigation.navigate('UserPublicProfile', { uid: n.actorUid, displayName: n.actorName });
    },
    [navigation, user?.uid]
  );

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
          renderItem={({ item }) => {
            const verb =
              item.type === 'like'
                ? 'хареса твой улов'
                : item.type === 'comment'
                  ? 'коментира твой улов'
                  : 'те последва';
            const icon =
              item.type === 'like'
                ? 'heart'
                : item.type === 'comment'
                  ? 'chatbubble-ellipses-outline'
                  : 'person-add-outline';
            return (
              <Pressable onPress={() => onOpen(item)}>
                <Card style={[styles.row, !item.read && styles.rowUnread]}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={icon} size={20} color={colors.primary} />
                  </View>
                  <View style={styles.body}>
                    <Text style={styles.line}>
                      <Text style={{ fontWeight: '700' }}>{item.actorName}</Text> {verb}.
                    </Text>
                    {item.preview ? <Text style={styles.preview} numberOfLines={3}>{item.preview}</Text> : null}
                    {item.catchId ? (
                      <Text style={styles.meta} numberOfLines={1}>
                        Улов #{item.catchId.slice(0, 8)}…
                      </Text>
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
          }}
        />
      )}
    </Screen>
  );
}
