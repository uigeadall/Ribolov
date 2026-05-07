import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import type { LogbookStackParamList } from '../navigation/types';
import { formatCatchDate } from '../utils/formatCatchDate';

type R = RouteProp<LogbookStackParamList, 'CatchDetail'>;

export default function CatchDetailScreen() {
  const route = useRoute<R>();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [item, setItem] = useState<Catch | null>(null);

  const reload = useCallback(async () => {
    const list = await catchesStore.list();
    setItem(list.find((c) => c.id === route.params.id) ?? null);
  }, [route.params.id]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        meta: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
        chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
        chip: {
          alignSelf: 'flex-start',
          paddingHorizontal: spacing.sm + 2,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: colors.primarySurface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        chipText: { ...typography.small, fontWeight: '600', color: colors.primary },
        photoTitle: {
          ...typography.bodyBold,
          color: colors.text,
          marginTop: spacing.md,
          fontSize: 17,
          lineHeight: 24,
        },
        notes: { ...typography.body, color: colors.text, marginTop: spacing.md, lineHeight: 22 },
        photo: {
          width: '100%',
          height: 260,
          borderRadius: 12,
          marginTop: spacing.md,
          backgroundColor: colors.surfaceAlt,
        },
        actions: { marginTop: spacing.lg, gap: spacing.sm },
      }),
    [colors]
  );

  if (!item) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Уловът не е намерен.</Text>
        <Button title="Назад" variant="secondary" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
      </Screen>
    );
  }

  const remove = () => {
    Alert.alert('Изтриване', 'Да се изтрие записът?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await catchesStore.remove(item.id);
          navigation.goBack();
        },
      },
    ]);
  };

  const metaLine = [
    formatCatchDate(item.date),
    item.weightKg != null ? `${item.weightKg} кг` : null,
    item.lengthCm != null ? `${item.lengthCm} см` : null,
    item.released ? 'пуснат' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen scroll>
      <Text style={styles.title}>{item.speciesName}</Text>
      <Text style={styles.meta}>{metaLine}</Text>
      {item.location?.name ? <Text style={styles.meta}>{item.location.name}</Text> : null}
      {item.bait ? <Text style={styles.meta}>Стръв: {item.bait}</Text> : null}

      <View style={styles.chipRow}>
        {item.syncedToCloud ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>Синхронизиран</Text>
          </View>
        ) : null}
      </View>

      {item.photoUri ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
          {[item.photoUri, ...(item.extraPhotoUris ?? [])].map((uri, i) => (
            <Image
              key={i}
              source={{ uri }}
              style={[styles.photo, { marginTop: 0, marginRight: spacing.sm }]}
              contentFit="cover"
            />
          ))}
        </ScrollView>
      ) : null}

      {item.photoTitle ? <Text style={styles.photoTitle}>{item.photoTitle}</Text> : null}
      {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

      <Card style={styles.actions}>
        <Button title="Редактирай" variant="secondary" onPress={() => navigation.navigate('AddCatch', { editCatchId: item.id })} />
        <Button title="Изтрий записа" variant="danger" onPress={remove} />
      </Card>
    </Screen>
  );
}
