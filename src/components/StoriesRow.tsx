import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  Alert, TextInput, KeyboardAvoidingView, Platform, Linking,
  ActivityIndicator, Dimensions, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  getStories, addStory, deleteStory, uploadStoryMedia, timeAgo,
  subscribeMyStoryReaction, toggleStoryReaction, getStoryReactionSummary,
  subscribeStoryComments, addStoryComment, deleteStoryComment,
  STORY_REACTIONS,
  type Story, type StoryReactionType, type StoryReactionSummary, type StoryComment,
} from '../services/stories';

const { width: SW, height: SH } = Dimensions.get('window');

/* ── Flying emoji ─────────────────────────────────────────── */
type FlyingEmoji = {
  id: string;
  emoji: string;
  x: number;
  translateY: Animated.Value;
  translateX: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
};

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
        position: 'absolute',
        bottom: 148,
        left: item.x - 28,
        fontSize: 56,
        transform: [
          { translateY: item.translateY },
          { translateX: item.translateX },
          { scale: item.scale },
        ],
        opacity: item.opacity,
        zIndex: 200,
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
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState('🎣');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);

  // Viewer social state
  const [myReaction, setMyReaction] = useState<StoryReactionType | null>(null);
  const [reactionSummary, setReactionSummary] = useState<StoryReactionSummary[]>([]);
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [flyingEmojis, setFlyingEmojis] = useState<FlyingEmoji[]>([]);

  const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '🏆', '🤙'];

  const load = useCallback(async () => {
    if (!configured) return;
    const list = await getStories();
    setStories(list);
    onStoriesLoaded?.(list.length);
  }, [configured, onStoriesLoaded]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!viewing || !user) return;
    setMyReaction(null);
    setReactionSummary([]);
    setComments([]);
    const unsubReaction = subscribeMyStoryReaction(viewing.id, user.uid, setMyReaction);
    const unsubComments = subscribeStoryComments(viewing.id, setComments);
    getStoryReactionSummary(viewing.id).then(setReactionSummary);
    return () => { unsubReaction(); unsubComments(); };
  }, [viewing?.id, user?.uid]);

  const handlePickReaction = useCallback(async (type: StoryReactionType, tapX: number) => {
    if (!viewing || !user) return;
    const fe: FlyingEmoji = {
      id: `${Date.now()}-${Math.random()}`,
      emoji: STORY_REACTIONS[type].emoji,
      x: tapX,
      translateY: new Animated.Value(0),
      translateX: new Animated.Value(0),
      scale: new Animated.Value(0.3),
      opacity: new Animated.Value(1),
    };
    setFlyingEmojis((prev) => [...prev, fe]);
    try {
      await toggleStoryReaction(viewing.id, user.uid, user.displayName ?? 'Рибар', type);
      const summary = await getStoryReactionSummary(viewing.id);
      setReactionSummary(summary);
    } catch { /* best-effort */ }
  }, [viewing, user]);

  const removeFlyingEmoji = useCallback((id: string) => {
    setFlyingEmojis((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSendComment = useCallback(async () => {
    if (!viewing || !user || !commentDraft.trim() || commentBusy) return;
    setCommentBusy(true);
    try {
      await addStoryComment(viewing.id, user.uid, user.displayName ?? 'Рибар', commentDraft);
      setCommentDraft('');
    } catch (e) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally { setCommentBusy(false); }
  }, [viewing, user, commentDraft, commentBusy]);

  const handleDeleteComment = useCallback((commentId: string) => {
    if (!viewing) return;
    Alert.alert('Изтриване', 'Изтриване на коментара?', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Изтрий', style: 'destructive', onPress: () => deleteStoryComment(viewing.id, commentId).catch(() => {}) },
    ]);
  }, [viewing]);

  const openViewer = (s: Story) => {
    setFlyingEmojis([]);
    setCommentsOpen(false);
    setCommentDraft('');
    setViewing(s);
  };

  const closeViewer = () => { setViewing(null); setFlyingEmojis([]); };

  const styles = useMemo(() => StyleSheet.create({
    row: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    bubble: { alignItems: 'center', marginHorizontal: spacing.xs, width: 68 },
    ring: { width: 58, height: 58, borderRadius: 29, borderWidth: 2.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySurface, overflow: 'hidden' },
    addRing: { borderColor: colors.border, backgroundColor: colors.card },
    emojiText: { fontSize: 26 },
    name: { ...typography.small, color: colors.text, marginTop: 4, textAlign: 'center', fontWeight: '600' },
    time: { ...typography.small, color: colors.textMuted, fontSize: 10, textAlign: 'center' },
    viewerBg: { flex: 1, backgroundColor: '#000' },
    viewerMedia: { width: SW, height: SH },
    viewerOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0 },
    viewerInfo: { padding: spacing.lg, paddingBottom: spacing.sm, backgroundColor: 'rgba(0,0,0,0.45)' },
    viewerName: { ...typography.bodyBold, color: '#fff', marginBottom: spacing.xs },
    viewerText: { ...typography.h3, color: '#fff', lineHeight: 26 },
    viewerMeta: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: spacing.sm },
    viewerClose: { position: 'absolute', top: insets.top + spacing.md, right: spacing.lg },
    reactionBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      backgroundColor: 'rgba(0,0,0,0.65)',
    },
    reactionBtn: { alignItems: 'center', flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md },
    reactionBtnActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
    reactionEmoji: { fontSize: 28 },
    reactionCount: { ...typography.caption, color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 1 },
    reactionSummaryBar: { paddingHorizontal: spacing.md, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.4)' },
    commentsPanel: { backgroundColor: 'rgba(10,10,10,0.92)', paddingBottom: insets.bottom || spacing.md },
    commentsPanelHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    commentItem: {
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)',
      flexDirection: 'row', alignItems: 'flex-start',
    },
    commentComposer: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    },
    commentInput: {
      flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
      borderRadius: radius.pill, paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm + 1 : spacing.sm,
      color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', ...typography.body,
    },
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
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: type === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
        quality: type === 'video' ? 0.8 : 0.85, videoMaxDuration: 60, allowsEditing: type === 'photo',
      };
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Достъп', 'Разреши достъп до камерата.'); return; }
        result = await ImagePicker.launchCameraAsync(opts);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        result = await ImagePicker.launchImageLibraryAsync(opts);
      }
      if (!result.canceled && result.assets[0]) { setMediaUri(result.assets[0].uri); setMediaType(type); }
    } catch { Alert.alert('Грешка', 'Неуспешно избиране на медия.'); }
  };

  const handlePost = async () => {
    if (!user) return;
    if (!text.trim() && !mediaUri) { Alert.alert('Добави съдържание', 'Напиши нещо или добави снимка/видео.'); return; }
    setSaving(true);
    try {
      let uploadedUrl: string | undefined;
      if (mediaUri && mediaType) uploadedUrl = await uploadStoryMedia(mediaUri, user.uid, mediaType);
      await addStory({
        uid: user.uid,
        userName: user.displayName?.split(' ')[0] ?? 'Рибар',
        userPhotoUrl: user.photoURL ?? undefined,
        text: text.trim(), locationName: location.trim() || undefined,
        emoji: selectedEmoji, mediaUrl: uploadedUrl, mediaType: mediaType ?? undefined,
      });
      setText(''); setLocation(''); setMediaUri(null); setMediaType(null);
      setAddOpen(false);
      await load();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally { setSaving(false); }
  };

  const reactionEntries = Object.entries(STORY_REACTIONS) as [StoryReactionType, { emoji: string; label: string }][];
  const totalReactions = reactionSummary.reduce((s, r) => s + r.count, 0);

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

      {/* ── Full-screen story viewer ── */}
      <Modal visible={!!viewing} transparent={false} animationType="fade" onRequestClose={closeViewer}>
        {viewing ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.viewerBg}>
              {/* Story content */}
              {viewing.mediaUrl && viewing.mediaType === 'photo' ? (
                <Image source={{ uri: viewing.mediaUrl }} style={styles.viewerMedia} contentFit="contain" />
              ) : viewing.mediaUrl && viewing.mediaType === 'video' ? (
                <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="videocam" size={64} color="rgba(255,255,255,0.4)" />
                  <Pressable
                    onPress={() => Linking.openURL(viewing.mediaUrl!).catch(() => {})}
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

              {/* Flying emoji layer */}
              {flyingEmojis.map((fe) => (
                <FlyingEmojiView key={fe.id} item={fe} onDone={() => removeFlyingEmoji(fe.id)} />
              ))}

              {/* Close */}
              <Pressable style={styles.viewerClose} onPress={closeViewer} hitSlop={12}>
                <Ionicons name="close-circle" size={32} color="rgba(255,255,255,0.85)" />
              </Pressable>

              {/* Bottom overlay */}
              <View style={styles.viewerOverlay}>
                {/* Story text/meta */}
                <View style={styles.viewerInfo}>
                  <Text style={styles.viewerName}>{viewing.userName} · {timeAgo(viewing.createdAt)}</Text>
                  {viewing.text ? <Text style={styles.viewerText}>{viewing.text}</Text> : null}
                  {viewing.locationName ? <Text style={styles.viewerMeta}>📍 {viewing.locationName}</Text> : null}
                  {viewing.uid === user?.uid ? (
                    <Pressable onPress={() => { deleteStory(viewing.id).then(load); closeViewer(); }} style={{ marginTop: spacing.sm }}>
                      <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.45)' }}>Изтрий момента</Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* Reaction bar */}
                {user ? (
                  <View style={styles.reactionBar}>
                    {reactionEntries.map(([type, r], idx) => {
                      const count = reactionSummary.find((s) => s.type === type)?.count ?? 0;
                      const isActive = myReaction === type;
                      const segW = (SW - 52) / reactionEntries.length; // 52 for comment btn
                      const tapX = segW * idx + segW / 2;
                      return (
                        <Pressable
                          key={type}
                          style={[styles.reactionBtn, isActive && styles.reactionBtnActive]}
                          onPress={() => handlePickReaction(type, tapX)}
                        >
                          <Text style={[styles.reactionEmoji, isActive && { transform: [{ scale: 1.25 }] }]}>
                            {r.emoji}
                          </Text>
                          {count > 0 && <Text style={styles.reactionCount}>{count}</Text>}
                        </Pressable>
                      );
                    })}
                    {/* Comment toggle */}
                    <Pressable style={styles.reactionBtn} onPress={() => setCommentsOpen((v) => !v)}>
                      <Ionicons name={commentsOpen ? 'chatbubble' : 'chatbubble-outline'} size={24} color={commentsOpen ? '#fff' : 'rgba(255,255,255,0.55)'} />
                      {comments.length > 0 && <Text style={styles.reactionCount}>{comments.length}</Text>}
                    </Pressable>
                  </View>
                ) : null}

                {/* Reaction summary strip */}
                {totalReactions > 0 && !commentsOpen && (
                  <View style={styles.reactionSummaryBar}>
                    <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.55)' }}>
                      {reactionSummary.slice(0, 3).map((r) => r.emoji).join('  ')}  {totalReactions}
                    </Text>
                  </View>
                )}

                {/* Comments panel */}
                {commentsOpen && (
                  <View style={styles.commentsPanel}>
                    <View style={styles.commentsPanelHeader}>
                      <Text style={{ ...typography.bodyBold, color: '#fff' }}>Коментари ({comments.length})</Text>
                      <Pressable onPress={() => setCommentsOpen(false)} hitSlop={8}>
                        <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.5)" />
                      </Pressable>
                    </View>
                    <ScrollView style={{ maxHeight: SH * 0.2 }} keyboardShouldPersistTaps="handled">
                      {comments.length === 0 ? (
                        <Text style={{ ...typography.body, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: spacing.lg }}>
                          Бъди първият, който коментира!
                        </Text>
                      ) : comments.map((c) => {
                        const canDelete = user && (c.authorUid === user.uid || viewing.uid === user.uid);
                        return (
                          <View key={c.id} style={styles.commentItem}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.65)', fontWeight: '700' }}>{c.authorName}</Text>
                              <Text style={{ ...typography.body, color: '#fff', marginTop: 2, lineHeight: 20 }}>{c.text}</Text>
                            </View>
                            {canDelete && (
                              <Pressable onPress={() => handleDeleteComment(c.id)} hitSlop={8} style={{ paddingLeft: spacing.sm, paddingTop: 2 }}>
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
                        placeholder="Коментирай…"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                        value={commentDraft}
                        onChangeText={setCommentDraft}
                        maxLength={500}
                        returnKeyType="send"
                        onSubmitEditing={handleSendComment}
                      />
                      <Pressable onPress={handleSendComment} disabled={commentBusy || !commentDraft.trim()} hitSlop={8}>
                        {commentBusy
                          ? <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
                          : <Ionicons name="send" size={22} color={commentDraft.trim() ? '#fff' : 'rgba(255,255,255,0.25)'} />}
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
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg }} keyboardShouldPersistTaps="handled">
            <View style={styles.addSheet}>
              <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.md }}>Нов момент</Text>
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
                value={text} onChangeText={setText} multiline maxLength={280}
              />
              <Text style={[styles.label, { marginTop: spacing.sm }]}>МЕСТОПОЛОЖЕНИЕ</Text>
              <TextInput
                style={styles.input} placeholder="напр. яз. Огоста"
                placeholderTextColor={colors.textMuted}
                value={location} onChangeText={setLocation} maxLength={60} returnKeyType="done"
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <Pressable onPress={() => { setAddOpen(false); setMediaUri(null); setMediaType(null); }} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md }}>
                  <Text style={{ ...typography.body, color: colors.textMuted }}>Отказ</Text>
                </Pressable>
                <Pressable
                  onPress={handlePost}
                  disabled={saving || (!text.trim() && !mediaUri)}
                  style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, opacity: saving || (!text.trim() && !mediaUri) ? 0.5 : 1, flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={{ ...typography.bodyBold, color: '#fff' }}>{saving ? 'Качване…' : 'Сподели'}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
