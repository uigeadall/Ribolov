import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

/**
 * Story video player.
 *
 * Lazy + try-caught `require` of `expo-video` so the app still boots when the
 * native module isn't bundled — same situation we hit with expo-dynamic-app-icon:
 * a plain `import` runs at module load and would crash the entire JS runtime in
 * Expo Go or a dev client built before this dependency landed. By isolating the
 * require inside this component (and only after `useEffect` runs), the crash
 * risk is confined to the moment a user actually opens a video story; if the
 * native module is missing we render a clear fallback that explains the
 * situation, rather than ripping down the screen.
 *
 * Tested API (expo-video):
 *   - useVideoPlayer(source, setup) → VideoPlayer instance
 *   - <VideoView player={p} contentFit="contain" allowsFullscreen />
 *   - player.play() / pause() / muted / loop
 *   - player.addListener('statusChange', cb)
 *   - player.addListener('playToEnd', cb)
 *
 * We mirror the story's "playing" gate so hold-to-pause + comments-open both
 * pause the video. We also report duration up so the caller can sync its
 * progress bar to the actual video length instead of the default 8s photo
 * duration — without that, a 30-second clip would advance to the next story
 * 8 seconds in.
 */

type Props = {
  uri: string;
  /** External play gate. Story viewer pauses on hold + when comments open. */
  paused: boolean;
  /** Fired once the player reports its duration in ms. Used by the viewer to
      reset its progress bar to match the actual clip length. 0 = unknown. */
  onDurationLoaded?: (ms: number) => void;
  /** Fired when the player reaches the end naturally. Lets the viewer advance
      to the next story even if duration was longer than its progress timer. */
  onPlaybackEnded?: () => void;
  width: number;
  height: number;
};

// Cached singleton: undefined = haven't tried, null = tried + failed, value = available.
type ExpoVideoMod = typeof import('expo-video');
let cachedMod: ExpoVideoMod | null | undefined = undefined;
function loadExpoVideo(): ExpoVideoMod | null {
  if (cachedMod !== undefined) return cachedMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMod = require('expo-video') as ExpoVideoMod;
  } catch {
    cachedMod = null;
  }
  return cachedMod;
}

export function StoryVideoPlayer({ uri, paused, onDurationLoaded, onPlaybackEnded, width, height }: Props) {
  const mod = loadExpoVideo();
  if (!mod) {
    // Native module missing — render a clear "rebuild needed" message instead
    // of a videocam icon over nothing. Better to show the cause than to look
    // like the app silently broke.
    return (
      <View style={[styles.center, { width, height }]}>
        <Ionicons name="construct-outline" size={48} color="rgba(255,255,255,0.5)" />
        <Text style={styles.fallbackTitle}>Видеото изисква нов билд</Text>
        <Text style={styles.fallbackBody}>
          Видео плеърът се добавя при нов нативен билд на приложението.
        </Text>
      </View>
    );
  }
  return <InnerPlayer mod={mod} uri={uri} paused={paused} onDurationLoaded={onDurationLoaded} onPlaybackEnded={onPlaybackEnded} width={width} height={height} />;
}

function InnerPlayer({
  mod,
  uri,
  paused,
  onDurationLoaded,
  onPlaybackEnded,
  width,
  height,
}: Props & { mod: ExpoVideoMod }) {
  const { useVideoPlayer, VideoView } = mod;
  const insets = useSafeAreaInsets();
  // Start UNMUTED. Industry split: Instagram Stories default-mute, TikTok /
  // Reels default-unmute. For a fishing app the audio (splash, the angler's
  // reaction, water sounds) is half the point — defaulting to mute meant
  // users had to find a small toggle button to hear it, which most never
  // did. iOS still respects the silent switch by default unless the audio
  // session category is `.playback`, which expo-video sets automatically
  // when an unmuted player starts. So a user with their phone in silent
  // mode still hears the sound (matching TikTok/Reels) — which is what
  // someone tapping a video story expects.
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  // Story videos auto-play, loop, and play with sound by default. We can't
  // conditionally-loop here since we don't know duration at setup time —
  // instead we set loop=true and rely on the viewer's progress bar to
  // advance to the next story on time.
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });

  // Pause/play sync with external gate (hold-to-pause, comments-open).
  useEffect(() => {
    if (!player) return;
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  // Mute toggle — keep the player muted state in sync with our local UI state.
  useEffect(() => {
    if (!player) return;
    player.muted = muted;
  }, [muted, player]);

  // Duration + playback-ended listeners. expo-video's `statusChange` event
  // fires when the player transitions through 'loading' → 'readyToPlay' →
  // 'error'; the duration property is reliable only after readyToPlay.
  useEffect(() => {
    if (!player) return;
    const statusSub = player.addListener('statusChange', (evt: { status: string }) => {
      if (evt.status === 'readyToPlay' && !ready) {
        setReady(true);
        const durSec = (player as unknown as { duration?: number }).duration ?? 0;
        const durMs = Math.round(durSec * 1000);
        if (durMs > 0 && onDurationLoaded) onDurationLoaded(durMs);
      }
    });
    const endSub = player.addListener('playToEnd', () => {
      // Loop is on, so the player will restart automatically. We still notify
      // the viewer so it can choose to advance to the next story if it'd
      // rather not see the loop. Whether the viewer acts on this is its call.
      if (onPlaybackEnded) onPlaybackEnded();
    });
    return () => {
      statusSub?.remove();
      endSub?.remove();
    };
  }, [player, ready, onDurationLoaded, onPlaybackEnded]);

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height }}
        contentFit="contain"
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        nativeControls={false}
      />
      {!ready ? (
        // Loading spinner over a black frame — better than the previous "tap
        // to open externally" placeholder because the video is actually about
        // to play in-app within a second or two.
        <View style={[styles.centerAbs, { width, height }]} pointerEvents="none">
          <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
        </View>
      ) : null}
      {/* Mute toggle — top-left of the video. Previously sat at bottom-right
          with bottom: 96, but the story viewer's reaction bar + comment
          composer occupy the bottom ~220px (see StoriesRow viewer overlay),
          which buried the button entirely. Top-left mirrors the close
          button's top-right position so they sit symmetrically without
          stepping on each other. */}
      <Pressable
        onPress={() => setMuted((v) => !v)}
        hitSlop={12}
        style={[styles.muteBtn, { top: Math.max(insets.top, 20) + 28 }]}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Включи звука' : 'Изключи звука'}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    padding: 24,
    gap: 8,
  },
  centerAbs: {
    position: 'absolute',
    top: 0, left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  fallbackBody: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  muteBtn: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    // top is set inline because it depends on safe-area insets.
  },
});
