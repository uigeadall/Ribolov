import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { Image } from 'expo-image';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { requireFirebase } from '../services/firebase';
import { useAuth } from '../services/authContext';
import type { Catch } from '../types';
import type { LogbookStackParamList } from '../navigation/types';
import { formatCatchDate } from '../utils/formatCatchDate';
import { useAppNavigation } from '../navigation/useAppNavigation';

type R = RouteProp<LogbookStackParamList, 'CatchDetail'>;

export default function CatchDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [item, setItem] = useState<Catch | null>(null);
  const [isOwn, setIsOwn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<ViewShot>(null);

  const reload = useCallback(async () => {
    const id = route.params.id;
    // Try local storage first (own catches)
    const list = await catchesStore.list();
    const local = list.find((c) => c.id === id);
    if (local) {
      setItem(local);
      setIsOwn(true);
      return;
    }
    // Fall back to publicCatches in Firestore (other users' catches from the feed)
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'publicCatches', id));
      if (snap.exists()) {
        const data = snap.data() as Catch & { ownerUid?: string };
        setItem(data);
        setIsOwn(!!user?.uid && data.ownerUid === user.uid);
      } else {
        setItem(null);
      }
    } catch {
      setItem(null);
    }
  }, [route.params.id, user?.uid]);

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
        extraPhoto: {
          width: 200,
          height: 150,
          borderRadius: 10,
          marginTop: spacing.md,
          marginRight: spacing.sm,
          backgroundColor: colors.surfaceAlt,
        },
        watermark: {
          ...typography.caption,
          color: colors.textMuted,
          marginTop: spacing.md,
          textAlign: 'right',
        },
        actions: { marginTop: spacing.lg, gap: spacing.sm },
      }),
    [colors]
  );

  const safeGoBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('LogbookList');
  };

  if (!item) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Уловът не е намерен.</Text>
        <Button title="Назад" variant="secondary" onPress={safeGoBack} style={{ marginTop: spacing.lg }} />
      </Screen>
    );
  }

  const shareCard = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const uri = await (cardRef.current as any).capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      }
    } catch {
      Alert.alert('Грешка', 'Споделянето не успя.');
    } finally {
      setSharing(false);
    }
  };

  const remove = () => {
    Alert.alert('Изтриване', 'Да се изтрие записът?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await catchesStore.remove(item.id);
          safeGoBack();
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
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>

        {/* ── Shareable card ── ViewShot captures this flat View only (no nested ScrollView) */}
        <ViewShot ref={cardRef} options={{ format: 'png', quality: 0.95 }}>
          <View style={{ backgroundColor: colors.background }}>
            <Text style={styles.title}>{item.speciesName}</Text>
            <Text style={styles.meta}>{metaLine}</Text>
            {item.location?.name ? <Text style={styles.meta}>{item.location.name}</Text> : null}
            {item.bait ? <Text style={styles.meta}>Стръв: {item.bait}</Text> : null}

            <View style={styles.chipRow}>
              {item.syncedToCloud ? (
                <View style={styles.chip}><Text style={styles.chipText}>Синхронизиран</Text></View>
              ) : null}
              {item.conditions?.fishingRating != null ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{'⭐'.repeat(item.conditions.fishingRating)} риболов</Text>
                </View>
              ) : null}
              {item.conditions?.temperatureC != null ? (
                <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.temperatureC}°C</Text></View>
              ) : null}
              {item.conditions?.windKmh != null ? (
                <View style={styles.chip}><Text style={styles.chipText}>💨 {item.conditions.windKmh} км/ч</Text></View>
              ) : null}
              {item.conditions?.pressureHpa != null ? (
                <View style={styles.chip}><Text style={styles.chipText}>⏱ {item.conditions.pressureHpa} hPa</Text></View>
              ) : null}
              {item.conditions?.moonPhaseName ? (
                <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.moonPhaseName}</Text></View>
              ) : null}
            </View>

            {/* First photo only — flat Image, capturable by ViewShot */}
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={styles.photo} contentFit="cover" />
            ) : null}

            {item.photoTitle ? <Text style={styles.photoTitle}>{item.photoTitle}</Text> : null}

            <Text style={styles.watermark}>🎣 Риболов</Text>
          </View>
        </ViewShot>

        {/* Extra photos — outside ViewShot, horizontal scroll */}
        {(item.extraPhotoUris?.length ?? 0) > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {item.extraPhotoUris!.map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.extraPhoto} contentFit="cover" />
            ))}
          </ScrollView>
        ) : null}

        {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

        <Card style={styles.actions}>
          <Button title="Сподели като снимка" variant="secondary" onPress={shareCard} loading={sharing} />
          {isOwn && (
            <>
              <Button title="Редактирай" variant="secondary" onPress={() => navigation.navigate('AddCatch', { editCatchId: item.id })} />
              <Button title="Изтрий записа" variant="danger" onPress={remove} />
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
