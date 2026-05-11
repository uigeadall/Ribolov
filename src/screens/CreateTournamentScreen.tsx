import React, { useMemo, useReducer, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Switch,
  Platform,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { createTournament, joinTournament } from '../services/cloudSync';
import { newId } from '../storage/storage';
import { Tournament, TournamentCategory } from '../types';
import { speciesList } from '../data/species';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { handleError } from '../utils/handleError';

const CATEGORIES: { id: TournamentCategory; label: string; icon: keyof typeof Ionicons.glyphMap; hint: string }[] = [
  { id: 'weight', label: 'Общо тегло', icon: 'scale-outline', hint: 'Сборът от теглата на всички улови' },
  { id: 'count', label: 'Брой улови', icon: 'list-outline', hint: 'Кой ще има най-много улови' },
  { id: 'length', label: 'Най-дълга риба', icon: 'resize-outline', hint: 'Един шампионски улов решава' },
];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function createCreateTournamentStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.lg,
    },
    title: { ...typography.h2, color: colors.text },
    label: { ...typography.bodyBold, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    input: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catCol: { gap: spacing.sm },
    catCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.card,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    catCardActive: { borderColor: colors.primary, backgroundColor: '#E8F4F8' },
    catEmoji: { fontSize: 28 },
    catLabel: { ...typography.bodyBold, color: colors.text },
    catLabelActive: { color: colors.primary },
    catHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...typography.body, color: colors.text },
    chipTextActive: { color: colors.white, fontWeight: '600' },
    dateRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
    dateValue: { ...typography.bodyBold, color: colors.primary },
    muted: { ...typography.body, color: colors.textMuted },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    toggleTitle: { ...typography.bodyBold, color: colors.text },
  });
}

type FormState = {
  name: string;
  description: string;
  category: TournamentCategory;
  speciesId: string | null;
  startDate: string;
  endDate: string;
  isPublic: boolean;
};

type FormAction =
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_DESCRIPTION'; value: string }
  | { type: 'SET_CATEGORY'; value: TournamentCategory }
  | { type: 'SET_SPECIES'; value: string | null }
  | { type: 'SET_START_DATE'; value: string; adjustEnd?: string }
  | { type: 'SET_END_DATE'; value: string }
  | { type: 'SET_PUBLIC'; value: boolean };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.value };
    case 'SET_DESCRIPTION': return { ...state, description: action.value };
    case 'SET_CATEGORY': return { ...state, category: action.value };
    case 'SET_SPECIES': return { ...state, speciesId: action.value };
    case 'SET_START_DATE':
      return { ...state, startDate: action.value, endDate: action.adjustEnd ?? state.endDate };
    case 'SET_END_DATE': return { ...state, endDate: action.value };
    case 'SET_PUBLIC': return { ...state, isPublic: action.value };
    default: return state;
  }
}

export default function CreateTournamentScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => createCreateTournamentStyles(colors), [colors]);
  const { user } = useAuth();

  const today = new Date();
  const inWeek = new Date();
  inWeek.setDate(today.getDate() + 7);

  const [form, dispatch] = useReducer(formReducer, {
    name: '',
    description: '',
    category: 'weight',
    speciesId: null,
    startDate: isoDate(today),
    endDate: isoDate(inWeek),
    isPublic: true,
  });
  const { name, description, category, speciesId, startDate, endDate, isPublic } = form;
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedSpecies = speciesId ? speciesList.find((s) => s.id === speciesId) : null;

  const onPickDate = (event: any, date?: Date) => {
    const which = picking;
    setPicking(null);
    if (!date || !which) return;
    if (which === 'start') {
      const newStart = isoDate(date);
      const adjustEnd =
        new Date(endDate).getTime() < date.getTime()
          ? isoDate(new Date(date.getTime() + 7 * 86_400_000))
          : undefined;
      dispatch({ type: 'SET_START_DATE', value: newStart, adjustEnd });
    } else {
      dispatch({ type: 'SET_END_DATE', value: isoDate(date) });
    }
  };

  const submit = async () => {
    if (!user) {
      Alert.alert('Нужен е акаунт', 'Влез или се регистрирай.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Име', 'Дай име на турнира.');
      return;
    }
    if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
      Alert.alert('Дати', 'Крайната дата трябва да е след началната.');
      return;
    }
    setSaving(true);
    try {
      const t: Tournament = {
        id: newId(),
        name: name.trim(),
        description: description.trim() || undefined,
        hostUid: user.uid,
        hostName: user.displayName ?? user.email ?? 'Рибар',
        startDate,
        endDate,
        category,
        speciesId: speciesId ?? undefined,
        speciesName: selectedSpecies?.nameBg,
        isPublic,
      };
      await createTournament(t);
      await joinTournament(t.id, user.uid, t.hostName);
      navigation.replace('TournamentDetail', { id: t.id });
    } catch (e: any) {
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
        <Text style={styles.title}>Нов турнир</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} {...keyboardAwareScrollProps}>
        <Text style={styles.label}>Име</Text>
        <TextInput
          value={name}
          onChangeText={(v) => dispatch({ type: 'SET_NAME', value: v })}
          placeholder="напр. Майско шаранско надбягване"
          style={styles.input}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>Описание (по избор)</Text>
        <TextInput
          value={description}
          onChangeText={(v) => dispatch({ type: 'SET_DESCRIPTION', value: v })}
          placeholder="Правила, награди, условия…"
          multiline
          style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>Категория</Text>
        <View style={styles.catCol}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => dispatch({ type: 'SET_CATEGORY', value: c.id })}
              style={[styles.catCard, category === c.id && styles.catCardActive]}
            >
              <Ionicons name={c.icon} size={26} color={category === c.id ? colors.primary : colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.catLabel, category === c.id && styles.catLabelActive]}>{c.label}</Text>
                <Text style={styles.catHint}>{c.hint}</Text>
              </View>
              {category === c.id ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Само за вид (по избор)</Text>
        <View style={styles.chips}>
          <Pressable onPress={() => dispatch({ type: 'SET_SPECIES', value: null })} style={[styles.chip, !speciesId && styles.chipActive]}>
            <Text style={[styles.chipText, !speciesId && styles.chipTextActive]}>Всички видове</Text>
          </Pressable>
          {speciesList.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => dispatch({ type: 'SET_SPECIES', value: s.id })}
              style={[styles.chip, speciesId === s.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, speciesId === s.id && styles.chipTextActive]}>{s.nameBg}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Период</Text>
        <Card style={{ marginTop: spacing.sm }}>
          <Pressable onPress={() => setPicking('start')} style={styles.dateRow}>
            <Text style={styles.muted}>Начало</Text>
            <Text style={styles.dateValue}>{formatDateLabel(startDate)}</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable onPress={() => setPicking('end')} style={styles.dateRow}>
            <Text style={styles.muted}>Край</Text>
            <Text style={styles.dateValue}>{formatDateLabel(endDate)}</Text>
          </Pressable>
        </Card>
        {picking ? (
          <DateTimePicker
            mode="date"
            value={new Date((picking === 'start' ? startDate : endDate) + 'T00:00:00')}
            onChange={onPickDate}
            minimumDate={picking === 'end' ? new Date(startDate + 'T00:00:00') : undefined}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          />
        ) : null}

        <View style={[styles.toggleRow, { marginTop: spacing.lg }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Публичен турнир</Text>
            <Text style={styles.muted}>
              {isPublic
                ? 'Виждат го всички и могат да се присъединят.'
                : 'Само ти и поканените виждат турнира.'}
            </Text>
          </View>
          <Switch
            value={isPublic}
            onValueChange={(v) => dispatch({ type: 'SET_PUBLIC', value: v })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        <Button title="Създай турнир" onPress={submit} loading={saving} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}
