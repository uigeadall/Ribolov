import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { PostCard } from '../components/PostCard';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import { useAuth } from '../services/authContext';
import { spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';
import type { FeedStackParamList } from '../navigation/types';
import { getPost } from '../services/posts';
import type { Post } from '../types';

type R = RouteProp<FeedStackParamList, 'PostDetail'>;

/**
 * Single-post view. Reuses PostCard so likes / comments / share work
 * identically to the feed. Reached from:
 *  - tapping a reshare/quote card embedded in another post (Feed/HashtagFeed)
 *  - a push-notification tap when type === 'reshare' or 'comment' with postId
 *  - a deep-link in the future (post/:id)
 */
export default function PostDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user } = useAuth();

  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await getPost(route.params.id);
      setPost(p);
    } catch {
      // Surface as "not found" so the user can back out instead of staring
      // at a permanent skeleton.
      setPost(null);
    }
  }, [route.params.id]);

  useEffect(() => { void load(); }, [load]);

  // Pull-to-refresh handler. Re-fetches the post + its likeCount snapshot
  // so users coming back to a post they viewed earlier see fresh reaction
  // counts and any edits the author made. Comments are loaded by PostCard
  // via a live subscription, so they don't need a manual refresh.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onPressAuthor = useCallback((uid: string, displayName: string) => {
    navigation.navigate('UserPublicProfile', { uid, displayName });
  }, [navigation]);

  const onPressHashtag = useCallback((tag: string) => {
    (navigation as any).navigate('HashtagFeed', { tag });
  }, [navigation]);

  const onPressMention = useCallback((handle: string) => {
    (navigation as any).navigate('Search', { initialQuery: handle });
  }, [navigation]);

  // Tapping a quote inside this post — if the quote is a catch, go to
  // CatchDetail; if it's another post, push another PostDetail.
  const onPressReshareTarget = useCallback((target: { kind: 'post' | 'catch'; id: string }) => {
    if (target.kind === 'catch') {
      (navigation as any).navigate('LogbookTab', { screen: 'CatchDetail', params: { id: target.id } });
    } else {
      (navigation as any).push('PostDetail', { id: target.id });
    }
  }, [navigation]);

  return (
    <Screen padded={false}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ ...typography.h3, color: colors.text, flex: 1 }}>Публикация</Text>
      </View>

      {post === undefined ? (
        // Content-shaped skeleton mirrors the PostCard layout (avatar +
        // name + meta, body text lines, photo block, action row) so the
        // load feels like the actual content is forming instead of a
        // generic spinner. Local AsyncStorage cache hits land in <100ms
        // so this is typically a quick flash; on a cold network fetch
        // (~500ms-2s) the user sees the layout settle into real content.
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Skeleton width={40} height={40} borderRadius={20} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton height={14} width="50%" />
              <Skeleton height={10} width="32%" />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Skeleton height={14} width="100%" />
            <Skeleton height={14} width="92%" />
            <Skeleton height={14} width="76%" />
          </View>
          <Skeleton height={240} borderRadius={12} />
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Skeleton width={48} height={20} />
            <Skeleton width={48} height={20} />
            <Skeleton width={48} height={20} />
          </View>
        </View>
      ) : !post ? (
        <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} />
          <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center' }}>
            Публикацията не е намерена.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <PostCard
            post={post}
            myUid={user?.uid}
            myDisplayName={user?.displayName ?? 'Аз'}
            onPressAuthor={onPressAuthor}
            onPressHashtag={onPressHashtag}
            onPressMention={onPressMention}
            onPressReshareTarget={onPressReshareTarget}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
