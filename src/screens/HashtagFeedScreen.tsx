import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/EmptyState';
import { PostCard } from '../components/PostCard';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { fetchPostsByHashtag, deletePost, searchUsersByName } from '../services/cloudSync';
import type { Post } from '../types';
import type { FeedStackParamList } from '../navigation/types';
import Toast from 'react-native-toast-message';

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

  const onReshare = useCallback((p: Post) => {
    const target = p.reshareOf ?? {
      kind: 'post' as const,
      id: p.id,
      ownerUid: p.ownerUid,
      ownerName: p.ownerName,
      ownerPhotoUrl: p.ownerPhotoUrl,
      text: p.text,
      photoUri: p.photoUri,
      date: p.date,
    };
    (navigation as any).navigate('CreatePost', { reshare: target });
  }, [navigation]);

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
            Alert.alert('Грешка', 'Неуспешно изтриване. Опитай отново.');
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
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>#{tag}</Text>
          <Text style={styles.subtitle}>
            {loading ? 'Зареждане…' : `${items.length} ${items.length === 1 ? 'публикация' : 'публикации'}`}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
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
            />
          )}
        />
      )}
    </Screen>
  );
}
