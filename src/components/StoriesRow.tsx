import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  Alert, TextInput, KeyboardAvoidingView, Platform, Linking,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  getStories, addStory, deleteStory, uploadStoryMedia,
  timeAgo, type Story,
} from '../services/stories';

const { width: SW, height: SH } = Dimensions.get('window');

type Props = { onStoriesLoaded?: (count: number) => void };

export function StoriesRow({ onStoriesLoaded }: Props) {
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();
  const [stories, setStories] = useState<Story[]>([]);
  const [viewing, setViewing] = useState<Story | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState('🎣');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);

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
    ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 2.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySurface, overflow: 'hidden' },
    addRing: { borderColor: colors.border, backgroundColor: colors.card },
    emojiText: { fontSize: 26 },
    name: { ...typography.small, color: colors.text, marginTop: 4, textAlign: 'center', fontWeight: '600' },
    time: { ...typography.small, color: colors.textMuted, fontSize: 10, textAlign: 'center' },
    // Viewer
    viewerBg: { flex: 1, backgroundColor: '#000' },
    viewerMedia: { width: SW, height: SH },
    viewerOverlay: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: spacing.xl, paddingBottom: insets.bottom + spacing.xl,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    viewerName: { ...typography.bodyBold, color: '#fff', marginBottom: spacing.xs },
    viewerText: { ...typography.h3, color: '#fff', lineHeight: 26 },
    viewerMeta: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: spacing.sm },
    viewerClose: { position: 'absolute', top: insets.top + spacing.md, right: spacing.lg },
    viewerDelete: { marginTop: spacing.md },
    // Composer
    addSheet: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, width: '94%', maxHeight: SH * 0.9 },
    label: { ...typography.small, color: colors.textMuted, fontWeight: '700', marginBottom: spacing.xs },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, backgroundColor: colors.surfaceAlt, ...typography.body },
    emojiRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm },
    emojiBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    emojiBtnActive: { backgroundColor: colors.primarySurface, borderColor: colors.primary },
    mediaBtns: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    mediaBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm + 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    mediaBtnText: { ...typography.small, color: colors.primary, fontWeight: '600' },
    mediaPreview: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm, overflow: 'hidden' },
    removeMedia: { position: 'absolute', top: spacing.xs, right: spacing.xs, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 4 },
    videoPlaceholder: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: '#111', marginBottom: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  }), [colors, insets]);

  const pickMedia = async (source: 'library' | 'camera', type: 'photo' | 'video') => {
    try {
      let result: ImagePicker.ImagePickerResult;
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: type === 'video'
          ? ImagePicker.MediaTypeOptions.Videos
          : ImagePicker.MediaTypeOptions.Images,
        quality: type === 'video' ? 0.8 : 0.85,
        videoMaxDuration: 60,
        allowsEditing: type === 'photo',
      };
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Достъп', 'Разреши достъп до камерата.', [
            { text: 'Отказ', style: 'cancel' },
            { text: 'Настройки', onPress: () => Linking.openSettings() },
          ]);
          return;
        }
        result = await ImagePicker.launchCameraAsync(opts);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        result = await ImagePicker.launchImageLibraryAsync(opts);
      }
      if (!result.canceled && result.assets[0]) {
        setMediaUri(result.assets[0].uri);
        setMediaType(type);
      }
    } catch {
      Alert.alert('Грешка', 'Неуспешно избиране на медия.');
    }
  };

  const handlePost = async () => {
    if (!user) return;
    if (!text.trim() && !mediaUri) {
      Alert.alert('Добави съдържание', 'Напиши нещо или добави снимка/видео.');
      return;
    }
    setSaving(true);
    try {
      let uploadedUrl: string | undefined;
      if (mediaUri && mediaType) {
        uploadedUrl = await uploadStoryMedia(mediaUri, user.uid, mediaType);
      }
      await addStory({
        uid: user.uid,
        userName: user.displayName?.split(' ')[0] ?? 'Рибар',
        userPhotoUrl: user.photoURL ?? undefined,
        text: text.trim(),
        locationName: location.trim() || undefined,
        emoji: selectedEmoji,
        mediaUrl: uploadedUrl,
        mediaType: mediaType ?? undefined,
      });
      setText(''); setLocation(''); setMediaUri(null); setMediaType(null);
      setAddOpen(false);
      await load();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally { setSaving(false); }
  };

  const openVideo = (url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Грешка', 'Неуспешно отваряне на видеото.'));
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
              {s.mediaUrl && s.mediaType === 'photo' ? (
                <Image source={{ uri: s.mediaUrl }} style={{ width: 58, height: 58 }} contentFit="cover" />
              ) : s.mediaType === 'video' ? (
                <Ionicons name="videocam" size={26} color={colors.primary} />
              ) : (
                <Text style={styles.emojiText}>{s.emoji ?? '🎣'}</Text>
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>{s.userName}</Text>
            <Text style={styles.time}>{timeAgo(s.createdAt)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Full-screen story viewer ── */}
      <Modal visible={!!viewing} transparent={false} animationType="fade" onRequestClose={() => setViewing(null)}>
        {viewing ? (
          <View style={styles.viewerBg}>
            {viewing.mediaUrl && viewing.mediaType === 'photo' ? (
              <Image
                source={{ uri: viewing.mediaUrl }}
                style={styles.viewerMedia}
                contentFit="contain"
              />
            ) : viewing.mediaUrl && viewing.mediaType === 'video' ? (
              <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="videocam" size={64} color="rgba(255,255,255,0.4)" />
                <Pressable
                  onPress={() => openVideo(viewing.mediaUrl!)}
                  style={{ marginTop: spacing.lg, backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill }}
                >
                  <Text style={{ ...typography.bodyBold, color: '#fff' }}>▶ Гледай видеото</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }]}>
                <Text style={{ fontSize: 80 }}>{viewing.emoji ?? '🎣'}</Text>
              </View>
            )}

            {/* Info overlay at bottom */}
            <View style={styles.viewerOverlay}>
              <Text style={styles.viewerName}>{viewing.userName} · {timeAgo(viewing.createdAt)}</Text>
              {viewing.text ? <Text style={styles.viewerText}>{viewing.text}</Text> : null}
              {viewing.locationName ? (
                <Text style={styles.viewerMeta}>📍 {viewing.locationName}</Text>
              ) : null}
              {viewing.uid === user?.uid ? (
                <Pressable style={styles.viewerDelete} onPress={() => { deleteStory(viewing.id).then(load); setViewing(null); }}>
                  <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.55)' }}>Изтрий момента</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Close button */}
            <Pressable style={styles.viewerClose} onPress={() => setViewing(null)} hitSlop={12}>
              <Ionicons name="close-circle" size={32} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
        ) : null}
      </Modal>

      {/* ── Add story composer ── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ alignItems: 'center', paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.addSheet}>
              <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.md }}>Нов момент</Text>

              {/* Media preview */}
              {mediaUri && mediaType === 'photo' ? (
                <View style={{ position: 'relative', marginBottom: spacing.sm }}>
                  <Image source={{ uri: mediaUri }} style={styles.mediaPreview} contentFit="cover" />
                  <Pressable style={styles.removeMedia} onPress={() => { setMediaUri(null); setMediaType(null); }}>
                    <Ionicons name="close" size={16} color="#fff" />
                  </Pressable>
                </View>
              ) : mediaUri && mediaType === 'video' ? (
                <View style={{ position: 'relative' }}>
                  <View style={styles.videoPlaceholder}>
                    <Ionicons name="videocam" size={36} color="rgba(255,255,255,0.6)" />
                    <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.6)', marginTop: spacing.xs }}>Видео избрано</Text>
                  </View>
                  <Pressable style={styles.removeMedia} onPress={() => { setMediaUri(null); setMediaType(null); }}>
                    <Ionicons name="close" size={16} color="#fff" />
                  </Pressable>
                </View>
              ) : null}

              {/* Media picker buttons */}
              <View style={styles.mediaBtns}>
                <Pressable style={styles.mediaBtn} onPress={() => pickMedia('camera', 'photo')}>
                  <Ionicons name="camera-outline" size={18} color={colors.primary} />
                  <Text style={styles.mediaBtnText}>Снимай</Text>
                </Pressable>
                <Pressable style={styles.mediaBtn} onPress={() => pickMedia('library', 'photo')}>
                  <Ionicons name="image-outline" size={18} color={colors.primary} />
                  <Text style={styles.mediaBtnText}>Галерия</Text>
                </Pressable>
                <Pressable style={styles.mediaBtn} onPress={() => pickMedia('library', 'video')}>
                  <Ionicons name="videocam-outline" size={18} color={colors.primary} />
                  <Text style={styles.mediaBtnText}>Видео</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>ЕМОТИКОН</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiRow}>
                {EMOJIS.map((e) => (
                  <Pressable key={e} style={[styles.emojiBtn, selectedEmoji === e && styles.emojiBtnActive]} onPress={() => setSelectedEmoji(e)}>
                    <Text style={{ fontSize: 20 }}>{e}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={[styles.label, { marginTop: spacing.sm }]}>СЪОБЩЕНИЕ</Text>
              <TextInput
                style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                placeholder={mediaUri ? 'Добави надпис… (по избор)' : 'Риболов при Батак, вода 12°C…'}
                placeholderTextColor={colors.textMuted}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={280}
              />

              <Text style={[styles.label, { marginTop: spacing.sm }]}>МЕСТОПОЛОЖЕНИЕ</Text>
              <TextInput
                style={styles.input}
                placeholder="напр. яз. Огоста"
                placeholderTextColor={colors.textMuted}
                value={location}
                onChangeText={setLocation}
                maxLength={60}
                returnKeyType="done"
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <Pressable
                  onPress={() => { setAddOpen(false); setMediaUri(null); setMediaType(null); }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md }}
                >
                  <Text style={{ ...typography.body, color: colors.textMuted }}>Отказ</Text>
                </Pressable>
                <Pressable
                  onPress={handlePost}
                  disabled={saving || (!text.trim() && !mediaUri)}
                  style={{
                    flex: 2, alignItems: 'center', paddingVertical: spacing.md,
                    backgroundColor: colors.primary, borderRadius: radius.md,
                    opacity: saving || (!text.trim() && !mediaUri) ? 0.5 : 1,
                    flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
                  }}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={{ ...typography.bodyBold, color: '#fff' }}>
                    {saving ? 'Качване…' : 'Сподели'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
