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

const { width: SW, height: SH } = Dimensions.get('window');
const CARD_W = SW * 0.68;
const CARD_H = CARD_W * 1.45;

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
    header: {
      paddingTop: insets.top + spacing.xs,
      paddingBottom: spacing.sm,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    titleBlock: { flex: 1, marginLeft: spacing.md },
    headerTitle: { ...typography.h2, color: colors.text, letterSpacing: -0.3 },
    headerSub: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    segmented: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: 3,
    },
    segItem: {
      flex: 1,
      paddingVertical: 7,
      alignItems: 'center',
      borderRadius: radius.md - 2,
    },
    segActive: {
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOpacity: 0.07,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    segText: { ...typography.small, fontWeight: '700', color: colors.textMuted },
    segTextActive: { color: colors.text },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    sectionLabel: {
      ...typography.overline,
      color: colors.textMuted,
      letterSpacing: 1.2,
    },
    storyScroll: {
      paddingLeft: spacing.lg,
      paddingRight: spacing.md,
      paddingBottom: spacing.sm,
    },
    storyCard: {
      width: CARD_W,
      height: CARD_H,
      borderRadius: radius.xl,
      overflow: 'hidden',
      marginRight: spacing.md,
      backgroundColor: colors.primarySurface,
    },
    storyOverlay: {
      position: 'absolute',
      inset: 0,
      justifyContent: 'space-between',
      padding: spacing.md,
    },
    storyTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    medalBadge: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    medalText: { fontSize: 20 },
    likesBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
    },
    likesText: { ...typography.small, color: '#fff', fontWeight: '700' },
    storyBottom: {
      gap: 3,
    },
    storyAuthor: { ...typography.small, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
    storyTitle: { ...typography.bodyBold, color: '#fff', fontSize: 15 },
    divLine: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
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
    rankNumWrap: { width: 24, alignItems: 'center' },
    rankNum: { ...typography.bodyBold, color: colors.textMuted, fontSize: 13 },
    rankThumb: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.primarySurface,
    },
    rankInfo: { flex: 1 },
    rankName: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    rankSub: { ...typography.small, color: colors.textMuted, marginTop: 2 },
    rankLikesRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    rankLikesNum: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.md,
    },
    emptyTrophy: { fontSize: 56 },
    emptyTitle: { ...typography.h2, color: colors.text, textAlign: 'center' },
    emptyBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    stepsCard: {
      width: '100%',
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    stepRow: {
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
    // Full screen viewer
    fsOverlay: {
      flex: 1,
      backgroundColor: '#000',
    },
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
      gap: 4,
    },
    fsAuthor: { ...typography.small, color: 'rgba(255,255,255,0.65)', fontWeight: '600' },
    fsTitle: { ...typography.h3, color: '#fff' },
    fsLikes: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 4,
    },
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

  const openPhoto = (row: RankedClassicPhoto) => {
    if (!row.item.photoUri) return;
    setFullScreen({
      uri: row.item.photoUri,
      author: row.item.ownerName ?? 'Рибар',
      title: row.item.photoTitle ?? row.item.speciesName,
      likes: row.likes,
    });
  };

  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

  const Header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.headerTitle}>Класики 🏆</Text>
          <Text style={styles.headerSub}>
            {daysLeft === 0
              ? 'Последен ден от периода'
              : `${daysLeft} ${daysLeft === 1 ? 'ден' : 'дни'} до края`}
          </Text>
        </View>
      </View>
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
      {/* Full screen photo viewer */}
      <Modal visible={!!fullScreen} transparent={false} animationType="fade" statusBarTranslucent>
        <StatusBar hidden />
        <View style={styles.fsOverlay}>
          {fullScreen ? (
            <Image
              source={{ uri: fullScreen.uri }}
              style={{ width: SW, height: SH }}
              contentFit="contain"
            />
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
            <Text style={styles.emptyTrophy}>🏆</Text>
            <Text style={styles.emptyTitle}>Все още няма снимки</Text>
            <Text style={styles.emptyBody}>
              Бъди първият! Сподели улов с именувана снимка в Лентата.
            </Text>
            {StepsCard}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
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
              {/* Top 3 horizontal story cards */}
              {rows.slice(0, 3).length > 0 ? (
                <>
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionLabel}>ТОП 3</Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.storyScroll}
                  >
                    {rows.slice(0, 3).map((row, idx) => (
                      <Pressable
                        key={row.item.id}
                        style={styles.storyCard}
                        onPress={() => openPhoto(row)}
                      >
                        {row.item.photoUri ? (
                          <Image
                            source={{ uri: row.item.photoUri }}
                            style={{ width: CARD_W, height: CARD_H }}
                            contentFit="cover"
                            recyclingKey={row.item.id}
                          />
                        ) : (
                          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="fish-outline" size={56} color={colors.primary} />
                          </View>
                        )}
                        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)' }} />
                        <View style={styles.storyOverlay}>
                          <View style={styles.storyTopRow}>
                            <View style={styles.medalBadge}>
                              <Text style={styles.medalText}>{medals[idx + 1]}</Text>
                            </View>
                            <View style={styles.likesBadge}>
                              <Ionicons name="heart" size={12} color="#ff6b6b" />
                              <Text style={styles.likesText}>{row.likes}</Text>
                            </View>
                          </View>
                          <View style={styles.storyBottom}>
                            <Text style={styles.storyAuthor} numberOfLines={1}>
                              {row.item.ownerName ?? 'Рибар'}
                            </Text>
                            <Text style={styles.storyTitle} numberOfLines={2}>
                              {row.item.photoTitle ?? row.item.speciesName}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : null}

              {rows.length > 3 ? (
                <>
                  <View style={styles.divLine} />
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionLabel}>КЛАСАЦИЯ</Text>
                  </View>
                </>
              ) : null}
            </>
          }
          renderItem={({ item: row, index }) => (
            <Pressable
              style={styles.rankRow}
              onPress={() => openPhoto(row)}
            >
              <View style={styles.rankNumWrap}>
                <Text style={styles.rankNum}>#{index + 1}</Text>
              </View>
              <Pressable onPress={() => openPhoto(row)} style={styles.rankThumb}>
                {row.item.photoUri ? (
                  <Image
                    source={{ uri: row.item.photoUri }}
                    style={{ width: 52, height: 52 }}
                    contentFit="cover"
                    recyclingKey={`list-${row.item.id}`}
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="fish-outline" size={20} color={colors.primary} />
                  </View>
                )}
              </Pressable>
              <View style={styles.rankInfo}>
                <Text style={styles.rankName} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
                <Text style={styles.rankSub} numberOfLines={1}>{row.item.photoTitle ?? row.item.speciesName}</Text>
              </View>
              <View style={styles.rankLikesRow}>
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
