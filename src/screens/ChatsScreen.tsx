import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyConversations, subscribeTyping } from '../services/messaging';
import { subscribeUserPresence } from '../services/userProfile';
import { getBlockedUids } from '../services/blockUser';
import { ConversationPreview } from '../types';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAppNavigation } from '../navigation/useAppNavigation';

function formatTime(ms: number): string {
  if (!ms) return '';
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'сега';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} дн`;
  return new Date(ms).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

function ChatSkeleton({ colors }: { colors: AppColors }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Skeleton width={54} height={54} borderRadius={27} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={14} width="50%" />
            <Skeleton height={11} width="75%" />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Skeleton height={10} width={36} />
            <Skeleton height={18} width={18} borderRadius={9} />
          </View>
        </View>
      ))}
    </View>
  );
}

type ChatRowProps = {
  item: ConversationPreview;
  myUid: string;
  styles: ReturnType<typeof createChatsStyles>;
  colors: AppColors;
  onPress: (item: ConversationPreview) => void;
};

/** One conversation row. Subscribes to presence + typing for its own conv so the
    online dot and "пише…" indicator are live. Capped by the list's 50-item cap
    upstream, so at most 100 listeners — well within Firestore's per-client budget. */
function ChatRow({ item, myUid, styles, colors, onPress }: ChatRowProps) {
  const avatarUrl = useAvatarUrl({
    ownerUid: item.otherUid,
    isMine: item.otherUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  const initials = item.otherName.slice(0, 1).toUpperCase();

  const [presence, setPresence] = useState<{ online: boolean }>({ online: false });
  const [otherTyping, setOtherTyping] = useState(false);

  useEffect(() => {
    if (!item.otherUid) return;
    const unsub = subscribeUserPresence(item.otherUid, (p) => setPresence({ online: p.online }));
    return unsub;
  }, [item.otherUid]);

  useEffect(() => {
    if (!item.convId || !myUid) return;
    const unsub = subscribeTyping(item.convId, myUid, (uid) => setOtherTyping(!!uid));
    return unsub;
  }, [item.convId, myUid]);

  const mineLast = item.lastSenderUid === myUid;
  const unread = item.unreadCount > 0;

  const previewNode = otherTyping ? (
    <Text style={styles.previewTyping} numberOfLines={1}>пише…</Text>
  ) : (
    <Text
      style={unread ? styles.previewUnread : styles.preview}
      numberOfLines={1}
    >
      {mineLast && item.lastMessage ? <Text style={styles.previewPrefix}>Ти: </Text> : null}
      {item.lastMessage || 'Без съобщения'}
    </Text>
  );

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.avatarWrap}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}
        {presence.online ? <View style={styles.onlineDot} /> : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{item.otherName}</Text>
        {previewNode}
      </View>

      <View style={styles.right}>
        {item.lastMessageAt ? (
          <Text style={unread ? styles.timeUnread : styles.time}>{formatTime(item.lastMessageAt)}</Text>
        ) : null}
        {unread ? (
          <View style={styles.unreadPill}>
            <Text style={styles.unreadPillText}>
              {item.unreadCount > 99 ? '99+' : item.unreadCount}
            </Text>
          </View>
        ) : (
          <View style={styles.unreadSpacer} />
        )}
      </View>
    </Pressable>
  );
}

function createChatsStyles(colors: AppColors, mode: 'dark' | 'light') {
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

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      gap: spacing.md,
    },
    avatarWrap: {
      width: 54,
      height: 54,
      borderRadius: 27,
      overflow: 'visible',
    },
    avatarImg: { width: 54, height: 54, borderRadius: 27 },
    avatarFallback: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatarText: { color: colors.primary, fontWeight: '700', fontSize: 22 },
    onlineDot: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: '#2ECC71',
      borderWidth: 2.5,
      borderColor: mode === 'dark' ? colors.background : '#FFFFFF',
    },

    body: { flex: 1, justifyContent: 'center', gap: 3 },
    name: { ...typography.h3, color: colors.text, fontSize: 16 },
    preview: { ...typography.body, color: colors.textMuted, fontSize: 14 },
    previewUnread: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    previewPrefix: { color: colors.textMuted, fontWeight: '600' },
    previewTyping: { ...typography.body, color: colors.primary, fontStyle: 'italic', fontSize: 14 },

    right: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, minWidth: 44 },
    time: { ...typography.small, color: colors.textMuted, fontSize: 12 },
    timeUnread: { ...typography.small, color: colors.primary, fontWeight: '700', fontSize: 12 },
    unreadPill: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
    },
    unreadPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    unreadSpacer: { width: 22, height: 22 },

    warn: { ...typography.body, color: colors.textMuted },

    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing.lg + 54 + spacing.md,
    },

    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.xl + spacing.md,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
  });
}

export default function ChatsScreen() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createChatsStyles(colors, mode), [colors, mode]);
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

  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.uid) { setBlockedUids(new Set()); return; }
    let cancelled = false;
    getBlockedUids(user.uid).then((set) => { if (!cancelled) setBlockedUids(set); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  const items = useMemo(() => {
    const visible = blockedUids.size > 0
      ? allItems.filter((c) => !blockedUids.has(c.otherUid))
      : allItems;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((c) => c.otherName.toLowerCase().includes(q) || (c.lastMessage ?? '').toLowerCase().includes(q));
  }, [allItems, searchQuery, blockedUids]);

  const onPressConv = (item: ConversationPreview) => {
    navigation.navigate('ChatDetail', {
      convId: item.convId,
      otherUid: item.otherUid,
      otherName: item.otherName,
    });
  };

  const onCompose = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('Friends');
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
            <Text style={styles.warn}>Влез в профила си и активирай Firebase, за да ползваш чата.</Text>
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
            contentContainerStyle={items.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { paddingBottom: 100 }}
            ListEmptyComponent={
              <View style={{ paddingHorizontal: spacing.xl }}>
                <EmptyState
                  icon="chatbubbles-outline"
                  title="Все още няма разговори"
                  subtitle="Открий приятели и започни първия си разговор."
                />
              </View>
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => (
              <ChatRow item={item} myUid={user.uid} styles={styles} colors={colors} onPress={onPressConv} />
            )}
          />
        )}

        <Pressable
          onPress={onCompose}
          style={styles.fab}
          accessibilityRole="button"
          accessibilityLabel="Нов разговор"
        >
          <Ionicons name="create-outline" size={26} color="#fff" />
        </Pressable>
      </View>
    </Screen>
  );
}
