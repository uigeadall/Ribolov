import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  TextInput, KeyboardAvoidingView, Platform, Linking,
  ActivityIndicator, Dimensions, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { getStories, deleteStory, timeAgo, STORY_REACTIONS, type Story, type StoryReactionType } from '../services/stories';
import { useStoryViewer, type FlyingEmoji } from '../hooks/useStoryViewer';
import { useAddStory } from '../hooks/useAddStory';

const { width: SW, height: SH } = Dimensions.get('window');

const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '���', '🤙'];

/* ── Flying emoji ─────────────────────────────────────────── */
function FlyingEmojiView({ item, onDone }: { item: FlyingEmoji; onDone: () => void }) {
  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.spring(item.scale, { toValue: 1.6, useNativeDriver: true, speed: 40, bounciness: 14 }),
        Animated.timing(item.scale, { toValue: 1.2, duration: 250, useNativeDriver: true }),
      ]),
      Animated.timing(item.translateY, { toValue: -280, duration: 1900, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(item.translateX, { toValue: -14, duration: 300, useNativeDriver: true }),
        Animated.timing(item.translateX, { toValue: 16, duration: 300, useNativeDriver: true }),
        Animated.timing(item.translateX, { toValue: -10, duration: 250, useNativeDriver: true }),
        Animated.timing(item.translateX, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(item.opacity, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    ]).start(onDone);
  }, []);

  return (
    <Animated.Text
      style={{
        position: 'absolute', bottom: 148, left: item.x - 28, fontSize: 56,
        transform: [{ translateY: item.translateY }, { translateX: item.translateX }, { scale: item.scale }],
        opacity: item.opacity, zIndex: 200,
      }}
    >
      {item.emoji}
    </Animated.Text>
  );
}

/* ── Main component ───────────────────────────────────────── */
type Props = { onStoriesLoaded?: (count: number) => void };

export function StoriesRow({ onStoriesLoaded }: Props) {
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();
  const [stories, setStories] = useState<Story[]>([]);
  const [viewing, setViewing] = useState<Story | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const viewer = useStoryViewer(viewing, user);
  const addStory = useAddStory(user, () => loadStories(), () => setAddOpen(false));

  const loadStories = useCallback(async () => {
    if (!configured) return;
    const list = await getStories();
    setStories(list);
    onStoriesLoaded?.(list.length);
  }, [configured, onStoriesLoaded]);

  useEffect(() => { void loadStories(); }, [loadStories]);

  const openViewer = (s: Story) => {
    viewer.setCommentsOpen(false);
    viewer.setCommentDraft('');
    setViewing(s);
  };

  const closeViewer = () => { setViewing(null); };

  const reactionEntries = Object.entries(STORY_REACTIONS) as [StoryReactionType, { emoji: string; label: string }][];

  const styles = useMemo(() => StyleSheet.create({
    rowWrapper: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    bubble: { alignItems: 'center', marginHorizontal: spacing.xs, width: 72 },
    ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 2.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySurface, overflow: 'hidden' },
    addRing: { borderColor: colors.border, backgroundColor: colors.card },
    emojiText: { fontSize: 26 },
    name: { ...typography.small, color: colors.text, marginTop: 4, textAlign: 'center', fontWeight: '600' },
    time: { fontSize: 11, lineHeight: 14, color: colors.textMuted, textAlign: 'center', marginTop: 1 },
    viewerBg: { flex: 1, backgroundColor: '#000' },
    viewerMedia: { width: SW, height: SH },
    viewerOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0 },
    viewerInfo: { padding: spacing.lg, paddingBottom: spacing.sm, backgroundColor: 'rgba(0,0,0,0.45)' },
    viewerName: { ...typography.bodyBold, color: '#fff', marginBottom: spacing.xs },
    viewerText: { ...typography.h3, color: '#fff', lineHeight: 26 },
    viewerMeta: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: spacing.sm },
    viewerClose: { position: 'absolute', top: insets.top + spacing.md, right: spacing.lg },
    reactionBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: 'rgba(0,0,0,0.65)' },
    reactionBtn: { alignItems: 'center', flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md },
    reactionBtnActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
    reactionEmoji: { fontSize: 28 },
    reactionCount: { ...typography.caption, color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 1 },
    reactionSummaryBar: { paddingHorizontal: spacing.md, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.4)' },
    commentsPanel: { backgroundColor: 'rgba(10,10,10,0.92)', paddingBottom: insets.bottom || spacing.md },
    commentsPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
    commentItem: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', alignItems: 'flex-start' },
    commentComposer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    commentInput: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'ios' ? spacing.sm + 1 : spacing.sm, color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', ...typography.body },
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

  return (
    <>
      <View style={styles.rowWrapper}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {user && configured ? (
          <Pressable style={styles.bubble} onPress={() => setAddOpen(true)}>
            <View style={[styles.ring, styles.addRing]}>
              <Ionicons name="add" size={28} color={colors.primary} />
            </View>
            <Text style={styles.name}>Мо��енти</Text>
          </Pressable>
        ) : null}
        {stories.map((s) => (
          <Pressable key={s.id} style={styles.bubble} onPress={() => openViewer(s)}>
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
      </View>

      {/* ── Full-screen story viewer ── */}
      <Modal visible={!!viewing} transparent={false} animationType="fade" onRequestClose={closeViewer}>
        {viewing ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.viewerBg}>
              {viewing.mediaUrl && viewing.mediaType === 'photo' ? (
                <Image source={{ uri: viewing.mediaUrl }} style={styles.viewerMedia} contentFit="contain" />
              ) : viewing.mediaUrl && viewing.mediaType === 'video' ? (
                <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="videocam" size={64} color="rgba(255,255,255,0.4)" />
                  <Pressable onPress={() => Linking.openURL(viewing.mediaUrl!).catch(() => {})} style={{ marginTop: spacing.lg, backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill }}>
                    <Text style={{ ...typography.bodyBold, color: '#fff' }}>▶ Гледа�� видеото</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }]}>
                  <Text style={{ fontSize: 80 }}>{viewing.emoji ?? '🎣'}</Text>
                </View>
              )}

              {viewer.flyingEmojis.map((fe) => (
                <FlyingEmojiView key={fe.id} item={fe} onDone={() => viewer.removeFlyingEmoji(fe.id)} />
              ))}

              <Pressable style={styles.viewerClose} onPress={closeViewer} hitSlop={12}>
                <Ionicons name="close-circle" size={32} color="rgba(255,255,255,0.85)" />
              </Pressable>

              <View style={styles.viewerOverlay}>
                <View style={styles.viewerInfo}>
                  <Text style={styles.viewerName}>{viewing.userName} · {timeAgo(viewing.createdAt)}</Text>
                  {viewing.text ? <Text style={styles.viewerText}>{viewing.text}</Text> : null}
                  {viewing.locationName ? <Text style={styles.viewerMeta}>📍 {viewing.locationName}</Text> : null}
                  {viewing.uid === user?.uid ? (
                    <Pressable onPress={() => { deleteStory(viewing.id).then(loadStories); closeViewer(); }} style={{ marginTop: spacing.sm }}>
                      <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.45)' }}>Изтрий момента</Text>
                    </Pressable>
                  ) : null}
                </View>

                {user ? (
                  <View style={styles.reactionBar}>
                    {reactionEntries.map(([type, r], idx) => {
                      const count = viewer.reactionSummary.find((s) => s.type === type)?.count ?? 0;
                      const isActive = viewer.myReaction === type;
                      const segW = (SW - 52) / reactionEntries.length;
                      const tapX = segW * idx + segW / 2;
                      return (
                        <Pressable key={type} style={[styles.reactionBtn, isActive && styles.reactionBtnActive]} onPress={() => viewer.handlePickReaction(type, tapX)}>
                          <Text style={[styles.reactionEmoji, isActive && { transform: [{ scale: 1.25 }] }]}>{r.emoji}</Text>
                          {count > 0 && <Text style={styles.reactionCount}>{count}</Text>}
                        </Pressable>
                      );
                    })}
                    <Pressable style={styles.reactionBtn} onPress={() => viewer.setCommentsOpen((v) => !v)}>
                      <Ionicons name={viewer.commentsOpen ? 'chatbubble' : 'chatbubble-outline'} size={24} color={viewer.commentsOpen ? '#fff' : 'rgba(255,255,255,0.55)'} />
                      {viewer.comments.length > 0 && <Text style={styles.reactionCount}>{viewer.comments.length}</Text>}
                    </Pressable>
                  </View>
                ) : null}

                {viewer.totalReactions > 0 && !viewer.commentsOpen && (
                  <View style={styles.reactionSummaryBar}>
                    <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.55)' }}>
                      {viewer.reactionSummary.slice(0, 3).map((r) => r.emoji).join('  ')}  {viewer.totalReactions}
                    </Text>
                  </View>
                )}

                {viewer.commentsOpen && (
                  <View style={styles.commentsPanel}>
                    <View style={styles.commentsPanelHeader}>
                      <Text style={{ ...typography.bodyBold, color: '#fff' }}>Коментари ({viewer.comments.length})</Text>
                      <Pressable onPress={() => viewer.setCommentsOpen(false)} hitSlop={8}>
                        <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.5)" />
                      </Pressable>
                    </View>
                    <ScrollView style={{ maxHeight: SH * 0.2 }} keyboardShouldPersistTaps="handled">
                      {viewer.comments.length === 0 ? (
                        <Text style={{ ...typography.body, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: spacing.lg }}>
                          Бъди първият, който коментира!
                        </Text>
                      ) : viewer.comments.map((c) => {
                        const canDelete = user && (c.authorUid === user.uid || viewing.uid === user.uid);
                        return (
                          <View key={c.id} style={styles.commentItem}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.65)', fontWeight: '700' }}>{c.authorName}</Text>
                              <Text style={{ ...typography.body, color: '#fff', marginTop: 2, lineHeight: 20 }}>{c.text}</Text>
                            </View>
                            {canDelete && (
                              <Pressable onPress={() => viewer.handleDeleteComment(c.id)} hitSlop={8} style={{ paddingLeft: spacing.sm, paddingTop: 2 }}>
                                <Ionicons name="trash-outline" size={14} color="rgba(255,80,80,0.65)" />
                              </Pressable>
                            )}
                          </View>
                        );
                      })}
                    </ScrollView>
                    <View style={styles.commentComposer}>
                      <TextInput
                        style={styles.commentInput}
                        placeholder="Коментир��й…"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                        value={viewer.commentDraft}
                        onChangeText={viewer.setCommentDraft}
                        maxLength={500}
                        returnKeyType="send"
                        onSubmitEditing={viewer.handleSendComment}
                      />
                      <Pressable onPress={viewer.handleSendComment} disabled={viewer.commentBusy || !viewer.commentDraft.trim()} hitSlop={8}>
                        {viewer.commentBusy
                          ? <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
                          : <Ionicons name="send" size={22} color={viewer.commentDraft.trim() ? '#fff' : 'rgba(255,255,255,0.25)'} />}
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>

      {/* ── Add story composer ── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg }} keyboardShouldPersistTaps="handled">
            <View style={styles.addSheet}>
              <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.md }}>Нов момент</Text>
              {addStory.mediaUri && addStory.mediaType === 'photo' ? (
                <View style={{ position: 'relative', marginBottom: spacing.sm }}>
                  <Image source={{ uri: addStory.mediaUri }} style={styles.mediaPreview} contentFit="cover" />
                  <Pressable style={styles.removeMedia} onPress={() => { addStory.setMediaUri(null); addStory.setMediaType(null); }}>
                    <Ionicons name="close" size={16} color="#fff" />
                  </Pressable>
                </View>
              ) : addStory.mediaUri && addStory.mediaType === 'video' ? (
                <View style={{ position: 'relative' }}>
                  <View style={styles.videoPlaceholder}>
                    <Ionicons name="videocam" size={36} color="rgba(255,255,255,0.6)" />
                    <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.6)', marginTop: spacing.xs }}>Видео избрано</Text>
                  </View>
                  <Pressable style={styles.removeMedia} onPress={() => { addStory.setMediaUri(null); addStory.setMediaType(null); }}>
                    <Ionicons name="close" size={16} color="#fff" />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.mediaBtns}>
                <Pressable style={styles.mediaBtn} onPress={() => addStory.pickMedia('camera', 'photo')}>
                  <Ionicons name="camera-outline" size={18} color={colors.primary} />
                  <Text style={styles.mediaBtnText}>Снимай</Text>
                </Pressable>
                <Pressable style={styles.mediaBtn} onPress={() => addStory.pickMedia('library', 'photo')}>
                  <Ionicons name="image-outline" size={18} color={colors.primary} />
                  <Text style={styles.mediaBtnText}>Галерия</Text>
                </Pressable>
                <Pressable style={styles.mediaBtn} onPress={() => addStory.pickMedia('library', 'video')}>
                  <Ionicons name="videocam-outline" size={18} color={colors.primary} />
                  <Text style={styles.mediaBtnText}>Видео</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>ЕМОТИКОН</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiRow}>
                {EMOJIS.map((e) => (
                  <Pressable key={e} style={[styles.emojiBtn, addStory.selectedEmoji === e && styles.emojiBtnActive]} onPress={() => addStory.setSelectedEmoji(e)}>
                    <Text style={{ fontSize: 20 }}>{e}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={[styles.label, { marginTop: spacing.sm }]}>СЪОБЩЕНИЕ</Text>
              <TextInput
                style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                placeholder={addStory.mediaUri ? 'Добави надпис… (по избор)' : 'Риболов при Батак, вода 12°C…'}
                placeholderTextColor={colors.textMuted}
                value={addStory.text}
                onChangeText={addStory.setText}
                multiline maxLength={280}
              />
              <Text style={[styles.label, { marginTop: spacing.sm }]}>МЕСТОПОЛОЖЕНИЕ</Text>
              <TextInput
                style={styles.input}
                placeholder="напр. яз. Огоста"
                placeholderTextColor={colors.textMuted}
                value={addStory.location}
                onChangeText={addStory.setLocation}
                maxLength={60} returnKeyType="done"
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <Pressable onPress={() => { setAddOpen(false); addStory.setMediaUri(null); addStory.setMediaType(null); }} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md }}>
                  <Text style={{ ...typography.body, color: colors.textMuted }}>Отказ</Text>
                </Pressable>
                <Pressable
                  onPress={addStory.handlePost}
                  disabled={addStory.saving || (!addStory.text.trim() && !addStory.mediaUri)}
                  style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, opacity: addStory.saving || (!addStory.text.trim() && !addStory.mediaUri) ? 0.5 : 1, flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}
                >
                  {addStory.saving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={{ ...typography.bodyBold, color: '#fff' }}>{addStory.saving ? 'Качване…' : 'Сподели'}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
