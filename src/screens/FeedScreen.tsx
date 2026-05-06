import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { fetchPublicFeed, getFollowing } from '../services/cloudSync';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';

type FeedScope = 'all' | 'following';

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    heroTitleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    heroTitleBlock: {
      flex: 1,
      minWidth: 0,
    },
    heroIconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 2,
    },
    heroTitle: { ...typography.h1, color: colors.text },
    heroSubtitle: {
      ...typography.body,
      color: colors.textMuted,
      marginTop: spacing.xs,
      lineHeight: 22,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      alignItems: 'center',
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentWrap: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      padding: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 11,
      alignItems: 'center',
      borderRadius: radius.pill,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    segmentBtnActive: { backgroundColor: colors.primary },
    segmentText: { ...typography.caption, fontWeight: '700', color: colors.textMuted },
    segmentTextActive: { color: colors.white },
    listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
    listGap: { height: spacing.lg },
    warnTitle: { ...typography.h3, color: colors.text },
    warnBody: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 22 },
    centerMsg: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  });
}

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, configured } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const heroTopStyle = useMemo(
    () => ({ paddingTop: insets.top + spacing.md }),
    [insets.top]
  );

  const [items, setItems] = useState<FeedItem[]>([]);
  const [scope, setScope] = useState<FeedScope>('all');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setLoading(true);
    setError(null);
    try {
      const [list, followingRows] = await Promise.all([fetchPublicFeed(100), getFollowing(user.uid)]);
      const followingSet = new Set(followingRows.map((f) => f.uid));
      let next = list as FeedItem[];
      if (scope === 'following') {
        next = next.filter((i) => followingSet.has(i.ownerUid));
      }
      setItems(next);
    } catch (e: unknown) {
      setError(formatFirebaseError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured, user, scope]);

  useEffect(() => {
    if (user && configured) load();
  }, [load, user, configured]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const Header = () => (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.primary} />
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => navigation.navigate('Classics')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Класики и награди"
      >
        <Ionicons name="trophy-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('SavedPosts')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Запазени публикации"
      >
        <Ionicons name="bookmark-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Notifications')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Известия"
      >
        <Ionicons name="notifications-outline" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );

  if (!configured) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <View style={[styles.hero, heroTopStyle]}>
          <Header />
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="newspaper-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Лента</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Социалната част изисква Firebase</Text>
            <Text style={styles.warnBody}>
              Отвори файла src/services/firebaseConfig.ts и следвай инструкциите вътре, за да активираш облачната
              синхронизация и социалния feed.
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <View style={[styles.hero, heroTopStyle]}>
          <Header />
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="newspaper-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Лента</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Влез в акаунта си</Text>
            <Text style={styles.warnBody}>За да видиш улова на други риболовци, трябва да си влязъл.</Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      <View style={[styles.hero, heroTopStyle]}>
        <Header />
        <View style={styles.heroTitleRow}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="fish-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroTitle}>Лента</Text>
            <Text style={styles.heroSubtitle}>Споделени улови от риболовната общност</Text>
          </View>
        </View>
      </View>

      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          <Pressable
            onPress={() => setScope('all')}
            style={[styles.segmentBtn, scope === 'all' && styles.segmentBtnActive]}
          >
            <Ionicons
              name="globe-outline"
              size={16}
              color={scope === 'all' ? colors.white : colors.textMuted}
            />
            <Text style={[styles.segmentText, scope === 'all' && styles.segmentTextActive]}>Всички</Text>
          </Pressable>
          <Pressable
            onPress={() => setScope('following')}
            style={[styles.segmentBtn, scope === 'following' && styles.segmentBtnActive]}
          >
            <Ionicons
              name="people-outline"
              size={16}
              color={scope === 'following' ? colors.white : colors.textMuted}
            />
            <Text style={[styles.segmentText, scope === 'following' && styles.segmentTextActive]}>Следвани</Text>
          </Pressable>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerMsg}>Зареждане на улова…</Text>
        </View>
      ) : error && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Неуспешно зареждане</Text>
            <Text style={styles.warnBody}>{error}</Text>
            <Button title="Опитай отново" onPress={() => load()} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="layers-outline"
            title={scope === 'following' ? 'Няма публикации от следваните' : 'Тук още е тихо'}
            subtitle={
              scope === 'following'
                ? 'Следвай риболовци от „Приятели“, за да виждаш само техните публични улове тук.'
                : 'Когато други споделят улов, ще го виждаш тук. Сподели и твоя — Дневник → улов → „Сподели публично".'
            }
          />
          {scope === 'following' ? (
            <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.md }}>
              <Button title="Към приятели" onPress={() => navigation.navigate('Friends')} />
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.listGap} />}
          showsVerticalScrollIndicator={false}
          {...keyboardAwareScrollProps}
          renderItem={({ item }) => (
            <FeedPost
              item={item}
              myUid={user?.uid}
              myDisplayName={user?.displayName ?? user?.email ?? 'Аз'}
              socialEnabled={!!user && !!configured}
              onPressAuthor={(authorUid, name) =>
                navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name })
              }
            />
          )}
        />
      )}
    </Screen>
  );
}
