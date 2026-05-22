import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Toast from 'react-native-toast-message';
import type { User } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { Card } from './Card';
import { createDamFeedPost, deleteDamFeedPost, subscribeDamFeedPosts, type DamFeedPostDoc } from '../services/damFeed';
import { checkImageSize } from '../utils/imageSize';

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
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
        },
        uploadPill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: spacing.sm,
          paddingVertical: 5,
          borderRadius: radius.pill,
          backgroundColor: colors.primarySurface,
          borderWidth: 1,
          borderColor: colors.primary,
        },
        uploadPillText: {
          ...typography.caption,
          color: colors.primary,
          fontWeight: '700',
          fontSize: 12,
        },
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
      mediaTypes: 'images',
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]?.uri) return;
    if (!checkImageSize(res.assets[0])) return;
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
      {/* Header row — title on the left, compact upload pill on the right.
          The previous full-width primary green button dominated the sheet;
          a small icon-pill matches the rest of the calmer action design. */}
      <View style={styles.headerRow}>
        <Text style={[styles.title, { marginBottom: 0 }]}>Снимки от мястото</Text>
        {firebaseConfigured && user ? (
          <Pressable
            onPress={pickAndUpload}
            disabled={busy}
            style={({ pressed }) => [styles.uploadPill, (pressed || busy) && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Качи снимка"
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="camera-outline" size={14} color={colors.primary} />
            )}
            <Text style={styles.uploadPillText}>{busy ? 'Качване…' : 'Качи'}</Text>
          </Pressable>
        ) : null}
      </View>

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
                                  Toast.show({ type: 'error', text1: e instanceof Error ? e.message : 'Неуспешно изтриване', visibilityTime: 2400 });
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
