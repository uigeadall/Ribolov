import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { REACTIONS, type ReactionType } from '../services/socialTypes';

type Props = {
  visible: boolean;
  myReaction: ReactionType | null;
  onPick: (type: ReactionType) => void;
  /** Called when the picker should close itself — either after an
      auto-dismiss timer fires or (via parent) any other dismissal path. */
  onAutoClose: () => void;
};

/**
 * Shared reaction picker used by FeedPost AND PostCard. Extracted because the
 * two screens had ~75 lines of identical picker JSX each — any change had to
 * land twice and the styles inevitably drifted. Consolidating also gave a
 * single place to land the v2 polish set:
 *
 *   - selectionAsync haptic the moment an emoji is tapped (was missing — the
 *     most emotional micro-interaction had zero tactile feedback)
 *   - bigger emoji (28→32) + label (10→12) so the labels are actually
 *     readable; the old 10pt labels were borderline illegible on phones
 *   - auto-close after 4 seconds of inactivity so a user who opens the
 *     picker by accident isn't trapped in it; replaces the old explicit
 *     close-circle button which was a smaller-than-the-emoji tap target
 *     that most users ignored anyway. Combined with the existing
 *     pick-then-close behaviour, the user always has two paths out.
 *
 * Tap-outside-to-dismiss was considered and deferred: the picker renders
 * inline above the like button (so its position depends on scroll offset),
 * which means a Modal-backed backdrop would either hide the picker behind
 * the Modal or force the picker into a fixed centre-of-screen position
 * that doesn't match where the user tapped. Auto-close gives the same
 * "you're not stuck here" feel without the structural rework.
 */
export function ReactionPicker({ visible, myReaction, onPick, onAutoClose }: Props) {
  const { colors, mode } = useTheme();
  const pickerAnim = useRef(new Animated.Value(0)).current;

  // Show/hide animation. We only run the enter spring on visible=true; the
  // exit fade lives in the parent's closePicker because the parent owns the
  // Animated.Value lifecycle (would otherwise unmount mid-animation).
  useEffect(() => {
    if (visible) {
      Animated.spring(pickerAnim, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
    } else {
      Animated.timing(pickerAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }
  }, [visible, pickerAnim]);

  // Auto-close after 4 seconds. Mirrors what Slack / Instagram do — a
  // long-press that turned out to be accidental shouldn't leave the picker
  // hanging until the user finds the tiny close button. Timer resets every
  // time `visible` flips back to true.
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(onAutoClose, 4000);
    return () => clearTimeout(id);
  }, [visible, onAutoClose]);

  if (!visible) return null;

  const handlePick = (type: ReactionType) => {
    void Haptics.selectionAsync();
    onPick(type);
  };

  return (
    <Animated.View
      style={{
        marginHorizontal: 12,
        marginTop: 8,
        opacity: pickerAnim,
        transform: [{ scale: pickerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: mode === 'dark' ? 0.35 : 0.14,
        shadowRadius: 14,
        elevation: 6,
        borderRadius: radius.xl,
      }}
    >
      {/* Outer holds the elevation/shadow — Android clips elevation shadows
          under overflow:hidden, so the BlurView clip lives on the inner View. */}
      <View style={{ borderRadius: radius.xl, overflow: 'hidden' }}>
        <BlurView
          intensity={mode === 'dark' ? 68 : 80}
          tint={mode === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={mode === 'dark'
            ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.04)']
            : ['rgba(255,255,255,0.72)', 'rgba(255,255,255,0.30)']}
          start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[StyleSheet.absoluteFillObject, {
          borderRadius: radius.xl, borderWidth: 1,
          borderColor: mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.82)',
        }]} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.xs }}>
          {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => {
            const isActive = myReaction === type;
            return (
              <Pressable
                key={type}
                onPress={() => handlePick(type)}
                hitSlop={6}
                style={{
                  alignItems: 'center',
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                  borderRadius: radius.md,
                  backgroundColor: isActive
                    ? (mode === 'dark' ? 'rgba(255,255,255,0.18)' : colors.primarySurface)
                    : 'transparent',
                }}
              >
                {/* Active emoji bumped slightly so the selected reaction
                    pops without users having to read the label colour to
                    work out which one they already picked. */}
                <Text style={{ fontSize: isActive ? 34 : 32 }}>{r.emoji}</Text>
                <Text style={{
                  ...typography.caption,
                  color: isActive ? colors.primary : colors.textMuted,
                  marginTop: 2,
                  fontSize: 12,
                  fontWeight: isActive ? '700' : '600',
                }}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}
