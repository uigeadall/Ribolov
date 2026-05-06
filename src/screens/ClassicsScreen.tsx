import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { FeedPost } from '../components/FeedPost';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import {
  fetchRankedClassicPhotos,
  periodStartIso,
  type ClassicPeriod,
  type RankedClassicPhoto,
} from '../services/classicsContest';

function medalForRank(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
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
    heroTitleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
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
    heroTitleBlock: { flex: 1, minWidth: 0 },
    heroTitle: { ...typography.h1, color: colors.text },
    heroSubtitle: {
      ...typography.body,
      color: colors.textMuted,
      marginTop: spacing.xs,
      lineHeight: 22,
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
    rankRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    rankBadge: {
      minWidth: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rankText: { ...typography.caption, fontWeight: '800', color: colors.text },
    likesLbl: { ...typography.caption, color: colors.textMuted, flex: 1 },
    prizeCardText: { ...typography.body, color: colors.text, lineHeight: 22 },
    warnTitle: { ...typography.h3, color: colors.text },
    warnBody: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 22 },
    centerMsg: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  });
}

export default function ClassicsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, configured } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const heroTopStyle = useMemo(
    () => ({ paddingTop: insets.top + spacing.md }),
    [insets.top]
  );

  const [period, setPeriod] = useState<ClassicPeriod>('week');
  const [rows, setRows] = useState<RankedClassicPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setLoading(true);
    setError(null);
    try {
      const since = periodStartIso(period);
      const next = await fetchRankedClassicPhotos(since);
      setRows(next);
    } catch (e: unknown) {
      setError(formatFirebaseError(e));
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured, user, period]);

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
    </View>
  );

  if (!configured) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <View style={[styles.hero, heroTopStyle]}>
          <Header />
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="images-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Класики</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Нужен е Firebase</Text>
            <Text style={styles.warnBody}>Настрой облака, за да участваш и да гласуваш с лайкове.</Text>
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
              <Ionicons name="images-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Класики</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Влез в акаунта си</Text>
            <Text style={styles.warnBody}>За да виждаш класацията и да харесваш снимки.</Text>
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
            <Ionicons name="trophy-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroTitle}>Класики</Text>
            <Text style={styles.heroSubtitle}>
              Именувани снимки от лентата · гласуване със сърце · топ по лайкове за периода
            </Text>
          </View>
        </View>
      </View>

      <Card style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
        <Text style={styles.prizeCardText}>
          <Text style={{ ...typography.bodyBold, color: colors.text }}>Награди: </Text>
          Победителите за седмицата и за месеца са снимките с най-много харесвания сред публичните постове със снимка за
          съответния период. Конкретните награди (значки в приложението, партньорски подаръци и др.) се обявяват от екипа —
          следи известията и лентата.
        </Text>
      </Card>

      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          <Pressable
            onPress={() => setPeriod('week')}
            style={[styles.segmentBtn, period === 'week' && styles.segmentBtnActive]}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={period === 'week' ? colors.white : colors.textMuted}
            />
            <Text style={[styles.segmentText, period === 'week' && styles.segmentTextActive]}>Седмица</Text>
          </Pressable>
          <Pressable
            onPress={() => setPeriod('month')}
            style={[styles.segmentBtn, period === 'month' && styles.segmentBtnActive]}
          >
            <Ionicons name="calendar-number-outline" size={16} color={period === 'month' ? colors.white : colors.textMuted} />
            <Text style={[styles.segmentText, period === 'month' && styles.segmentTextActive]}>Месец</Text>
          </Pressable>
        </View>
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerMsg}>Броим лайкове и подреждаме…</Text>
        </View>
      ) : error && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Неуспешно зареждане</Text>
            <Text style={styles.warnBody}>{error}</Text>
            <Button title="Опитай отново" onPress={() => load()} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="images-outline"
            title="Още няма класики за периода"
            subtitle="Сподели улов със снимка в лентата и добави заглавие на снимката при записване. Получавай лайкове от други риболовци."
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.listGap} />}
          showsVerticalScrollIndicator={false}
          {...keyboardAwareScrollProps}
          renderItem={({ item: row, index }) => (
            <View>
              <View style={styles.rankRow}>
                <View style={styles.rankBadge}>
                  <Text style={styles.rankText}>{medalForRank(index + 1)}</Text>
                </View>
                <Text style={styles.likesLbl}>
                  {row.likes} {row.likes === 1 ? 'харесване' : 'харесвания'}
                </Text>
              </View>
              <FeedPost
                item={row.item}
                myUid={user?.uid}
                myDisplayName={user?.displayName ?? user?.email ?? 'Аз'}
                socialEnabled={!!user && !!configured}
                onPressAuthor={(authorUid, name) =>
                  navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name })
                }
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}
