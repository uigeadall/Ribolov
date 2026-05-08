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
  Modal,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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

const { width: SW, height: SH } = Dimensions.get('window');

const GOLD   = '#F5C842';
const SILVER = '#B0BEC5';
const BRONZE = '#CD8C5A';

const PODIUM: Record<number, { color: string; blockH: number; circleSize: number; medal: string }> = {
  1: { color: GOLD,   blockH: 72, circleSize: 88, medal: '🥇' },
  2: { color: SILVER, blockH: 50, circleSize: 76, medal: '🥈' },
  3: { color: BRONZE, blockH: 36, circleSize: 68, medal: '🥉' },
};

function daysLeft(period: ClassicPeriod): number {
  if (period === 'week') {
    const d = new Date().getDay();
    return d === 0 ? 0 : 7 - d;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
}

type FullScreen = { uri: string; author: string; title: string; likes: number };

export default function ClassicsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, configured } = useAuth();
  const { colors } = useTheme();

  const [period, setPeriod]     = useState<ClassicPeriod>('week');
  const [rows, setRows]         = useState<RankedClassicPhoto[]>([]);
  const [loading, setLoading]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState<FullScreen | null>(null);

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setLoading(true); setError(null);
    try { setRows(await fetchRankedClassicPhotos(periodStartIso(period))); }
    catch (e: unknown) { setError(formatFirebaseError(e)); setRows([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [configured, user, period]);

  useEffect(() => { if (user && configured) load(); }, [load, user, configured]);

  const left = daysLeft(period);
  const [first, second, third, ...rest] = rows;

  const openPhoto = (row: RankedClassicPhoto) => {
    if (!row.item.photoUri) return;
    setFullScreen({
      uri: row.item.photoUri,
      author: row.item.ownerName ?? 'Рибар',
      title: row.item.photoTitle ?? row.item.speciesName,
      likes: row.likes,
    });
  };

  const s = useMemo(() => StyleSheet.create({
    // ── banner ──────────────────────────────────────────────
    banner: {
      backgroundColor: colors.primaryDark,
      paddingTop: insets.top + spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    bannerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.xl,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center', justifyContent: 'center',
    },
    bannerTitleWrap: { flex: 1, alignItems: 'center' },
    bannerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.4 },
    periodToggle: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: radius.pill,
      padding: 3,
    },
    ptItem: {
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
      borderRadius: radius.pill,
    },
    ptActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
    ptText: { ...typography.small, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
    ptTextActive: { color: '#fff' },
    // ── podium ───────────────────────────────────────────────
    podiumRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: spacing.lg,
    },
    podiumSlot: { alignItems: 'center', gap: spacing.xs },
    podiumCircleWrap: {
      borderRadius: 999,
      padding: 3,
    },
    podiumCircle: {
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center', justifyContent: 'center',
    },
    podiumBlock: {
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingBottom: 4,
      width: 80,
    },
    podiumRankText: { fontSize: 11, fontWeight: '800', color: 'rgba(0,0,0,0.5)' },
    podiumName: {
      ...typography.small, color: 'rgba(255,255,255,0.85)',
      fontWeight: '700', textAlign: 'center', maxWidth: 82,
    },
    podiumLikes: {
      ...typography.small, color: 'rgba(255,255,255,0.5)',
      textAlign: 'center', fontSize: 11, marginTop: 1,
    },
    // ── countdown strip ──────────────────────────────────────
    countdownStrip: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 6, marginTop: spacing.lg,
    },
    countdownText: { ...typography.small, color: 'rgba(255,255,255,0.55)' },
    // ── featured card ────────────────────────────────────────
    featuredWrap: {
      marginHorizontal: spacing.lg,
      marginTop: -spacing.lg,
      borderRadius: radius.xl,
      overflow: 'hidden',
      height: 210,
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    featuredOverlay: {
      position: 'absolute', inset: 0,
      justifyContent: 'space-between',
      padding: spacing.md,
    },
    featuredBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      backgroundColor: GOLD, paddingHorizontal: spacing.md,
      paddingVertical: 5, borderRadius: radius.pill,
    },
    featuredBadgeText: { fontSize: 11, fontWeight: '800', color: '#1a1a1a', letterSpacing: 0.5 },
    featuredBottom: { gap: 3 },
    featuredAuthor: { ...typography.small, color: 'rgba(255,255,255,0.65)', fontWeight: '600' },
    featuredTitle: { ...typography.h3, color: '#fff', letterSpacing: -0.3 },
    featuredLikes: {
      flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3,
    },
    featuredLikesText: { ...typography.small, color: '#fff', fontWeight: '700' },
    // ── list ─────────────────────────────────────────────────
    listHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs,
      gap: spacing.sm,
    },
    listHeaderLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    listHeaderLabel: { ...typography.overline, color: colors.textMuted, letterSpacing: 1.2, fontSize: 10 },
    rankRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
      gap: spacing.md,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rankNumBox: {
      width: 28, height: 28, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
    },
    rankNumText: { fontSize: 13, fontWeight: '800' },
    rankAvatar: {
      width: 50, height: 50, borderRadius: 25,
      overflow: 'hidden', backgroundColor: colors.primarySurface,
    },
    rankInfo: { flex: 1 },
    rankName: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    rankSub: { ...typography.small, color: colors.textMuted, marginTop: 2 },
    rankLikesRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rankLikesNum: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    // ── empty ────────────────────────────────────────────────
    emptyBanner: {
      backgroundColor: colors.primaryDark,
      paddingTop: insets.top + spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
      alignItems: 'center', gap: spacing.sm,
    },
    emptyBannerTopRow: {
      width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md,
    },
    emptyTitle: { ...typography.h2, color: '#fff', textAlign: 'center' },
    emptyBody: { ...typography.body, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 22 },
    stepsCard: {
      marginHorizontal: spacing.lg, marginTop: spacing.xl,
      borderRadius: radius.lg, overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    stepRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      padding: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    stepDot: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    },
    stepDotText: { fontSize: 12, fontWeight: '800', color: '#fff' },
    stepText: { ...typography.body, color: colors.text, flex: 1, fontSize: 13 },
    // ── fullscreen viewer ─────────────────────────────────────
    fsRoot: { flex: 1, backgroundColor: '#000' },
    fsClose: {
      position: 'absolute', top: insets.top + 12, right: spacing.lg,
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center', justifyContent: 'center', zIndex: 10,
    },
    fsBottom: {
      position: 'absolute', bottom: insets.bottom + spacing.lg,
      left: spacing.lg, right: spacing.lg, gap: 3,
    },
    fsAuthor: { ...typography.small, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
    fsTitle: { ...typography.h3, color: '#fff' },
    fsLikesRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    fsLikesText: { ...typography.bodyBold, color: '#fff' },
  }), [colors, insets]);

  // ── podium slot component ────────────────────────────────────────────────────
  const PodiumSlot = ({ row, rank }: { row: RankedClassicPhoto; rank: 1 | 2 | 3 }) => {
    const cfg = PODIUM[rank];
    return (
      <Pressable style={s.podiumSlot} onPress={() => openPhoto(row)}>
        <View style={[s.podiumCircleWrap, { borderWidth: 3, borderColor: cfg.color }]}>
          <View style={[s.podiumCircle, { width: cfg.circleSize, height: cfg.circleSize }]}>
            {row.item.photoUri ? (
              <Image source={{ uri: row.item.photoUri }} style={{ width: cfg.circleSize, height: cfg.circleSize }} contentFit="cover" />
            ) : (
              <Ionicons name="fish-outline" size={cfg.circleSize * 0.4} color="rgba(255,255,255,0.4)" />
            )}
          </View>
        </View>
        <View style={[s.podiumBlock, { height: cfg.blockH, backgroundColor: cfg.color }]}>
          <Text style={s.podiumRankText}>{rank === 1 ? '1ST' : rank === 2 ? '2ND' : '3RD'}</Text>
        </View>
        <Text style={s.podiumName} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
        <Text style={s.podiumLikes}>❤️ {row.likes}</Text>
      </Pressable>
    );
  };

  // ── rank row color ────────────────────────────────────────────────────────────
  const rankColor = (i: number) => {
    if (i === 0) return GOLD;
    if (i === 1) return SILVER;
    if (i === 2) return BRONZE;
    return colors.textMuted;
  };

  // ── steps card ────────────────────────────────────────────────────────────────
  const StepsCard = (
    <View style={s.stepsCard}>
      {['Снимай улова с камерата на приложението', 'Добави заглавие на снимката', 'Сподели публично в Лентата'].map((txt, i) => (
        <View key={i} style={[s.stepRow, i === 2 && { borderBottomWidth: 0 }]}>
          <View style={s.stepDot}><Text style={s.stepDotText}>{i + 1}</Text></View>
          <Text style={s.stepText}>{txt}</Text>
        </View>
      ))}
    </View>
  );

  if (!configured || !user) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ flex: 1 }}>
        <StatusBar barStyle="light-content" />
        <View style={s.emptyBanner}>
          <View style={s.emptyBannerTopRow}>
            <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
          </View>
          <Text style={{ fontSize: 48 }}>🏆</Text>
          <Text style={s.emptyTitle}>Класики</Text>
          <Text style={s.emptyBody}>Влез в акаунта си, за да виждаш класацията.</Text>
        </View>
        <View style={{ padding: spacing.lg }}>
          <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="light-content" />

      {/* Full-screen viewer */}
      <Modal visible={!!fullScreen} transparent={false} animationType="fade" statusBarTranslucent>
        <StatusBar hidden />
        <View style={s.fsRoot}>
          {fullScreen && (
            <Image source={{ uri: fullScreen.uri }} style={{ width: SW, height: SH }} contentFit="contain" />
          )}
          <Pressable style={s.fsClose} onPress={() => setFullScreen(null)} hitSlop={8}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          {fullScreen && (
            <View style={s.fsBottom}>
              <Text style={s.fsAuthor}>{fullScreen.author}</Text>
              <Text style={s.fsTitle} numberOfLines={2}>{fullScreen.title}</Text>
              <View style={s.fsLikesRow}>
                <Ionicons name="heart" size={15} color="#ff6b6b" />
                <Text style={s.fsLikesText}>{fullScreen.likes} харесвания</Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {loading && rows.length === 0 ? (
        <>
          <View style={[s.banner, { alignItems: 'center', gap: spacing.sm }]}>
            <View style={[s.bannerTopRow, { width: '100%' }]}>
              <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={8}>
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </Pressable>
            </View>
            <Text style={{ fontSize: 38 }}>🏆</Text>
            <Text style={s.bannerTitle}>Класики</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ ...typography.body, color: colors.textMuted }}>Броим харесванията…</Text>
          </View>
        </>
      ) : error ? (
        <>
          <View style={s.banner}>
            <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
            <Text style={{ ...typography.h3, color: colors.text }}>Грешка при зареждане</Text>
            <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
          </View>
        </>
      ) : rows.length === 0 ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={[s.emptyBanner]}>
            <View style={s.emptyBannerTopRow}>
              <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={8}>
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </Pressable>
            </View>
            <Text style={{ fontSize: 56 }}>🏆</Text>
            <Text style={s.emptyTitle}>Все още няма снимки</Text>
            <Text style={s.emptyBody}>
              Само снимки, направени с камерата на приложението, участват в класацията.
            </Text>
          </View>
          {StepsCard}
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.item.id}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
          }
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ListHeaderComponent={
            <>
              {/* ── Banner with podium ── */}
              <View style={s.banner}>
                {/* top row */}
                <View style={s.bannerTopRow}>
                  <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={8}>
                    <Ionicons name="chevron-back" size={20} color="#fff" />
                  </Pressable>
                  <View style={s.bannerTitleWrap}>
                    <Text style={s.bannerTitle}>🏆  Класики</Text>
                  </View>
                  <View style={s.periodToggle}>
                    {(['week', 'month'] as ClassicPeriod[]).map((p) => (
                      <Pressable key={p} style={[s.ptItem, period === p && s.ptActive]} onPress={() => setPeriod(p)}>
                        <Text style={[s.ptText, period === p && s.ptTextActive]}>
                          {p === 'week' ? 'Седм.' : 'Месец'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* podium */}
                <View style={s.podiumRow}>
                  {second
                    ? <PodiumSlot row={second} rank={2} />
                    : <View style={{ width: 80 }} />}
                  {first
                    ? <PodiumSlot row={first} rank={1} />
                    : null}
                  {third
                    ? <PodiumSlot row={third} rank={3} />
                    : <View style={{ width: 80 }} />}
                </View>

                {/* countdown */}
                <View style={s.countdownStrip}>
                  <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.4)" />
                  <Text style={s.countdownText}>
                    {left === 0 ? 'Последен ден от периода' : `${left} ${left === 1 ? 'ден' : 'дни'} до края на периода`}
                  </Text>
                </View>
              </View>

              {/* ── Featured winner card (elevated, overlaps banner) ── */}
              {first ? (
                <Pressable style={s.featuredWrap} onPress={() => openPhoto(first)}>
                  {first.item.photoUri ? (
                    <Image source={{ uri: first.item.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : (
                    <View style={{ flex: 1, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="fish-outline" size={56} color={colors.primary} />
                    </View>
                  )}
                  <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)' }} />
                  <View style={s.featuredOverlay}>
                    <View style={s.featuredBadge}>
                      <Text style={{ fontSize: 13 }}>🥇</Text>
                      <Text style={s.featuredBadgeText}>СНИМКА НА {period === 'week' ? 'СЕДМИЦАТА' : 'МЕСЕЦА'}</Text>
                    </View>
                    <View style={s.featuredBottom}>
                      <Text style={s.featuredAuthor}>{first.item.ownerName ?? 'Рибар'}</Text>
                      <Text style={s.featuredTitle} numberOfLines={1}>
                        {first.item.photoTitle ?? first.item.speciesName}
                      </Text>
                      <View style={s.featuredLikes}>
                        <Ionicons name="heart" size={13} color="#ff6b6b" />
                        <Text style={s.featuredLikesText}>{first.likes} харесвания</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              ) : null}

              {/* ── List header ── */}
              <View style={s.listHeader}>
                <View style={s.listHeaderLine} />
                <Text style={s.listHeaderLabel}>КЛАСАЦИЯ</Text>
                <View style={s.listHeaderLine} />
              </View>
            </>
          }
          renderItem={({ item: row, index }) => (
            <Pressable style={s.rankRow} onPress={() => openPhoto(row)}>
              <View style={[s.rankNumBox, { backgroundColor: index < 3 ? `${rankColor(index)}22` : colors.surfaceAlt }]}>
                <Text style={[s.rankNumText, { color: rankColor(index) }]}>{index + 1}</Text>
              </View>
              <View style={s.rankAvatar}>
                {row.item.photoUri ? (
                  <Image source={{ uri: row.item.photoUri }} style={{ width: 50, height: 50 }} contentFit="cover" recyclingKey={row.item.id} />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="fish-outline" size={20} color={colors.primary} />
                  </View>
                )}
              </View>
              <View style={s.rankInfo}>
                <Text style={s.rankName} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
                <Text style={s.rankSub} numberOfLines={1}>{row.item.photoTitle ?? row.item.speciesName}</Text>
              </View>
              <View style={s.rankLikesRow}>
                <Ionicons name="heart" size={13} color="#ff6b6b" />
                <Text style={s.rankLikesNum}>{row.likes}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
