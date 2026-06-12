import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Text, View, StyleSheet, Pressable, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { ListSkeleton } from '../components/ListSkeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { useAuth } from '../services/authContext';
import { fetchMyTournaments, fetchMyTournamentRank, fetchPublicTournaments, type MyTournamentRank } from '../services/tournaments';
import type { Tournament } from '../types';

const CATEGORY_LABEL: Record<string, string> = {
  weight: 'Тегло',
  count: 'Брой',
  length: 'Дължина',
  species: 'Видове',
};

type Status = 'active' | 'upcoming' | 'ended';

function statusOf(t: Tournament, todayIso: string): Status {
  if (t.endDate && t.endDate < todayIso) return 'ended';
  if (t.startDate && t.startDate > todayIso) return 'upcoming';
  return 'active';
}

function statusLabel(s: Status): string {
  if (s === 'active') return 'Активен';
  if (s === 'upcoming') return 'Скоро';
  return 'Приключил';
}

function statusColor(s: Status, colors: AppColors): string {
  if (s === 'active') return '#2E9B5A';
  if (s === 'upcoming') return colors.primary;
  return colors.textMuted;
}

function formatRange(t: Tournament): string {
  const fmt = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
    } catch {
      return iso;
    }
  };
  return `${fmt(t.startDate)} – ${fmt(t.endDate)}`;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    title: { ...typography.h2, color: colors.text },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionAccent: { width: 4, height: 18, borderRadius: 2, backgroundColor: colors.primary },
    sectionTitle: { ...typography.h3, color: colors.text },
    badge: {
      marginLeft: 'auto',
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    badgeText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 11 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    iconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(232,144,46,0.16)',
    },
    name: { ...typography.bodyBold, color: colors.text },
    meta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    pillDot: { width: 6, height: 6, borderRadius: 3 },
    pillText: { ...typography.caption, fontWeight: '700', fontSize: 11 },
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

function TournamentRow({
  t,
  todayIso,
  styles,
  colors,
  onPress,
  rank,
}: {
  t: Tournament;
  todayIso: string;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  onPress: () => void;
  rank?: MyTournamentRank;
}) {
  const s = statusOf(t, todayIso);
  const color = statusColor(s, colors);
  // Rank pill only when (a) we know the user has at least submitted (rank !== null)
  // AND (b) the leaderboard has competitors. For ended tournaments this is the
  // final standing; for active ones it's a live-ish snapshot (refreshed on focus).
  const showRank = rank && rank.rank != null && rank.total > 0;
  // Tiered accent: podium gets medal colors, top 10 gets the primary accent,
  // 11+ uses textMuted. Previously everything past #3 collapsed to one color
  // — a user at #4 looked identical to a user at #58, which removed the
  // emotional gradient that motivates competing toward the podium.
  const rankColor =
    !showRank ? colors.primary :
    rank!.rank === 1 ? '#E8B923' :
    rank!.rank === 2 ? '#9AA0A6' :
    rank!.rank === 3 ? '#CD7F32' :
    rank!.rank! <= 10 ? colors.primary :
    colors.textMuted;
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.iconCircle}>
        <Ionicons name="trophy" size={22} color="#C77F12" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatRange(t)}
          {t.speciesName ? ` · ${t.speciesName}` : ''}
          {' · '}{CATEGORY_LABEL[t.category] ?? t.category}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <View style={[styles.pill, { backgroundColor: `${color}1F` }]}>
            <View style={[styles.pillDot, { backgroundColor: color }]} />
            <Text style={[styles.pillText, { color }]}>{statusLabel(s)}</Text>
          </View>
          {showRank ? (
            <View style={[styles.pill, { backgroundColor: `${rankColor}1F` }]}>
              <Ionicons name="podium-outline" size={11} color={rankColor} />
              <Text style={[styles.pillText, { color: rankColor }]}>
                #{rank!.rank} от {rank!.total}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function TournamentsScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [mine, setMine] = useState<Tournament[]>([]);
  const [publicList, setPublicList] = useState<Tournament[]>([]);
  // tournamentId → my rank within it. Populated in a follow-up pass after
  // the tournament list itself loads, so the cards render immediately and
  // rank pills "fade in" as each rank fetch resolves.
  const [myRanks, setMyRanks] = useState<Record<string, MyTournamentRank>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([
        user ? fetchMyTournaments(user.uid) : Promise.resolve([] as Tournament[]),
        fetchPublicTournaments(50),
      ]);
      setMine(m);
      // Filter out tournaments already in "mine" so they don't appear twice in Discover.
      const mineIds = new Set(m.map((t) => t.id));
      setPublicList(p.filter((t) => !mineIds.has(t.id)));
      // Kick off per-tournament rank fetches in parallel. Each one reads the
      // tournament's photoEntries collection. We update myRanks atomically once
      // all settle to avoid N renders for N tournaments.
      if (user && m.length > 0) {
        const uid = user.uid;
        Promise.all(
          m.map((t) => fetchMyTournamentRank(t.id, uid).then((r) => [t.id, r] as const))
        ).then((pairs) => {
          const next: Record<string, MyTournamentRank> = {};
          for (const [id, r] of pairs) next[id] = r;
          setMyRanks(next);
        }).catch(() => {});
      } else {
        setMyRanks({});
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // First focus shows the skeleton (no cached data yet). Subsequent focuses
  // refresh silently so the user doesn't see the skeleton flash on every
  // return to this tab. Pull-to-refresh still has the standard spinner.
  const initialFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    if (initialFocusRef.current) {
      initialFocusRef.current = false;
      setLoading(true);
    }
    void load();
  }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const openDetail = (id: string) => {
    void Haptics.selectionAsync();
    navigation.navigate('TournamentDetail', { id });
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl + 80 }}
        refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Турнири</Text>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate('CreateTournament');
            }}
            hitSlop={8}
            accessibilityLabel="Нов турнир"
          >
            <Ionicons name="add-circle-outline" size={32} color={colors.primary} />
          </Pressable>
        </View>

        {loading ? (
          // Row variant matches the TournamentRow layout (icon + 2 lines + pill).
          <View style={{ paddingTop: spacing.md }}>
            <ListSkeleton variant="row" count={4} />
          </View>
        ) : (
          <>
            {/* My tournaments */}
            {user ? (
              <>
                <View style={styles.sectionRow}>
                  <View style={styles.sectionAccent} />
                  <Text style={styles.sectionTitle}>Мои турнири</Text>
                  {mine.length > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{mine.length}</Text>
                    </View>
                  ) : null}
                </View>
                {mine.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon="trophy-outline"
                      emoji="🏆"
                      title="Все още нямаш турнири"
                      subtitle="Създай нов турнир или се присъедини към активен по-долу."
                      action={{
                        label: 'Създай турнир',
                        onPress: () => navigation.navigate('CreateTournament'),
                      }}
                    />
                  </Card>
                ) : (
                  mine.map((t) => (
                    <TournamentRow
                      key={t.id}
                      t={t}
                      todayIso={todayIso}
                      styles={styles}
                      colors={colors}
                      onPress={() => openDetail(t.id)}
                      rank={myRanks[t.id]}
                    />
                  ))
                )}
              </>
            ) : null}

            {/* Discover */}
            <View style={styles.sectionRow}>
              <View style={[styles.sectionAccent, { backgroundColor: '#C77F12' }]} />
              <Text style={styles.sectionTitle}>Открий</Text>
              {publicList.length > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{publicList.length}</Text>
                </View>
              ) : null}
            </View>
            {publicList.length === 0 ? (
              <Card>
                <EmptyState
                  icon="globe-outline"
                  title="Няма активни публични турнири"
                  subtitle="Бъди първият и създай нов."
                />
              </Card>
            ) : (
              publicList.map((t) => (
                <TournamentRow
                  key={t.id}
                  t={t}
                  todayIso={todayIso}
                  styles={styles}
                  colors={colors}
                  onPress={() => openDetail(t.id)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate('CreateTournament');
        }}
        style={styles.fab}
        accessibilityLabel="Нов турнир"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </Screen>
  );
}
