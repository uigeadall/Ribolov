import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Share, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { computePersonalBests, type PersonalBest } from '../services/personalBests';
import { formatCatchDate } from '../utils/formatCatchDate';

export default function PersonalBestsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [bests, setBests] = useState<PersonalBest[]>([]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
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
        row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
        iconWrap: {
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: '#FFD700' + '22',
          borderWidth: 1,
          borderColor: '#FFD700' + '66',
          alignItems: 'center',
          justifyContent: 'center',
        },
        species: { ...typography.bodyBold, color: colors.text },
        stats: { ...typography.caption, color: colors.primary, marginTop: 2 },
        date: { ...typography.small, color: colors.textMuted, marginTop: 1 },
        medal: { fontSize: 22 },
      }),
    [colors]
  );

  useFocusEffect(
    useCallback(() => {
      catchesStore.list().then((list) => {
        const map = computePersonalBests(list);
        const sorted = Array.from(map.values()).sort((a, b) => b.weightKg - a.weightKg);
        setBests(sorted);
      });
    }, [])
  );

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅');

  const cardRefs = useRef<Map<string, ViewShot>>(new Map());

  const shareRecord = async (item: PersonalBest) => {
    const ref = cardRefs.current.get(item.speciesId);
    if (!ref) return;
    try {
      const uri = await (ref as any).capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      } else {
        await Share.share({ message: `🏆 Личен рекорд: ${item.speciesName} — ${item.weightKg} кг | Ribolov App` });
      }
    } catch {
      Alert.alert('Грешка', 'Неуспешно споделяне.');
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Лични рекорди</Text>
      </View>

      {bests.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}>
          <EmptyState
            icon="trophy-outline"
            title="Все още няма рекорди"
            subtitle="Добавяй улови с тегло и дължина — рекордите ще се появят автоматично."
          />
        </View>
      ) : (
        <FlatList
          data={bests}
          keyExtractor={(b) => b.speciesId}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() =>
                navigation.getParent()?.navigate('LogbookTab', {
                  screen: 'CatchDetail',
                  params: { id: item.catchId },
                })
              }
            >
              <ViewShot ref={(r) => { if (r) cardRefs.current.set(item.speciesId, r as unknown as ViewShot); }} options={{ format: 'png', quality: 0.95 }}>
                <Card>
                  <View style={styles.row}>
                    <View style={styles.iconWrap}>
                      <Text style={styles.medal}>{medal(index)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.species}>{item.speciesName}</Text>
                      <Text style={styles.stats}>
                        {item.weightKg > 0 ? `${item.weightKg} кг` : ''}
                        {item.weightKg > 0 && item.lengthCm > 0 ? ' · ' : ''}
                        {item.lengthCm > 0 ? `${item.lengthCm} см` : ''}
                      </Text>
                      <Text style={styles.date}>{formatCatchDate(item.catchDate)}</Text>
                    </View>
                    <Pressable onPress={() => shareRecord(item)} hitSlop={8}>
                      <Ionicons name="share-outline" size={22} color={colors.primary} />
                    </Pressable>
                  </View>
                </Card>
              </ViewShot>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
