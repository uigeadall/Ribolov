import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Feed-inline video player. Mirrors StoryVideoPlayer's lazy-require pattern
 * for expo-video so the app doesn't crash on a missing native module.
 *
 * Differences from the story variant:
 *   - Defaults MUTED. Instagram feed pattern: a soundless thumbnail-like
 *     auto-play is much less surprising during a fast scroll than blasting
 *     audio out of a phone. Users tap the speaker icon to unmute.
 *   - Autoplay is gated on the `playing` prop, which the parent FeedPost
 *     drives from `useFeedItemVisibility` — visible cards play, off-screen
 *     cards pause. Saves bandwidth + battery and means at most ONE feed
 *     video should be playing at a time (the top-most visible card).
 *   - Looping is on, so the 15s clip just keeps repeating until the user
 *     scrolls past or taps to expand. Matches X / TikTok feed behaviour.
 *   - No fullscreen button on the player chrome — tapping the video opens
 *     the post detail. The chrome is hidden (nativeControls=false) so the
 *     content fills the rounded media block.
 */

type Props = {
  uri: string;
  /** Whether the parent feed card is currently visible (drives play/pause). */
  playing: boolean;
  width: number;
  height: number;
  /** Optional: called when a video tile is tapped — usually opens the
      fullscreen viewer or post detail. */
  onPress?: () => void;
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

export function FeedVideoPlayer({ uri, playing, width, height, onPress }: Props) {
  const mod = loadExpoVideo();
  if (!mod) {
    // Native module not bundled (Expo Go, older dev client). Render a
    // clear hint so the user knows what's missing; tap still opens
    // whatever the parent provides as the press target.
    return (
      <Pressable onPress={onPress} style={[styles.center, { width, height }]}>
        <Ionicons name="construct-outline" size={36} color="rgba(255,255,255,0.5)" />
        <Text style={styles.fallbackTitle}>Видеото изисква нов билд</Text>
      </Pressable>
    );
  }
  return <InnerPlayer mod={mod} uri={uri} playing={playing} width={width} height={height} onPress={onPress} />;
}

function InnerPlayer({
  mod, uri, playing, width, height, onPress,
}: Props & { mod: ExpoVideoMod }) {
  const { useVideoPlayer, VideoView } = mod;
  // Default muted for feed videos — see header comment.
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);

  const player = useVideoPlayer({ uri, useCaching: true }, (p) => {
    p.loop = true;
    p.muted = true;
    // Same low-buffer tuning as StoryVideoPlayer — at 15s feed clips, the
    // default 20s forward-buffer doesn't even apply; ask the player to
    // start as soon as 1s is ready so first-frame latency stays low.
    p.bufferOptions = {
      preferredForwardBufferDuration: 1,
      waitsToMinimizeStalling: false,
      minBufferForPlayback: 1,
    };
    // Don't auto-play here — the `playing` effect below kicks playback
    // once the card is actually visible. Autoplay on mount would burn
    // bandwidth on cards just off the bottom of the viewport.
  });

  // Visibility → play/pause. The visibility manager in FeedScreen sets
  // exactly one card "primary" via useFeedItemVisibility, so at most one
  // video plays at a time. When a card scrolls off, this falls back to
  // pause and the player keeps its position so the next visit resumes.
  useEffect(() => {
    if (!player) return;
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  // Mute toggle sync.
  useEffect(() => {
    if (!player) return;
    player.muted = muted;
  }, [muted, player]);

  // Mark ready on first readyToPlay so the spinner can clear.
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (evt: { status: string }) => {
      if (evt.status === 'readyToPlay' && !ready) setReady(true);
    });
    return () => sub?.remove();
  }, [player, ready]);

  return (
    <Pressable onPress={onPress} style={{ width, height, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height }}
        contentFit="cover"
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        nativeControls={false}
      />
      {!ready ? (
        <View style={[styles.centerAbs, { width, height }]} pointerEvents="none">
          <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
        </View>
      ) : null}
      {/* Mute toggle — bottom-right corner, small. Stops propagation so
          tapping the speaker doesn't ALSO open the detail screen. */}
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          setMuted((v) => !v);
        }}
        hitSlop={10}
        style={styles.muteBtn}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Включи звука' : 'Изключи звука'}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={16} color="#fff" />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    padding: 16,
    gap: 6,
  },
  centerAbs: {
    position: 'absolute',
    top: 0, left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  muteBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
