import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  FlatList,
  Dimensions,
} from 'react-native';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import * as Haptics from 'expo-haptics';
import { Skeleton } from '../components/Skeleton';
import { TrophyHero, TrophyHeroButton } from '../components/TrophyHero';
import { TrophyShelf } from '../components/TrophyShelf';
import { FeedItem } from '../components/FeedPost';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../services/authContext';
import {
  fetchPublicCatchesByOwner,
  getUserPublicSummary,
  isFollowingUser,
  followUser,
  unfollowUser,
  ensureDirectConversation,
  getFollowerCount,
  getFollowingCount,
} from '../services/cloudSync';
import { sendFollowNotification } from '../services/socialFeed';
import { handleError } from '../utils/handleError';
import { blockUser, unblockUser } from '../services/blockUser';
import { useAppNavigation } from '../navigation/useAppNavigation';

const SW = Dimensions.get('window').width;
const GRID_PAD = spacing.lg;
const GRID_GAP = 2;
const GRID_CELL = (SW - GRID_PAD * 2 - GRID_GAP * 2) / 3;

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    /* ── stats card ── */
    statsCard: {
      flexDirection: 'row',
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
    },
    statCell: { flex: 1, alignItems: 'center' },
    statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
    statNum: { ...typography.h2, color: colors.text, fontSize: 20, fontWeight: '800' },
    statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 11 },

    /* ── actions ── */
    actionsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
    },
    followBtn: {
      flex: 1,
      height: 46,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    followBtnActive: { backgroundColor: colors.primary },
    followBtnInactive: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    followBtnText: { ...typography.bodyBold, color: '#fff', fontSize: 15 },
    followBtnTextInactive: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
    msgBtn: {
      width: 46,
      height: 46,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* ── section header ── */
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    sectionAccent: { width: 4, height: 18, borderRadius: 2, backgroundColor: colors.primary },
    sectionTitle: { ...typography.h3, color: colors.text },
    sectionBadge: {
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
      marginLeft: 'auto',
    },
    sectionBadgeText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 11 },

    /* ── grid ── */
    gridWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: GRID_PAD,
      gap: GRID_GAP,
    },
    gridCell: {
      width: GRID_CELL,
      height: GRID_CELL,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: 4,
    },
    gridImg: { width: '100%', height: '100%' },
    gridTrophy: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* ── misc ── */
    hint: {
      ...typography.caption,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
    },
    emptyFeed: {
      alignItems: 'center',
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
    },
    emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  });
}

export default function UserPublicProfileScreen() {
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'UserPublicProfile'>>();
  const { uid, displayName: routeName, photoUrlHint } = route.params;
  const { user, configured } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [summaryName, setSummaryName] = useState(routeName ?? 'Рибар');
  const [city, setCity] = useState<string | undefined>();
  const [bio, setBio] = useState<string | undefined>();
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(
    photoUrlHint?.trim() ? photoUrlHint.trim() : undefined
  );
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [catches, setCatches] = useState<FeedItem[]>([]);
  const [blocked, setBlocked] = useState(false);

  const isSelf = user?.uid === uid;

  const bestCatch = useMemo(() => {
    let best: FeedItem | null = null;
    for (const c of catches) {
      if (typeof c.weightKg !== 'number') continue;
      if (!best || (c.weightKg ?? 0) > (best.weightKg ?? 0)) best = c;
    }
    return best;
  }, [catches]);
  const bestCatchId = bestCatch?.id ?? null;
  const totalKg = useMemo(() => catches.reduce((s, c) => s + (c.weightKg ?? 0), 0), [catches]);

  const handleBlockMenu = () => {
    if (!user || isSelf) return;
    Alert.alert(
      summaryName,
      blocked ? 'Вече си блокирал този потребител.' : 'Какво искаш да направиш?',
      blocked
        ? [
            { text: 'Отказ', style: 'cancel' },
            {
              text: 'Деблокирай',
              onPress: async () => {
                await unblockUser(user.uid, uid).catch(() => {});
                setBlocked(false);
              },
            },
          ]
        : [
            { text: 'Отказ', style: 'cancel' },
            {
              text: 'Блокирай',
              style: 'destructive',
              onPress: () => {
                Alert.alert(
                  'Блокирай потребителя',
                  `Уловите на ${summaryName} няма да се показват в лентата ти.`,
                  [
                    { text: 'Отказ', style: 'cancel' },
                    {
                      text: 'Блокирай',
                      style: 'destructive',
                      onPress: async () => {
                        await blockUser(user.uid, uid).catch(() => {});
                        setBlocked(true);
                        navigation.goBack();
                      },
                    },
                  ]
                );
              },
            },
          ]
    );
  };

  const load = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    try {
      const self = user?.uid === uid;
      const [sum, list, fol, fc, fwc] = await Promise.all([
        getUserPublicSummary(uid),
        fetchPublicCatchesByOwner(uid, 50),
        user && !self ? isFollowingUser(user.uid, uid) : Promise.resolve(false),
        getFollowerCount(uid),
        getFollowingCount(uid),
      ]);
      if (sum?.displayName) setSummaryName(sum.displayName);
      setCity(sum?.city);
      setBio(sum?.bio);
      setPhotoUrl(
        sum?.photoUrl?.trim() ||
          (photoUrlHint?.trim() ? photoUrlHint.trim() : undefined)
      );
      setCatches(list as FeedItem[]);
      setFollowing(!!fol);
      setFollowerCount(fc);
      setFollowingCount(fwc);
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured, uid, user, photoUrlHint]);

  useFocusEffect(
    useCallback(() => {
      setPhotoUrl(photoUrlHint?.trim() ? photoUrlHint.trim() : undefined);
      setLoading(true);
      void load();
    }, [load, photoUrlHint])
  );

  const onRefresh = () => { setRefreshing(true); load(); };

  const toggleFollow = async () => {
    if (!user || isSelf) return;
    setFollowBusy(true);
    // Light haptic when following; selection-style when unfollowing. Match
    // the rest of the app (PeopleYouMayKnowRow uses Light on follow).
    void Haptics.impactAsync(
      following ? Haptics.ImpactFeedbackStyle.Soft : Haptics.ImpactFeedbackStyle.Light,
    );
    try {
      if (following) {
        await unfollowUser(user.uid, uid);
        setFollowing(false);
        setFollowerCount((n) => Math.max(0, n - 1));
      } else {
        await followUser(user.uid, uid, summaryName);
        await sendFollowNotification(uid, user.uid, user.displayName ?? user.email ?? 'Рибар');
        setFollowing(true);
        setFollowerCount((n) => n + 1);
      }
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setFollowBusy(false);
    }
  };

  const openChat = async () => {
    if (!user || isSelf) return;
    try {
      const myName = user.displayName ?? user.email ?? 'Рибар';
      const convId = await ensureDirectConversation(user.uid, myName, uid, summaryName);
      navigation.navigate('Main', {
        screen: 'ProfileTab',
        params: { screen: 'ChatDetail', params: { convId, otherUid: uid, otherName: summaryName } },
      });
    } catch (e: unknown) {
      handleError(e, 'Чат');
    }
  };

  if (loading && !refreshing) {
    return (
      <Screen padded={false}>
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <Skeleton height={220} width="100%" borderRadius={0} />
          <View style={{ alignItems: 'center', marginTop: -54 }}>
            <Skeleton width={108} height={108} borderRadius={54} />
          </View>
          <View style={{ alignItems: 'center', marginTop: spacing.md, gap: 8 }}>
            <Skeleton width={180} height={22} borderRadius={4} />
            <Skeleton width={110} height={12} borderRadius={4} />
          </View>
          <View style={{ flexDirection: 'row', marginHorizontal: spacing.lg, marginTop: spacing.lg, gap: spacing.sm }}>
            <Skeleton height={72} width="32%" />
            <Skeleton height={72} width="32%" />
            <Skeleton height={72} width="32%" />
          </View>
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen padded={false}>
        <View style={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg }}>
          <Card>
            <Text style={{ ...typography.body, color: colors.danger }}>{error}</Text>
            <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      </Screen>
    );
  }

  const initials = summaryName.slice(0, 1).toUpperCase();

  const ListHeader = (
    <View>
      <TrophyHero
        name={summaryName}
        city={city}
        bio={bio}
        avatarUrl={photoUrl}
        initials={initials}
        bestCatch={bestCatch ? {
          photoUri: bestCatch.photoUri,
          speciesName: bestCatch.speciesName,
          weightKg: bestCatch.weightKg,
          date: bestCatch.date,
        } : undefined}
        topLeft={<TrophyHeroButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Назад" />}
        topRight={
          user && !isSelf
            ? <TrophyHeroButton icon="ellipsis-horizontal" onPress={handleBlockMenu} accessibilityLabel="Опции" />
            : undefined
        }
      />

      {/* Stats — three cells: catches / followers / following */}
      <View style={styles.statsCard}>
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{catches.length}</Text>
          <Text style={styles.statLbl}>Улови</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{followerCount}</Text>
          <Text style={styles.statLbl}>Последователи</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{followingCount}</Text>
          <Text style={styles.statLbl}>Следва</Text>
        </View>
      </View>

      {/* Bonus stat — total kg, only when there are catches */}
      {totalKg > 0 ? (
        <Text style={[styles.hint, { marginTop: spacing.sm }]}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>{totalKg.toFixed(1)} кг</Text>
          <Text> общо споделени</Text>
        </Text>
      ) : null}

      {/* Actions */}
      {!user ? (
        <Text style={[styles.hint, { marginTop: spacing.lg }]}>
          Влез в акаунт, за да следваш или да пишеш на този рибар.
        </Text>
      ) : isSelf ? (
        <Text style={styles.hint}>
          Така изглежда профилът ти за другите рибари.
        </Text>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.followBtn, following ? styles.followBtnInactive : styles.followBtnActive]}
            onPress={toggleFollow}
            disabled={followBusy}
          >
            {followBusy ? (
              <ActivityIndicator size="small" color={following ? colors.text : '#fff'} />
            ) : (
              <>
                <Ionicons
                  name={following ? 'checkmark-circle' : 'person-add-outline'}
                  size={18}
                  color={following ? colors.text : '#fff'}
                />
                <Text style={following ? styles.followBtnTextInactive : styles.followBtnText}>
                  {following ? 'Следваш' : 'Следвай'}
                </Text>
              </>
            )}
          </Pressable>
          <Pressable style={styles.msgBtn} onPress={openChat} accessibilityLabel="Съобщение">
            <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
          </Pressable>
        </View>
      )}

      {/* Trophy shelf — top 3 biggest catches with podium ribbons */}
      <TrophyShelf
        catches={catches.map((c) => ({
          id: c.id,
          speciesName: c.speciesName,
          weightKg: c.weightKg,
          photoUri: c.photoUri,
          date: c.date,
        }))}
        onPressCatch={(id) =>
          (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id } })
        }
      />

      {/* Catches grid header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionAccent} />
        <Text style={styles.sectionTitle}>Улови</Text>
        {catches.length > 0 ? (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{catches.length}</Text>
          </View>
        ) : null}
      </View>

      {catches.length === 0 ? (
        <View style={styles.emptyFeed}>
          <Ionicons name="fish-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Няма споделени улови все още.</Text>
        </View>
      ) : (
        // 3-col grid with trophy badge on the best catch. No more duplicated highlight.
        <View style={styles.gridWrap}>
          {catches.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: item.id } })}
              style={styles.gridCell}
            >
              {item.photoUri ? (
                <Image
                  source={{ uri: item.photoUri }}
                  style={styles.gridImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text style={{ fontSize: 32 }}>🐟</Text>
              )}
              {item.id === bestCatchId ? (
                <View style={styles.gridTrophy}>
                  <Ionicons name="trophy" size={12} color="#FFD700" />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      <FlatList
        data={[]}
        extraData={{ photoUrl, summaryName, city, bio, following, followerCount, followingCount }}
        keyExtractor={() => 'x'}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}
        refreshControl={
          <FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={null}
      />
    </Screen>
  );
}
