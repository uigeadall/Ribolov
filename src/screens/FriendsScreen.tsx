import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { followUser, getFollowing, unfollowUser } from '../services/cloudSync';
import { sendFollowNotification } from '../services/socialFeed';
import { formatFirebaseError } from '../services/firebaseErrors';

export default function FriendsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const [rows, setRows] = useState<{ uid: string; displayName: string }[]>([]);
  const [uidInput, setUidInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      setRows(await getFollowing(user.uid));
    } catch (e: unknown) {
      Alert.alert('Грешка', formatFirebaseError(e));
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  React.useEffect(() => {
    load();
  }, [load]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        },
        title: { ...typography.h2, color: colors.text },
        input: {
          marginHorizontal: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          color: colors.text,
          marginBottom: spacing.sm,
        },
      }),
    [colors]
  );

  const follow = async () => {
    if (!user || !uidInput.trim()) return;
    try {
      const target = uidInput.trim();
      await followUser(user.uid, target);
      await sendFollowNotification(target, user.uid, user.displayName ?? user.email ?? 'Рибар');
      setUidInput('');
      await load();
    } catch (e: unknown) {
      Alert.alert('Последване', formatFirebaseError(e));
    }
  };

  const unfollow = async (targetUid: string) => {
    if (!user) return;
    try {
      await unfollowUser(user.uid, targetUid);
      await load();
    } catch (e: unknown) {
      Alert.alert('Грешка', formatFirebaseError(e));
    }
  };

  if (!configured || !user) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>
          Влез и конфигурирай Firebase, за да управляваш приятели.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Приятели</Text>
        <View style={{ width: 28 }} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="UID на потребител за следване"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        value={uidInput}
        onChangeText={setUidInput}
      />
      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
        <Button title="Следвай" onPress={follow} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.uid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState icon="people-outline" title="Още никого не следваш" subtitle="Добави UID или отвори профил от лентата." />
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() =>
                  navigation.navigate('UserPublicProfile', {
                    uid: item.uid,
                    displayName: item.displayName,
                  })
                }
              >
                <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.displayName || item.uid}</Text>
                <Text style={{ ...typography.caption, color: colors.textMuted }}>{item.uid}</Text>
              </Pressable>
              <Button title="Отписване" variant="secondary" onPress={() => unfollow(item.uid)} />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
