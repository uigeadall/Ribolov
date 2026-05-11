import React, { useCallback, useMemo, useReducer, useState } from 'react';
import Toast from 'react-native-toast-message';
import { View, Text, FlatList, TextInput, StyleSheet, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { gearStore, newId } from '../storage/storage';
import type { GearItem } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useFocusEffect } from '@react-navigation/native';

type FormState = {
  name: string;
  notes: string;
  editingId: string | null;
  editName: string;
  editNotes: string;
};

type FormAction =
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_NOTES'; value: string }
  | { type: 'START_EDIT'; id: string; name: string; notes: string }
  | { type: 'SET_EDIT_NAME'; value: string }
  | { type: 'SET_EDIT_NOTES'; value: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'RESET_ADD' };

const initialForm: FormState = { name: '', notes: '', editingId: null, editName: '', editNotes: '' };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.value };
    case 'SET_NOTES': return { ...state, notes: action.value };
    case 'START_EDIT': return { ...state, editingId: action.id, editName: action.name, editNotes: action.notes };
    case 'SET_EDIT_NAME': return { ...state, editName: action.value };
    case 'SET_EDIT_NOTES': return { ...state, editNotes: action.value };
    case 'CANCEL_EDIT': return { ...state, editingId: null };
    case 'RESET_ADD': return { ...state, name: '', notes: '' };
    default: return state;
  }
}

export default function GearScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<GearItem[]>([]);
  const [form, dispatch] = useReducer(formReducer, initialForm);
  const { name, notes, editingId, editName, editNotes } = form;

  const load = useCallback(() => {
    gearStore.list().then(setItems);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const styles = useMemo(() => StyleSheet.create({
    title: { ...typography.h2, color: colors.text, marginBottom: spacing.md },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      color: colors.text,
      marginBottom: spacing.sm,
      backgroundColor: colors.card,
      ...typography.body,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    itemName: { ...typography.bodyBold, color: colors.text },
    itemNotes: { ...typography.body, color: colors.textMuted, marginTop: 4 },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }), [colors]);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    await gearStore.save({ id: newId(), name: n, notes: notes.trim() || undefined });
    dispatch({ type: 'RESET_ADD' });
    Toast.show({ type: 'success', text1: 'Предметът е добавен', visibilityTime: 2000 });
    load();
  };

  const startEdit = (item: GearItem) => {
    dispatch({ type: 'START_EDIT', id: item.id, name: item.name, notes: item.notes ?? '' });
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await gearStore.save({ id: editingId, name: editName.trim(), notes: editNotes.trim() || undefined });
    dispatch({ type: 'CANCEL_EDIT' });
    Toast.show({ type: 'success', text1: 'Запазено', visibilityTime: 2000 });
    load();
  };

  const cancelEdit = () => dispatch({ type: 'CANCEL_EDIT' });

  const confirmDelete = (item: GearItem) => {
    Alert.alert('Изтриване', `Изтриване на „${item.name}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await gearStore.remove(item.id);
          load();
        },
      },
    ]);
  };

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg }}>
        <Text style={styles.title}>Екипировка</Text>
        <TextInput
          style={styles.input}
          placeholder="Име на предмет"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={(v) => dispatch({ type: 'SET_NAME', value: v })}
        />
        <TextInput
          style={[styles.input, { minHeight: 72 }]}
          placeholder="Бележки (по избор)"
          placeholderTextColor={colors.textMuted}
          value={notes}
          onChangeText={(v) => dispatch({ type: 'SET_NOTES', value: v })}
          multiline
          textAlignVertical="top"
        />
        <Button title="Добави" onPress={add} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={<EmptyState icon="bag-outline" title="Празен списък" subtitle="Добави въдица, макара, кутия…" />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Card>
            {editingId === item.id ? (
              <View>
                <TextInput
                  style={[styles.input, { marginBottom: spacing.sm }]}
                  value={editName}
                  onChangeText={(v) => dispatch({ type: 'SET_EDIT_NAME', value: v })}
                  autoFocus
                />
                <TextInput
                  style={[styles.input, { minHeight: 64, marginBottom: spacing.sm }]}
                  value={editNotes}
                  onChangeText={(v) => dispatch({ type: 'SET_EDIT_NOTES', value: v })}
                  multiline
                  textAlignVertical="top"
                  placeholder="Бележки"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title="Запази" onPress={saveEdit} style={{ flex: 1 }} />
                  <Button title="Отказ" variant="secondary" onPress={cancelEdit} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
                </View>
                <Pressable style={styles.iconBtn} onPress={() => startEdit(item)} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={18} color={colors.primary} />
                </Pressable>
                <Pressable style={styles.iconBtn} onPress={() => confirmDelete(item)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            )}
          </Card>
        )}
      />
    </Screen>
  );
}
