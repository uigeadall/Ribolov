import React, { useMemo, useReducer, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, Platform } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { createGroup, CATEGORY_LABELS, type GroupCategory } from '../services/groups';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { handleError } from '../utils/handleError';

const CATEGORIES: GroupCategory[] = ['club', 'water', 'species', 'general'];

type FormState = { name: string; description: string; category: GroupCategory };
type FormAction =
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_DESCRIPTION'; value: string }
  | { type: 'SET_CATEGORY'; value: GroupCategory };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.value };
    case 'SET_DESCRIPTION': return { ...state, description: action.value };
    case 'SET_CATEGORY': return { ...state, category: action.value };
    default: return state;
  }
}

export default function CreateGroupScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const [form, dispatch] = useReducer(formReducer, { name: '', description: '', category: 'club' });
  const { name, description, category } = form;
  const [saving, setSaving] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    headerTitle: { ...typography.h2, color: colors.text, flex: 1 },
    label: { ...typography.bodyBold, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    input: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm, fontSize: 15, color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...typography.small, color: colors.text, fontWeight: '600' },
    chipTextActive: { color: colors.white },
  }), [colors]);

  const submit = async () => {
    if (!user || !configured) return;
    if (!name.trim()) { Alert.alert('Грешка', 'Въведи название на клуба.'); return; }
    setSaving(true);
    try {
      const id = await createGroup(
        { name: name.trim(), description: description.trim() || undefined, category },
        { uid: user.uid, displayName: user.displayName ?? 'Рибар' }
      );
      navigation.replace('GroupDetail', { groupId: id, groupName: name.trim() });
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Нов клуб</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Название *</Text>
        <TextInput
          placeholder="напр. Шаранджии Пловдив"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={(v) => dispatch({ type: 'SET_NAME', value: v })}
          style={styles.input}
          maxLength={60}
          returnKeyType="next"
        />

        <Text style={styles.label}>Описание</Text>
        <TextInput
          placeholder="Накратко за какво е клубът…"
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={(v) => dispatch({ type: 'SET_DESCRIPTION', value: v })}
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top', paddingTop: spacing.sm }]}
          multiline
          maxLength={300}
        />

        <Text style={styles.label}>Категория</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} style={[styles.chip, category === c && styles.chipActive]} onPress={() => dispatch({ type: 'SET_CATEGORY', value: c })}>
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{CATEGORY_LABELS[c]}</Text>
            </Pressable>
          ))}
        </View>

        <Button title="Създай клуба" onPress={submit} loading={saving} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}
