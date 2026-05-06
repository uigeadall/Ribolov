import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { listMyConversations } from '../services/cloudSync';
import { ConversationPreview } from '../types';

function createChatsStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    title: { ...typography.h2, color: colors.text },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.white, fontWeight: '700', fontSize: 20 },
    name: { ...typography.h3, color: colors.text },
    preview: { ...typography.body, color: colors.textMuted, marginTop: 2 },
    warn: { ...typography.body, color: colors.textMuted },
  });
}

export default function ChatsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createChatsStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const { user, configured } = useAuth();
  const [items, setItems] = useState<ConversationPreview[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setItems(await listMyConversations(user.uid));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function Header({ onBack }: { onBack: () => void }) {
    return (
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Съобщения</Text>
        <View style={{ width: 28 }} />
      </View>
    );
  }

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <Header onBack={() => navigation.goBack()} />
        <View style={{ padding: spacing.lg, flex: 1 }}>
          <Card>
            <Text style={styles.warn}>Влез в профила си и активирай Firebase, за да ползваш чата.</Text>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Header onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.convId}
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title="Няма разговори"
              subtitle="В Приятели отвори чат с някой, с когото се следвате взаимно."
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate('ChatDetail', {
                  convId: item.convId,
                  otherUid: item.otherUid,
                  otherName: item.otherName,
                })
              }
            >
              <Card>
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.otherName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.otherName}
                    </Text>
                    <Text style={styles.preview} numberOfLines={1}>
                      {item.lastMessage || 'Без съобщения'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
