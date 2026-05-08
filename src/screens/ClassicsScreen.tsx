import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import {
  fetchRankedClassicPhotos,
  periodStartIso,
  type ClassicPeriod,
  type RankedClassicPhoto,
} from '../services/classicsContest';

const { width: SW } = Dimensions.get('window');
const HALF = (SW - spacing.lg * 2 - spacing.sm) / 2;

function daysLeftInWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 0 : 7 - d;
}
function daysLeftInMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
}

export default function ClassicsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, configured } = useAuth();
  const { colors } = useTheme();

  const [period, setPeriod] = useState<ClassicPeriod>('week');
  const [rows, setRows] = useState<RankedClassicPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styles = useMemo(() => StyleSheet.create({
    header: {
      paddingTop: insets.top + spacing.xs,
      paddingBottom: spacing.sm,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { ...typography.h2, color: colors.text, flex: 1, letterSpacing: -0.3 },
    countdownBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    countdownText: { ...typography.small, color: colors.primary, fontWeight: '700' },
    segmented: {
      flexDirection: 'row',
      marginHorizontal: spacing.lg,
      marginVertical: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: 3,
    },
    segItem: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: radius.md - 1,
    },
    segItemActive: {
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    segText: { ...typography.small, fontWeight: '700', color: colors.textMuted },
    segTextActive: { color: colors.text },
    winnerCard: {
      marginHorizontal: spacing.lg,
      borderRadius: radius.xl,
      overflow: 'hidden',
      height: 260,
      marginBottom: spacing.md,
    },
    winnerPhoto: { width: '100%', height: '100%' },
    winnerOverlay: {
      position: 'absolute',
      inset: 0,
      justifyContent: 'space-between',
      padding: spacing.md,
    },
    winnerTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    winnerBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#FFD700',
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    winnerBadgeText: { fontSize: 12, fontWeight: '800', color: '#1a1a1a', letterSpacing: 0.5 },
    likesBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.pill,
    },
    likesText: { ...typography.small, color: '#fff', fontWeight: '700' },
    winnerBottom: {
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    winnerAuthor: { ...typography.small, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
    winnerTitle: { ...typography.bodyBold, color: '#fff', marginTop: 2, fontSize: 16 },
    runnerRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    runnerCard: {
      width: HALF,
      height: HALF * 1.15,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    runnerOverlay: {
      position: 'absolute',
      inset: 0,
      justifyContent: 'space-between',
      padding: spacing.sm,
    },
    runnerMedalBadge: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    runnerMedalText: { fontSize: 16 },
    runnerBottom: {
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: radius.sm,
      padding: 6,
    },
    runnerName: { ...typography.small, color: '#fff', fontWeight: '700', fontSize: 11 },
    runnerLikes: { ...typography.small, color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 1 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      ...typography.overline,
      color: colors.textMuted,
      letterSpacing: 1.2,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      marginTop: spacing.xs,
    },
    rankRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      gap: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rankNum: {
      width: 28,
      alignItems: 'center',
    },
    rankNumText: { ...typography.bodyBold, color: colors.textMuted, fontSize: 15 },
    rankThumb: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.primarySurface,
      overflow: 'hidden',
    },
    rankInfo: { flex: 1 },
    rankName: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    rankSub: { ...typography.small, color: colors.textMuted, marginTop: 2 },
    rankLikes: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    rankLikesText: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.lg,
    },
    emptyTrophy: { fontSize: 64 },
    emptyTitle: { ...typography.h2, color: colors.text, textAlign: 'center' },
    emptyBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    stepsCard: {
      width: '100%',
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    stepsHeader: {
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    stepsHeaderText: { ...typography.bodyBold, color: colors.primary, fontSize: 13 },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    stepDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDotText: { fontSize: 12, fontWeight: '800', color: '#fff' },
    stepText: { ...typography.body, color: colors.text, flex: 1, fontSize: 13 },
  }), [colors, insets.top]);

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchRankedClassicPhotos(periodStartIso(period)));
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

  const daysLeft = period === 'week' ? daysLeftInWeek() : daysLeftInMonth();
  const [first, second, third, ...rest] = rows;

  const Header = (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
        <Ionicons name="chevron-back" size={26} color={colors.primary} />
      </Pressable>
      <Text style={styles.headerTitle}>🏆 Класики</Text>
      <View style={styles.countdownBadge}>
        <Ionicons name="time-outline" size={12} color={colors.primary} />
        <Text style={styles.countdownText}>
          {daysLeft === 0 ? 'Последен ден' : `${daysLeft} ${daysLeft === 1 ? 'ден' : 'дни'}`}
        </Text>
      </View>
    </View>
  );

  const Segmented = (
    <View style={styles.segmented}>
      {(['week', 'month'] as ClassicPeriod[]).map((p) => (
        <Pressable key={p} style={[styles.segItem, period === p && styles.segItemActive]} onPress={() => setPeriod(p)}>
          <Text style={[styles.segText, period === p && styles.segTextActive]}>
            {p === 'week' ? 'Седмица' : 'Месец'}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const StepsCard = (
    <View style={styles.stepsCard}>
      <View style={styles.stepsHeader}>
        <Text style={styles.stepsHeaderText}>Как да участваш?</Text>
      </View>
      {['Запиши улов в Дневника', 'Добави заглавие на снимката', 'Сподели публично в Лентата'].map((s, i) => (
        <View key={i} style={[styles.step, i === 2 && { borderBottomWidth: 0 }]}>
          <View style={styles.stepDot}><Text style={styles.stepDotText}>{i + 1}</Text></View>
          <Text style={styles.stepText}>{s}</Text>
        </View>
      ))}
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        {Header}
        {Segmented}
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ ...typography.h3, color: colors.text }}>Нужен е акаунт</Text>
            <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.sm }}>
              Влез, за да виждаш класацията и да гласуваш с харесвания.
            </Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {Header}

      {loading && rows.length === 0 ? (
        <>
          {Segmented}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ ...typography.body, color: colors.textMuted }}>Броим харесванията…</Text>
          </View>
        </>
      ) : error ? (
        <>
          {Segmented}
          <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
            <Card>
              <Text style={{ ...typography.h3, color: colors.text }}>Грешка при зареждане</Text>
              <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
            </Card>
          </View>
        </>
      ) : rows.length === 0 ? (
        <>
          {Segmented}
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTrophy}>🏆</Text>
              <Text style={styles.emptyTitle}>Все още няма снимки</Text>
              <Text style={styles.emptyBody}>
                Бъди първият! Сподели улов с именувана снимка в Лентата.
              </Text>
              {StepsCard}
            </View>
          </ScrollView>
        </>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item) => item.item.id}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
          }
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ListHeaderComponent={
            <>
              {Segmented}

              {/* #1 Winner card */}
              {first ? (
                <Pressable
                  style={styles.winnerCard}
                  onPress={() => navigation.navigate('UserPublicProfile', { uid: first.item.ownerUid, displayName: first.item.ownerName })}
                >
                  {first.item.photoUri ? (
                    <Image source={{ uri: first.item.photoUri }} style={styles.winnerPhoto} contentFit="cover" />
                  ) : (
                    <View style={[styles.winnerPhoto, { backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }]}>
                      <Ionicons name="fish-outline" size={56} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.winnerOverlay}>
                    <View style={styles.winnerTopRow}>
                      <View style={styles.winnerBadge}>
                        <Text style={{ fontSize: 14 }}>🥇</Text>
                        <Text style={styles.winnerBadgeText}>ПОБЕДИТЕЛ</Text>
                      </View>
                      <View style={styles.likesBadge}>
                        <Ionicons name="heart" size={13} color="#ff6b6b" />
                        <Text style={styles.likesText}>{first.likes}</Text>
                      </View>
                    </View>
                    <View style={styles.winnerBottom}>
                      <Text style={styles.winnerAuthor}>{first.item.ownerName ?? 'Рибар'}</Text>
                      <Text style={styles.winnerTitle} numberOfLines={1}>
                        {first.item.photoTitle ?? first.item.speciesName}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ) : null}

              {/* #2 and #3 side by side */}
              {(second || third) ? (
                <View style={styles.runnerRow}>
                  {[second, third].filter(Boolean).map((row, idx) => {
                    const rank = idx + 2;
                    const borderColor = rank === 2 ? '#C0C0C0' : '#CD7F32';
                    return (
                      <Pressable
                        key={row!.item.id}
                        style={[styles.runnerCard, { borderWidth: 2, borderColor }]}
                        onPress={() => navigation.navigate('UserPublicProfile', { uid: row!.item.ownerUid, displayName: row!.item.ownerName })}
                      >
                        {row!.item.photoUri ? (
                          <Image source={{ uri: row!.item.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                        ) : (
                          <View style={{ flex: 1, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="fish-outline" size={32} color={colors.primary} />
                          </View>
                        )}
                        <View style={styles.runnerOverlay}>
                          <View style={styles.runnerMedalBadge}>
                            <Text style={styles.runnerMedalText}>{rank === 2 ? '🥈' : '🥉'}</Text>
                          </View>
                          <View style={styles.runnerBottom}>
                            <Text style={styles.runnerName} numberOfLines={1}>{row!.item.ownerName ?? 'Рибар'}</Text>
                            <Text style={styles.runnerLikes}>❤️ {row!.likes}</Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {/* Rest header */}
              {rest.length > 0 ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.sectionLabel}>ОСТАНАЛИ</Text>
                </>
              ) : null}
            </>
          }
          renderItem={({ item: row, index }) => (
            <Pressable
              style={styles.rankRow}
              onPress={() => navigation.navigate('UserPublicProfile', { uid: row.item.ownerUid, displayName: row.item.ownerName })}
            >
              <View style={styles.rankNum}>
                <Text style={styles.rankNumText}>#{index + 4}</Text>
              </View>
              <View style={styles.rankThumb}>
                {row.item.photoUri ? (
                  <Image source={{ uri: row.item.photoUri }} style={{ width: 52, height: 52 }} contentFit="cover" recyclingKey={row.item.id} />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="fish-outline" size={22} color={colors.primary} />
                  </View>
                )}
              </View>
              <View style={styles.rankInfo}>
                <Text style={styles.rankName} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
                <Text style={styles.rankSub} numberOfLines={1}>
                  {row.item.photoTitle ?? row.item.speciesName}
                </Text>
              </View>
              <View style={styles.rankLikes}>
                <Ionicons name="heart" size={14} color="#ff6b6b" />
                <Text style={styles.rankLikesText}>{row.likes}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
