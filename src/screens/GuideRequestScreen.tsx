import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { submitGuideRequest } from '../services/guides';

export default function GuideRequestScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [specialty, setSpecialty] = useState('');
  const [watersText, setWatersText] = useState('');
  const [phone, setPhone] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    headerTitle: { ...typography.h2, color: colors.text, flex: 1 },
    label: { ...typography.bodyBold, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
    hint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
    input: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm, fontSize: 15, color: colors.text },
    infoBanner: { backgroundColor: colors.primarySurface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  }), [colors]);

  const submit = async () => {
    if (!user) return;
    if (!specialty.trim()) { Alert.alert('Грешка', 'Въведи специалност.'); return; }
    setSaving(true);
    try {
      await submitGuideRequest(user.uid, {
        displayName: user.displayName ?? 'Рибар',
        specialty: specialty.trim(),
        waters: watersText.split(',').map((w) => w.trim()).filter(Boolean),
        contactPhone: phone.trim() || undefined,
        priceRange: priceRange.trim() || undefined,
        note: note.trim() || undefined,
      });
      Alert.alert('Заявката е изпратена!', 'Ще прегледаме профила ти и ще те уведомим при одобрение.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally { setSaving(false); }
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Стани верифициран водач</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.infoBanner}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          <Text style={{ ...typography.caption, color: colors.text, flex: 1, lineHeight: 18 }}>
            Верифицираните водачи получават значка ✓ на профила си и се появяват в картата при съответните водоеми. Проверката отнема 1–3 работни дни.
          </Text>
        </View>

        <Text style={styles.label}>Специалност *</Text>
        <Text style={styles.hint}>Какъв вид риболов предлагаш? (напр. Шаранджийски, Спининг, Мухарски)</Text>
        <TextInput style={styles.input} placeholder="напр. Шаранджийски и бяла риба" placeholderTextColor={colors.textMuted} value={specialty} onChangeText={setSpecialty} maxLength={100} returnKeyType="next" />

        <Text style={styles.label}>Водоеми</Text>
        <Text style={styles.hint}>Разделени с запетая (имена или ID-та на язовири/реки)</Text>
        <TextInput style={[styles.input, { minHeight: 72, textAlignVertical: 'top', paddingTop: spacing.sm }]} placeholder="напр. яз. Батак, яз. Баташки, р. Марица" placeholderTextColor={colors.textMuted} value={watersText} onChangeText={setWatersText} multiline maxLength={300} />

        <Text style={styles.label}>Телефон за контакт</Text>
        <TextInput style={styles.input} placeholder="напр. 0888 123 456" placeholderTextColor={colors.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />

        <Text style={styles.label}>Ценови диапазон</Text>
        <TextInput style={styles.input} placeholder="напр. 80–150 лв./ден" placeholderTextColor={colors.textMuted} value={priceRange} onChangeText={setPriceRange} maxLength={60} returnKeyType="next" />

        <Text style={styles.label}>Допълнителна информация</Text>
        <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top', paddingTop: spacing.sm }]} placeholder="Опит, сертификати, оборудване…" placeholderTextColor={colors.textMuted} value={note} onChangeText={setNote} multiline maxLength={500} />

        <Button title="Изпрати заявката" onPress={submit} loading={saving} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}
