import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { PostCard } from '../components/PostCard';
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
        <View style={{ alignItems: 'center', padding: spacing.xl }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !post ? (
        <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} />
          <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center' }}>
            Публикацията не е намерена.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
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
