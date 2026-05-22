import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { FacebookProfileHero, FacebookHeroButton } from '../components/FacebookProfileHero';
import { ProfileTabs, type ProfileTabKey } from '../components/ProfileTabs';
import { TrophyShelf } from '../components/TrophyShelf';
import { FeedItem, FeedPost } from '../components/FeedPost';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { RootStackParamList } from '../navigation/types';
import { getImageVariant, ImageSize } from '../utils/imageVariants';
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
  listMutualFollowers,
} from '../services/cloudSync';
import { sendFollowNotification } from '../services/socialFeed';
import { handleError } from '../utils/handleError';
import { blockUser, unblockUser, isBlockedBy } from '../services/blockUser';
import { useAppNavigation } from '../navigation/useAppNavigation';

const SW = Dimensions.get('window').width;
const GRID_PAD = spacing.lg;
const GRID_GAP = 2;
const GRID_CELL = (SW - GRID_PAD * 2 - GRID_GAP * 2) / 3;

/** Single grid cell with its own image-error state — broken URLs fall back
    to a fish-icon placeholder instead of a black tile. */
function CatchGridCell({
  item,
  isBest,
  styles,
  colors,
  onPress,
}: {
  item: FeedItem;
  isBest: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  onPress: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !item.photoUri || imgError;
  return (
    <Pressable onPress={onPress} style={styles.gridCell}>
      {showFallback ? (
        <Ionicons name="fish-outline" size={28} color={colors.textMuted} />
      ) : (
        <Image
          source={{ uri: getImageVariant(item.photoUri, ImageSize.gridThumb) ?? item.photoUri }}
          style={styles.gridImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setImgError(true)}
        />
      )}
      {isBest ? (
        <View style={styles.gridTrophy}>
          <Ionicons name="trophy" size={12} color="#FFD700" />
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    // ── Action button row (sits under name in FacebookProfileHero) ──
    actionsRow: { flexDirection: 'row', gap: spacing.sm },
    primaryActionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 40,
      borderRadius: 8,
    },
    primaryFollow: { backgroundColor: colors.primary },
    primaryFollowing: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
    primaryFollowText: { ...typography.bodyBold, color: '#fff', fontSize: 14 },
    primaryFollowingText: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    msgBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 40,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    msgBtnText: { ...typography.bodyBold, color: colors.text, fontSize: 14 },

    // ── Tab content shared ──
    tabBody: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
    sectionTitle: {
      ...typography.h3,
      color: colors.text,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },

    // ── Info tab ──
    infoCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    infoIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoLabel: { ...typography.caption, color: colors.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
    infoValue: { ...typography.body, color: colors.text, fontSize: 14, marginTop: 2 },
    infoDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 40 },

    statsRow: {
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

    // ── Grid (posts + photos tabs) ──
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

    // ── Misc ──
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
  const [activeTab, setActiveTab] = useState<ProfileTabKey>('posts');
  const [mutualFollowers, setMutualFollowers] = useState<{ uid: string; displayName: string }[]>([]);
  // How many catches the Posts tab is currently showing. We page in chunks
  // of 10 (initial) → 20 → all so even a profile with 50 catches doesn't
  // mount every FeedPost up front. "Виж всички" jumps straight to the end.
  const [postsShown, setPostsShown] = useState(10);
  // Reset back to a small window whenever the user navigates to a different
  // profile so a long-scroll session on one doesn't leak into another.
  useEffect(() => { setPostsShown(10); }, [uid]);

  const isSelf = user?.uid === uid;

  // Earliest catch date — "Риболов от Year". Derived from the already-loaded
  // catches array so no extra fetch. Falls back to null when the profile has
  // no public catches (we hide the year cell in that case).
  const fishingSinceYear = useMemo(() => {
    if (catches.length === 0) return null;
    let earliest = Infinity;
    for (const c of catches) {
      const t = Date.parse(c.date);
      if (!isNaN(t) && t < earliest) earliest = t;
    }
    if (earliest === Infinity) return null;
    return new Date(earliest).getFullYear();
  }, [catches]);

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
  const speciesCount = useMemo(() => new Set(catches.map((c) => c.speciesName)).size, [catches]);

  // Fishing-style summary — top species, favorite spot, average weight.
  // Pure client-side derivation from the already-loaded catches array.
  const fishingStyle = useMemo(() => {
    if (catches.length < 3) return null; // not enough signal
    const speciesTally: Record<string, number> = {};
    const spotTally: Record<string, number> = {};
    let weightSum = 0;
    let weightCount = 0;
    for (const c of catches) {
      const sp = c.speciesName?.trim();
      if (sp) speciesTally[sp] = (speciesTally[sp] ?? 0) + 1;
      const spot = c.location?.name?.trim();
      if (spot) spotTally[spot] = (spotTally[spot] ?? 0) + 1;
      if (typeof c.weightKg === 'number' && c.weightKg > 0) {
        weightSum += c.weightKg;
        weightCount += 1;
      }
    }
    const topSpecies = Object.entries(speciesTally).sort((a, b) => b[1] - a[1])[0];
    const topSpot = Object.entries(spotTally).sort((a, b) => b[1] - a[1])[0];
    const avgWeight = weightCount > 0 ? weightSum / weightCount : null;
    return {
      topSpecies: topSpecies ? { name: topSpecies[0], count: topSpecies[1] } : null,
      topSpot: topSpot ? { name: topSpot[0], count: topSpot[1] } : null,
      avgWeight,
    };
  }, [catches]);

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
      const [sum, list, fol, fc, fwc, blk, mutuals] = await Promise.all([
        getUserPublicSummary(uid),
        fetchPublicCatchesByOwner(uid, 50),
        user && !self ? isFollowingUser(user.uid, uid) : Promise.resolve(false),
        getFollowerCount(uid),
        getFollowingCount(uid),
        user && !self ? isBlockedBy(user.uid, uid) : Promise.resolve(false),
        user && !self ? listMutualFollowers(user.uid, uid) : Promise.resolve([] as { uid: string; displayName: string }[]),
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
      setBlocked(!!blk);
      setMutualFollowers(mutuals);
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured, uid, user, photoUrlHint]);

  // First focus shows skeleton (no cached data). Subsequent focuses refresh
  // silently so the profile stays visible while we re-fetch in the background.
  const initialFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      setPhotoUrl(photoUrlHint?.trim() ? photoUrlHint.trim() : undefined);
      if (initialFocusRef.current) {
        initialFocusRef.current = false;
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      void load();
    }, [load, photoUrlHint])
  );

  const onRefresh = () => { setRefreshing(true); load(); };

  const toggleFollow = async () => {
    if (!user || isSelf) return;
    setFollowBusy(true);
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
        <View style={{ flex: 1 }}>
          <Skeleton height={200 + insets.top} width="100%" borderRadius={0} />
          {/* Avatar silhouette overlapping the cover */}
          <View style={{ position: 'absolute', top: 200 + insets.top - 76, left: spacing.lg }}>
            <Skeleton width={120} height={120} borderRadius={60} />
          </View>
          <View style={{ paddingTop: 60, paddingHorizontal: spacing.lg, gap: 8 }}>
            <Skeleton width={180} height={22} borderRadius={4} />
            <Skeleton width={110} height={13} borderRadius={4} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Skeleton height={40} width="48%" borderRadius={8} />
              <Skeleton height={40} width="48%" borderRadius={8} />
            </View>
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

  // Action row that goes inside the FacebookProfileHero. Self-view shows
  // nothing here (this is the public profile from another viewer's POV,
  // but isSelf catches the "preview my own profile" case).
  const actionRow = (() => {
    if (!user) {
      return (
        <Text style={styles.hint}>
          Влез в акаунт, за да следваш или да пишеш на този рибар.
        </Text>
      );
    }
    if (isSelf) {
      return (
        <Text style={styles.hint}>
          Така изглежда профилът ти за другите рибари.
        </Text>
      );
    }
    return (
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.primaryActionBtn, following ? styles.primaryFollowing : styles.primaryFollow]}
          onPress={toggleFollow}
          disabled={followBusy}
          accessibilityRole="button"
          accessibilityLabel={following ? 'Спри да следваш' : 'Последвай'}
        >
          {followBusy ? (
            <ActivityIndicator size="small" color={following ? colors.text : '#fff'} />
          ) : (
            <>
              <Ionicons
                name={following ? 'checkmark-circle' : 'person-add-outline'}
                size={16}
                color={following ? colors.text : '#fff'}
              />
              <Text style={following ? styles.primaryFollowingText : styles.primaryFollowText}>
                {following ? 'Следваш' : 'Последвай'}
              </Text>
            </>
          )}
        </Pressable>
        <Pressable
          style={styles.msgBtn}
          onPress={openChat}
          accessibilityRole="button"
          accessibilityLabel="Изпрати съобщение"
        >
          <Ionicons name="chatbubble-outline" size={16} color={colors.text} />
          <Text style={styles.msgBtnText}>Съобщение</Text>
        </Pressable>
      </View>
    );
  })();

  const metaItems: Array<string | undefined> = [
    city,
    `${followerCount} ${followerCount === 1 ? 'последовател' : 'последователи'}`,
    `${catches.length} ${catches.length === 1 ? 'улов' : 'улова'}`,
  ];

  // Empty-state for the Posts tab (when no catches). The actual FeedPost
  // timeline is virtualized — it flows into the outer FlatList's `data` so
  // each row mounts only when scrolled into range. This is what keeps a
  // profile with 80+ catches scrollable without stalling on mount.
  const renderPostsEmpty = () => (
    <View style={styles.emptyFeed}>
      <Ionicons name="fish-outline" size={40} color={colors.textMuted} />
      <Text style={styles.emptyText}>Няма споделени улови все още.</Text>
    </View>
  );

  const renderPhotosTab = () => {
    return (
      <View>
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
        {catches.length === 0 ? (
          <View style={styles.emptyFeed}>
            <Ionicons name="images-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>Все още няма качени снимки.</Text>
          </View>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Всички снимки</Text>
            <View style={styles.gridWrap}>
              {catches.filter((c) => c.photoUri).map((item) => (
                <CatchGridCell
                  key={item.id}
                  item={item}
                  isBest={item.id === bestCatchId}
                  styles={styles}
                  colors={colors}
                  onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: item.id } })}
                />
              ))}
            </View>
          </>
        )}
      </View>
    );
  };

  const renderInfoTab = () => {
    const formattedTotalKg = totalKg > 0
      ? (Number.isInteger(totalKg) ? totalKg.toString() : totalKg.toFixed(1))
      : '0';
    return (
      <View>
        {/* Stats card */}
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{catches.length}</Text>
            <Text style={styles.statLbl}>Улови</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{speciesCount}</Text>
            <Text style={styles.statLbl}>Вида</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{formattedTotalKg}</Text>
            <Text style={styles.statLbl}>кг</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>За {summaryName}</Text>
        <View style={styles.infoCard}>
          {bio ? (
            <>
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>Биография</Text>
                  <Text style={styles.infoValue}>{bio}</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
            </>
          ) : null}

          {city ? (
            <>
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="location-outline" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>Град</Text>
                  <Text style={styles.infoValue}>{city}</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
            </>
          ) : null}

          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Последователи / Следва</Text>
              <Text style={styles.infoValue}>
                {followerCount} последователи · {followingCount} следва
              </Text>
            </View>
          </View>

          {bestCatch?.speciesName && typeof bestCatch.weightKg === 'number' && bestCatch.weightKg > 0 ? (
            <>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="trophy" size={18} color="#E8902E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>Личен рекорд</Text>
                  <Text style={styles.infoValue}>
                    {bestCatch.speciesName} · {Number.isInteger(bestCatch.weightKg) ? bestCatch.weightKg : bestCatch.weightKg.toFixed(1)} кг
                  </Text>
                </View>
              </View>
            </>
          ) : null}
        </View>
      </View>
    );
  };

  // Posts tab is handled via the FlatList's `data` (virtualized); other tabs
  // render as a single static block in the header. The empty-posts case is
  // also a single static block so the FlatList stays empty in that scenario.
  const renderNonPostsTabContent = () => {
    if (activeTab === 'posts') return catches.length === 0 ? renderPostsEmpty() : null;
    if (activeTab === 'photos') return renderPhotosTab();
    if (activeTab === 'info') return renderInfoTab();
    return null; // friends tab hidden on public profile
  };

  const ListHeader = (
    <View>
      <FacebookProfileHero
        name={summaryName}
        city={city}
        bio={bio}
        coverUrl={bestCatch?.photoUri}
        avatarUrl={photoUrl}
        initials={initials}
        metaItems={metaItems}
        topLeft={<FacebookHeroButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Назад" />}
        topRight={
          user && !isSelf
            ? <FacebookHeroButton icon="ellipsis-horizontal" onPress={handleBlockMenu} accessibilityLabel="Опции" />
            : undefined
        }
        actions={actionRow}
      />

      {/* Mutual-follow badge — small social-proof line that surfaces overlap
          between viewer and target. Hidden on own profile, hidden when there
          are no mutuals to avoid an empty row. */}
      {mutualFollowers.length > 0 && !isSelf ? (
        <Pressable
          onPress={() => navigation.navigate('Friends')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
          })}
          accessibilityRole="button"
          accessibilityLabel="Виж общи последователи"
        >
          <Ionicons name="people" size={14} color={colors.textMuted} />
          <Text
            style={{ ...typography.caption, color: colors.textMuted, flex: 1, fontSize: 12 }}
            numberOfLines={2}
          >
            Следва се с{' '}
            {(() => {
              const named = mutualFollowers.filter((m) => m.displayName).slice(0, 3);
              const nameStr = named.map((m) => m.displayName).join(', ');
              const rest = mutualFollowers.length - named.length;
              if (nameStr && rest > 0) return `${nameStr} и още ${rest}`;
              if (nameStr) return nameStr;
              return `${mutualFollowers.length} от хората, които следваш`;
            })()}
          </Text>
        </Pressable>
      ) : null}

      {/* At-a-glance stats strip — catches / species / biggest / fishing-since.
          Sits above the fishing-style card so the bare numbers hit first; the
          style card answers "how do they fish" while this answers "how much".
          Hidden when the user has zero catches (empty strip looks worse than
          no strip). */}
      {catches.length > 0 ? (
        <View style={{
          flexDirection: 'row',
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
          paddingVertical: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ ...typography.h3, color: colors.text, fontSize: 18 }}>{catches.length}</Text>
            <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>УЛОВИ</Text>
          </View>
          <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ ...typography.h3, color: colors.text, fontSize: 18 }}>{speciesCount}</Text>
            <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>ВИДОВЕ</Text>
          </View>
          {bestCatch && typeof bestCatch.weightKg === 'number' && bestCatch.weightKg > 0 ? (
            <>
              <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ ...typography.h3, color: colors.text, fontSize: 18 }}>
                  {Number.isInteger(bestCatch.weightKg) ? bestCatch.weightKg : bestCatch.weightKg.toFixed(1)}
                </Text>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>НАЙ-ГОЛЯМ КГ</Text>
              </View>
            </>
          ) : null}
          {fishingSinceYear ? (
            <>
              <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ ...typography.h3, color: colors.text, fontSize: 18 }}>{fishingSinceYear}</Text>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>ОТ ГОДИНА</Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Fishing-style summary card — top species / favorite water /
          average weight. Pure social-proof / get-to-know-this-user content.
          Hidden when the user has fewer than 3 catches (not enough signal). */}
      {fishingStyle ? (
        <View style={{
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
          marginBottom: spacing.sm,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Ionicons name="trophy-outline" size={14} color={colors.primary} />
            <Text style={{ ...typography.bodyBold, color: colors.textMuted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
              Стил на риболов
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
            {fishingStyle.topSpecies ? (
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10 }}>НАЙ-ЧЕСТО</Text>
                <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 14 }} numberOfLines={1}>
                  {fishingStyle.topSpecies.name}
                </Text>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 11 }}>
                  {fishingStyle.topSpecies.count}× уловен
                </Text>
              </View>
            ) : null}
            {fishingStyle.topSpot ? (
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10 }}>ЛЮБИМО МЯСТО</Text>
                <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 14 }} numberOfLines={1}>
                  {fishingStyle.topSpot.name}
                </Text>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 11 }}>
                  {fishingStyle.topSpot.count}× посетено
                </Text>
              </View>
            ) : null}
            {fishingStyle.avgWeight != null ? (
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 10 }}>СРЕДНО ТЕГЛО</Text>
                <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 14 }}>
                  {fishingStyle.avgWeight < 1
                    ? `${Math.round(fishingStyle.avgWeight * 1000)} г`
                    : `${fishingStyle.avgWeight.toFixed(1)} кг`}
                </Text>
                <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 11 }}>
                  на улов
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <ProfileTabs
        active={activeTab}
        onChange={setActiveTab}
        // Hide "friends" on public profile — we don't surface other users' friends.
        visibility={{ friends: false }}
      />

      <View style={styles.tabBody}>{renderNonPostsTabContent()}</View>
    </View>
  );

  // Posts tab streams into FlatList data so virtualization works; every other
  // tab is empty data + static header. We also cap the visible count via
  // `postsShown` so even a profile with 80+ catches doesn't mount every
  // FeedPost up front. A footer offers "Виж още N" and "Виж всички (N)".
  const postsData = activeTab === 'posts' ? catches.slice(0, postsShown) : [];
  const remainingPosts = Math.max(0, catches.length - postsShown);

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      <FlatList
        data={postsData}
        extraData={{ photoUrl, summaryName, city, bio, following, followerCount, followingCount, activeTab, postsShown }}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={
          activeTab === 'posts' && remainingPosts > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
              <Pressable
                onPress={() => setPostsShown((n) => n + 10)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: 10,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? colors.surfaceAlt : colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                })}
                accessibilityRole="button"
                accessibilityLabel={`Виж още ${Math.min(10, remainingPosts)}`}
              >
                <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 13 }}>
                  Виж още {Math.min(10, remainingPosts)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPostsShown(catches.length)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: 10,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? colors.primaryDark : colors.primary,
                })}
                accessibilityRole="button"
                accessibilityLabel={`Виж всички ${catches.length}`}
              >
                <Text style={{ ...typography.bodyBold, color: '#fff', fontSize: 13 }}>
                  Виж всички ({catches.length})
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}
        refreshControl={
          <FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <FeedPost
            item={item}
            myUid={user?.uid}
            myDisplayName={user?.displayName ?? user?.email ?? 'Аз'}
            socialEnabled={Boolean(configured && user)}
            onPressAuthor={(authorUid, name) => {
              if (authorUid === uid) return;
              navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name });
            }}
            onPressCatch={(c) =>
              (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })
            }
          />
        )}
        // Virtualization knobs — keep rendered windows tight so a 100-catch
        // profile only mounts a handful of FeedPost trees at a time.
        windowSize={5}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        removeClippedSubviews
      />
    </Screen>
  );
}
