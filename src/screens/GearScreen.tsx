import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { gearStore, newId } from '../storage/storage';
import type { GearItem } from '../types';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { useFocusEffect } from '@react-navigation/native';

export default function GearScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<GearItem[]>([]);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(() => {
    gearStore.list().then(setItems);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: spacing.md,
          color: colors.text,
          marginBottom: spacing.sm,
          backgroundColor: colors.card,
        },
      }),
    [colors]
  );

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    await gearStore.save({ id: newId(), name: n, notes: notes.trim() || undefined });
    setName('');
    setNotes('');
    load();
  };

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg }}>
        <Text style={styles.title}>Екипировка</Text>
        <TextInput style={styles.input} placeholder="Име на предмет" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
        <TextInput
          style={[styles.input, { minHeight: 72 }]}
          placeholder="Бележки (по избор)"
          placeholderTextColor={colors.textMuted}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        <Button title="Добави" onPress={add} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={<EmptyState icon="bag-outline" title="Празен списък" subtitle="Добави въдица, макара, кутия…" />}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.name}</Text>
            {item.notes ? (
              <Text style={{ ...typography.body, color: colors.textMuted, marginTop: 4 }}>{item.notes}</Text>
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}
