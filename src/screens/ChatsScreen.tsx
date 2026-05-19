import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
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

function ChatSkeleton({ colors }: { colors: AppColors }) {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border }}>
          <Skeleton width={48} height={48} borderRadius={24} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={14} width="55%" />
            <Skeleton height={11} width="80%" />
          </View>
          <Skeleton height={11} width={32} />
        </View>
      ))}
    </View>
  );
}

function createChatsStyles(colors: AppColors) {
  return StyleSheet.create({
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    searchInput: { flex: 1, color: colors.text, ...typography.body, paddingVertical: 2 },
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
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createChatsStyles(colors), [colors]);
  const navigation = useAppNavigation();
  const { user, configured } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];
  const waveColor = mode === 'dark' ? '#0E1628' : '#FFFFFF';

  const S = useMemo(() => StyleSheet.create({
    hero: { paddingBottom: 28 + 16 },
    heroInner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      gap: 8,
    },
    heroTitle: {
      flex: 1,
      fontSize: 22,
      fontWeight: '700',
      color: '#fff',
      textAlign: 'center',
    },
    backBtn: {
      width: 40, height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center', justifyContent: 'center',
    },
    wave: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      marginTop: -28,
      flex: 1,
      backgroundColor: waveColor,
      overflow: 'hidden',
    },
  }), [waveColor]);

  const { data, loading } = useFirestoreSubscription<ConversationPreview[]>(
    (cb) => {
      if (!user?.uid) { cb([]); return () => {}; }
      return subscribeMyConversations(user.uid, cb);
    },
    [user?.uid],
  );
  const allItems: ConversationPreview[] = data ?? [];
  const items = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((c) => c.otherName.toLowerCase().includes(q) || (c.lastMessage ?? '').toLowerCase().includes(q));
  }, [allItems, searchQuery]);

  const onPressConv = (item: ConversationPreview) => {
    navigation.navigate('ChatDetail', {
      convId: item.convId,
      otherUid: item.otherUid,
      otherName: item.otherName,
    });
  };

  const HeroSection = (
    <View style={S.hero}>
      <LinearGradient colors={heroColors} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <View style={S.heroInner}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={S.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={S.heroTitle}>Съобщения</Text>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false} avoidKeyboard={false}>
        {HeroSection}
        <View style={[S.wave, { flex: 1 }]}>
          <View style={{ padding: spacing.lg, flex: 1 }}>
            <Card>
              <Text style={styles.warn}>Влез в профила си и активирай Firebase, за да ползваш чата.</Text>
            </Card>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} avoidKeyboard={false}>
      {HeroSection}
      <View style={[S.wave, { flex: 1 }]}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Търси разговори…"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {loading ? (
          <ChatSkeleton colors={colors} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.convId}
            removeClippedSubviews={Platform.OS === 'android'}
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
      </View>
    </Screen>
  );
}
