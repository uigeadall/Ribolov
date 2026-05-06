import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  Modal,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { fetchPublicCatchesSince } from '../services/cloudSync';
import {
  aggregateLeaderboard,
  LEADERBOARD_DAM_RADIUS_KM,
  LEADERBOARD_RIVER_RADIUS_KM,
  LeaderboardPeriod,
  LeaderboardRow,
  LeaderboardScope,
  periodMinIso,
} from '../services/leaderboards';
import { formatFirebaseError } from '../services/firebaseErrors';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import type { ProfileStackParamList } from '../navigation/types';

type ScopePick =
  | { mode: 'all' }
  | { mode: 'dam'; id: string; name: string }
  | { mode: 'river'; id: string; name: string };

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'day', label: 'Ден' },
  { key: 'week', label: 'Седмица' },
  { key: 'month', label: 'Месец' },
  { key: 'year', label: 'Година' },
];

function scopeToLeaderboardScope(p: ScopePick): LeaderboardScope {
  if (p.mode === 'all') return { type: 'all' };
  return { type: 'water', kind: p.mode, id: p.id };
}

function scopeLabel(p: ScopePick): string {
  if (p.mode === 'all') return 'Общо — всички водоеми';
  if (p.mode === 'dam') return `Язовир: ${p.name}`;
  return `Река: ${p.name}`;
}

function createStyles(colors: AppColors, mode: 'light' | 'dark') {
  return StyleSheet.create({
    hero: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: spacing.sm,
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
      backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTitleBlock: { flex: 1, minWidth: 0 },
    heroTitle: { ...typography.h2, color: colors.text },
    heroSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    periodRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: { ...typography.caption, fontWeight: '700', color: colors.text },
    chipTextActive: { color: colors.white },
    scopeCard: { marginTop: spacing.md },
    scopePressInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    scopeTextBlock: { flex: 1, minWidth: 0 },
    scopeTitle: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    scopeValue: { ...typography.bodyBold, color: colors.text, marginTop: 4 },
    hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },
    warnTitle: { ...typography.bodyBold, color: colors.text },
    warnBody: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
    rowCard: { marginBottom: spacing.sm },
    rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rankCol: { width: 36, alignItems: 'center' },
    rankNum: { ...typography.h3, color: colors.primary },
    rowMid: { flex: 1, minWidth: 0 },
    rowName: { ...typography.bodyBold, color: colors.text },
    rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: '78%',
      paddingBottom: spacing.lg,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: { ...typography.h3, color: colors.text },
    modalSection: {
      ...typography.caption,
      color: colors.textMuted,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    modalRow: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalRowText: { ...typography.body, color: colors.text },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
    modalSearch: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      fontSize: 16,
      color: colors.text,
    },
    modalTabRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      flexWrap: 'wrap',
    },
  });
}

type WaterModalTab = 'all' | 'dams' | 'rivers';

export default function LeaderboardScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ProfileStackParamList, 'Leaderboard'>>();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createStyles(colors, mode), [colors, mode]);
  const { user, configured } = useAuth();

  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [scopePick, setScopePick] = useState<ScopePick>({ mode: 'all' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [waterModalTab, setWaterModalTab] = useState<WaterModalTab>('all');
  const [waterSearch, setWaterSearch] = useState('');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const damId = route.params?.damId;
    const riverId = route.params?.riverId;
    if (damId) {
      const d = DAMS.find((x) => x.id === damId);
      if (d) setScopePick({ mode: 'dam', id: d.id, name: d.name });
      return;
    }
    if (riverId) {
      const r = RIVERS.find((x) => x.id === riverId);
      if (r) setScopePick({ mode: 'river', id: r.id, name: r.name });
    }
  }, [route.params?.damId, route.params?.riverId]);

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setLoading(true);
    setError(null);
    try {
      const since = periodMinIso(period);
      const catches = await fetchPublicCatchesSince(since);
      const filtered = catches.filter((c) => typeof c.ownerUid === 'string' && c.ownerUid.length > 0);
      const lbScope = scopeToLeaderboardScope(scopePick);
      setRows(aggregateLeaderboard(filtered, period, lbScope));
    } catch (e: unknown) {
      setError(formatFirebaseError(e));
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured, user, period, scopePick]);

  useEffect(() => {
    if (user && configured) load();
  }, [load, user, configured]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const heroTopStyle = useMemo(() => ({ paddingTop: Math.max(insets.top, spacing.md) }), [insets.top]);

  const q = waterSearch.trim().toLowerCase();
  const damsFiltered = useMemo(() => {
    if (!q) return DAMS;
    return DAMS.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.region.toLowerCase().includes(q) ||
        (d.id && d.id.toLowerCase().includes(q))
    );
  }, [q]);
  const riversFiltered = useMemo(() => {
    if (!q) return RIVERS;
    return RIVERS.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        (r.id && r.id.toLowerCase().includes(q))
    );
  }, [q]);

  const HeaderBtn = () => (
    <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button">
      <Ionicons name="chevron-back" size={28} color={colors.primary} />
    </Pressable>
  );

  if (!configured) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <View style={[styles.hero, heroTopStyle]}>
          <View style={styles.headerRow}>
            <HeaderBtn />
            <View style={{ width: 28 }} />
          </View>
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="podium-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Класирания</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Класиранията изискват Firebase</Text>
            <Text style={styles.warnBody}>
              Настрой облака в src/services/firebaseConfig.ts, за да се зареждат споделените улови от общността.
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
          <View style={styles.headerRow}>
            <HeaderBtn />
            <View style={{ width: 28 }} />
          </View>
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="podium-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Класирания</Text>
            </View>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Влез в акаунта си</Text>
            <Text style={styles.warnBody}>За да виждаш класирането по споделени улови, трябва да си влязъл.</Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      <View style={[styles.hero, heroTopStyle]}>
        <View style={styles.headerRow}>
          <HeaderBtn />
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.heroTitleRow}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="podium-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroTitle}>Класирания</Text>
            <Text style={styles.heroSubtitle}>По сумарно тегло от споделени улови за избрания период</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
          {PERIODS.map(({ key, label }) => {
            const active = period === key;
            return (
              <Pressable
                key={key}
                onPress={() => setPeriod(key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable onPress={() => setPickerOpen(true)}>
          <Card style={styles.scopeCard}>
            <View style={styles.scopePressInner}>
              <View style={styles.scopeTextBlock}>
                <Text style={styles.scopeTitle}>Водоем</Text>
                <Text style={styles.scopeValue} numberOfLines={2}>
                  {scopeLabel(scopePick)}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={22} color={colors.textMuted} />
            </View>
          </Card>
        </Pressable>

        {scopePick.mode !== 'all' ? (
          <Text style={styles.hint}>
            За язовири: улови с GPS до ~{LEADERBOARD_DAM_RADIUS_KM} км от маркера или с име на място/бележка като
            водоема. За реки: до ~{LEADERBOARD_RIVER_RADIUS_KM} км или текстово съвпадение.
          </Text>
        ) : (
          <Text style={styles.hint}>
            Общото класиране включва всички споделени улови за периода. Избери конкретен язовир или река от картата
            или списъка по-долу.
          </Text>
        )}

        {error ? (
          <Card style={{ marginTop: spacing.md, borderColor: colors.danger }}>
            <Text style={{ ...typography.body, color: colors.danger }}>{error}</Text>
            <Button title="Опитай отново" variant="secondary" onPress={load} style={{ marginTop: spacing.sm }} />
          </Card>
        ) : null}
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
          <EmptyState
            icon="podium-outline"
            title="Няма данни за периода"
            subtitle={
              scopePick.mode !== 'all'
                ? 'Няма споделени улови с локация за този водоем или период.'
                : 'Все още няма споделени улови за избрания период.'
            }
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.ownerUid}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate('UserPublicProfile', { uid: item.ownerUid, displayName: item.ownerName })
              }
            >
              <Card style={styles.rowCard}>
                <View style={styles.rowInner}>
                  <View style={styles.rankCol}>
                    <Text style={styles.rankNum}>{item.rank}</Text>
                  </View>
                  <View style={styles.rowMid}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.ownerName}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {item.totalKg.toFixed(2)} кг · {item.catchCount}{' '}
                      {item.catchCount === 1 ? 'улов' : 'улова'} · топ {item.bestKg.toFixed(2)} кг
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setPickerOpen(false);
          setWaterSearch('');
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            setPickerOpen(false);
            setWaterSearch('');
          }}
        >
          <Pressable style={[styles.modalSheet, { paddingBottom: spacing.lg + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Водоем за класиране</Text>
              <Pressable
                onPress={() => {
                  setPickerOpen(false);
                  setWaterSearch('');
                }}
                hitSlop={8}
              >
                <Ionicons name="close" size={26} color={colors.textMuted} />
              </Pressable>
            </View>
            <TextInput
              value={waterSearch}
              onChangeText={setWaterSearch}
              placeholder="Търси по име или област…"
              placeholderTextColor={colors.textMuted}
              style={styles.modalSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalTabRow}>
              {(
                [
                  { key: 'all' as const, label: 'Общо + всички' },
                  { key: 'dams' as const, label: `Язовири (${damsFiltered.length})` },
                  { key: 'rivers' as const, label: `Реки (${riversFiltered.length})` },
                ] as const
              ).map(({ key, label }) => {
                const active = waterModalTab === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setWaterModalTab(key)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView keyboardShouldPersistTaps="handled">
              {(waterModalTab === 'all' || waterModalTab === 'dams') && (
                <>
                  {waterModalTab === 'all' ? (
                    <>
                      <Text style={styles.modalSection}>Общо класиране</Text>
                      <Pressable
                        style={styles.modalRow}
                        onPress={() => {
                          setScopePick({ mode: 'all' });
                          setPickerOpen(false);
                          setWaterSearch('');
                        }}
                      >
                        <Text style={styles.modalRowText}>Всички водоеми — сумарно за общността</Text>
                      </Pressable>
                    </>
                  ) : null}
                  {(waterModalTab === 'all' || waterModalTab === 'dams') && (
                    <>
                      <Text style={styles.modalSection}>Язовири</Text>
                      {damsFiltered.map((d) => (
                        <Pressable
                          key={d.id}
                          style={styles.modalRow}
                          onPress={() => {
                            setScopePick({ mode: 'dam', id: d.id, name: d.name });
                            setPickerOpen(false);
                            setWaterSearch('');
                          }}
                        >
                          <Text style={styles.modalRowText}>
                            {d.name}
                            <Text style={{ ...typography.caption, color: colors.textMuted }}> · {d.region}</Text>
                          </Text>
                        </Pressable>
                      ))}
                      {damsFiltered.length === 0 ? (
                        <Text style={[styles.modalRow, { color: colors.textMuted }]}>Няма язовири по филтъра.</Text>
                      ) : null}
                    </>
                  )}
                </>
              )}
              {(waterModalTab === 'all' || waterModalTab === 'rivers') && (
                <>
                  <Text style={styles.modalSection}>Реки</Text>
                  {riversFiltered.map((r) => (
                    <Pressable
                      key={r.id}
                      style={styles.modalRow}
                      onPress={() => {
                        setScopePick({ mode: 'river', id: r.id, name: r.name });
                        setPickerOpen(false);
                        setWaterSearch('');
                      }}
                    >
                      <Text style={styles.modalRowText}>
                        {r.name}
                        <Text style={{ ...typography.caption, color: colors.textMuted }}> · {r.region}</Text>
                      </Text>
                    </Pressable>
                  ))}
                  {riversFiltered.length === 0 ? (
                    <Text style={[styles.modalRow, { color: colors.textMuted }]}>Няма реки по филтъра.</Text>
                  ) : null}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
