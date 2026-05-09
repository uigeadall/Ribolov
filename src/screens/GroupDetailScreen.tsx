import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Alert, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  getGroup, getGroupPosts, getMembers, isMember,
  joinGroup, leaveGroup, postToGroup, deleteGroupPost,
  type Group, type GroupPost,
} from '../services/groups';
import type { ProfileStackParamList } from '../navigation/types';

type R = RouteProp<ProfileStackParamList, 'GroupDetail'>;

export default function GroupDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<R>();
  const { groupId, groupName } = route.params;
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();

  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [joined, setJoined] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    metaText: { ...typography.caption, color: colors.textMuted },
    postRow: { marginBottom: spacing.md },
    postAuthor: { ...typography.bodyBold, color: colors.text },
    postTime: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    postText: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
    composer: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
      paddingBottom: Math.max(insets.bottom, spacing.md),
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
      backgroundColor: colors.card,
    },
    input: {
      flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      color: colors.text, maxHeight: 120, ...typography.body,
      backgroundColor: colors.surfaceAlt,
    },
  }), [colors, insets.bottom]);

  const load = useCallback(async () => {
    if (!configured) return;
    const [g, p, am] = await Promise.all([
      getGroup(groupId),
      getGroupPosts(groupId),
      user ? isMember(groupId, user.uid) : Promise.resolve(false),
    ]);
    setGroup(g);
    setPosts(p);
    setJoined(am);
    setMemberCount(g?.memberCount ?? 0);
    setRefreshing(false);
  }, [groupId, configured, user]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const handleJoin = async () => {
    if (!user || !configured) return;
    setJoining(true);
    try {
      if (joined) {
        await leaveGroup(groupId, user.uid);
        setJoined(false);
        setMemberCount((n) => Math.max(0, n - 1));
      } else {
        await joinGroup(groupId, { uid: user.uid, displayName: user.displayName ?? 'Рибар' });
        setJoined(true);
        setMemberCount((n) => n + 1);
      }
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно действие.');
    } finally {
      setJoining(false);
    }
  };

  const handlePost = async () => {
    if (!user || !postText.trim() || posting) return;
    setPosting(true);
    try {
      await postToGroup(groupId, postText, { uid: user.uid, displayName: user.displayName ?? 'Рибар' });
      setPostText('');
      await load();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      setPosting(false);
    }
  };

  const isAdmin = group?.createdBy === user?.uid;

  const handleDeletePost = (post: GroupPost) => {
    Alert.alert('Изтриване', 'Да се изтрие публикацията?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGroupPost(groupId, post.id);
            setPosts((prev) => prev.filter((p) => p.id !== post.id));
          } catch (e: unknown) {
            Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изтриване.');
          }
        },
      },
    ]);
  };

  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{groupName}</Text>
          {user && configured ? (
            <Button
              title={joined ? 'Напусни' : 'Присъедини се'}
              variant={joined ? 'ghost' : 'primary'}
              compact
              onPress={handleJoin}
              loading={joining}
            />
          ) : null}
        </View>

        {group ? (
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={15} color={colors.textMuted} />
            <Text style={styles.metaText}>{memberCount} члена</Text>
            {group.description ? <>
              <Text style={styles.metaText}>·</Text>
              <Text style={styles.metaText} numberOfLines={1}>{group.description}</Text>
            </> : null}
          </View>
        ) : null}

        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: spacing.xxl }}>
              <Ionicons name="chatbubble-outline" size={40} color={colors.border} />
              <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.md, textAlign: 'center' }}>
                {joined || !user ? 'Няма публикации все още.' : 'Присъедини се, за да публикуваш.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Card style={styles.postRow}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.postAuthor}>{item.ownerName}</Text>
                  {item.createdAt ? <Text style={styles.postTime}>{formatTime(item.createdAt)}</Text> : null}
                </View>
                {(user && (item.ownerUid === user.uid || isAdmin)) ? (
                  <Pressable onPress={() => handleDeletePost(item)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.postText}>{item.text}</Text>
            </Card>
          )}
        />

        {joined && user ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Сподели нещо с клуба…"
              placeholderTextColor={colors.textMuted}
              value={postText}
              onChangeText={setPostText}
              multiline
              maxLength={2000}
            />
            <Pressable onPress={handlePost} disabled={posting || !postText.trim()} hitSlop={8}>
              {posting ? null : (
                <Ionicons name="send" size={24} color={postText.trim() ? colors.primary : colors.textMuted} />
              )}
            </Pressable>
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
