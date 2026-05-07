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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ClassicPhotoCard } from '../components/ClassicPhotoCard';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
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

function daysLeftInWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 0 : 7 - d;
}

function daysLeftInMonth(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return last - now.getDate();
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        hero: {
          backgroundColor: colors.primaryDark,
          paddingTop: insets.top + spacing.sm,
          paddingBottom: spacing.xl,
          paddingHorizontal: spacing.lg,
        },
        backBtn: {
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: 'rgba(255,255,255,0.15)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        },
        trophyRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          marginBottom: spacing.sm,
        },
        trophyWrap: {
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: 'rgba(255,215,0,0.18)',
          borderWidth: 1.5,
          borderColor: 'rgba(255,215,0,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        heroTitle: { ...typography.h1, color: '#fff', letterSpacing: -0.5 },
        heroSub: { ...typography.body, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
        countdown: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          marginTop: spacing.md,
          backgroundColor: 'rgba(255,255,255,0.1)',
          alignSelf: 'flex-start',
          paddingHorizontal: spacing.md,
          paddingVertical: 6,
          borderRadius: radius.pill,
        },
        countdownText: { ...typography.small, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
        tabs: {
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        },
        tab: {
          flex: 1,
          paddingVertical: spacing.sm + 2,
          alignItems: 'center',
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
        },
        tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
        tabText: { ...typography.small, color: colors.textMuted, fontWeight: '700' },
        tabTextActive: { color: '#fff' },
        howTo: {
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
          marginBottom: spacing.xs,
          padding: spacing.md,
          backgroundColor: colors.primarySurface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          gap: spacing.sm,
          alignItems: 'flex-start',
        },
        howToText: { ...typography.caption, color: colors.text, flex: 1, lineHeight: 18 },
        sectionLabel: {
          ...typography.overline,
          color: colors.textMuted,
          letterSpacing: 1,
          marginHorizontal: spacing.lg,
          marginTop: spacing.lg,
          marginBottom: spacing.sm,
        },
        podiumRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing.xs,
        },
        podiumItem: { alignItems: 'center' },
        podiumMedal: { fontSize: 22, marginBottom: 4 },
        podiumLikes: { ...typography.small, color: colors.textMuted, marginTop: 4, fontWeight: '700' },
        podiumName: {
          ...typography.small,
          color: colors.text,
          fontWeight: '600',
          marginTop: 2,
          maxWidth: 90,
          textAlign: 'center',
        },
        grid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
        },
      }),
    [colors, insets.top]
  );

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
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  const podiumOrder = [
    top3[1] ? { row: top3[1], rank: 2, h: 110, w: 100, borderColor: '#C0C0C0' } : null,
    top3[0] ? { row: top3[0], rank: 1, h: 140, w: 120, borderColor: '#FFD700' } : null,
    top3[2] ? { row: top3[2], rank: 3, h: 90, w: 100, borderColor: '#CD7F32' } : null,
  ].filter(Boolean) as { row: RankedClassicPhoto; rank: number; h: number; w: number; borderColor: string }[];

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <View style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.heroTitle}>Класики 🏆</Text>
          <Text style={styles.heroSub}>Топ снимки на общността</Text>
        </View>
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
      {/* Hero */}
      <View style={styles.hero}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.trophyRow}>
          <View style={styles.trophyWrap}>
            <Text style={{ fontSize: 26 }}>🏆</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Класики</Text>
            <Text style={styles.heroSub}>Топ снимки по харесвания за периода</Text>
          </View>
        </View>
        <View style={styles.countdown}>
          <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.85)" />
          <Text style={styles.countdownText}>
            {daysLeft === 0
              ? 'Последен ден!'
              : `${daysLeft} ${daysLeft === 1 ? 'ден' : 'дни'} остават`}
          </Text>
        </View>
      </View>

      {/* Period tabs */}
      <View style={styles.tabs}>
        {(['week', 'month'] as ClassicPeriod[]).map((p) => (
          <Pressable
            key={p}
            style={[styles.tab, period === p && styles.tabActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.tabText, period === p && styles.tabTextActive]}>
              {p === 'week' ? '📅 Седмица' : '🗓 Месец'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.md }}>
            Броим харесванията…
          </Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ ...typography.h3, color: colors.text }}>Грешка при зареждане</Text>
            <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="images-outline"
          title="Все още няма снимки"
          subtitle="Сподели улов с именувана снимка в лентата и получавай харесвания от риболовната общност."
        />
      ) : (
        <FlatList
          data={[]}
          renderItem={null}
          keyExtractor={() => 'placeholder'}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ListHeaderComponent={
            <>
              {/* How to participate */}
              <View style={styles.howTo}>
                <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.howToText}>
                  Запиши улов → добави{' '}
                  <Text style={{ fontWeight: '700' }}>заглавие на снимката</Text> → сподели публично.
                  Риболовци гласуват с харесване. Най-много харесвания = победител!
                </Text>
              </View>

              {/* Podium */}
              {top3.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>ТОП 3</Text>
                  <View style={styles.podiumRow}>
                    {podiumOrder.map(({ row, rank, h, w, borderColor }) => (
                      <Pressable
                        key={row.item.id}
                        style={styles.podiumItem}
                        onPress={() =>
                          navigation.navigate('UserPublicProfile', {
                            uid: row.item.ownerUid,
                            displayName: row.item.ownerName,
                          })
                        }
                      >
                        <Text style={styles.podiumMedal}>
                          {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                        </Text>
                        <View style={{ width: w, height: h, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2.5, borderColor }}>
                          {row.item.photoUri ? (
                            <Image source={{ uri: row.item.photoUri }} style={{ width: w, height: h }} contentFit="cover" />
                          ) : (
                            <View style={{ width: w, height: h, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="fish-outline" size={28} color={colors.primary} />
                            </View>
                          )}
                        </View>
                        <Text style={styles.podiumLikes}>❤️ {row.likes}</Text>
                        <Text style={styles.podiumName} numberOfLines={2}>
                          {row.item.ownerName ?? 'Рибар'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {/* #1 full-width card */}
              {top3[0] ? (
                <>
                  <Text style={styles.sectionLabel}>№1 ЗА ПЕРИОДА</Text>
                  <View style={{ paddingHorizontal: spacing.lg }}>
                    <ClassicPhotoCard
                      row={top3[0]}
                      rank={1}
                      variant="full"
                      onPress={() =>
                        navigation.navigate('UserPublicProfile', {
                          uid: top3[0].item.ownerUid,
                          displayName: top3[0].item.ownerName,
                        })
                      }
                    />
                  </View>
                </>
              ) : null}

              {/* Rest as 2-column grid */}
              {rest.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>ОСТАНАЛИ</Text>
                  <View style={styles.grid}>
                    {rest.map((row, i) => (
                      <ClassicPhotoCard
                        key={row.item.id}
                        row={row}
                        rank={i + 4}
                        variant="grid"
                        onPress={() =>
                          navigation.navigate('UserPublicProfile', {
                            uid: row.item.ownerUid,
                            displayName: row.item.ownerName,
                          })
                        }
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </>
          }
        />
      )}
    </Screen>
  );
}
