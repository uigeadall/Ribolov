import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
  InputAccessoryView,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../theme/typography';
import type { AddStoryState } from '../hooks/useAddStory';

// Story composers are conventionally dark regardless of the host app's theme —
// it lets the media (photo / video) feel like the surface, not framed UI. This
// component opts out of `useTheme` deliberately.
const COMPOSER_BG = '#0A0E14';
const SURFACE = 'rgba(255,255,255,0.10)';
const SURFACE_STRONG = 'rgba(255,255,255,0.18)';
const BORDER = 'rgba(255,255,255,0.18)';
const MUTED = 'rgba(255,255,255,0.55)';

// iOS-only — gives the multiline caption a "Готово" button above the keyboard.
// Multiline TextInputs swallow Return as a newline so the system keyboard has
// no built-in dismiss affordance; without this you can type but never get out.
const ACCESSORY_ID = 'story-caption-accessory';

const EMOJIS = ['🎣', '🐟', '🌊', '🌅', '🌧️', '☀️', '🏆', '🤙'];

// Background presets for text-only stories. Each is a 3-stop linear gradient
// tuned to keep white text readable. The user cycles them with the palette
// button on the bottom bar. We keep this client-side only (not persisted on
// the story doc) — the viewer renders text-only stories on its own primary
// background today; swapping the viewer to honor a stored gradient is a
// separate follow-up. For the composer it's still a quality-of-life change.
const TEXT_BG_PRESETS: { id: string; colors: [string, string, string] }[] = [
  { id: 'ocean', colors: ['#0E4D64', '#1570B8', '#4AA8E8'] },
  { id: 'sunset', colors: ['#F5890A', '#E04A4A', '#7A1F4A'] },
  { id: 'forest', colors: ['#1e6b3d', '#2E9B5A', '#0E4D64'] },
  { id: 'night', colors: ['#0A1E38', '#162033', '#0A0E14'] },
  { id: 'brass', colors: ['#7A4F1F', '#C49A00', '#F5890A'] },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  addStory: AddStoryState;
};

// Safe lazy require for expo-video. Same pattern as StoryVideoPlayer so the
// app still boots in environments where the native module isn't bundled (Expo
// Go, dev clients built before the dep landed). undefined = haven't tried,
// null = tried + failed, value = available.
type ExpoVideoMod = typeof import('expo-video');
let cachedVideoMod: ExpoVideoMod | null | undefined = undefined;
function loadExpoVideo(): ExpoVideoMod | null {
  if (cachedVideoMod !== undefined) return cachedVideoMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedVideoMod = require('expo-video') as ExpoVideoMod;
  } catch {
    cachedVideoMod = null;
  }
  return cachedVideoMod;
}

/** Inline muted-looping video preview for the composer canvas. Falls back to
    a play-icon placeholder if expo-video isn't bundled (e.g. Expo Go). */
function ComposerVideoPreview({ uri }: { uri: string }) {
  const mod = loadExpoVideo();
  if (!mod) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', gap: 10 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="play" size={32} color="#fff" />
        </View>
        <Text style={{ color: '#fff', fontFamily: 'Nunito_700Bold', fontSize: 14 }}>Видео избрано</Text>
        <Text style={{ color: MUTED, fontSize: 12 }}>Ще се качи при споделяне</Text>
      </View>
    );
  }
  return <InlineVideo mod={mod} uri={uri} />;
}

function InlineVideo({ mod, uri }: { mod: ExpoVideoMod; uri: string }) {
  const { useVideoPlayer, VideoView } = mod;
  // Muted + looping preview. Different defaults from StoryVideoPlayer (the
  // viewer): the composer is a draft surface — autoplaying audio would
  // surprise the user, especially if they're previewing in a quiet room.
  const player = useVideoPlayer({ uri, useCaching: true }, (p) => {
    p.loop = true;
    p.muted = true;
    p.bufferOptions = {
      preferredForwardBufferDuration: 1,
      waitsToMinimizeStalling: false,
      minBufferForPlayback: 1,
    };
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ flex: 1, backgroundColor: '#000' }}
      contentFit="cover"
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      nativeControls={false}
    />
  );
}

export function StoryComposer({ visible, onClose, addStory }: Props) {
  const insets = useSafeAreaInsets();
  const [emojiPaletteOpen, setEmojiPaletteOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [bgIndex, setBgIndex] = useState(0);

  const hasContent = !!(addStory.text.trim() || addStory.mediaUri);
  const hasMedia = !!addStory.mediaUri;
  const isTextMode = addStory.mode === 'text';
  const canShare = hasMedia || (isTextMode && addStory.text.trim().length > 0);

  /** Wraps onClose with a "Discard draft?" alert when content is present.
      Skips the alert if the composer is empty. On discard, wipes draft state
      so reopening the composer is a fresh session. */
  const requestClose = () => {
    if (!hasContent) {
      onClose();
      return;
    }
    Alert.alert(
      'Изтегли черновата?',
      'Това ще изтрие текущия текст и медия. Действието е необратимо.',
      [
        { text: 'Продължи редакцията', style: 'cancel' },
        {
          text: 'Изтегли',
          style: 'destructive',
          onPress: () => {
            addStory.reset();
            onClose();
          },
        },
      ],
    );
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: COMPOSER_BG },

        // Top bar — floats over the canvas
        topBar: {
          position: 'absolute',
          top: insets.top + 6,
          left: 0,
          right: 0,
          zIndex: 10,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        topPill: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: SURFACE_STRONG,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: BORDER,
        },
        topTitle: {
          color: '#fff',
          fontSize: 13,
          fontFamily: 'Nunito_700Bold',
          letterSpacing: 0.3,
        },

        // Canvas — the actual photo/video area, fills the body
        canvas: { flex: 1, position: 'relative', backgroundColor: COMPOSER_BG },
        canvasMedia: { width: '100%', height: '100%' },

        // Empty-state — when no media yet
        emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: 8 },
        emptyTitle: { fontSize: 22, fontFamily: 'Nunito_800ExtraBold', color: '#fff', textAlign: 'center' },
        emptySub: { fontSize: 13, color: MUTED, textAlign: 'center', marginBottom: spacing.xl },
        pickerCol: { width: '100%', gap: 10, marginTop: spacing.lg },
        pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.md, borderRadius: radius.lg, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
        pickerIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
        pickerTitle: { color: '#fff', fontFamily: 'Nunito_700Bold', fontSize: 15 },
        pickerSub: { color: MUTED, fontSize: 12, marginTop: 2 },

        // Emoji sticker on the canvas
        sticker: {
          position: 'absolute',
          top: 84,
          right: 22,
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: 'rgba(0,0,0,0.32)',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.18)',
        },
        stickerEmoji: { fontSize: 32 },

        // Caption overlay on the canvas (media mode)
        captionWrap: {
          position: 'absolute',
          left: 18,
          right: 18,
          bottom: 130,
          borderRadius: radius.lg,
          overflow: 'hidden',
          // Android fallback — expo-blur degrades to a transparent View on
          // Android so the BlurView padding wrapper alone would leave the
          // text floating with no backdrop. Solid dark tint here ensures the
          // pill looks intentional on both platforms; on iOS the BlurView
          // sits on top and the tint shows through as a subtle deepening.
          backgroundColor: Platform.OS === 'android' ? 'rgba(10,14,20,0.72)' : 'transparent',
        },
        captionBlur: {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
        },
        captionInput: {
          color: '#fff',
          fontSize: 17,
          fontFamily: 'Nunito_700Bold',
          minHeight: 28,
          textShadowColor: 'rgba(0,0,0,0.55)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 4,
          padding: 0,
        },
        captionCount: { color: MUTED, fontSize: 10, marginTop: 6 },

        // Big centered text input for text-only mode
        textOnlyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
        textOnlyInput: {
          color: '#fff',
          fontFamily: 'Nunito_800ExtraBold',
          fontSize: 32,
          lineHeight: 40,
          textAlign: 'center',
          textShadowColor: 'rgba(0,0,0,0.35)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 6,
          width: '100%',
          maxHeight: 320,
          padding: 0,
        },
        textOnlyCount: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: spacing.md },

        // Bottom bar — actions
        bottomBar: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 14,
          paddingBottom: Math.max(insets.bottom, 12) + 4,
          paddingTop: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        chipPill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          height: 38,
          borderRadius: 19,
          backgroundColor: SURFACE_STRONG,
          borderWidth: 1,
          borderColor: BORDER,
        },
        chipPillText: { color: '#fff', fontSize: 13, fontFamily: 'Nunito_700Bold', maxWidth: 130 },
        iconBtn: {
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: SURFACE_STRONG,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: BORDER,
        },
        shareBtn: {
          marginLeft: 'auto',
          paddingHorizontal: 16,
          height: 42,
          borderRadius: 21,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: '#1570B8',
          shadowColor: '#1570B8',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 10,
          elevation: 6,
          overflow: 'hidden',
        },
        shareBtnText: { color: '#fff', fontFamily: 'Nunito_800ExtraBold', fontSize: 14 },
        // Determinate progress fill that grows from left → right inside the
        // share button while a media upload is in flight. Sits behind the
        // label so the percentage is implicit (visual) rather than text.
        shareProgressFill: {
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          backgroundColor: 'rgba(255,255,255,0.22)',
        },

        emojiPalette: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: Math.max(insets.bottom, 12) + 64,
          padding: 10,
          borderRadius: radius.lg,
          backgroundColor: 'rgba(20,28,40,0.96)',
          borderWidth: 1,
          borderColor: BORDER,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'space-between',
        },
        emojiCell: {
          width: 48,
          height: 48,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: SURFACE,
        },
        emojiCellActive: { backgroundColor: 'rgba(21,112,184,0.45)' },
        emojiCellChar: { fontSize: 26 },

        locationPopover: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: Math.max(insets.bottom, 12) + 64,
          padding: 12,
          borderRadius: radius.lg,
          backgroundColor: 'rgba(20,28,40,0.96)',
          borderWidth: 1,
          borderColor: BORDER,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        locationInput: {
          flex: 1,
          color: '#fff',
          fontSize: 14,
          fontFamily: 'Nunito_600SemiBold',
          paddingVertical: 6,
        },

        scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
        scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 240 },

        accessoryBar: {
          backgroundColor: '#1A2330',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: BORDER,
          paddingVertical: 8,
          paddingHorizontal: 12,
          flexDirection: 'row',
          justifyContent: 'flex-end',
        },
        accessoryDoneBtn: { paddingHorizontal: 14, paddingVertical: 6 },
        accessoryDoneText: { color: '#4AA8E8', fontFamily: 'Nunito_800ExtraBold', fontSize: 15 },
      }),
    [insets.top, insets.bottom],
  );

  const currentBg = TEXT_BG_PRESETS[bgIndex] ?? TEXT_BG_PRESETS[0];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* ── CANVAS ── */}
        {/* Pressable wrapper dismisses the keyboard on tap-outside. Nested
            interactive children (TextInput, sticker, picker rows, etc.) take
            their own touches first so this only fires on "blank" canvas taps. */}
        <Pressable style={styles.canvas} onPress={() => Keyboard.dismiss()}>
          {hasMedia && addStory.mediaType === 'photo' ? (
            <Image source={{ uri: addStory.mediaUri! }} style={styles.canvasMedia} contentFit="cover" />
          ) : hasMedia && addStory.mediaType === 'video' ? (
            <ComposerVideoPreview uri={addStory.mediaUri!} />
          ) : isTextMode ? (
            // ── TEXT-ONLY MODE ────────────────────────────────────────────
            // Big centered TextInput on a colored gradient. Cycle the gradient
            // with the palette button on the bottom bar.
            <LinearGradient colors={currentBg.colors} style={{ flex: 1 }}>
              <View style={styles.textOnlyWrap}>
                <TextInput
                  value={addStory.text}
                  onChangeText={addStory.setText}
                  placeholder="Какво се случва?"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  style={styles.textOnlyInput}
                  multiline
                  maxLength={280}
                  inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                />
                {addStory.text.length > 0 ? (
                  <Text style={styles.textOnlyCount}>{280 - addStory.text.length}</Text>
                ) : null}
              </View>
            </LinearGradient>
          ) : (
            // ── EMPTY STATE ───────────────────────────────────────────────
            <LinearGradient colors={['#162033', '#0A0E14']} style={{ flex: 1 }}>
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>Нов момент</Text>
                <Text style={styles.emptySub}>Сподели какво се случва. Изчезва след 24 часа.</Text>
                <View style={styles.pickerCol}>
                  <Pressable style={styles.pickerRow} onPress={() => addStory.pickMedia('camera', 'photo')}>
                    <View style={styles.pickerIconWrap}>
                      <Ionicons name="camera" size={22} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerTitle}>Снимай сега</Text>
                      <Text style={styles.pickerSub}>Заснеми с камерата</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={MUTED} />
                  </Pressable>
                  <Pressable style={styles.pickerRow} onPress={() => addStory.pickMedia('library', 'photo')}>
                    <View style={styles.pickerIconWrap}>
                      <Ionicons name="image" size={22} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerTitle}>От галерия</Text>
                      <Text style={styles.pickerSub}>Избери снимка</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={MUTED} />
                  </Pressable>
                  <Pressable style={styles.pickerRow} onPress={() => addStory.pickMedia('library', 'video')}>
                    <View style={styles.pickerIconWrap}>
                      <Ionicons name="videocam" size={22} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerTitle}>Видео</Text>
                      <Text style={styles.pickerSub}>До 60 секунди</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={MUTED} />
                  </Pressable>
                  <Pressable style={styles.pickerRow} onPress={() => addStory.setMode('text')}>
                    <View style={styles.pickerIconWrap}>
                      <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Nunito_800ExtraBold' }}>Aa</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerTitle}>Просто текст</Text>
                      <Text style={styles.pickerSub}>Без снимка, цветен фон</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={MUTED} />
                  </Pressable>
                </View>
              </View>
            </LinearGradient>
          )}

          {/* Scrims — only over media so the empty / text-only states keep
              their natural background visible. */}
          {hasMedia ? (
            <>
              <LinearGradient
                colors={['rgba(0,0,0,0.45)', 'transparent']}
                style={styles.scrimTop}
                pointerEvents="none"
              />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.55)']}
                style={styles.scrimBottom}
                pointerEvents="none"
              />
            </>
          ) : null}

          {/* Caption overlay (media mode only — text mode has its own input) */}
          {hasMedia ? (
            <View style={styles.captionWrap}>
              <BlurView intensity={Platform.OS === 'ios' ? 28 : 0} tint="dark" style={styles.captionBlur}>
                <TextInput
                  value={addStory.text}
                  onChangeText={addStory.setText}
                  placeholder="Кажи нещо…"
                  placeholderTextColor="rgba(255,255,255,0.55)"
                  style={styles.captionInput}
                  multiline
                  maxLength={280}
                  inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                />
                {addStory.text.length > 0 ? (
                  <Text style={styles.captionCount}>{280 - addStory.text.length}</Text>
                ) : null}
              </BlurView>
            </View>
          ) : null}

          {/* Emoji sticker — only on media canvases (text-mode story doesn't
              have a fixed corner to stick something onto). */}
          {hasMedia ? (
            <Pressable
              style={styles.sticker}
              onPress={() => { setEmojiPaletteOpen((v) => !v); setLocationOpen(false); }}
              accessibilityLabel="Промени емоджи стикер"
            >
              <Text style={styles.stickerEmoji}>{addStory.selectedEmoji}</Text>
            </Pressable>
          ) : null}
        </Pressable>

        {/* ── TOP BAR ── */}
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={requestClose} style={styles.topPill} hitSlop={8} accessibilityLabel="Затвори">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <View style={[styles.topPill, { width: undefined, paddingHorizontal: 14 }]}>
            <Text style={styles.topTitle}>НОВ МОМЕНТ</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* ── EMOJI PALETTE (popover) ── */}
        {emojiPaletteOpen && hasMedia ? (
          <View style={styles.emojiPalette}>
            {EMOJIS.map((e) => (
              <Pressable
                key={e}
                style={[styles.emojiCell, addStory.selectedEmoji === e && styles.emojiCellActive]}
                onPress={() => {
                  addStory.setSelectedEmoji(e);
                  setEmojiPaletteOpen(false);
                }}
              >
                <Text style={styles.emojiCellChar}>{e}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── LOCATION POPOVER ── */}
        {locationOpen ? (
          <View style={styles.locationPopover}>
            <Ionicons name="location" size={18} color={MUTED} />
            <TextInput
              autoFocus
              value={addStory.location}
              onChangeText={addStory.setLocation}
              placeholder="напр. яз. Огоста"
              placeholderTextColor={MUTED}
              style={styles.locationInput}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={() => setLocationOpen(false)}
            />
            <Pressable hitSlop={8} onPress={() => setLocationOpen(false)}>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {/* ── BOTTOM BAR ── (shown for media or text-only mode) */}
        {hasMedia || isTextMode ? (
          <View style={styles.bottomBar}>
            <Pressable
              style={styles.chipPill}
              onPress={() => { setLocationOpen((v) => !v); setEmojiPaletteOpen(false); }}
              accessibilityLabel="Добави локация"
            >
              <Ionicons
                name={addStory.location.trim() ? 'location' : 'location-outline'}
                size={16}
                color="#fff"
              />
              <Text style={styles.chipPillText} numberOfLines={1}>
                {addStory.location.trim() || 'Локация'}
              </Text>
            </Pressable>

            {/* Emoji palette button — only meaningful in media mode (text mode
                has no sticker target). Replaced with a background-swap button
                in text-only mode. */}
            {hasMedia ? (
              <Pressable
                style={styles.iconBtn}
                onPress={() => { setEmojiPaletteOpen((v) => !v); setLocationOpen(false); }}
                accessibilityLabel="Емоджи"
              >
                <Ionicons name="happy-outline" size={20} color="#fff" />
              </Pressable>
            ) : (
              <Pressable
                style={styles.iconBtn}
                onPress={() => setBgIndex((i) => (i + 1) % TEXT_BG_PRESETS.length)}
                accessibilityLabel="Смени фона"
              >
                <Ionicons name="color-palette-outline" size={20} color="#fff" />
              </Pressable>
            )}

            {/* "Reset/replace media" — in media mode dumps the picked file; in
                text mode flips back to the empty picker so the user can switch
                to a photo without re-opening the composer. */}
            <Pressable
              style={styles.iconBtn}
              onPress={() => {
                if (hasMedia) {
                  addStory.setMediaUri(null);
                  addStory.setMediaType(null);
                } else {
                  addStory.setMode('media');
                  addStory.setText('');
                }
              }}
              accessibilityLabel={hasMedia ? 'Премахни медия' : 'Назад към избор'}
            >
              <Ionicons name="refresh" size={20} color="#fff" />
            </Pressable>

            <Pressable
              onPress={addStory.handlePost}
              disabled={addStory.saving || !canShare}
              style={[styles.shareBtn, (addStory.saving || !canShare) && { opacity: 0.55 }]}
            >
              {/* Progress fill behind the label — visible while uploadProgress
                  is between 0 and 1. Shows real upload progress for video
                  stories on slow connections instead of a flat spinner. */}
              {addStory.saving && addStory.uploadProgress > 0 && addStory.uploadProgress < 1 ? (
                <View
                  style={[
                    styles.shareProgressFill,
                    { width: `${Math.round(addStory.uploadProgress * 100)}%` },
                  ]}
                />
              ) : null}
              {addStory.saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="arrow-up" size={16} color="#fff" />
                  <Text style={styles.shareBtnText}>Сподели</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* iOS — bar above the keyboard with a "Готово" button. Without it the
            multiline caption keyboard has no built-in dismiss (Return inserts
            a newline). Android relies on tap-outside + the system back button. */}
        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={ACCESSORY_ID}>
            <View style={styles.accessoryBar}>
              <Pressable
                onPress={() => Keyboard.dismiss()}
                hitSlop={8}
                style={styles.accessoryDoneBtn}
              >
                <Text style={styles.accessoryDoneText}>Готово</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}
