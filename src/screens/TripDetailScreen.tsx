import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Alert, Platform, Modal, FlatList } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { tripsStore, catchesStore } from '../storage/storage';
import type { ProfileStackParamList } from '../navigation/types';
import type { TripPlan, Catch } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';

type R = RouteProp<ProfileStackParamList, 'TripDetail'>;

export default function TripDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const [trip, setTrip] = useState<TripPlan | null | undefined>(undefined);
  const [tripCatches, setTripCatches] = useState<Catch[]>([]);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState(new Date());
  const [editNotes, setEditNotes] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    catchesStore.list().then((all) =>
      setTripCatches(all.filter((c) => c.tripId === route.params.id))
    );
    tripsStore.get(route.params.id).then((t) => {
      setTrip(t ?? null);
      if (t) {
        setEditTitle(t.title);
        setEditDate(new Date(t.dateIso));
        setEditNotes(t.notes ?? '');
      }
    });
  }, [route.params.id]);

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { ...typography.h2, color: colors.text },
    date: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      color: colors.text,
      backgroundColor: colors.background,
      ...typography.body,
      marginTop: spacing.sm,
    },
  }), [colors]);

  const save = async () => {
    if (!trip || !editTitle.trim()) return;
    setSaving(true);
    try {
      const updated: TripPlan = {
        ...trip,
        title: editTitle.trim(),
        dateIso: editDate.toISOString().slice(0, 10),
        notes: editNotes.trim() || undefined,
      };
      await tripsStore.save(updated);
      setTrip(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Изтриване', `Изтриване на „${trip?.title}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await tripsStore.remove(route.params.id);
          navigation.goBack();
        },
      },
    ]);
  };

  if (trip === undefined) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Зареждане…</Text>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Излетът не е намерен.</Text>
      </Screen>
    );
  }

  const dateLabel = new Date(trip.dateIso).toLocaleDateString('bg-BG', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{trip.title}</Text>
        {!editing && (
          <>
            <Pressable onPress={() => setEditing(true)} hitSlop={8} style={{ marginRight: spacing.sm }}>
              <Ionicons name="pencil-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable onPress={confirmDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </Pressable>
          </>
        )}
      </View>

      <View style={{ padding: spacing.lg }}>
        {editing ? (
          <Card>
            <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.xs }}>Редактиране</Text>
            <TextInput
              style={styles.input}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Заглавие"
              placeholderTextColor={colors.textMuted}
              autoFocus
            />

            <Pressable
              onPress={() => setShowPicker(true)}
              style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
            >
              <Text style={{ color: colors.text }}>
                {editDate.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
            </Pressable>

            {/* Android native dialog rendered outside Card */}
            {Platform.OS === 'android' && showPicker && (
              <DateTimePicker
                value={editDate}
                mode="date"
                display="default"
                onChange={(event, d) => {
                  setShowPicker(false);
                  if (event.type === 'set' && d) setEditDate(d);
                }}
                maximumDate={new Date()}
              />
            )}

            <TextInput
              style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Бележки"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button title="Запази" onPress={save} loading={saving} style={{ flex: 1 }} />
              <Button title="Отказ" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
              <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
              <Text style={styles.date}>{dateLabel}</Text>
            </View>
            <Card>
              <Text style={{ ...typography.body, color: trip.notes?.trim() ? colors.text : colors.textMuted, lineHeight: 22 }}>
                {trip.notes?.trim() || 'Няма бележки за този излет.'}
              </Text>
            </Card>

            {/* Catches for this trip */}
            <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm }}>
              Улови ({tripCatches.length})
            </Text>
            {tripCatches.length === 0 ? (
              <Text style={{ ...typography.body, color: colors.textMuted }}>
                Няма улови, свързани с този излет.
              </Text>
            ) : (
              tripCatches.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })}
                >
                  <Card style={{ marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Ionicons name="fish-outline" size={20} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...typography.bodyBold, color: colors.text }}>{c.speciesName}</Text>
                      <Text style={{ ...typography.caption, color: colors.textMuted }}>
                        {c.weightKg != null ? `${c.weightKg} кг` : ''}
                        {c.weightKg != null && c.date ? ' · ' : ''}
                        {c.date ? new Date(c.date).toLocaleDateString('bg-BG') : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Card>
                </Pressable>
              ))
            )}
          </>
        )}
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
              value={editDate}
              mode="date"
              display="spinner"
              onChange={(_, d) => { if (d) setEditDate(d); }}
              maximumDate={new Date()}
              locale="bg"
            />
          </View>
        </Modal>
      )}
    </Screen>
  );
}
