import React, { useCallback, useMemo, useState } from 'react';
import { Text, View, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { useAuth } from '../services/authContext';
import { fetchMyTournaments, fetchPublicTournaments } from '../services/tournaments';
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
}: {
  t: Tournament;
  todayIso: string;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  onPress: () => void;
}) {
  const s = statusOf(t, todayIso);
  const color = statusColor(s, colors);
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.iconCircle}>
        <Ionicons name="trophy" size={22} color="#E8902E" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatRange(t)}
          {t.speciesName ? ` · ${t.speciesName}` : ''}
          {' · '}{CATEGORY_LABEL[t.category] ?? t.category}
        </Text>
        <View style={[styles.pill, { backgroundColor: `${color}1F` }]}>
          <View style={[styles.pillDot, { backgroundColor: color }]} />
          <Text style={[styles.pillText, { color }]}>{statusLabel(s)}</Text>
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
    } catch {
      // best-effort
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
  }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const openDetail = (id: string) => navigation.navigate('TournamentDetail', { id });

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Турнири</Text>
          <Pressable onPress={() => navigation.navigate('CreateTournament')} hitSlop={8} accessibilityLabel="Нов турнир">
            <Ionicons name="add-circle-outline" size={32} color={colors.primary} />
          </Pressable>
        </View>

        {loading ? (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
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
                      title="Все още нямаш турнири"
                      subtitle="Създай нов турнир или се присъедини към активен по-долу."
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
                    />
                  ))
                )}
              </>
            ) : null}

            {/* Discover */}
            <View style={styles.sectionRow}>
              <View style={[styles.sectionAccent, { backgroundColor: '#E8902E' }]} />
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
        onPress={() => navigation.navigate('CreateTournament')}
        style={styles.fab}
        accessibilityLabel="Нов турнир"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </Screen>
  );
}
