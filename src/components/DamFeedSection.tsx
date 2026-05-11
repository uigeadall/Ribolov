import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import type { User } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { Button } from './Button';
import { Card } from './Card';
import { createDamFeedPost, deleteDamFeedPost, subscribeDamFeedPosts, type DamFeedPostDoc } from '../services/damFeed';

type Props = {
  damId: string;
  damName: string;
  user: User | null;
  firebaseConfigured: boolean;
};

export function DamFeedSection({ damId, damName, user, firebaseConfigured }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.overline, color: colors.textMuted, marginBottom: spacing.sm },
        row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
        thumb: {
          width: 160,
          height: 120,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceAlt,
        },
        meta: { flex: 1 },
        author: { ...typography.bodyBold, color: colors.text },
        cap: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
        separator: { height: spacing.md },
        muted: { ...typography.body, color: colors.textMuted },
      }),
    [colors]
  );

  const [posts, setPosts] = useState<DamFeedPostDoc[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured || !user) {
      setPosts([]);
      return;
    }
    const unsub = subscribeDamFeedPosts(
      damId,
      (list) => setPosts(list),
      () => undefined
    );
    return unsub;
  }, [damId, firebaseConfigured, user]);

  const pickAndUpload = async () => {
    if (!user || !firebaseConfigured) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Галерия', 'Разреши достъп до снимки.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]?.uri) return;
    setBusy(true);
    try {
      await createDamFeedPost({
        damId,
        ownerUid: user.uid,
        ownerName: user.displayName || user.email || 'Рибар',
        localImageUri: res.assets[0].uri,
      });
    } catch (e: unknown) {
      Alert.alert('Качване', e instanceof Error ? e.message : 'Неуспешно качване');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.title}>Снимки от мястото</Text>

      {!firebaseConfigured ? (
        <Card>
          <Text style={styles.muted}>Активирай Firebase, за да виждаш и качваш снимки за този водоем.</Text>
        </Card>
      ) : !user ? (
        <Card>
          <Text style={styles.muted}>Влез в акаунта си, за да споделяш снимка от „{damName}“.</Text>
        </Card>
      ) : (
        <>
          <Button title={busy ? 'Качване…' : 'Качи снимка'} onPress={pickAndUpload} loading={busy} />
          {posts.length === 0 ? (
            <Text style={[styles.muted, { marginTop: spacing.md }]}>
              Още няма качени снимки за този язовир. Бъди пръв!
            </Text>
          ) : (
            <FlatList
              scrollEnabled={false}
              data={posts}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              style={{ marginTop: spacing.md }}
              renderItem={({ item }) => (
                <Card>
                  <View style={styles.row}>
                    <Image source={{ uri: item.photoUrl }} style={styles.thumb} contentFit="cover" />
                    <View style={styles.meta}>
                      <Text style={styles.author} numberOfLines={1}>
                        {item.ownerName || 'Рибар'}
                      </Text>
                      {item.caption ? <Text style={styles.cap}>{item.caption}</Text> : null}
                    </View>
                    {item.ownerUid === user.uid ? (
                      <Pressable
                        hitSlop={8}
                        onPress={() =>
                          Alert.alert('Изтриване', 'Да се премахне снимката от галерията?', [
                            { text: 'Отказ', style: 'cancel' },
                            {
                              text: 'Изтрий',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  await deleteDamFeedPost(damId, item.id, item.storagePath);
                                } catch (e: unknown) {
                                  Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изтриване');
                                }
                              },
                            },
                          ])
                        }
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                      </Pressable>
                    ) : null}
                  </View>
                </Card>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}
