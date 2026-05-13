import React, { useCallback, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { tripsStore, newId } from '../storage/storage';
import type { TripPlan } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';

export default function TripsScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const [items, setItems] = useState<TripPlan[]>([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    tripsStore.list().then((list) =>
      setItems([...list].sort((a, b) => b.dateIso.localeCompare(a.dateIso)))
    );
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  } as const;

  const addTrip = async () => {
    if (!title.trim()) {
      Alert.alert('Заглавие', 'Въведи ime на излета.');
      return;
    }
    setSaving(true);
    try {
      await tripsStore.save({
        id: newId(),
        title: title.trim(),
        dateIso: date.toISOString().slice(0, 10),
        notes: notes.trim() || undefined,
      });
      setTitle('');
      setNotes('');
      setDate(new Date());
      Toast.show({ type: 'success', text1: 'Излетът е добавен', visibilityTime: 2000 });
      load();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: TripPlan) => {
    Alert.alert('Изтриване', `Изтриване на „${item.title}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await tripsStore.remove(item.id);
          load();
        },
      },
    ]);
  };

  const dateLabel = date.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Screen padded={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.sm }}>
        <Text style={{ ...typography.h2, color: colors.text, flex: 1 }}>Излети</Text>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
        <Card>
          <Text style={{ ...typography.h3, color: colors.text }}>Нов излет</Text>
          <TextInput
            style={inputStyle}
            placeholder="Заглавие (напр. Искър сутрин)"
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          {/* Date picker trigger */}
          <Pressable
            onPress={() => setShowPicker(true)}
            style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
          >
            <Text style={{ color: colors.text, fontSize: 16 }}>{dateLabel}</Text>
            <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          </Pressable>

          <TextInput
            style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
            placeholder="Бележки (опционално)"
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <Button title="Добави излет" onPress={addTrip} loading={saving} style={{ marginTop: spacing.md }} />
        </Card>
      </View>

      {/* iOS: bottom-sheet modal with spinner */}
      {Platform.OS === 'ios' && (
        <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowPicker(false)} />
          <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.md }}>
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={{ ...typography.bodyBold, color: colors.primary }}>Готово</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={date}
              mode="date"
              display="spinner"
              onChange={(_, selected) => { if (selected) setDate(selected); }}
              maximumDate={new Date()}
              locale="bg"
            />
          </View>
        </Modal>
      )}

      {/* Android: native dialog rendered at screen level */}
      {Platform.OS === 'android' && showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setShowPicker(false);
            if (event.type === 'set' && selected) setDate(selected);
          }}
          maximumDate={new Date()}
        />
      )}

      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(t) => t.id}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title="Още няма записани излети"
            subtitle="Попълни формата горе или добави бележка след риболов."
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('TripDetail', { id: item.id })}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Ionicons name="boat-outline" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.title}</Text>
                  <Text style={{ ...typography.caption, color: colors.textMuted }}>
                    {new Date(item.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() => confirmDelete(item)}
                  style={{ padding: spacing.xs }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
