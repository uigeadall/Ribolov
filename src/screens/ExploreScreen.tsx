import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { fetchPublicFeed, getUserPublicSummary } from '../services/cloudSync';
import { fetchCatchLikeCount } from '../services/socialFeed';
import type { FeedItem } from '../components/FeedPost';

type TrendingCatch = FeedItem & { likeCount: number };

export default function ExploreScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();
  const [trending, setTrending] = useState<TrendingCatch[]>([]);
  const [topAnglers, setTopAnglers] = useState<{ uid: string; name: string; count: number; photo?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    sectionTitle: { ...typography.bodyBold, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.lg },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    catchThumb: { width: '47%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, overflow: 'hidden', position: 'relative' },
    catchOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', padding: spacing.xs },
    catchName: { ...typography.small, color: '#fff', fontWeight: '700' },
    catchLikes: { ...typography.small, color: '#fff' },
    anglerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    anglerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
    anglerName: { ...typography.bodyBold, color: colors.text },
    anglerSub: { ...typography.small, color: colors.textMuted },
  }), [colors]);

  const load = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { items: all } = await fetchPublicFeed(100);
      const recent = all.filter((c) => c.date >= oneWeekAgo);

      // Get like counts for recent catches (batch, max 20)
      const withLikes: TrendingCatch[] = await Promise.all(
        recent.slice(0, 20).map(async (c) => ({
          ...c,
          likeCount: await fetchCatchLikeCount(c.id).catch(() => 0),
        }))
      );
      const sorted = withLikes.sort((a, b) => b.likeCount - a.likeCount).slice(0, 12);
      setTrending(sorted);

      // Top anglers by catch count this week
      const byCatcher = new Map<string, { uid: string; name: string; count: number; photo?: string }>();
      for (const c of recent) {
        const e = byCatcher.get(c.ownerUid);
        if (e) { e.count++; } else { byCatcher.set(c.ownerUid, { uid: c.ownerUid, name: c.ownerName ?? 'Рибар', count: 1, photo: c.ownerPhotoUrl }); }
      }
      const anglers = Array.from(byCatcher.values()).sort((a, b) => b.count - a.count).slice(0, 5);
      setTopAnglers(anglers);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Открий</Text>
      </View>

      {loading && !refreshing ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => 'placeholder'}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={{ padding: spacing.lg }}>
              <Text style={styles.sectionTitle}>🔥 Trending тази седмица</Text>
              <View style={styles.grid}>
                {trending.map((c) => (
                  <Pressable
                    key={c.id}
                    style={styles.catchThumb}
                    onPress={() => navigation.navigate('UserPublicProfile', { uid: c.ownerUid, displayName: c.ownerName })}
                  >
                    {c.photoUri ? (
                      <Image source={{ uri: c.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="fish-outline" size={32} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.catchOverlay}>
                      <Text style={styles.catchName} numberOfLines={1}>{c.speciesName}</Text>
                      <Text style={styles.catchLikes}>❤️ {c.likeCount}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>🎣 Активни рибари тази седмица</Text>
              <Card>
                {topAnglers.map((a, i) => (
                  <Pressable
                    key={a.uid}
                    style={[styles.anglerRow, i < topAnglers.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                    onPress={() => navigation.navigate('UserPublicProfile', { uid: a.uid, displayName: a.name, photoUrlHint: a.photo })}
                  >
                    <Text style={{ ...typography.h3, color: colors.primary, width: 24 }}>{i + 1}</Text>
                    <View style={styles.anglerAvatar}>
                      {a.photo ? (
                        <Image source={{ uri: a.photo }} style={{ width: 44, height: 44, borderRadius: 22 }} contentFit="cover" />
                      ) : (
                        <Text style={{ ...typography.h3, color: colors.primary }}>{a.name.slice(0, 1)}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.anglerName} numberOfLines={1}>{a.name}</Text>
                      <Text style={styles.anglerSub}>{a.count} {a.count === 1 ? 'улов' : 'улова'} тази седмица</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
                {topAnglers.length === 0 ? (
                  <Text style={{ ...typography.body, color: colors.textMuted }}>Все още няма данни.</Text>
                ) : null}
              </Card>
            </View>
          }
          renderItem={() => null}
        />
      )}
    </Screen>
  );
}
