import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyConversations } from '../services/messaging';
import { ConversationPreview } from '../types';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAppNavigation } from '../navigation/useAppNavigation';

function formatTime(ms: number): string {
  if (!ms) return '';
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'Сега';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  return new Date(ms).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

function createChatsStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    title: { ...typography.h2, color: colors.text },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatarImg: { width: 48, height: 48, borderRadius: 24 },
    avatarText: { color: colors.primary, fontWeight: '700', fontSize: 20 },
    name: { ...typography.h3, color: colors.text },
    preview: { ...typography.body, color: colors.textMuted, marginTop: 2 },
    previewUnread: { ...typography.bodyBold, color: colors.text, marginTop: 2 },
    warn: { ...typography.body, color: colors.textMuted },
    timeText: { ...typography.small, color: colors.textMuted },
    unreadDot: {
      width: 10, height: 10, borderRadius: 5,
      backgroundColor: colors.primary, marginTop: 2,
    },
  });
}

type ChatRowProps = {
  item: ConversationPreview;
  myUid: string;
  styles: ReturnType<typeof createChatsStyles>;
  onPress: (item: ConversationPreview) => void;
};

function ChatRow({ item, myUid, styles, onPress }: ChatRowProps) {
  const avatarUrl = useAvatarUrl({
    ownerUid: item.otherUid,
    isMine: item.otherUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  const initials = item.otherName.slice(0, 1).toUpperCase();

  return (
    <Pressable onPress={() => onPress(item)}>
      <Card>
        <View style={styles.row}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{item.otherName}</Text>
            <Text
              style={item.unreadCount > 0 ? styles.previewUnread : styles.preview}
              numberOfLines={1}
            >
              {item.lastMessage || 'Без съобщения'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {item.lastMessageAt ? (
              <Text style={styles.timeText}>{formatTime(item.lastMessageAt)}</Text>
            ) : null}
            {item.unreadCount > 0 ? (
              <View style={[styles.unreadDot, { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function ChatsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createChatsStyles(colors), [colors]);
  const navigation = useAppNavigation();
  const { user, configured } = useAuth();

  const { data, loading } = useFirestoreSubscription<ConversationPreview[]>(
    (cb) => {
      if (!user?.uid) { cb([]); return () => {}; }
      return subscribeMyConversations(user.uid, cb);
    },
    [user?.uid],
  );
  const items: ConversationPreview[] = data ?? [];

  const onPressConv = (item: ConversationPreview) => {
    navigation.navigate('ChatDetail', {
      convId: item.convId,
      otherUid: item.otherUid,
      otherName: item.otherName,
    });
  };

  function Header({ onBack }: { onBack: () => void }) {
    return (
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Съобщения</Text>
        <View style={{ width: 28 }} />
      </View>
    );
  }

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <Header onBack={() => navigation.goBack()} />
        <View style={{ padding: spacing.lg, flex: 1 }}>
          <Card>
            <Text style={styles.warn}>Влез в профила си и активирай Firebase, за да ползваш чата.</Text>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Header onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.convId}
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title="Няма разговори"
              subtitle="В Приятели отвори чат с някой, с когото се следвате взаимно."
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <ChatRow item={item} myUid={user.uid} styles={styles} onPress={onPressConv} />
          )}
        />
      )}
    </Screen>
  );
}
