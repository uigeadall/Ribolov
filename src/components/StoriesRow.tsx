import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Dimensions, Animated, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeStories, deleteStory, timeAgo, STORY_REACTIONS, type Story, type StoryReactionType } from '../services/stories';
import { useStoryViewer, type FlyingEmoji } from '../hooks/useStoryViewer';
import { useAddStory } from '../hooks/useAddStory';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { BlurView } from 'expo-blur';
import { StoryComposer } from './StoryComposer';
import { StoryVideoPlayer } from './StoryVideoPlayer';

const STORY_DURATION = 8000;
// Minimum progress-bar duration for a video. A 2-second clip with a 2-second
// progress bar feels jarring (story flashes by); 3.5s gives the eye time to
// register. Caps the lower bound; upper bound is the actual video length.
const MIN_VIDEO_PROGRESS_MS = 3500;

const { width: SW, height: SH } = Dimensions.get('window');

const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '🔥', '🤙'];

// Brand story ring (teal → navy) for the unseen-story state —
// replaces the old Instagram-style orange/pink ring.
const IG_GRADIENT: readonly [string, string, ...string[]] = ['#14B8B8', '#13294B'];

const STORY_RING_OUTER = 68; // outer ring diameter (gradient ring)
const STORY_RING_GAP = 2.5;   // gap between ring and avatar (theme bg colour)
const STORY_AVATAR_SIZE = STORY_RING_OUTER - STORY_RING_GAP * 2 - 4; // inner avatar

// Local persistent set of story IDs the user has opened — drives the
// Instagram "ring goes grey after viewing" affordance. Backed by AsyncStorage
// so a user who scrolls past stories, opens a few, closes the app, and
// re-opens still sees the same grey/coloured state. We keep this client-only
// (no Firestore write) because the cost of a per-view write is high and the
// value is purely cosmetic.
const SEEN_STORIES_KEY = '@ribolov/seenStoryIds';

async function loadSeenStoryIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_STORIES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

async function persistSeenStoryIds(ids: Set<string>): Promise<void> {
  try {
    // Keep the persisted list bounded — stories expire after 24h server-side,
    // so 200 recently-seen IDs covers a generous viewing window without the
    // AsyncStorage row growing unboundedly across months of use.
    const arr = [...ids].slice(-200);
    await AsyncStorage.setItem(SEEN_STORIES_KEY, JSON.stringify(arr));
  } catch {
    /* best-effort */
  }
}

/* ── Instagram-style story avatar ─────────────────────────────
   Outer gradient ring (or grey when all of this user's stories have been
   seen), small theme-coloured gap, then the avatar/image/emoji inside. The
   "Add" bubble at the head of the row reuses this with showAdd=true — it
   keeps the same outer size so the row stays visually aligned. */
type StoryAvatarProps = {
  uri?: string;
  emoji?: string;
  isVideo?: boolean;
  seen: boolean;
  isAdd?: boolean;
  bgColor: string;
  surfaceColor: string;
  textMutedColor: string;
  primaryColor: string;
};

function StoryAvatar({
  uri,
  emoji,
  isVideo,
  seen,
  isAdd,
  bgColor,
  surfaceColor,
  textMutedColor,
  primaryColor,
}: StoryAvatarProps) {
  // Ring contents: the "Add" bubble shows a plus icon over a flat surface,
  // a media story shows the image, an emoji story shows the emoji centred.
  const inner = (
    <View
      style={{
        width: STORY_AVATAR_SIZE,
        height: STORY_AVATAR_SIZE,
        borderRadius: STORY_AVATAR_SIZE / 2,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: surfaceColor,
      }}
    >
      {isAdd ? (
        <Ionicons name="add" size={28} color={primaryColor} />
      ) : uri && !isVideo ? (
        <Image
          source={{ uri }}
          style={{ width: STORY_AVATAR_SIZE, height: STORY_AVATAR_SIZE }}
          contentFit="cover"
        />
      ) : isVideo ? (
        <Ionicons name="videocam" size={26} color={primaryColor} />
      ) : (
        <Text style={{ fontSize: 26 }}>{emoji ?? '🎣'}</Text>
      )}
    </View>
  );

  // The "Add" bubble uses a thin grey border instead of a ring — Instagram
  // does the same so the +-button reads as an action, not "fresh content".
  if (isAdd) {
    return (
      <View
        style={{
          width: STORY_RING_OUTER,
          height: STORY_RING_OUTER,
          borderRadius: STORY_RING_OUTER / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: textMutedColor + '55',
          backgroundColor: surfaceColor,
        }}
      >
        {inner}
      </View>
    );
  }

  // Seen → flat grey ring. Unseen → IG gradient ring.
  if (seen) {
    return (
      <View
        style={{
          width: STORY_RING_OUTER,
          height: STORY_RING_OUTER,
          borderRadius: STORY_RING_OUTER / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: textMutedColor + '66',
        }}
      >
        <View style={{
          width: STORY_AVATAR_SIZE + STORY_RING_GAP * 2,
          height: STORY_AVATAR_SIZE + STORY_RING_GAP * 2,
          borderRadius: (STORY_AVATAR_SIZE + STORY_RING_GAP * 2) / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bgColor,
        }}>
          {inner}
        </View>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={IG_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: STORY_RING_OUTER,
        height: STORY_RING_OUTER,
        borderRadius: STORY_RING_OUTER / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* The theme-coloured gap between ring and avatar — this is the bit
          that visually separates the gradient from the photo. */}
      <View style={{
        width: STORY_AVATAR_SIZE + STORY_RING_GAP * 2,
        height: STORY_AVATAR_SIZE + STORY_RING_GAP * 2,
        borderRadius: (STORY_AVATAR_SIZE + STORY_RING_GAP * 2) / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bgColor,
      }}>
        {inner}
      </View>
    </LinearGradient>
  );
}

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

  // Seen-story tracking. The ring transitions from the IG gradient to grey
  // when the user has opened the story. We hydrate from AsyncStorage on mount
  // and add to the set every time openViewer runs (then persist async). The
  // ref shadows the state because the openViewer closure needs the freshest
  // value without re-binding every render. */
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    void loadSeenStoryIds().then((s) => {
      if (cancelled) return;
      seenIdsRef.current = s;
      setSeenIds(s);
    });
    return () => { cancelled = true; };
  }, []);
  // Video state. Lives on the row (not inside the player) because the
  // progress timer is owned here and needs to know the actual clip length.
  // Reset on every story change so a previous video's duration doesn't
  // bleed into a fresh story.
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  // External pause gate the video player subscribes to. Mirrors the
  // hold-to-pause AND comments-open conditions so the video freezes when
  // either fires. Pure state (not ref) so the player's useEffect re-runs.
  const [videoPaused, setVideoPaused] = useState(false);

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

  // StoriesRow only renders on the Feed tab. Detach the listener when the
  // user navigates to a different tab so we're not paying for live story
  // updates the user can't see. Stories are short-lived (24h TTL) so users
  // expect a fresh fetch on return anyway.
  useFocusEffect(
    useCallback(() => {
      const unsub = loadStories();
      return unsub;
    }, [loadStories]),
  );

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
  // Uses the video's actual duration when known so a 30s clip doesn't get
  // cut off after 8s (the photo default). Photos always use STORY_DURATION;
  // videos use max(MIN_VIDEO_PROGRESS_MS, actualDuration) so very-short
  // clips still get a readable progress bar.
  const startProgressFrom = useCallback((startValue: number) => {
    if (progressTimer.current) progressTimer.current.stop();
    progressAnim.setValue(startValue);
    const fullDuration = videoDurationMs != null
      ? Math.max(MIN_VIDEO_PROGRESS_MS, videoDurationMs)
      : STORY_DURATION;
    const remainingMs = fullDuration * (1 - startValue);
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
  }, [progressAnim, videoDurationMs]);

  // Start/reset progress bar when viewing changes
  useEffect(() => {
    setImageError(false);
    // Reset video state — a new story might be a photo (videoDurationMs=null
    // → fall back to STORY_DURATION) and we don't want the previous video's
    // duration to keep timing the next story.
    setVideoDurationMs(null);
    setVideoPaused(false);
    if (viewingIndex < 0) {
      if (progressTimer.current) progressTimer.current.stop();
      progressAnim.setValue(0);
      return;
    }
    // Mark the just-displayed story as seen as the viewer advances. Without
    // this, a user who taps story 1 and lets the viewer auto-advance through
    // 2, 3, 4 would still see those rings as coloured (unseen) on return.
    const advanced = stories[viewingIndex];
    if (advanced && !seenIdsRef.current.has(advanced.id)) {
      const next = new Set(seenIdsRef.current);
      next.add(advanced.id);
      seenIdsRef.current = next;
      setSeenIds(next);
      void persistSeenStoryIds(next);
    }
    startProgressFrom(0);
    return () => {
      if (progressTimer.current) progressTimer.current.stop();
    };
    // intentionally exclude startProgressFrom — it changes when videoDurationMs
    // changes (which we WANT to re-run progress on via the dedicated effect
    // below), but we don't want it to re-fire on every viewingIndex render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingIndex, progressAnim]);

  // When a video reports its actual duration after the initial progress run
  // already started, restart the timer with the correct length so the
  // progress bar matches what the user is seeing. Without this the progress
  // bar finishes at the 8s photo default while the video keeps playing.
  useEffect(() => {
    if (viewingIndex < 0 || videoDurationMs == null) return;
    startProgressFrom(0);
    // intentionally exclude startProgressFrom — already triggered via
    // videoDurationMs (which is in its dep list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDurationMs]);

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
    // Also pause the video so it stops mid-frame instead of running on while
    // the progress bar is frozen.
    setVideoPaused(true);
  }, []);
  const resumeProgress = useCallback(() => {
    setVideoPaused(false);
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

  // When comments panel opens over a video story, pause the playback (and the
  // progress bar) so the video doesn't keep advancing while the user is
  // composing a reply. Mirrors hold-to-pause behaviour. Resumes on close.
  useEffect(() => {
    if (viewer.commentsOpen) {
      pauseProgress();
    } else {
      resumeProgress();
    }
    // intentionally not depending on pauseProgress/resumeProgress (they're
    // stable callbacks whose identity-changes shouldn't re-fire this effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.commentsOpen]);

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
    // Mark this story (and any user's other stories scrolled past in the
    // viewer's auto-advance) as seen — the ring transitions to grey on the
    // next render. We persist async so the AsyncStorage write doesn't
    // block the viewer-open animation.
    if (!seenIdsRef.current.has(s.id)) {
      const next = new Set(seenIdsRef.current);
      next.add(s.id);
      seenIdsRef.current = next;
      setSeenIds(next);
      void persistSeenStoryIds(next);
    }
  };

  const closeViewer = () => { setViewingIndex(-1); };

  const reactionEntries = Object.entries(STORY_REACTIONS) as [StoryReactionType, { emoji: string; label: string }][];

  const styles = useMemo(() => StyleSheet.create({
    // Tighter wrapper — Instagram pads the row by 10px and uses a hairline
    // bottom border. The bubbles themselves carry their visual weight.
    rowWrapper: { paddingTop: 10, paddingBottom: 8, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    bubble: { alignItems: 'center', marginHorizontal: 4, width: 78 },
    // Instagram name treatment under the avatar: 12px, 1 line, ellipsised
    // — wider than 12 chars overflows visually and the row stops reading
    // as a tidy strip.
    name: { fontSize: 12, color: colors.text, marginTop: 6, textAlign: 'center', fontWeight: '500', maxWidth: 78 },
    time: { fontSize: 10, lineHeight: 13, color: colors.textMuted, textAlign: 'center', marginTop: 1 },
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8 }}>
        {/* "Your story" / Add — Instagram puts this first. We use the new
            StoryAvatar in isAdd mode so the bubble keeps the same overall
            geometry as the rest of the row (no off-grid sizing). */}
        {user && configured ? (
          <Pressable style={styles.bubble} onPress={() => setAddOpen(true)}>
            <StoryAvatar
              isAdd
              seen={false}
              bgColor={colors.card}
              surfaceColor={colors.surfaceAlt}
              textMutedColor={colors.textMuted}
              primaryColor={colors.primary}
            />
            <Text style={styles.name} numberOfLines={1}>Моменти</Text>
          </Pressable>
        ) : null}
        {stories.map((s) => {
          const isSeen = seenIds.has(s.id);
          return (
            <Pressable key={s.id} style={styles.bubble} onPress={() => openViewer(s)}>
              <StoryAvatar
                uri={s.mediaUrl}
                emoji={s.emoji}
                isVideo={s.mediaType === 'video'}
                seen={isSeen}
                bgColor={colors.card}
                surfaceColor={colors.primarySurface}
                textMutedColor={colors.textMuted}
                primaryColor={colors.primary}
              />
              <Text style={styles.name} numberOfLines={1}>{s.userName}</Text>
            </Pressable>
          );
        })}
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
                  // Real in-app video playback. The previous version showed a
                  // videocam icon + a button that called Linking.openURL —
                  // which handed the video off to an external browser and
                  // never actually played it in-app. StoryVideoPlayer reports
                  // its loaded duration back so the progress bar matches the
                  // clip length (a 25s video no longer ends after 8s).
                  <StoryVideoPlayer
                    uri={viewing.mediaUrl}
                    paused={videoPaused}
                    onDurationLoaded={setVideoDurationMs}
                    width={SW}
                    height={SH}
                  />
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
