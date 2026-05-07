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
import { ClassicPhotoCard } from '../components/ClassicPhotoCard';
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
          paddingTop: insets.top,
          paddingBottom: spacing.xl + 4,
          paddingHorizontal: spacing.lg,
          overflow: 'hidden',
        },
        heroTopRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.lg,
        },
        backBtn: {
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: 'rgba(255,255,255,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        decorRingOuter: {
          position: 'absolute',
          width: 260,
          height: 260,
          borderRadius: 130,
          borderWidth: 1,
          borderColor: 'rgba(255,215,0,0.08)',
          right: -60,
          top: -40,
        },
        decorRingInner: {
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: 90,
          borderWidth: 1,
          borderColor: 'rgba(255,215,0,0.12)',
          right: -20,
          top: 0,
        },
        heroCenterBlock: {
          alignItems: 'flex-start',
          marginTop: spacing.xs,
        },
        trophyCircle: {
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: 'rgba(255,215,0,0.14)',
          borderWidth: 1.5,
          borderColor: 'rgba(255,215,0,0.3)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
          shadowColor: '#FFD700',
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        heroTitle: {
          fontSize: 34,
          fontWeight: '800',
          color: '#fff',
          letterSpacing: -0.8,
          lineHeight: 38,
        },
        heroSub: {
          ...typography.body,
          color: 'rgba(255,255,255,0.55)',
          marginTop: spacing.xs,
        },
        countdownRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.lg,
          marginTop: spacing.lg,
        },
        countdownPill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: 'rgba(255,255,255,0.1)',
          paddingHorizontal: spacing.md,
          paddingVertical: 7,
          borderRadius: radius.pill,
        },
        countdownText: {
          ...typography.small,
          color: 'rgba(255,255,255,0.9)',
          fontWeight: '700',
        },
        tabBar: {
          flexDirection: 'row',
          backgroundColor: colors.background,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        tabItem: {
          flex: 1,
          alignItems: 'center',
          paddingVertical: spacing.md,
          gap: 4,
        },
        tabText: {
          ...typography.bodyBold,
          color: colors.textMuted,
          fontSize: 14,
        },
        tabTextActive: {
          color: colors.primary,
        },
        tabIndicator: {
          height: 2.5,
          width: 32,
          borderRadius: 2,
          backgroundColor: 'transparent',
        },
        tabIndicatorActive: {
          backgroundColor: colors.primary,
        },
        sectionLabel: {
          ...typography.overline,
          color: colors.textMuted,
          letterSpacing: 1.2,
          marginHorizontal: spacing.lg,
          marginTop: spacing.lg,
          marginBottom: spacing.sm,
        },
        podiumRow: {
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: spacing.xs,
        },
        podiumItem: { alignItems: 'center', flex: 1 },
        podiumMedal: { fontSize: 20, marginBottom: 6 },
        podiumLikes: {
          ...typography.small,
          color: colors.textMuted,
          marginTop: 6,
          fontWeight: '700',
        },
        podiumName: {
          ...typography.small,
          color: colors.text,
          fontWeight: '600',
          marginTop: 2,
          textAlign: 'center',
        },
        grid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
        },
        howToCard: {
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          overflow: 'hidden',
        },
        howToHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
          backgroundColor: colors.primarySurface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        howToHeaderText: {
          ...typography.bodyBold,
          color: colors.primary,
          fontSize: 13,
        },
        howToStep: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        stepNum: {
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        stepNumText: {
          fontSize: 12,
          fontWeight: '800',
          color: '#fff',
        },
        stepText: {
          ...typography.body,
          color: colors.text,
          flex: 1,
          fontSize: 13,
        },
        emptyHero: {
          alignItems: 'center',
          paddingTop: spacing.xxl,
          paddingBottom: spacing.xl,
          paddingHorizontal: spacing.lg,
        },
        emptyTrophyWrap: {
          width: 90,
          height: 90,
          borderRadius: 45,
          backgroundColor: colors.primarySurface,
          borderWidth: 1.5,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        },
        emptyTitle: {
          ...typography.h2,
          color: colors.text,
          textAlign: 'center',
          marginBottom: spacing.sm,
        },
        emptySubtitle: {
          ...typography.body,
          color: colors.textMuted,
          textAlign: 'center',
          lineHeight: 22,
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
    top3[1] ? { row: top3[1], rank: 2, h: 110, w: (SW - spacing.md * 4) / 3, borderColor: '#C0C0C0' } : null,
    top3[0] ? { row: top3[0], rank: 1, h: 145, w: (SW - spacing.md * 4) / 3, borderColor: '#FFD700' } : null,
    top3[2] ? { row: top3[2], rank: 3, h: 90, w: (SW - spacing.md * 4) / 3, borderColor: '#CD7F32' } : null,
  ].filter(Boolean) as { row: RankedClassicPhoto; rank: number; h: number; w: number; borderColor: string }[];

  const Hero = (
    <View style={styles.hero}>
      <View style={styles.decorRingOuter} />
      <View style={styles.decorRingInner} />
      <View style={styles.heroTopRow}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
      </View>
      <View style={styles.heroCenterBlock}>
        <View style={styles.trophyCircle}>
          <Text style={{ fontSize: 34 }}>🏆</Text>
        </View>
        <Text style={styles.heroTitle}>Класики</Text>
        <Text style={styles.heroSub}>Топ снимки по харесвания за периода</Text>
        <View style={styles.countdownRow}>
          <View style={styles.countdownPill}>
            <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.countdownText}>
              {daysLeft === 0
                ? 'Последен ден!'
                : `${daysLeft} ${daysLeft === 1 ? 'ден' : 'дни'} остават`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const TabBar = (
    <View style={styles.tabBar}>
      {(['week', 'month'] as ClassicPeriod[]).map((p) => (
        <Pressable key={p} style={styles.tabItem} onPress={() => setPeriod(p)}>
          <Text style={[styles.tabText, period === p && styles.tabTextActive]}>
            {p === 'week' ? 'Седмица' : 'Месец'}
          </Text>
          <View style={[styles.tabIndicator, period === p && styles.tabIndicatorActive]} />
        </Pressable>
      ))}
    </View>
  );

  const HowToCard = (
    <View style={styles.howToCard}>
      <View style={styles.howToHeader}>
        <Ionicons name="information-circle" size={16} color={colors.primary} />
        <Text style={styles.howToHeaderText}>Как да участваш?</Text>
      </View>
      {[
        'Запиши улов в Дневника',
        'Добави заглавие на снимката',
        'Сподели публично в Лентата',
      ].map((step, i) => (
        <View key={i} style={[styles.howToStep, i === 2 && { borderBottomWidth: 0 }]}>
          <View style={styles.stepNum}>
            <Text style={styles.stepNumText}>{i + 1}</Text>
          </View>
          <Text style={styles.stepText}>{step}</Text>
          <Ionicons
            name={i === 0 ? 'book-outline' : i === 1 ? 'text-outline' : 'share-social-outline'}
            size={16}
            color={colors.textMuted}
          />
        </View>
      ))}
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        {Hero}
        {TabBar}
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
      {Hero}
      {TabBar}

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ ...typography.body, color: colors.textMuted }}>Броим харесванията…</Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ ...typography.h3, color: colors.text }}>Грешка при зареждане</Text>
            <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      ) : rows.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.emptyHero}>
            <View style={styles.emptyTrophyWrap}>
              <Text style={{ fontSize: 40 }}>🏆</Text>
            </View>
            <Text style={styles.emptyTitle}>Все още няма снимки</Text>
            <Text style={styles.emptySubtitle}>
              Бъди първият! Сподели улов с именувана снимка и започни да получаваш харесвания.
            </Text>
          </View>
          {HowToCard}
        </ScrollView>
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
              {HowToCard}

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
                        <View
                          style={{
                            width: w,
                            height: h,
                            borderRadius: radius.md,
                            overflow: 'hidden',
                            borderWidth: 2.5,
                            borderColor,
                          }}
                        >
                          {row.item.photoUri ? (
                            <Image
                              source={{ uri: row.item.photoUri }}
                              style={{ width: w, height: h }}
                              contentFit="cover"
                            />
                          ) : (
                            <View
                              style={{
                                width: w,
                                height: h,
                                backgroundColor: colors.primarySurface,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons name="fish-outline" size={28} color={colors.primary} />
                            </View>
                          )}
                        </View>
                        <Text style={styles.podiumLikes}>❤️ {row.likes}</Text>
                        <Text style={styles.podiumName} numberOfLines={1}>
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
