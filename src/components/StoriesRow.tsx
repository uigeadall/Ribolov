import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  TextInput, KeyboardAvoidingView, Platform, Linking,
  ActivityIndicator, Dimensions, Animated, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeStories, deleteStory, timeAgo, STORY_REACTIONS, type Story, type StoryReactionType } from '../services/stories';
import { useStoryViewer, type FlyingEmoji } from '../hooks/useStoryViewer';
import { useAddStory } from '../hooks/useAddStory';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { BlurView } from 'expo-blur';
import { StoryComposer } from './StoryComposer';

const STORY_DURATION = 8000;

const { width: SW, height: SH } = Dimensions.get('window');

const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '🔥', '🤙'];

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
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const [stories, setStories] = useState<Story[]>([]);
  const [viewingIndex, setViewingIndex] = useState<number>(-1);
  const viewing = viewingIndex >= 0 ? (stories[viewingIndex] ?? null) : null;
  const [addOpen, setAddOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Progress bar animation
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressTimer = useRef<ReturnType<typeof Animated.timing> | null>(null);

  const viewer = useStoryViewer(viewing, user);
  const addStory = useAddStory(user, () => loadStories(), () => setAddOpen(false));

  const loadStories = useCallback(() => {
    if (!configured) return () => {};
    const unsub = subscribeStories((list) => {
      setStories(list);
      onStoriesLoaded?.(list.length);
    });
    return unsub;
  }, [configured, onStoriesLoaded]);

  useEffect(() => {
    const unsub = loadStories();
    return unsub;
  }, [loadStories]);

  const goNext = useCallback(() => {
    setViewingIndex((prev) => {
      if (prev < stories.length - 1) return prev + 1;
      return -1;
    });
  }, [stories.length]);

  const goPrev = useCallback(() => {
    setViewingIndex((prev) => {
      if (prev > 0) return prev - 1;
      return prev;
    });
  }, []);

  // Keep refs up-to-date so PanResponder (created once) always calls the latest callbacks
  const goNextRef = useRef(goNext);
  const goPrevRef = useRef(goPrev);
  useEffect(() => { goNextRef.current = goNext; }, [goNext]);
  useEffect(() => { goPrevRef.current = goPrev; }, [goPrev]);

  // Horizontal slide animation for swipe transitions
  const swipeX = useRef(new Animated.Value(0)).current;

  const animateAndGo = useCallback((direction: 'left' | 'right') => {
    const toValue = direction === 'left' ? -SW : SW;
    Animated.timing(swipeX, { toValue, duration: 220, useNativeDriver: true }).start(() => {
      swipeX.setValue(0);
      if (direction === 'left') goNextRef.current();
      else goPrevRef.current();
    });
  }, [swipeX]);

  // Reset swipe position when story changes
  useEffect(() => { swipeX.setValue(0); }, [viewingIndex, swipeX]);

  // Helper to start (or resume from a given progress 0..1) the timing run.
  // Used by both the initial story-changed effect and the hold-to-pause logic.
  const startProgressFrom = useCallback((startValue: number) => {
    if (progressTimer.current) progressTimer.current.stop();
    progressAnim.setValue(startValue);
    const remainingMs = STORY_DURATION * (1 - startValue);
    if (remainingMs <= 0) {
      goNextRef.current();
      return;
    }
    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: remainingMs,
      useNativeDriver: false,
    });
    progressTimer.current = anim;
    anim.start(({ finished }) => { if (finished) goNextRef.current(); });
  }, [progressAnim]);

  // Start/reset progress bar when viewing changes
  useEffect(() => {
    setImageError(false);
    if (viewingIndex < 0) {
      if (progressTimer.current) progressTimer.current.stop();
      progressAnim.setValue(0);
      return;
    }
    startProgressFrom(0);
    return () => {
      if (progressTimer.current) progressTimer.current.stop();
    };
  }, [viewingIndex, progressAnim, startProgressFrom]);

  // Hold-to-pause — Instagram-style. When user presses and holds the story
  // area, pause the progress animation; resume when they release. Also
  // distinguish a quick tap (<200ms) from a hold so the tap zones still
  // advance/rewind on quick taps.
  const pressStartedAtRef = useRef(0);
  const wasPausedRef = useRef(false);
  const pauseProgress = useCallback(() => {
    if (progressTimer.current) {
      progressTimer.current.stop();
      // After stop(), progressAnim retains its current value internally.
      wasPausedRef.current = true;
    }
  }, []);
  const resumeProgress = useCallback(() => {
    if (!wasPausedRef.current) return;
    wasPausedRef.current = false;
    // Read the paused position via stopAnimation's callback — that's the
    // only public API on Animated.Value that yields the current value.
    // The old listener-based read was wrong: addListener doesn't fire on
    // attach, so `current` stayed at 0 and hold-to-pause always restarted
    // the progress bar from the beginning.
    progressAnim.stopAnimation((current) => {
      startProgressFrom(current);
    });
  }, [progressAnim, startProgressFrom]);

  // Swipe gesture — fix: use refs so closure is always fresh
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderMove: (_, gs) => {
        swipeX.setValue(gs.dx * 0.4);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 90 && Math.abs(gs.dy) > Math.abs(gs.dx)) {
          Animated.timing(swipeX, { toValue: 0, duration: 120, useNativeDriver: true }).start();
          setViewingIndex(-1);
        } else if (gs.dx < -60) {
          animateAndGo('left');
        } else if (gs.dx > 60) {
          animateAndGo('right');
        } else {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 180, friction: 20 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  const openViewer = (s: Story) => {
    const idx = stories.findIndex((st) => st.id === s.id);
    viewer.setCommentsOpen(false);
    viewer.setCommentDraft('');
    setImageError(false);
    setViewingIndex(idx >= 0 ? idx : 0);
  };

  const closeViewer = () => { setViewingIndex(-1); };

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
    viewerInfo: { padding: spacing.lg, paddingBottom: spacing.sm },
    viewerName: { ...typography.bodyBold, color: '#fff', marginBottom: spacing.xs },
    viewerText: { ...typography.h3, color: '#fff', lineHeight: 26 },
    viewerMeta: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: spacing.sm },
    viewerClose: { position: 'absolute', top: insets.top + spacing.md, right: spacing.lg },
    reactionBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
    reactionBtn: { alignItems: 'center', flex: 1, paddingVertical: spacing.xs, borderRadius: radius.md },
    reactionBtnActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
    reactionEmoji: { fontSize: 28 },
    reactionCount: { ...typography.caption, color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 1 },
    reactionSummaryBar: { paddingHorizontal: spacing.md, paddingVertical: 5 },
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
            <Text style={styles.name}>Моменти</Text>
          </Pressable>
        ) : null}
        {stories.map((s) => (
          <Pressable key={s.id} style={styles.bubble} onPress={() => openViewer(s)}>
            <View style={[styles.ring, { borderColor: s.uid === user?.uid ? colors.accent : colors.primary }]}>
              {s.mediaUrl && s.mediaType !== 'video' ? (
                <Image source={{ uri: s.mediaUrl }} style={{ width: 58, height: 58 }} contentFit="cover" />
              ) : s.mediaUrl && s.mediaType === 'video' ? (
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
      {/* statusBarTranslucent so the system status bar doesn't overlay the
          progress bar on Android (the app uses edgeToEdgeEnabled in app.json,
          which otherwise lets the system clock sit on top of the story chrome). */}
      <Modal
        visible={!!viewing}
        transparent={false}
        animationType="fade"
        onRequestClose={closeViewer}
        statusBarTranslucent
      >
        {viewing ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.viewerBg} {...panResponder.panHandlers}>
              {/* Progress bar */}
              <View style={{ position: 'absolute', top: insets.top + 8, left: spacing.md, right: spacing.md, flexDirection: 'row', gap: 4, zIndex: 100 }}>
                {stories.map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                    {i < viewingIndex
                      ? <View style={{ flex: 1, backgroundColor: '#fff' }} />
                      : i === viewingIndex
                        ? <Animated.View style={{ width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), height: 3, backgroundColor: '#fff' }} />
                        : null}
                  </View>
                ))}
              </View>

              {/* Animated media container — slides on swipe */}
              <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: swipeX }] }]}>
                {viewing.mediaUrl && viewing.mediaType !== 'video' && !imageError ? (
                  <Image
                    source={{ uri: viewing.mediaUrl }}
                    style={styles.viewerMedia}
                    contentFit="contain"
                    onError={() => setImageError(true)}
                  />
                ) : viewing.mediaUrl && viewing.mediaType !== 'video' && imageError ? (
                  <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ fontSize: 72 }}>{viewing.emoji ?? '🎣'}</Text>
                  </View>
                ) : viewing.mediaUrl && viewing.mediaType === 'video' ? (
                  <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="videocam" size={64} color="rgba(255,255,255,0.4)" />
                    <Pressable onPress={() => Linking.openURL(viewing.mediaUrl!).catch(() => {})} style={{ marginTop: spacing.lg, backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill }}>
                      <Text style={{ ...typography.bodyBold, color: '#fff' }}>▶ Гледай видеото</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={[styles.viewerMedia, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }]}>
                    <Text style={{ fontSize: 80 }}>{viewing.emoji ?? '🎣'}</Text>
                  </View>
                )}
              </Animated.View>

              {/* Left tap zone — quick tap = previous story; hold = pause */}
              {viewingIndex > 0 ? (
                <Pressable
                  style={{ position: 'absolute', left: 0, top: insets.top + 48, bottom: 220, width: SW * 0.32, zIndex: 10 }}
                  onPressIn={() => {
                    pressStartedAtRef.current = Date.now();
                    // Wait briefly before pausing so quick taps don't strobe the timer.
                    setTimeout(() => {
                      if (Date.now() - pressStartedAtRef.current >= 180) pauseProgress();
                    }, 200);
                  }}
                  onPressOut={() => {
                    const heldMs = Date.now() - pressStartedAtRef.current;
                    if (heldMs < 200) {
                      animateAndGo('right');
                    } else {
                      resumeProgress();
                    }
                  }}
                />
              ) : null}
              {/* Right tap zone — quick tap = next story; hold = pause */}
              <Pressable
                style={{ position: 'absolute', right: 0, top: insets.top + 48, bottom: 220, width: SW * 0.45, zIndex: 10 }}
                onPressIn={() => {
                  pressStartedAtRef.current = Date.now();
                  setTimeout(() => {
                    if (Date.now() - pressStartedAtRef.current >= 180) pauseProgress();
                  }, 200);
                }}
                onPressOut={() => {
                  const heldMs = Date.now() - pressStartedAtRef.current;
                  if (heldMs < 200) {
                    animateAndGo('left');
                  } else {
                    resumeProgress();
                  }
                }}
              />

              {viewer.flyingEmojis.map((fe) => (
                <FlyingEmojiView key={fe.id} item={fe} onDone={() => viewer.removeFlyingEmoji(fe.id)} />
              ))}

              <Pressable style={styles.viewerClose} onPress={closeViewer} hitSlop={12}>
                <Ionicons name="close-circle" size={32} color="rgba(255,255,255,0.85)" />
              </Pressable>

              <View style={styles.viewerOverlay}>
                <BlurView intensity={45} tint="dark" style={styles.viewerInfo}>
                  <Pressable onPress={() => { closeViewer(); navigation.navigate('UserPublicProfile', { uid: viewing.uid, displayName: viewing.userName }); }} hitSlop={8}>
                    <Text style={styles.viewerName}>{viewing.userName} · {timeAgo(viewing.createdAt)}</Text>
                  </Pressable>
                  {viewing.text ? <Text style={styles.viewerText}>{viewing.text}</Text> : null}
                  {viewing.locationName ? <Text style={styles.viewerMeta}>📍 {viewing.locationName}</Text> : null}
                  {viewing.uid === user?.uid ? (
                    <Pressable onPress={() => { deleteStory(viewing.id).then(loadStories); closeViewer(); }} style={{ marginTop: spacing.sm }}>
                      <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.45)' }}>Изтрий момента</Text>
                    </Pressable>
                  ) : null}
                </BlurView>

                {user ? (
                  <BlurView intensity={50} tint="dark" style={styles.reactionBar}>
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
                  </BlurView>
                ) : null}

                {viewer.totalReactions > 0 && !viewer.commentsOpen && (
                  <BlurView intensity={35} tint="dark" style={styles.reactionSummaryBar}>
                    <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.55)' }}>
                      {viewer.reactionSummary.slice(0, 3).map((r) => r.emoji).join('  ')}  {viewer.totalReactions}
                    </Text>
                  </BlurView>
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
                        placeholder="Коментирай…"
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

      {/* ── Add story composer (redesigned, full-screen) ── */}
      <StoryComposer
        visible={addOpen}
        onClose={() => {
          setAddOpen(false);
          addStory.setMediaUri(null);
          addStory.setMediaType(null);
        }}
        addStory={addStory}
      />
    </>
  );
}
