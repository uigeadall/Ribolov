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

const { width: SW, height: SH } = Dimensions.get('window');
const HERO_H = SH * 0.44;
const RUNNER_W = (SW - spacing.lg * 2 - spacing.sm) / 2;
const RUNNER_H = RUNNER_W * 1.3;

const BG = '#0b1820';
const SURFACE = 'rgba(255,255,255,0.07)';
const BORDER = 'rgba(255,255,255,0.1)';
const TEXT = '#ffffff';
const TEXT_MUTED = 'rgba(255,255,255,0.5)';
const GOLD = '#F5A623';

function daysLeftInWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 0 : 7 - d;
}
function daysLeftInMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
}

type FullScreenPhoto = { uri: string; author: string; title: string; likes: number };

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
  const [fullScreen, setFullScreen] = useState<FullScreenPhoto | null>(null);

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    header: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingTop: insets.top + spacing.xs,
      paddingBottom: spacing.sm,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      ...typography.h2,
      color: TEXT,
      flex: 1,
      letterSpacing: -0.3,
    },
    segmented: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: radius.md,
      padding: 3,
    },
    segItem: {
      paddingVertical: 6,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md - 2,
      alignItems: 'center',
    },
    segActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
    segText: { ...typography.small, fontWeight: '700', color: TEXT_MUTED },
    segTextActive: { color: TEXT },
    hero: {
      width: SW,
      height: HERO_H,
      backgroundColor: '#1a2a35',
    },
    heroGradientTop: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: 120,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    heroGradientBottom: {
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      height: 140,
      backgroundColor: 'rgba(0,0,0,0.72)',
    },
    heroTopBadge: {
      position: 'absolute',
      bottom: spacing.md + 56,
      left: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    goldDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: GOLD,
    },
    heroLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: GOLD,
      letterSpacing: 2,
    },
    heroInfoRow: {
      position: 'absolute',
      bottom: spacing.md,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    heroName: { ...typography.small, color: TEXT_MUTED, fontWeight: '600' },
    heroTitle: { ...typography.h3, color: TEXT, marginTop: 2, letterSpacing: -0.3 },
    heroLikesBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: 'rgba(255,255,255,0.12)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.15)',
    },
    heroLikesText: { ...typography.bodyBold, color: TEXT, fontSize: 13 },
    body: { flex: 1, backgroundColor: BG },
    runnersLabel: {
      ...typography.overline,
      color: TEXT_MUTED,
      letterSpacing: 1.5,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    runnersRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    runnerCard: {
      width: RUNNER_W,
      height: RUNNER_H,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: SURFACE,
      borderWidth: 1,
      borderColor: BORDER,
    },
    runnerOverlay: {
      position: 'absolute',
      inset: 0,
      justifyContent: 'space-between',
      padding: spacing.sm,
    },
    runnerMedal: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    runnerMedalText: { fontSize: 16 },
    runnerBottom: { gap: 2 },
    runnerName: { ...typography.small, color: TEXT, fontWeight: '700', fontSize: 12 },
    runnerLikes: { ...typography.small, color: TEXT_MUTED, fontSize: 11 },
    divRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    divLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
    divLabel: { ...typography.overline, color: TEXT_MUTED, letterSpacing: 1.5, fontSize: 10 },
    rankRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      gap: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: BORDER,
    },
    rankNum: {
      width: 24,
      alignItems: 'center',
    },
    rankNumText: {
      ...typography.bodyBold,
      color: TEXT_MUTED,
      fontSize: 13,
    },
    rankThumb: {
      width: 50,
      height: 50,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: SURFACE,
      borderWidth: 1,
      borderColor: BORDER,
    },
    rankInfo: { flex: 1 },
    rankName: { ...typography.bodyBold, color: TEXT, fontSize: 14 },
    rankSub: { ...typography.small, color: TEXT_MUTED, marginTop: 2 },
    rankLikes: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rankLikesNum: { ...typography.bodyBold, color: TEXT, fontSize: 13 },
    emptyWrap: {
      flex: 1,
      backgroundColor: BG,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.lg,
    },
    emptyTitle: { ...typography.h2, color: TEXT, textAlign: 'center' },
    emptyBody: { ...typography.body, color: TEXT_MUTED, textAlign: 'center', lineHeight: 22 },
    stepsCard: {
      width: '100%',
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: SURFACE,
      borderWidth: 1,
      borderColor: BORDER,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: BORDER,
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
    stepText: { ...typography.body, color: TEXT, flex: 1, fontSize: 13 },
    fsOverlay: { flex: 1, backgroundColor: '#000' },
    fsClose: {
      position: 'absolute',
      top: insets.top + 12,
      right: spacing.lg,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    fsBottom: {
      position: 'absolute',
      bottom: insets.bottom + spacing.lg,
      left: spacing.lg,
      right: spacing.lg,
      gap: 3,
    },
    fsAuthor: { ...typography.small, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
    fsTitle: { ...typography.h3, color: '#fff' },
    fsLikes: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    fsLikesText: { ...typography.bodyBold, color: '#fff' },
  }), [colors, insets]);

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

  const openPhoto = (row: RankedClassicPhoto) => {
    if (!row.item.photoUri) return;
    setFullScreen({
      uri: row.item.photoUri,
      author: row.item.ownerName ?? 'Рибар',
      title: row.item.photoTitle ?? row.item.speciesName,
      likes: row.likes,
    });
  };

  const Header = (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
        <Ionicons name="chevron-back" size={20} color={TEXT} />
      </Pressable>
      <Text style={styles.headerTitle}>🏆 Класики</Text>
      <View style={styles.segmented}>
        {(['week', 'month'] as ClassicPeriod[]).map((p) => (
          <Pressable key={p} style={[styles.segItem, period === p && styles.segActive]} onPress={() => setPeriod(p)}>
            <Text style={[styles.segText, period === p && styles.segTextActive]}>
              {p === 'week' ? 'Седмица' : 'Месец'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const StepsCard = (
    <View style={styles.stepsCard}>
      {['Запиши улов в Дневника', 'Добави заглавие на снимката', 'Сподели публично в Лентата'].map((s, i) => (
        <View key={i} style={[styles.stepRow, i === 2 && { borderBottomWidth: 0 }]}>
          <View style={styles.stepDot}><Text style={styles.stepDotText}>{i + 1}</Text></View>
          <Text style={styles.stepText}>{s}</Text>
        </View>
      ))}
    </View>
  );

  if (!configured || !user) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {Header}
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg, paddingTop: insets.top + 60 }}>
          <Card>
            <Text style={{ ...typography.h3, color: colors.text }}>Нужен е акаунт</Text>
            <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.sm }}>
              Влез, за да виждаш класацията.
            </Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Full screen photo viewer */}
      <Modal visible={!!fullScreen} transparent={false} animationType="fade" statusBarTranslucent>
        <StatusBar hidden />
        <View style={styles.fsOverlay}>
          {fullScreen ? (
            <Image source={{ uri: fullScreen.uri }} style={{ width: SW, height: SH }} contentFit="contain" />
          ) : null}
          <Pressable style={styles.fsClose} onPress={() => setFullScreen(null)} hitSlop={8}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          {fullScreen ? (
            <View style={styles.fsBottom}>
              <Text style={styles.fsAuthor}>{fullScreen.author}</Text>
              <Text style={styles.fsTitle} numberOfLines={2}>{fullScreen.title}</Text>
              <View style={styles.fsLikes}>
                <Ionicons name="heart" size={15} color="#ff6b6b" />
                <Text style={styles.fsLikesText}>{fullScreen.likes} харесвания</Text>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {loading && rows.length === 0 ? (
        <>
          {Header}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ ...typography.body, color: TEXT_MUTED }}>Броим харесванията…</Text>
          </View>
        </>
      ) : error ? (
        <>
          {Header}
          <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
            <View style={[styles.stepsCard, { padding: spacing.md }]}>
              <Text style={{ ...typography.h3, color: TEXT }}>Грешка при зареждане</Text>
              <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
            </View>
          </View>
        </>
      ) : rows.length === 0 ? (
        <>
          {Header}
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            style={{ paddingTop: insets.top + 56 }}
          >
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 56 }}>🏆</Text>
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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ListHeaderComponent={
            <>
              {/* Hero — #1 full-bleed photo */}
              <Pressable onPress={() => first && openPhoto(first)}>
                <View style={styles.hero}>
                  {first?.item.photoUri ? (
                    <Image
                      source={{ uri: first.item.photoUri }}
                      style={{ width: SW, height: HERO_H }}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="fish-outline" size={64} color="rgba(255,255,255,0.2)" />
                    </View>
                  )}
                  <View style={styles.heroGradientTop} />
                  <View style={styles.heroGradientBottom} />

                  {/* Floating header over hero */}
                  {Header}

                  {first ? (
                    <>
                      <View style={styles.heroTopBadge}>
                        <View style={styles.goldDot} />
                        <Text style={styles.heroLabel}>КЛАСИК НА {period === 'week' ? 'СЕДМИЦАТА' : 'МЕСЕЦА'}</Text>
                      </View>
                      <View style={styles.heroInfoRow}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.heroName}>{first.item.ownerName ?? 'Рибар'}</Text>
                          <Text style={styles.heroTitle} numberOfLines={1}>
                            {first.item.photoTitle ?? first.item.speciesName}
                          </Text>
                        </View>
                        <View style={styles.heroLikesBadge}>
                          <Ionicons name="heart" size={13} color="#ff6b6b" />
                          <Text style={styles.heroLikesText}>{first.likes}</Text>
                        </View>
                      </View>
                    </>
                  ) : null}
                </View>
              </Pressable>

              {/* #2 and #3 runner-up cards */}
              {(second || third) ? (
                <>
                  <Text style={styles.runnersLabel}>ПРЕСЛЕДВАЧИ</Text>
                  <View style={styles.runnersRow}>
                    {[second, third].map((row, idx) =>
                      row ? (
                        <Pressable key={row.item.id} style={styles.runnerCard} onPress={() => openPhoto(row)}>
                          {row.item.photoUri ? (
                            <Image
                              source={{ uri: row.item.photoUri }}
                              style={{ width: RUNNER_W, height: RUNNER_H }}
                              contentFit="cover"
                            />
                          ) : (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="fish-outline" size={36} color="rgba(255,255,255,0.25)" />
                            </View>
                          )}
                          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)' }} />
                          <View style={styles.runnerOverlay}>
                            <View style={styles.runnerMedal}>
                              <Text style={styles.runnerMedalText}>{idx === 0 ? '🥈' : '🥉'}</Text>
                            </View>
                            <View style={styles.runnerBottom}>
                              <Text style={styles.runnerName} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
                              <Text style={styles.runnerLikes}>❤️ {row.likes}</Text>
                            </View>
                          </View>
                        </Pressable>
                      ) : <View key={idx} style={{ width: RUNNER_W }} />
                    )}
                  </View>
                </>
              ) : null}

              {rest.length > 0 ? (
                <View style={styles.divRow}>
                  <View style={styles.divLine} />
                  <Text style={styles.divLabel}>ОСТАНАЛИ</Text>
                  <View style={styles.divLine} />
                </View>
              ) : null}
            </>
          }
          renderItem={({ item: row, index }) => (
            <Pressable style={styles.rankRow} onPress={() => openPhoto(row)}>
              <View style={styles.rankNum}>
                <Text style={styles.rankNumText}>#{index + 4}</Text>
              </View>
              <Pressable style={styles.rankThumb} onPress={() => openPhoto(row)}>
                {row.item.photoUri ? (
                  <Image
                    source={{ uri: row.item.photoUri }}
                    style={{ width: 50, height: 50 }}
                    contentFit="cover"
                    recyclingKey={row.item.id}
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="fish-outline" size={20} color="rgba(255,255,255,0.3)" />
                  </View>
                )}
              </Pressable>
              <View style={styles.rankInfo}>
                <Text style={styles.rankName} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
                <Text style={styles.rankSub} numberOfLines={1}>{row.item.photoTitle ?? row.item.speciesName}</Text>
              </View>
              <View style={styles.rankLikes}>
                <Ionicons name="heart" size={13} color="#ff6b6b" />
                <Text style={styles.rankLikesNum}>{row.likes}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
