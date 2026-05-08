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

function daysLeftInWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 0 : 7 - d;
}
function daysLeftInMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
}

const GOLD = '#F5A623';
const SILVER = '#A8B2BC';
const BRONZE = '#C27B3E';

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
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.background,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    headerTitle: {
      ...typography.h2,
      color: colors.text,
      flex: 1,
      textAlign: 'center',
      letterSpacing: -0.3,
    },
    headerSide: { width: 36 },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmented: {
      flexDirection: 'row',
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
      shadowOpacity: 0.07,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    segText: { ...typography.small, fontWeight: '700', color: colors.textMuted },
    segTextActive: { color: colors.text },
    countdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      marginTop: spacing.sm,
    },
    countdownText: { ...typography.small, color: colors.textMuted },
    podiumSection: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
    },
    podiumRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: spacing.xl,
      width: '100%',
    },
    podiumItem: { alignItems: 'center', gap: spacing.xs },
    ringWrap: {
      borderRadius: 999,
      padding: 3,
    },
    circle: {
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    podiumName: {
      ...typography.small,
      color: colors.text,
      fontWeight: '700',
      textAlign: 'center',
      maxWidth: 80,
    },
    podiumLikes: {
      ...typography.small,
      color: colors.textMuted,
      textAlign: 'center',
      fontSize: 11,
    },
    rankLabel: {
      fontSize: 18,
      textAlign: 'center',
      marginBottom: spacing.xs,
    },
    spotlightWrap: {
      marginHorizontal: spacing.lg,
      borderRadius: radius.xl,
      overflow: 'hidden',
      height: 220,
    },
    spotlightOverlay: {
      position: 'absolute',
      inset: 0,
      justifyContent: 'flex-end',
      padding: spacing.md,
    },
    spotlightTopRow: {
      position: 'absolute',
      top: spacing.md,
      left: spacing.md,
      right: spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    spotlightLabel: {
      ...typography.overline,
      color: GOLD,
      letterSpacing: 2,
      fontSize: 10,
      fontWeight: '800',
    },
    spotlightLikesBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    spotlightLikesText: { ...typography.small, color: '#fff', fontWeight: '700' },
    spotlightInfo: {
      gap: 2,
    },
    spotlightAuthor: {
      ...typography.small,
      color: 'rgba(255,255,255,0.65)',
      fontWeight: '600',
    },
    spotlightTitle: {
      ...typography.h3,
      color: '#fff',
      letterSpacing: -0.3,
    },
    divLine: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
    },
    listLabel: {
      ...typography.overline,
      color: colors.textMuted,
      letterSpacing: 1.2,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
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
      width: 24,
      alignItems: 'center',
    },
    rankNumText: {
      ...typography.bodyBold,
      color: colors.textMuted,
      fontSize: 13,
    },
    rankThumb: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.primarySurface,
    },
    rankInfo: { flex: 1 },
    rankName: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    rankSub: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    rankLikes: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    rankLikesNum: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.md,
    },
    emptyIcon: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.primarySurface,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: { ...typography.h2, color: colors.text, textAlign: 'center' },
    emptyBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    stepsCard: {
      width: '100%',
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: spacing.sm,
    },
    stepsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
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
      <View style={styles.headerTop}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>🏆  Класики</Text>
        <View style={styles.headerSide} />
      </View>
      <View style={styles.segmented}>
        {(['week', 'month'] as ClassicPeriod[]).map((p) => (
          <Pressable key={p} style={[styles.segItem, period === p && styles.segItemActive]} onPress={() => setPeriod(p)}>
            <Text style={[styles.segText, period === p && styles.segTextActive]}>
              {p === 'week' ? 'Седмица' : 'Месец'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.countdownRow}>
        <Ionicons name="time-outline" size={12} color={colors.textMuted} />
        <Text style={styles.countdownText}>
          {daysLeft === 0
            ? 'Последен ден от периода'
            : `${daysLeft} ${daysLeft === 1 ? 'ден' : 'дни'} до края на периода`}
        </Text>
      </View>
    </View>
  );

  const CirclePhoto = ({
    row,
    size,
    ringColor,
  }: {
    row: RankedClassicPhoto;
    size: number;
    ringColor: string;
  }) => (
    <View style={[styles.ringWrap, { borderWidth: 3, borderColor: ringColor }]}>
      <View style={[styles.circle, { width: size, height: size }]}>
        {row.item.photoUri ? (
          <Image source={{ uri: row.item.photoUri }} style={{ width: size, height: size }} contentFit="cover" />
        ) : (
          <Ionicons name="fish-outline" size={size * 0.4} color={colors.primary} />
        )}
      </View>
    </View>
  );

  const Podium = (
    <View style={styles.podiumSection}>
      <View style={styles.podiumRow}>
        {second ? (
          <Pressable
            style={styles.podiumItem}
            onPress={() => navigation.navigate('UserPublicProfile', { uid: second.item.ownerUid, displayName: second.item.ownerName })}
          >
            <Text style={styles.rankLabel}>🥈</Text>
            <CirclePhoto row={second} size={72} ringColor={SILVER} />
            <Text style={styles.podiumName} numberOfLines={1}>{second.item.ownerName ?? 'Рибар'}</Text>
            <Text style={styles.podiumLikes}>❤️ {second.likes}</Text>
          </Pressable>
        ) : <View style={{ width: 72 }} />}

        {first ? (
          <Pressable
            style={[styles.podiumItem, { marginBottom: 0 }]}
            onPress={() => navigation.navigate('UserPublicProfile', { uid: first.item.ownerUid, displayName: first.item.ownerName })}
          >
            <Text style={[styles.rankLabel, { fontSize: 24 }]}>🥇</Text>
            <CirclePhoto row={first} size={96} ringColor={GOLD} />
            <Text style={[styles.podiumName, { color: GOLD, maxWidth: 100 }]} numberOfLines={1}>{first.item.ownerName ?? 'Рибар'}</Text>
            <Text style={styles.podiumLikes}>❤️ {first.likes}</Text>
          </Pressable>
        ) : null}

        {third ? (
          <Pressable
            style={styles.podiumItem}
            onPress={() => navigation.navigate('UserPublicProfile', { uid: third.item.ownerUid, displayName: third.item.ownerName })}
          >
            <Text style={styles.rankLabel}>🥉</Text>
            <CirclePhoto row={third} size={72} ringColor={BRONZE} />
            <Text style={styles.podiumName} numberOfLines={1}>{third.item.ownerName ?? 'Рибар'}</Text>
            <Text style={styles.podiumLikes}>❤️ {third.likes}</Text>
          </Pressable>
        ) : <View style={{ width: 72 }} />}
      </View>
    </View>
  );

  const WinnerSpotlight = first ? (
    <Pressable
      style={styles.spotlightWrap}
      onPress={() => navigation.navigate('UserPublicProfile', { uid: first.item.ownerUid, displayName: first.item.ownerName })}
    >
      {first.item.photoUri ? (
        <Image source={{ uri: first.item.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="fish-outline" size={56} color={colors.primary} />
        </View>
      )}
      <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <View style={styles.spotlightTopRow}>
        <Text style={styles.spotlightLabel}>СНИМКА НА ПОБЕДИТЕЛЯ</Text>
        <View style={styles.spotlightLikesBadge}>
          <Ionicons name="heart" size={12} color="#ff6b6b" />
          <Text style={styles.spotlightLikesText}>{first.likes}</Text>
        </View>
      </View>
      <View style={styles.spotlightOverlay}>
        <View style={styles.spotlightInfo}>
          <Text style={styles.spotlightAuthor}>{first.item.ownerName ?? 'Рибар'}</Text>
          <Text style={styles.spotlightTitle} numberOfLines={1}>
            {first.item.photoTitle ?? first.item.speciesName}
          </Text>
        </View>
      </View>
    </Pressable>
  ) : null;

  const StepsCard = (
    <View style={styles.stepsCard}>
      {['Запиши улов в Дневника', 'Добави заглавие на снимката', 'Сподели публично в Лентата'].map((s, i) => (
        <View key={i} style={[styles.stepsRow, i === 2 && { borderBottomWidth: 0 }]}>
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
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <Text style={{ fontSize: 42 }}>🏆</Text>
            </View>
            <Text style={styles.emptyTitle}>Все още няма снимки</Text>
            <Text style={styles.emptyBody}>
              Бъди първият! Сподели улов с именувана снимка в Лентата.
            </Text>
            {StepsCard}
          </View>
        </ScrollView>
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
              {Podium}
              {WinnerSpotlight}
              {rest.length > 0 ? (
                <>
                  <View style={styles.divLine} />
                  <Text style={styles.listLabel}>ОСТАНАЛИ</Text>
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
                  <Image source={{ uri: row.item.photoUri }} style={{ width: 48, height: 48 }} contentFit="cover" recyclingKey={row.item.id} />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="fish-outline" size={20} color={colors.primary} />
                  </View>
                )}
              </View>
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
    </Screen>
  );
}
