import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  FlatList,
} from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { FeedPost, FeedItem } from '../components/FeedPost';
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
import { blockUser } from '../services/blockUser';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { useAppNavigation } from '../navigation/useAppNavigation';

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    /* ── nav bar ── */
    navBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
    },
    navBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.32)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    navTitle: {
      ...typography.bodyBold,
      color: colors.white,
      flex: 1,
      textAlign: 'center',
    },

    /* ── cover / hero ── */
    coverWrap: { height: 200, width: '100%' },
    gradient: { ...StyleSheet.absoluteFillObject },
    avatarWrap: {
      position: 'absolute',
      bottom: -48,
      alignSelf: 'center',
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 3,
      borderColor: colors.card,
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 8,
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarInitials: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.white, fontSize: 34, fontWeight: '800' },

    /* ── identity ── */
    identity: { alignItems: 'center', marginTop: 56, paddingHorizontal: spacing.lg },
    name: { ...typography.h2, color: colors.text, fontSize: 22, letterSpacing: -0.3 },
    cityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: spacing.xs,
    },
    cityText: { ...typography.caption, color: colors.textMuted },
    bio: {
      ...typography.body,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 22,
      marginTop: spacing.sm,
    },

    /* ── stats strip ── */
    statsCard: {
      flexDirection: 'row',
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    statCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    statDivider: {
      width: 1,
      backgroundColor: colors.border,
      marginVertical: spacing.sm,
    },
    statNum: {
      ...typography.h2,
      color: colors.text,
      fontSize: 20,
      fontWeight: '800',
    },
    statLbl: {
      ...typography.caption,
      color: colors.textMuted,
      marginTop: 2,
      fontSize: 11,
    },

    /* ── actions ── */
    actionsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
    },
    followBtn: {
      flex: 1,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    followBtnActive: { backgroundColor: colors.primary },
    followBtnInactive: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    followBtnText: { ...typography.bodyBold, color: colors.white, fontSize: 15 },
    followBtnTextInactive: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
    msgBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* ── best catch highlight ── */
    highlightCard: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    highlightPhoto: { width: '100%', height: 160 },
    highlightOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      padding: spacing.md,
    },
    highlightBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      marginBottom: spacing.xs,
    },
    highlightBadgeText: { ...typography.caption, color: '#FFD700', fontWeight: '700' },
    highlightTitle: { ...typography.h3, color: colors.white, fontSize: 16 },
    highlightMeta: { ...typography.caption, color: 'rgba(255,255,255,0.78)', marginTop: 2 },
    highlightNoPhoto: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      gap: spacing.md,
    },
    highlightIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    highlightNoPhotoText: { ...typography.bodyBold, color: colors.text },
    highlightNoPhotoMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

    /* ── section header ── */
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: spacing.lg,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    sectionTitle: { ...typography.h3, color: colors.text },
    sectionBadge: {
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    sectionBadgeText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 11 },

    /* ── misc ── */
    center: { flex: 1, justifyContent: 'center', padding: spacing.xl },
    hint: { ...typography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    selfHint: {
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

  const bestCatch = useMemo(
    () => catches.reduce<FeedItem | null>((m, c) => (!m || (c.weightKg ?? 0) > (m.weightKg ?? 0) ? c : m), null),
    [catches]
  );
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
                await blockUser(user.uid, uid).catch(() => {});
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
    if (!configured) return;
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
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <ActivityIndicator size="large" color={colors.primary} />
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

  const ListHeader = (
    <View>
      {/* ── Cover + Avatar ── */}
      <View style={styles.coverWrap}>
        <LinearGradient
          colors={[colors.primary, `${colors.primary}99`, colors.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        />
        <View style={[styles.avatarWrap]}>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.avatarImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
              recyclingKey={photoUrl}
            />
          ) : (
            <View style={styles.avatarInitials}>
              <Text style={styles.avatarText}>{summaryName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Name / City / Bio ── */}
      <View style={styles.identity}>
        <Text style={styles.name}>{summaryName}</Text>
        {city ? (
          <View style={styles.cityRow}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text style={styles.cityText}>{city}</Text>
          </View>
        ) : null}
        {bio ? <Text style={styles.bio}>{bio}</Text> : null}
      </View>

      {/* ── Stats strip ── */}
      <View style={styles.statsCard}>
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{followerCount}</Text>
          <Text style={styles.statLbl}>Последователи</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{followingCount}</Text>
          <Text style={styles.statLbl}>Следва</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{catches.length}</Text>
          <Text style={styles.statLbl}>Улови</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{totalKg > 0 ? totalKg.toFixed(1) : '—'}</Text>
          <Text style={styles.statLbl}>кг общо</Text>
        </View>
      </View>

      {/* ── Action buttons ── */}
      {!user ? (
        <Text style={[styles.selfHint, { marginTop: spacing.lg }]}>
          Влез в акаунт, за да следваш или да пишеш на този рибар.
        </Text>
      ) : isSelf ? (
        <Text style={styles.selfHint}>
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
              <ActivityIndicator size="small" color={following ? colors.text : colors.white} />
            ) : (
              <>
                <Ionicons
                  name={following ? 'checkmark-circle' : 'person-add-outline'}
                  size={17}
                  color={following ? colors.text : colors.white}
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

      {/* ── Best catch highlight ── */}
      {bestCatch ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Най-голям улов</Text>
          </View>
          <View style={styles.highlightCard}>
            {bestCatch.photoUri ? (
              <View>
                <Image
                  source={{ uri: bestCatch.photoUri }}
                  style={styles.highlightPhoto}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.72)']}
                  style={styles.highlightOverlay}
                  pointerEvents="none"
                >
                  <View style={styles.highlightBadge}>
                    <Ionicons name="trophy" size={12} color="#FFD700" />
                    <Text style={styles.highlightBadgeText}>Личен рекорд</Text>
                  </View>
                  <Text style={styles.highlightTitle}>{bestCatch.speciesName}</Text>
                  <Text style={styles.highlightMeta}>
                    {bestCatch.weightKg != null ? `${bestCatch.weightKg} кг` : ''}
                    {bestCatch.lengthCm != null ? ` · ${bestCatch.lengthCm} см` : ''}
                    {bestCatch.location?.name ? ` · ${bestCatch.location.name}` : ''}
                  </Text>
                </LinearGradient>
              </View>
            ) : (
              <View style={styles.highlightNoPhoto}>
                <View style={styles.highlightIconWrap}>
                  <Ionicons name="trophy-outline" size={24} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.highlightNoPhotoText}>{bestCatch.speciesName}</Text>
                  <Text style={styles.highlightNoPhotoMeta}>
                    {bestCatch.weightKg != null ? `${bestCatch.weightKg} кг` : ''}
                    {bestCatch.lengthCm != null ? ` · ${bestCatch.lengthCm} см` : ''}
                    {bestCatch.date ? ` · ${new Date(bestCatch.date).toLocaleDateString('bg-BG')}` : ''}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </>
      ) : null}

      {/* ── Feed section header ── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Публична лента</Text>
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
      ) : null}
    </View>
  );

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      {/* Floating nav bar over the cover */}
      <View style={[styles.navBar, { top: insets.top }]}>
        <Pressable style={styles.navBtn} onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.white} />
        </Pressable>
        <Text style={styles.navTitle} numberOfLines={1}>{summaryName}</Text>
        {user && !isSelf ? (
          <Pressable style={styles.navBtn} onPress={handleBlockMenu} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.white} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <FlatList
        data={catches}
        extraData={{ photoUrl, summaryName, city, bio, following, followerCount }}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListFooterComponent={<View style={{ height: spacing.lg }} />}
        {...keyboardAwareScrollProps}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <FeedPost
              item={item}
              myUid={user?.uid}
              myDisplayName={user?.displayName ?? user?.email ?? 'Аз'}
              socialEnabled={Boolean(configured && user)}
              onPressAuthor={(authorUid, name) => {
                if (authorUid === uid) return;
                navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name });
              }}
            />
          </View>
        )}
      />
    </Screen>
  );
}
