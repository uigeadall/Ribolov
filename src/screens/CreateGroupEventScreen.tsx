import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, Alert,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
import { createEvent } from '../services/cloudSync';
import { handleError } from '../utils/handleError';

type R = RouteProp<ProfileStackParamList, 'CreateGroupEvent'>;

export default function CreateGroupEventScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const { groupId, groupName } = route.params;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationName, setLocationName] = useState('');
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24);
    d.setMinutes(0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  const submit = async () => {
    if (!user || !configured || saving) return;
    if (!title.trim()) {
      Alert.alert('Заглавие', 'Дай заглавие на събитието.');
      return;
    }
    setSaving(true);
    try {
      await createEvent(
        groupId,
        {
          title: title.trim(),
          description: description.trim() || undefined,
          dateIso: date.toISOString(),
          locationName: locationName.trim() || undefined,
        },
        { uid: user.uid, displayName: user.displayName ?? 'Рибар' },
      );
      Toast.show({ type: 'success', text1: 'Събитието е създадено', visibilityTime: 2000 });
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
    multiline: { minHeight: 100, textAlignVertical: 'top' as const },
    dateRow: { flexDirection: 'row', gap: spacing.sm },
    dateBtn: {
      flex: 1,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    dateBtnText: { fontSize: 14, color: colors.text, fontWeight: '600' as const },
  }), [colors]);

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.heroTitle}>Ново събитие</Text>
          </View>
        </LinearGradient>
        <View style={{ padding: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            За създаване на събитие трябва да си влязъл и член на клуба.
          </Text>
        </View>
      </Screen>
    );
  }

  const dateLabel = date.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeLabel = date.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen padded={false} avoidKeyboard={false}>
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.heroTitle}>Ново събитие</Text>
            <Text style={styles.heroSub} numberOfLines={1}>{groupName}</Text>
          </View>
          <Pressable onPress={submit} disabled={saving || !title.trim()} style={[styles.saveBtn, (saving || !title.trim()) && { opacity: 0.5 }]} hitSlop={8}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Запази</Text>}
          </Pressable>
        </LinearGradient>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View>
            <Text style={styles.label}>Заглавие</Text>
            <TextInput
              style={styles.input}
              placeholder="напр. Излет на яз. Мандра"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
            />
          </View>

          <View>
            <Text style={styles.label}>Описание</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Подробности — час, място, какво да донесем…"
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={2000}
            />
          </View>

          <View>
            <Text style={styles.label}>Кога</Text>
            <View style={styles.dateRow}>
              <Pressable style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                <Text style={styles.dateBtnText}>{dateLabel}</Text>
              </Pressable>
              <Pressable style={styles.dateBtn} onPress={() => setShowTimePicker(true)}>
                <Ionicons name="time-outline" size={16} color={colors.primary} />
                <Text style={styles.dateBtnText}>{timeLabel}</Text>
              </Pressable>
            </View>
          </View>

          <View>
            <Text style={styles.label}>Място (по избор)</Text>
            <TextInput
              style={styles.input}
              placeholder="напр. яз. Мандра, западен бряг"
              placeholderTextColor={colors.textMuted}
              value={locationName}
              onChangeText={setLocationName}
              maxLength={200}
            />
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              themeVariant={mode === 'dark' ? 'dark' : 'light'}
              accentColor={colors.primary}
              textColor={colors.text}
              onChange={(_, d) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (d) {
                  const next = new Date(date);
                  next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  setDate(next);
                }
              }}
            />
          )}
          {showTimePicker && (
            <DateTimePicker
              value={date}
              mode="time"
              // Time picker stays on the wheel (no "inline" variant exists for time mode).
              // Locking themeVariant keeps it readable in both light and dark.
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={mode === 'dark' ? 'dark' : 'light'}
              accentColor={colors.primary}
              textColor={colors.text}
              onChange={(_, d) => {
                setShowTimePicker(Platform.OS === 'ios');
                if (d) {
                  const next = new Date(date);
                  next.setHours(d.getHours(), d.getMinutes(), 0, 0);
                  setDate(next);
                }
              }}
            />
          )}
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
