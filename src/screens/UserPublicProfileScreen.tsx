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
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
import { formatFirebaseError } from '../services/firebaseErrors';
import { blockUser, isBlockedBy } from '../services/blockUser';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';

function createPublicProfileStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    title: { ...typography.h2, color: colors.text, flex: 1, textAlign: 'center' },
    center: { flex: 1, justifyContent: 'center', padding: spacing.xl },
    hero: { alignItems: 'center', paddingVertical: spacing.lg },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    avatarImg: { width: 72, height: 72 },
    avatarText: { color: colors.white, fontSize: 28, fontWeight: '700' },
    name: { ...typography.h2, color: colors.text },
    meta: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    bio: {
      ...typography.body,
      color: colors.text,
      marginTop: spacing.md,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: spacing.sm,
    },
    hint: { ...typography.body, color: colors.textMuted, marginTop: spacing.md, textAlign: 'center' },
    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, width: '100%' },
    sectionTitle: { ...typography.h3, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    muted: { ...typography.body, color: colors.textMuted },
    err: { ...typography.body, color: colors.danger },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
      justifyContent: 'center',
      width: '100%',
    },
    statPill: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      minWidth: '28%',
      flexGrow: 1,
    },
    statNum: { ...typography.h3, color: colors.primary },
    statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    cityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  });
}

export default function UserPublicProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'UserPublicProfile'>>();
  const { uid, displayName: routeName, photoUrlHint } = route.params;
  const { user, configured } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createPublicProfileStyles(colors), [colors]);

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

  const isSelf = user?.uid === uid;
  const [blocked, setBlocked] = useState(false);

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
                  `Уловите на ${summaryName} няма да се показват в лентата ти. Той не разбира, че е блокиран.`,
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
      const resolvedPhoto =
        sum?.photoUrl?.trim() ||
        (photoUrlHint && String(photoUrlHint).trim() ? String(photoUrlHint).trim() : undefined);
      setPhotoUrl(resolvedPhoto);
      setCatches(list as FeedItem[]);
      setFollowing(!!fol);
      setFollowerCount(fc);
      setFollowingCount(fwc);
    } catch (e: unknown) {
      setError(formatFirebaseError(e));
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

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

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
      Alert.alert('Грешка', e instanceof Error ? e.message : String(e));
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
        params: {
          screen: 'ChatDetail',
          params: {
            convId,
            otherUid: uid,
            otherName: summaryName,
          },
        },
      });
    } catch (e: unknown) {
      Alert.alert('Чат', e instanceof Error ? e.message : 'Няма чат без взаимно следване.');
    }
  };

  const totalKg = catches.reduce((s, c) => s + (c.weightKg ?? 0), 0);
  const biggest = catches.reduce((m, c) => Math.max(m, c.weightKg ?? 0), 0);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          Профил
        </Text>
        {user && !isSelf ? (
          <Pressable onPress={handleBlockMenu} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={{ padding: spacing.lg }}>
          <Card>
            <Text style={styles.err}>{error}</Text>
            <Button title="Опитай отново" onPress={load} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      ) : (
        <FlatList
          data={catches}
          extraData={{ photoUrl, summaryName, city, bio }}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
              <Card style={styles.hero}>
                <View style={styles.avatar}>
                  {photoUrl ? (
                    <Image
                      source={{ uri: photoUrl }}
                      style={styles.avatarImg}
                      contentFit="cover"
                      recyclingKey={photoUrl}
                      transition={200}
                    />
                  ) : (
                    <Text style={styles.avatarText}>{summaryName.slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                <Text style={styles.name}>{summaryName}</Text>
                {city ? (
                  <View style={styles.cityRow}>
                    <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.meta}>{city}</Text>
                  </View>
                ) : null}
                {bio ? <Text style={styles.bio}>{bio}</Text> : null}

                <View style={styles.statsRow}>
                  <View style={styles.statPill}>
                    <Text style={styles.statNum}>{followerCount}</Text>
                    <Text style={styles.statLbl}>Последователи</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statNum}>{followingCount}</Text>
                    <Text style={styles.statLbl}>Следва</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statNum}>{catches.length}</Text>
                    <Text style={styles.statLbl}>Публични улови</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statNum}>{totalKg.toFixed(1)}</Text>
                    <Text style={styles.statLbl}>кг (лента)</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statNum}>{biggest.toFixed(1)}</Text>
                    <Text style={styles.statLbl}>Най-голям кг</Text>
                  </View>
                </View>

                {!user ? (
                  <Text style={styles.hint}>Влез, за да следваш или да пишеш на този рибар.</Text>
                ) : isSelf ? (
                  <Text style={styles.hint}>
                    Това си ти — синхронизирай видимите данни от таб „Профил“ → публичен профил в облака.
                  </Text>
                ) : (
                  <View style={styles.actions}>
                    <Button
                      title={following ? 'Следваш ✓' : 'Следвай'}
                      variant={following ? 'secondary' : 'primary'}
                      onPress={toggleFollow}
                      disabled={followBusy}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Съобщение"
                      variant="secondary"
                      onPress={openChat}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
              </Card>

              <Text style={styles.sectionTitle}>Публична лента</Text>
              {catches.length === 0 ? (
                <Card>
                  <Text style={styles.muted}>Няма споделени улове все още.</Text>
                </Card>
              ) : null}
            </View>
          }
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
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
      )}
    </Screen>
  );
}
