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
import { tripsStore, catchesStore, newId } from '../storage/storage';
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
  const [titleError, setTitleError] = useState('');
  const [catchCountByTrip, setCatchCountByTrip] = useState<Map<string, number>>(new Map());

  const load = useCallback(() => {
    Promise.all([tripsStore.list(), catchesStore.list()]).then(([list, catches]) => {
      setItems([...list].sort((a, b) => b.dateIso.localeCompare(a.dateIso)));
      const m = new Map<string, number>();
      catches.forEach((c) => { if (c.tripId) m.set(c.tripId, (m.get(c.tripId) ?? 0) + 1); });
      setCatchCountByTrip(m);
    });
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
      setTitleError('Въведи заглавие на излета');
      return;
    }
    setTitleError('');
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
            style={[inputStyle, titleError ? { borderColor: '#E53935' } : {}]}
            placeholder="Заглавие (напр. Искър сутрин)"
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={(v) => { setTitle(v); if (titleError) setTitleError(''); }}
          />
          {titleError ? <Text style={{ color: '#E53935', fontSize: 12, marginTop: 4 }}>{titleError}</Text> : null}

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
        renderItem={({ item }) => {
          const catchCount = catchCountByTrip.get(item.id) ?? 0;
          return (
            <Pressable onPress={() => navigation.navigate('TripDetail', { id: item.id })}>
              <Card style={{ borderLeftWidth: 3, borderLeftColor: colors.primary }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                  <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="boat-outline" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.title}</Text>
                    <Text style={{ ...typography.caption, color: colors.textMuted }}>
                      {new Date(item.dateIso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </Text>
                    {item.notes ? (
                      <Text style={{ ...typography.small, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>{item.notes}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                    {catchCount > 0 ? (
                      <View style={{ backgroundColor: colors.primarySurface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ ...typography.small, color: colors.primary, fontWeight: '700' }}>🎣 {catchCount}</Text>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Pressable hitSlop={8} onPress={() => confirmDelete(item)}>
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </Pressable>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </View>
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
