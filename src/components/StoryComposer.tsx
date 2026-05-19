import React, { useMemo } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { AddStoryState } from '../hooks/useAddStory';

type Prompt = { emoji: string; label: string; prefill: string };

const STORY_PROMPTS: Prompt[] = [
  { emoji: '🎣', label: 'Какво хапе?', prefill: 'На яза хапе на… ' },
  { emoji: '🌅', label: 'Утрин на водата', prefill: 'Утрин на яза, водата е спокойна.' },
  { emoji: '🐟', label: 'Днешен улов', prefill: 'Днешен улов: ' },
  { emoji: '🌊', label: 'Условия днес', prefill: 'Вода ?°C, вятър от запад, ' },
  { emoji: '🌧️', label: 'Времето', prefill: 'Времето днес: ' },
  { emoji: '❓', label: 'Кой идва?', prefill: 'Кой идва утре сутрин на яза? ' },
  { emoji: '🏆', label: 'Личен рекорд', prefill: 'Току-що хванах личен рекорд! ' },
  { emoji: '🛶', label: 'От лодката', prefill: 'От лодката: ' },
];

const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '🏆', '🤙'];

type Props = {
  visible: boolean;
  onClose: () => void;
  addStory: AddStoryState;
};

export function StoryComposer({ visible, onClose, addStory }: Props) {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    hero: {
      paddingTop: insets.top + 6,
      paddingBottom: 12,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    closeBtn: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center', justifyContent: 'center',
    },
    heroTitleWrap: { flex: 1 },
    heroTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
    heroSub: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
    postBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    postBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    body: { padding: spacing.lg, gap: spacing.lg },

    // Media preview block
    mediaPreviewWrap: {
      position: 'relative',
      width: '100%',
      aspectRatio: 4 / 5,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surfaceAlt,
    },
    mediaPreview: { width: '100%', height: '100%' },
    removeMedia: {
      position: 'absolute',
      top: 10, right: 10,
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center', justifyContent: 'center',
    },
    mediaOverlay: {
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      paddingHorizontal: spacing.md,
      paddingTop: 26,
      paddingBottom: spacing.md,
    },
    mediaOverlayEmoji: { fontSize: 28 },
    mediaOverlayText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
      marginTop: 4,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },

    // Media picker tiles when no media yet
    pickerRow: { flexDirection: 'row', gap: spacing.sm },
    pickerTile: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    pickerTileIcon: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 6,
    },
    pickerTileText: { fontSize: 12, fontFamily: 'Nunito_700Bold', color: colors.text },
    pickerTileSub: { fontSize: 10, color: colors.textMuted },

    // Section labels
    sectionLabel: {
      fontSize: 10,
      fontFamily: 'Nunito_700Bold',
      color: colors.textMuted,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
      marginBottom: 8,
    },

    // Prompt cards
    promptRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
    promptCard: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      minWidth: 96,
      gap: 4,
    },
    promptCardActive: {
      backgroundColor: colors.primarySurface,
      borderColor: colors.primary,
    },
    promptEmoji: { fontSize: 22 },
    promptLabel: { fontSize: 10, fontFamily: 'Nunito_700Bold', color: colors.text, textAlign: 'center' },

    // Input fields
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      gap: 8,
    },
    fieldIcon: { color: colors.textMuted },
    fieldInput: {
      flex: 1,
      paddingVertical: spacing.sm + 4,
      fontSize: 15,
      color: colors.text,
    },
    fieldInputMultiline: { minHeight: 92, textAlignVertical: 'top' as const, paddingTop: spacing.sm + 4 },
    charCount: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: 'right' },

    // Emoji bar
    emojiBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    emojiBtn: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.card,
    },
    emojiBtnActive: {
      backgroundColor: colors.primarySurface,
      borderColor: colors.primary,
    },
    emojiChar: { fontSize: 22 },
  }), [colors, insets.top]);

  const hasContent = !!(addStory.text.trim() || addStory.mediaUri);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <LinearGradient colors={heroColors} style={styles.hero}>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <View style={styles.heroTitleWrap}>
            <Text style={styles.heroTitle}>Нов момент</Text>
            <Text style={styles.heroSub}>Изчезва след 24 часа</Text>
          </View>
          <Pressable
            onPress={addStory.handlePost}
            disabled={addStory.saving || !hasContent}
            style={[styles.postBtn, (addStory.saving || !hasContent) && { opacity: 0.5 }]}
            hitSlop={8}
          >
            {addStory.saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.postBtnText}>Сподели</Text>}
          </Pressable>
        </LinearGradient>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Media preview or pickers */}
          {addStory.mediaUri && addStory.mediaType === 'photo' ? (
            <View style={styles.mediaPreviewWrap}>
              <Image source={{ uri: addStory.mediaUri }} style={styles.mediaPreview} contentFit="cover" />
              <Pressable
                style={styles.removeMedia}
                onPress={() => { addStory.setMediaUri(null); addStory.setMediaType(null); }}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.55)']}
                style={styles.mediaOverlay}
                start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
              >
                <Text style={styles.mediaOverlayEmoji}>{addStory.selectedEmoji}</Text>
                {addStory.text.trim() ? (
                  <Text style={styles.mediaOverlayText} numberOfLines={3}>
                    {addStory.text}
                  </Text>
                ) : null}
              </LinearGradient>
            </View>
          ) : addStory.mediaUri && addStory.mediaType === 'video' ? (
            <View style={[styles.mediaPreviewWrap, { backgroundColor: '#111' }]}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="play" size={28} color="#fff" />
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' }}>Видео избрано</Text>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Ще се качи при споделяне</Text>
              </View>
              <Pressable
                style={styles.removeMedia}
                onPress={() => { addStory.setMediaUri(null); addStory.setMediaType(null); }}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.pickerRow}>
              <Pressable style={styles.pickerTile} onPress={() => addStory.pickMedia('camera', 'photo')}>
                <View style={styles.pickerTileIcon}>
                  <Ionicons name="camera" size={20} color={colors.primary} />
                </View>
                <Text style={styles.pickerTileText}>Снимай</Text>
                <Text style={styles.pickerTileSub}>Камера</Text>
              </Pressable>
              <Pressable style={styles.pickerTile} onPress={() => addStory.pickMedia('library', 'photo')}>
                <View style={styles.pickerTileIcon}>
                  <Ionicons name="image" size={20} color={colors.primary} />
                </View>
                <Text style={styles.pickerTileText}>Галерия</Text>
                <Text style={styles.pickerTileSub}>Снимка</Text>
              </Pressable>
              <Pressable style={styles.pickerTile} onPress={() => addStory.pickMedia('library', 'video')}>
                <View style={styles.pickerTileIcon}>
                  <Ionicons name="videocam" size={20} color={colors.primary} />
                </View>
                <Text style={styles.pickerTileText}>Видео</Text>
                <Text style={styles.pickerTileSub}>До 60с</Text>
              </Pressable>
            </View>
          )}

          {/* Prompt cards */}
          <View>
            <Text style={styles.sectionLabel}>Идеи за момент</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptRow}>
              {STORY_PROMPTS.map((p) => {
                // Only highlight a prompt when the user actually started from it —
                // checking the text. Matching on emoji alone produces false positives
                // since the same emoji is used by multiple prompts and as a manual pick.
                const active = !!addStory.text && addStory.text.startsWith(p.prefill);
                return (
                  <Pressable
                    key={p.label}
                    style={[styles.promptCard, active && styles.promptCardActive]}
                    onPress={() => {
                      addStory.setText(p.prefill);
                      addStory.setSelectedEmoji(p.emoji);
                    }}
                  >
                    <Text style={styles.promptEmoji}>{p.emoji}</Text>
                    <Text style={styles.promptLabel} numberOfLines={1}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Text */}
          <View>
            <Text style={styles.sectionLabel}>Съобщение</Text>
            <View style={[styles.fieldRow, { alignItems: 'flex-start' }]}>
              <Ionicons name="create-outline" size={16} color={colors.textMuted} style={{ marginTop: 14 }} />
              <TextInput
                style={[styles.fieldInput, styles.fieldInputMultiline]}
                placeholder={addStory.mediaUri ? 'Добави надпис (по избор)…' : 'Сподели нещо със рибарите…'}
                placeholderTextColor={colors.textMuted}
                value={addStory.text}
                onChangeText={addStory.setText}
                multiline
                maxLength={280}
              />
            </View>
            <Text style={styles.charCount}>{280 - addStory.text.length} символа</Text>
          </View>

          {/* Location */}
          <View>
            <Text style={styles.sectionLabel}>Местоположение</Text>
            <View style={styles.fieldRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.fieldInput}
                placeholder="напр. яз. Огоста"
                placeholderTextColor={colors.textMuted}
                value={addStory.location}
                onChangeText={addStory.setLocation}
                maxLength={60}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Emoji picker */}
          <View>
            <Text style={styles.sectionLabel}>Емоджи</Text>
            <View style={styles.emojiBar}>
              {EMOJIS.map((e) => (
                <Pressable
                  key={e}
                  style={[styles.emojiBtn, addStory.selectedEmoji === e && styles.emojiBtnActive]}
                  onPress={() => addStory.setSelectedEmoji(e)}
                >
                  <Text style={styles.emojiChar}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ height: insets.bottom + 8 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
