import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Skeleton } from '../components/Skeleton';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { FadeIn } from '../components/FadeIn';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { followUser, getFollowing, unfollowUser, getUserPublicSummary } from '../services/cloudSync';
import { searchUsersByName, type SearchUserResult } from '../services/userProfile';
import { sendFollowNotification } from '../services/socialFeed';
import { useAsync } from '../hooks/useAsync';
import { useAppNavigation } from '../navigation/useAppNavigation';

type FollowedRow = { uid: string; displayName: string; photoUrl?: string };

function FriendsSkeleton({ borderColor }: { borderColor: string }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor }}>
          <Skeleton width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={14} width="55%" />
          </View>
          <Skeleton width={76} height={32} borderRadius={radius.pill} />
        </View>
      ))}
    </>
  );
}

export default function FriendsScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];
  const waveColor = mode === 'dark' ? '#0E1628' : '#FFFFFF';

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [followBusy, setFollowBusy] = useState<Set<string>>(new Set());

  const { data: followedRows, loading: followsLoading, reload: reloadFollows } = useAsync(
    async () => {
      if (!user) return [] as FollowedRow[];
      const all = await getFollowing(user.uid);
      const summaries = await Promise.all(
        all.map((r) => getUserPublicSummary(r.uid).then(
          (s) => s,
          () => 'error' as const,   // network/Firestore error — keep the follow
        )),
      );
      const staleUids: string[] = [];
      const active: FollowedRow[] = [];
      all.forEach((r, i) => {
        const s = summaries[i];
        if (s === 'error') {
          // Transient error — don't auto-unfollow, show with no photo
          active.push({ uid: r.uid, displayName: r.displayName });
        } else if (s == null) {
          staleUids.push(r.uid);  // User document gone — safe to unfollow
        } else {
          active.push({ uid: r.uid, displayName: r.displayName, photoUrl: s.photoUrl });
        }
      });
      await Promise.all(staleUids.map((uid) => unfollowUser(user.uid, uid).catch(() => {})));
      return active;
    },
    [user?.uid],
  );

  useFocusEffect(useCallback(() => { reloadFollows(true); }, [reloadFollows]));

  const followedUids = useMemo(
    () => new Set((followedRows ?? []).map((r) => r.uid)),
    [followedRows],
  );

  const styles = useMemo(() => StyleSheet.create({
    hero: { paddingBottom: 28 + 16 },
    heroInner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      gap: 8,
    },
    heroTitle: {
      flex: 1,
      fontSize: 22,
      fontWeight: '700',
      color: '#fff',
      textAlign: 'center',
    },
    backBtn: {
      width: 40, height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center', justifyContent: 'center',
    },
    wave: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      marginTop: -28,
      flex: 1,
      backgroundColor: waveColor,
      overflow: 'hidden',
    },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, marginHorizontal: spacing.lg, marginVertical: spacing.sm,
    },
    searchInput: {
      flex: 1,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
      fontSize: 15, color: colors.text,
    },
    sectionLabel: {
      ...typography.overline, color: colors.textMuted,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs,
      letterSpacing: 0.8,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    name: { ...typography.bodyBold, color: colors.text },
    city: { ...typography.small, color: colors.textMuted, marginTop: 1 },
  }), [colors, waveColor]);

  const doSearch = useCallback(async (q: string) => {
    if (!configured) return;
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const results = await searchUsersByName(q, { excludeUid: user?.uid });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [configured, user?.uid]);

  // Debounce: only fire the Firestore search 250ms after the user stops typing.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => { void doSearch(text); }, 250);
  };

  const toggleFollow = useCallback(async (uid: string, displayName: string) => {
    if (!user) return;
    if (followedUids.has(uid)) {
      Alert.alert('Спри да следваш', `Спри да следваш ${displayName}?`, [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Спри',
          style: 'destructive',
          onPress: async () => {
            setFollowBusy((prev) => new Set([...prev, uid]));
            try {
              await unfollowUser(user.uid, uid);
              await reloadFollows(true);
            } finally {
              setFollowBusy((prev) => { const s = new Set(prev); s.delete(uid); return s; });
            }
          },
        },
      ]);
      return;
    }
    setFollowBusy((prev) => new Set([...prev, uid]));
    try {
      await followUser(user.uid, uid);
      await sendFollowNotification(uid, user.uid, user.displayName ?? 'Рибар');
      await reloadFollows(true);
    } finally {
      setFollowBusy((prev) => { const s = new Set(prev); s.delete(uid); return s; });
    }
  }, [user, followedUids, reloadFollows]);

  const renderUserRow = (uid: string, displayName: string, photoUrl?: string, city?: string) => {
    const busy = followBusy.has(uid);
    const isFollowing = followedUids.has(uid);
    return (
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate('UserPublicProfile', { uid, displayName, photoUrlHint: photoUrl })}
      >
        <View style={styles.avatar}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={{ width: 44, height: 44 }} contentFit="cover" />
          ) : (
            <Ionicons name="person-outline" size={22} color={colors.primary} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {city ? <Text style={styles.city}>{city}</Text> : null}
        </View>
        <Button
          title={isFollowing ? 'Следван' : 'Следвай'}
          variant={isFollowing ? 'secondary' : 'primary'}
          compact
          loading={busy}
          onPress={() => toggleFollow(uid, displayName)}
        />
      </Pressable>
    );
  };

  const isSearching = search.trim().length >= 2;

  const HeroSection = (
    <View style={styles.hero}>
      <LinearGradient colors={heroColors} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <View style={styles.heroInner}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.heroTitle}>Приятели</Text>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false} avoidKeyboard={false}>
        {HeroSection}
        <View style={styles.wave}>
          <EmptyState
            icon="people-outline"
            title="Влез в акаунта"
            subtitle="Следването на рибари изисква вход и Firebase."
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} avoidKeyboard={false}>
      {HeroSection}
      <View style={styles.wave}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Търси рибар по име…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {isSearching ? (
          <>
            <Text style={styles.sectionLabel}>
              {searching ? 'ТЪРСЕНЕ…' : `РЕЗУЛТАТИ${searchResults.length > 0 ? ` (${searchResults.length})` : ''}`}
            </Text>
            {searching && searchResults.length === 0 ? (
              <FriendsSkeleton borderColor={colors.border} />
            ) : searchResults.length === 0 ? (
              <EmptyState icon="person-outline" title="Няма резултати" subtitle="Опитай с различно или по-пълно име." />
            ) : (
              searchResults.map((r) => (
                <React.Fragment key={r.uid}>
                  {renderUserRow(r.uid, r.displayName, r.photoUrl, r.city)}
                </React.Fragment>
              ))
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>СЛЕДВАНИ</Text>
            {followsLoading ? (
              <FriendsSkeleton borderColor={colors.border} />
            ) : (followedRows ?? []).length === 0 ? (
              <FadeIn>
                <EmptyState
                  icon="people-outline"
                  emoji="🐟"
                  title="Още никого не следваш"
                  subtitle="Търси рибар по-горе или отвори профил от лентата."
                  action={{
                    label: 'Виж лентата',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onPress: () => (navigation as any).navigate('FeedTab', { screen: 'FeedList' }),
                  }}
                />
              </FadeIn>
            ) : (
              <FadeIn>
              <FlatList
                data={followedRows ?? []}
                keyExtractor={(r) => r.uid}
                renderItem={({ item }) => renderUserRow(item.uid, item.displayName, item.photoUrl)}
                keyboardShouldPersistTaps="handled"
              />
              </FadeIn>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}
