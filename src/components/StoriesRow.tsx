import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { getStories, addStory, deleteStory, timeAgo, type Story } from '../services/stories';

type Props = { onStoriesLoaded?: (count: number) => void };

export function StoriesRow({ onStoriesLoaded }: Props) {
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [viewing, setViewing] = useState<Story | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState('🎣');

  const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '🏆', '🤙'];

  const load = useCallback(async () => {
    if (!configured) return;
    const list = await getStories();
    setStories(list);
    onStoriesLoaded?.(list.length);
  }, [configured, onStoriesLoaded]);

  useEffect(() => { load(); }, [load]);

  const styles = useMemo(() => StyleSheet.create({
    row: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    bubble: { alignItems: 'center', marginHorizontal: spacing.xs, width: 68 },
    ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 2.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySurface },
    addRing: { borderColor: colors.border, backgroundColor: colors.card },
    emojiText: { fontSize: 26 },
    name: { ...typography.small, color: colors.text, marginTop: 4, textAlign: 'center', fontWeight: '600' },
    time: { ...typography.small, color: colors.textMuted, fontSize: 10, textAlign: 'center' },
    modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
    storyCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.xl, width: '85%', alignItems: 'center' },
    storyEmoji: { fontSize: 52, marginBottom: spacing.md },
    storyName: { ...typography.bodyBold, color: colors.white, opacity: 0.8, marginBottom: spacing.sm },
    storyText: { ...typography.h3, color: colors.white, textAlign: 'center', lineHeight: 28 },
    storyMeta: { ...typography.caption, color: colors.white, opacity: 0.7, marginTop: spacing.md },
    addSheet: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, width: '90%' },
    label: { ...typography.small, color: colors.textMuted, fontWeight: '700', marginBottom: spacing.xs },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, backgroundColor: colors.surfaceAlt, ...typography.body },
    emojiRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm },
    emojiBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    emojiBtnActive: { backgroundColor: colors.primarySurface, borderColor: colors.primary },
  }), [colors]);

  const handlePost = async () => {
    if (!user || !text.trim()) return;
    setSaving(true);
    try {
      await addStory({
        uid: user.uid,
        userName: user.displayName?.split(' ')[0] ?? 'Рибар',
        userPhotoUrl: user.photoURL ?? undefined,
        text: text.trim(),
        locationName: location.trim() || undefined,
        emoji: selectedEmoji,
      });
      setText(''); setLocation(''); setAddOpen(false);
      await load();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно.');
    } finally { setSaving(false); }
  };

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { paddingHorizontal: spacing.md }]}>
        {user && configured ? (
          <Pressable style={styles.bubble} onPress={() => setAddOpen(true)}>
            <View style={[styles.ring, styles.addRing]}>
              <Ionicons name="add" size={28} color={colors.primary} />
            </View>
            <Text style={styles.name}>Моменти</Text>
          </Pressable>
        ) : null}
        {stories.map((s) => (
          <Pressable key={s.id} style={styles.bubble} onPress={() => setViewing(s)}>
            <View style={[styles.ring, { borderColor: s.uid === user?.uid ? colors.accent : colors.primary }]}>
              <Text style={styles.emojiText}>{s.emoji ?? '🎣'}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>{s.userName}</Text>
            <Text style={styles.time}>{timeAgo(s.createdAt)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Story viewer */}
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.modalBg} onPress={() => setViewing(null)}>
          {viewing ? (
            <View style={styles.storyCard}>
              <Text style={styles.storyEmoji}>{viewing.emoji ?? '🎣'}</Text>
              <Text style={styles.storyName}>{viewing.userName}</Text>
              <Text style={styles.storyText}>{viewing.text}</Text>
              {viewing.locationName ? (
                <Text style={styles.storyMeta}>📍 {viewing.locationName}</Text>
              ) : null}
              <Text style={styles.storyMeta}>🕐 {timeAgo(viewing.createdAt)}</Text>
              {viewing.uid === user?.uid ? (
                <Pressable onPress={() => { deleteStory(viewing.id).then(load); setViewing(null); }} style={{ marginTop: spacing.lg }}>
                  <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.6)' }}>Изтрий момента</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </Modal>

      {/* Add story sheet */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: spacing.lg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.addSheet}>
            <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.md }}>Нов момент</Text>
            <Text style={styles.label}>ЕМОТИКОН</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiRow}>
              {EMOJIS.map((e) => (
                <Pressable key={e} style={[styles.emojiBtn, selectedEmoji === e && styles.emojiBtnActive]} onPress={() => setSelectedEmoji(e)}>
                  <Text style={{ fontSize: 20 }}>{e}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[styles.label, { marginTop: spacing.sm }]}>СЪОБЩЕНИЕ *</Text>
            <TextInput style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]} placeholder="Риболов при Батак, вода 12°C…" placeholderTextColor={colors.textMuted} value={text} onChangeText={setText} multiline maxLength={280} />
            <Text style={[styles.label, { marginTop: spacing.sm }]}>МЕСТОПОЛОЖЕНИЕ</Text>
            <TextInput style={styles.input} placeholder="напр. яз. Огоста" placeholderTextColor={colors.textMuted} value={location} onChangeText={setLocation} maxLength={60} returnKeyType="done" />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md }}>
                <Text style={{ ...typography.body, color: colors.textMuted }}>Отказ</Text>
              </Pressable>
              <Pressable onPress={handlePost} disabled={saving || !text.trim()} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md }}>
                <Text style={{ ...typography.bodyBold, color: colors.white }}>
                  {saving ? 'Изпращане…' : 'Сподели'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
