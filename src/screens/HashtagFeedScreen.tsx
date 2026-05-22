import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '../storage/kv';
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Screen } from '../components/Screen';
import { ActionSheet } from '../components/ActionSheet';
import { EmptyState } from '../components/EmptyState';
import { ListSkeleton } from '../components/ListSkeleton';
import { PostCard } from '../components/PostCard';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { fetchPostsByHashtag, deletePost, searchUsersByName, createPost } from '../services/cloudSync';
import type { Post, ResharedRef } from '../types';
import type { FeedStackParamList } from '../navigation/types';
import Toast from 'react-native-toast-message';
import { notifyError } from '../utils/notify';
import { followHashtag, subscribeHashtagFollowed, unfollowHashtag } from '../services/hashtags';

type R = RouteProp<FeedStackParamList, 'HashtagFeed'>;

export default function HashtagFeedScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { tag } = route.params;
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();

  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tagFollowed, setTagFollowed] = useState(false);
  const [tagFollowBusy, setTagFollowBusy] = useState(false);
  // Cached own avatar URL so one-tap reposts from this screen render with
  // the correct author photo, matching FeedScreen's behavior. Without this
  // the repost would fall back to initials in the feed.
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!user?.uid) return;
    AsyncStorage.getItem(`@ribolov/profilePhoto/${user.uid}`)
      .then((v) => { if (v) setMyPhotoUrl(v); })
      .catch(() => {});
  }, [user?.uid]);

  useEffect(() => {
    if (!user || !configured) return;
    return subscribeHashtagFollowed(user.uid, tag, setTagFollowed);
  }, [user, configured, tag]);

  const onToggleTagFollow = useCallback(async () => {
    if (!user || tagFollowBusy) return;
    setTagFollowBusy(true);
    const wasFollowed = tagFollowed;
    setTagFollowed(!wasFollowed);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (wasFollowed) {
        await unfollowHashtag(user.uid, tag);
        Toast.show({ type: 'info', text1: `Спря да следваш #${tag}`, visibilityTime: 1400 });
      } else {
        await followHashtag(user.uid, tag);
        Toast.show({ type: 'success', text1: `Следваш #${tag}`, visibilityTime: 1400 });
      }
    } catch {
      setTagFollowed(wasFollowed);
    } finally {
      setTagFollowBusy(false);
    }
  }, [user, tag, tagFollowed, tagFollowBusy]);

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  const load = useCallback(async (silent = false) => {
    if (!configured) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const posts = await fetchPostsByHashtag(tag, 40);
      setItems(posts);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tag, configured]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onPressAuthor = useCallback((uid: string, displayName: string) => {
    navigation.navigate('UserPublicProfile', { uid, displayName });
  }, [navigation]);

  const onPressReshareTarget = useCallback((target: { kind: 'post' | 'catch'; id: string }) => {
    if (target.kind === 'catch') {
      (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: target.id } });
    }
  }, [navigation]);

  const onPressHashtag = useCallback((nextTag: string) => {
    if (nextTag === tag) return;
    // Replace this screen with the new tag so back button still works sensibly
    (navigation as any).push('HashtagFeed', { tag: nextTag });
  }, [navigation, tag]);

  const onPressMention = useCallback(async (handle: string) => {
    try {
      const cleaned = handle.replace(/_/g, ' ');
      const results = await searchUsersByName(cleaned, { maxResults: 1, excludeUid: user?.uid });
      if (results[0]) {
        navigation.navigate('UserPublicProfile', { uid: results[0].uid, displayName: results[0].displayName });
      }
    } catch { /* ignore */ }
  }, [navigation, user?.uid]);

  // Synchronous guard so a double-tap on the reshare action doesn't create
  // two copies of the same repost in the feed before the first finishes.
  const repostingRef = useRef(false);
  const instantRepost = useCallback(async (target: ResharedRef) => {
    if (!user || repostingRef.current) return;
    repostingRef.current = true;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await createPost({
        ownerUid: user.uid,
        ownerName: user.displayName?.trim() || user.email?.trim() || 'Рибар',
        ownerPhotoUrl: myPhotoUrl,
        text: '',
        mentionUids: [],
        reshareOf: target,
      });
      Toast.show({ type: 'success', text1: 'Споделено в лентата', visibilityTime: 1500 });
    } catch (e) {
      notifyError('Грешка при споделяне', e instanceof Error ? e.message : 'Неуспешно споделяне.');
    } finally {
      repostingRef.current = false;
    }
  }, [user, myPhotoUrl]);

  const onReshare = useCallback((p: Post) => {
    const target: ResharedRef = p.reshareOf ?? {
      kind: 'post' as const,
      id: p.id,
      ownerUid: p.ownerUid,
      ownerName: p.ownerName,
      ownerPhotoUrl: p.ownerPhotoUrl,
      text: p.text,
      photoUri: p.photoUri,
      date: p.date,
    };
    ActionSheet.show({
      title: 'Сподели',
      options: [
        {
          label: 'Сподели във лентата',
          icon: 'arrow-redo-outline',
          onPress: () => { void instantRepost(target); },
        },
        {
          label: 'Сподели с коментар',
          icon: 'chatbox-ellipses-outline',
          onPress: () => (navigation as any).navigate('CreatePost', { reshare: target }),
        },
      ],
    });
  }, [navigation, instantRepost]);

  const onDeletePost = useCallback((post: Post) => {
    Alert.alert('Изтрий публикацията', 'Сигурен ли си?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deletePost(post.id);
            setItems((prev) => prev.filter((p) => p.id !== post.id));
            Toast.show({ type: 'success', text1: 'Изтрита', visibilityTime: 1800 });
          } catch {
            Toast.show({ type: 'error', text1: 'Неуспешно изтриване. Опитай отново', visibilityTime: 2400 });
          }
        },
      },
    ]);
  }, []);

  const styles = useMemo(() => StyleSheet.create({
    hero: { paddingTop: 16, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    titleWrap: { flex: 1 },
    title: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
    subtitle: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  }), []);

  return (
    <Screen padded={false} avoidKeyboard={false}>
      <LinearGradient colors={heroColors} style={styles.hero}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>#{tag}</Text>
          <Text style={styles.subtitle}>
            {loading ? 'Зареждане…' : `${items.length} ${items.length === 1 ? 'публикация' : 'публикации'}`}
          </Text>
        </View>
        {user ? (
          <Pressable
            onPress={onToggleTagFollow}
            disabled={tagFollowBusy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tagFollowed ? `Спри да следваш #${tag}` : `Следвай #${tag}`}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: tagFollowed ? 'rgba(255,255,255,0.18)' : '#fff',
              borderWidth: 1,
              borderColor: tagFollowed ? 'rgba(255,255,255,0.3)' : '#fff',
              opacity: tagFollowBusy ? 0.6 : 1,
            }}
          >
            <Text style={{
              fontFamily: 'Nunito_800ExtraBold',
              fontSize: 12,
              color: tagFollowed ? '#fff' : '#0D559A',
            }}>
              {tagFollowed ? 'Следваш' : 'Следвай'}
            </Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </LinearGradient>

      {loading ? (
        <ListSkeleton variant="tile" count={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="pricetag-outline"
          title="Няма публикации"
          subtitle={`Все още никой не е публикувал с #${tag}. Бъди първият!`}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load(true); }}
          ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              myUid={user?.uid}
              myDisplayName={user?.displayName ?? 'Аз'}
              onPressAuthor={onPressAuthor}
              onPressHashtag={onPressHashtag}
              onPressMention={onPressMention}
              onDelete={onDeletePost}
              onReshare={user ? onReshare : undefined}
              onPressReshareTarget={onPressReshareTarget}
            />
          )}
        />
      )}
    </Screen>
  );
}
