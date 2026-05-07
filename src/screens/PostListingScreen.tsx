import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  postListing, CATEGORY_LABELS, CONDITION_LABELS,
  type GearCategory, type GearCondition,
} from '../services/marketplace';

const CATEGORIES: GearCategory[] = ['rods', 'reels', 'lures', 'tackle', 'clothing', 'other'];
const CONDITIONS: GearCondition[] = ['new', 'like-new', 'used', 'worn'];

export default function PostListingScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<GearCategory>('rods');
  const [condition, setCondition] = useState<GearCondition>('used');
  const [location, setLocation] = useState('');
  const [contact, setContact] = useState('');
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
    if (!user) return;
    if (!title.trim()) { Alert.alert('Грешка', 'Въведи заглавие.'); return; }
    const p = parseFloat(price.replace(',', '.'));
    if (isNaN(p) || p < 0) { Alert.alert('Грешка', 'Въведи валидна цена.'); return; }
    if (!contact.trim()) { Alert.alert('Грешка', 'Въведи контакт (телефон или имейл).'); return; }
    setSaving(true);
    try {
      await postListing({
        title: title.trim(),
        description: description.trim(),
        priceBGN: p,
        category,
        condition,
        locationName: location.trim() || 'Не е посочено',
        contact: contact.trim(),
        sellerUid: user.uid,
        sellerName: user.displayName ?? 'Рибар',
      });
      Alert.alert('Публикувано!', 'Обявата е добавена в Марзет.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно публикуване.');
    } finally { setSaving(false); }
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Нова обява</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Заглавие *</Text>
        <TextInput style={styles.input} placeholder="напр. Shimano Stradic 2500" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} maxLength={100} returnKeyType="next" />

        <Text style={styles.label}>Категория</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => <Pressable key={c} style={[styles.chip, category === c && styles.chipActive]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextActive]}>{CATEGORY_LABELS[c]}</Text></Pressable>)}
        </View>

        <Text style={styles.label}>Състояние</Text>
        <View style={styles.chips}>
          {CONDITIONS.map((c) => <Pressable key={c} style={[styles.chip, condition === c && styles.chipActive]} onPress={() => setCondition(c)}><Text style={[styles.chipText, condition === c && styles.chipTextActive]}>{CONDITION_LABELS[c]}</Text></Pressable>)}
        </View>

        <Text style={styles.label}>Цена (лв.) *</Text>
        <TextInput style={styles.input} placeholder="напр. 150" placeholderTextColor={colors.textMuted} value={price} onChangeText={setPrice} keyboardType="decimal-pad" returnKeyType="next" />

        <Text style={styles.label}>Описание</Text>
        <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top', paddingTop: spacing.sm }]} placeholder="Подробности, причина за продажба…" placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} multiline maxLength={1000} />

        <Text style={styles.label}>Местоположение</Text>
        <TextInput style={styles.input} placeholder="напр. Пловдив" placeholderTextColor={colors.textMuted} value={location} onChangeText={setLocation} maxLength={60} returnKeyType="next" />

        <Text style={styles.label}>Контакт * (телефон или имейл)</Text>
        <TextInput style={styles.input} placeholder="напр. 0888 123 456" placeholderTextColor={colors.textMuted} value={contact} onChangeText={setContact} keyboardType="phone-pad" maxLength={80} />

        <Button title="Публикувай обявата" onPress={submit} loading={saving} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}
