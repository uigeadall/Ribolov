import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Dimensions, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { useAppNavigation } from '../navigation/useAppNavigation';

const NUM_COLS = 3;
const GAP = 2;
const { width: SCREEN_W } = Dimensions.get('window');
const CELL = Math.floor((SCREEN_W - GAP * (NUM_COLS + 1)) / NUM_COLS);

type PhotoItem = { uri: string; catchId: string };

export default function PhotoGalleryScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      catchesStore.list().then((list) => {
        const sorted = [...list].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        const result: PhotoItem[] = [];
        sorted.forEach((c) => {
          if (c.photoUri) result.push({ uri: c.photoUri, catchId: c.id });
          (c.extraPhotoUris ?? []).forEach((uri) => result.push({ uri, catchId: c.id }));
        });
        setPhotos(result);
      });
    }, [])
  );

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    count: { ...typography.caption, color: colors.textMuted },
    cell: { width: CELL, height: CELL, margin: GAP / 2 },
  }), [colors]);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Галерия</Text>
        <Text style={styles.count}>{photos.length} снимки</Text>
      </View>

      {photos.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}>
          <EmptyState
            icon="images-outline"
            title="Няма снимки"
            subtitle="Добави снимки при записване на улов — ще се появят тук."
          />
        </View>
      ) : (
        <FlatList
          data={photos}
          numColumns={NUM_COLS}
          keyExtractor={(item, i) => `${item.catchId}-${i}`}
          contentContainerStyle={{ padding: GAP / 2, paddingBottom: spacing.xxl }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.cell}
              onPress={() => navigation.navigate('CatchDetail', { id: item.catchId })}
            >
              <Image
                source={{ uri: item.uri }}
                style={{ width: CELL, height: CELL }}
                contentFit="cover"
              />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
