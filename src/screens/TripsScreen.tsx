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
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { tripsStore, catchesStore, newId } from '../storage/storage';
import type { TripPlan } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';

const S = StyleSheet.create({
  hero: { paddingBottom: 44 },
  heroInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  heroTitle: { fontSize: 22, fontWeight: '700', color: '#fff' },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});

export default function TripsScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const isDark = mode === 'dark';
  const heroColors = isDark
    ? (['#0A1E38', '#050C1A', '#030810'] as const)
    : (['#2B87CE', '#1570B8', '#0D559A'] as const);
  const waveColor = isDark ? '#0E1628' : '#FFFFFF';
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
    <Screen padded={false} avoidKeyboard={false}>
      {/* Hero */}
      <View style={S.hero}>
        <LinearGradient colors={heroColors} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
        <View style={S.heroInner}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={S.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={S.heroTitle}>Излети</Text>
            <Text style={S.heroSub}>Планирай и следи риболовните си излети</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </View>

      {/* Wave content */}
      <View style={{ flex: 1, backgroundColor: waveColor, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -28, overflow: 'hidden' }}>
        {/* Add trip form card */}
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, marginBottom: spacing.md }}>
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

            {/* Orange gradient add button */}
            <Pressable onPress={addTrip} style={{ marginTop: spacing.md, opacity: saving ? 0.6 : 1 }}>
              <LinearGradient
                colors={['#F5890A', '#E06400']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ borderRadius: 12, padding: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Добави излет</Text>
              </LinearGradient>
            </Pressable>
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
          renderItem={({ item }) => {
            const catchCount = catchCountByTrip.get(item.id) ?? 0;
            const tripDate = new Date(item.dateIso);
            const dateBadge = tripDate.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' });
            return (
              <Pressable onPress={() => navigation.navigate('TripDetail', { id: item.id })}>
                <View style={{
                  borderRadius: radius.lg,
                  overflow: 'hidden',
                  backgroundColor: colors.card,
                  marginBottom: spacing.md,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.08,
                  shadowRadius: 6,
                  elevation: 3,
                }}>
                  {/* Coloured accent strip */}
                  <View style={{ height: 4, backgroundColor: colors.primary }} />

                  <View style={{ padding: spacing.md }}>
                    {/* Date badge */}
                    <View style={{ alignSelf: 'flex-start', backgroundColor: colors.primarySurface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ ...typography.small, color: colors.primary, fontWeight: '700' }}>{dateBadge}</Text>
                    </View>

                    {/* Trip name */}
                    <Text style={{ ...typography.bodyBold, color: colors.text, fontSize: 16, marginBottom: spacing.xs }}>{item.title}</Text>

                    {/* Notes snippet */}
                    {item.notes ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
                        <Ionicons name="document-text-outline" size={13} color={colors.textMuted} />
                        <Text style={{ ...typography.small, color: colors.textMuted, flex: 1 }} numberOfLines={1}>{item.notes}</Text>
                      </View>
                    ) : null}

                    {/* Bottom row: catches chip + delete */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primarySurface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: colors.border }}>
                        <Ionicons name="fish-outline" size={13} color={colors.primary} />
                        <Text style={{ ...typography.small, color: colors.primary, fontWeight: '700' }}>{catchCount} улова</Text>
                      </View>

                      <View style={{ flex: 1 }} />

                      <Pressable hitSlop={8} onPress={() => confirmDelete(item)}>
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </Pressable>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </Screen>
  );
}
