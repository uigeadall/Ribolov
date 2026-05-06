import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { tripsStore, newId } from '../storage/storage';
import type { TripPlan } from '../types';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

export default function TripsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [items, setItems] = useState<TripPlan[]>([]);
  const [title, setTitle] = useState('');
  const [dateIso, setDateIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    tripsStore.list().then(setItems);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const addTrip = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert('Заглавие', 'Въведи име на излета.');
      return;
    }
    setSaving(true);
    try {
      await tripsStore.save({
        id: newId(),
        title: t,
        dateIso: dateIso.trim() || new Date().toISOString().slice(0, 10),
        notes: notes.trim() || undefined,
      });
      setTitle('');
      setNotes('');
      setDateIso(new Date().toISOString().slice(0, 10));
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.sm }}>
          <Text style={{ ...typography.h2, color: colors.text, flex: 1 }}>Излети</Text>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
          <Card>
            <Text style={{ ...typography.h3, color: colors.text }}>Нов излет</Text>
            <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: 4 }}>
              Локални планове — напомняния по имейл предстоят.
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: spacing.md,
                marginTop: spacing.md,
                fontSize: 16,
                color: colors.text,
                backgroundColor: colors.background,
              }}
              placeholder="Заглавие (напр. Искър сутрин)"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: spacing.md,
                marginTop: spacing.sm,
                fontSize: 16,
                color: colors.text,
                backgroundColor: colors.background,
              }}
              placeholder="Дата YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              value={dateIso}
              onChangeText={setDateIso}
              autoCapitalize="none"
            />
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: spacing.md,
                marginTop: spacing.sm,
                minHeight: 64,
                fontSize: 16,
                color: colors.text,
                textAlignVertical: 'top',
                backgroundColor: colors.background,
              }}
              placeholder="Бележки (опционално)"
              placeholderTextColor={colors.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <Button title="Добави излет" onPress={addTrip} loading={saving} style={{ marginTop: spacing.md }} />
          </Card>
        </View>

        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Още няма записани излети"
              subtitle="Попълни формата горе или добави бележка след риболов."
            />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => navigation.navigate('TripDetail', { id: item.id })}>
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Ionicons name="boat-outline" size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.title}</Text>
                    <Text style={{ ...typography.caption, color: colors.textMuted }}>{item.dateIso}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </Card>
            </Pressable>
          )}
        />
      </Screen>
  );
}
