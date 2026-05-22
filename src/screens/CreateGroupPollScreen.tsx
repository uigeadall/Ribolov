import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, Alert,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { Screen } from '../components/Screen';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import type { ProfileStackParamList } from '../navigation/types';
import { createPoll } from '../services/cloudSync';
import { handleError } from '../utils/handleError';

type R = RouteProp<ProfileStackParamList, 'CreateGroupPoll'>;

const MAX_OPTIONS = 6;

export default function CreateGroupPollScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const { groupId, groupName } = route.params;

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [saving, setSaving] = useState(false);

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  const setOption = (idx: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => i === idx ? value : o));
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, '']);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!user || !configured || saving) return;
    if (!question.trim()) {
      Alert.alert('Въпрос', 'Въведи въпроса на анкетата.');
      return;
    }
    const valid = options.filter((o) => o.trim().length > 0);
    if (valid.length < 2) {
      Alert.alert('Варианти', 'Трябват поне два непразни варианта.');
      return;
    }
    setSaving(true);
    try {
      await createPoll(
        groupId,
        { question: question.trim(), options: valid },
        { uid: user.uid, displayName: user.displayName ?? user.email ?? 'Рибар' },
      );
      Toast.show({ type: 'success', text1: 'Анкетата е създадена', visibilityTime: 2000 });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
    hero: { paddingTop: 16, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    titleWrap: { flex: 1 },
    heroTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
    heroSub: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
    saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    body: { padding: spacing.lg, gap: spacing.md },
    label: { ...typography.small, color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginTop: spacing.sm, marginBottom: 4, fontWeight: '700' as const },
    input: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      fontSize: 15,
      color: colors.text,
    },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    optionInput: { flex: 1 },
    removeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
    addOptionBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: spacing.sm,
      alignSelf: 'flex-start',
    },
    addOptionText: { ...typography.bodyBold, color: colors.primary, fontSize: 13 },
  }), [colors]);

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.heroTitle}>Нова анкета</Text>
          </View>
        </LinearGradient>
        <View style={{ padding: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            За създаване на анкета трябва да си влязъл и член на клуба.
          </Text>
        </View>
      </Screen>
    );
  }

  const canSubmit = question.trim().length > 0 && options.filter((o) => o.trim().length > 0).length >= 2;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen padded={false} avoidKeyboard={false}>
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.heroTitle}>Нова анкета</Text>
            <Text style={styles.heroSub} numberOfLines={1}>{groupName}</Text>
          </View>
          <Pressable
            onPress={submit}
            disabled={saving || !canSubmit}
            style={[styles.saveBtn, (saving || !canSubmit) && { opacity: 0.5 }]}
            hitSlop={8}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Запази</Text>}
          </Pressable>
        </LinearGradient>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View>
            <Text style={styles.label}>Въпрос</Text>
            <TextInput
              style={styles.input}
              placeholder="напр. Къде следващия weekend?"
              placeholderTextColor={colors.textMuted}
              value={question}
              onChangeText={setQuestion}
              maxLength={280}
            />
          </View>

          <View>
            <Text style={styles.label}>Варианти</Text>
            {options.map((o, idx) => (
              <View key={idx} style={[styles.optionRow, { marginBottom: 8 }]}>
                <TextInput
                  style={[styles.input, styles.optionInput]}
                  placeholder={`Вариант ${idx + 1}`}
                  placeholderTextColor={colors.textMuted}
                  value={o}
                  onChangeText={(v) => setOption(idx, v)}
                  maxLength={80}
                />
                {options.length > 2 ? (
                  <Pressable style={styles.removeBtn} onPress={() => removeOption(idx)} hitSlop={6}>
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {options.length < MAX_OPTIONS ? (
              <Pressable style={styles.addOptionBtn} onPress={addOption} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.addOptionText}>Добави вариант</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
