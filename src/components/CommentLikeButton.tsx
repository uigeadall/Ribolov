import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import {
  fetchMyCatchCommentReaction,
  toggleCatchCommentReaction,
} from '../services/socialComments';
import {
  fetchMyPostCommentReaction,
  togglePostCommentReaction,
} from '../services/posts';
import { REACTIONS, type ReactionType } from '../services/socialTypes';

type Kind = 'catch' | 'post';

type Props = {
  kind: Kind;
  parentId: string;
  commentId: string;
  myUid?: string;
  myDisplayName: string;
  initialCount: number;
};

/** Reaction button rendered inside an individual comment row. Like the
    post/catch picker but compact — quick-tap toggles the user's existing
    reaction (or `heart` if none), long-press opens a centered modal picker.
    Initial reaction is fetched one-shot on mount to avoid the N-listener leak
    when many comments are visible. Optimistic toggles handle live updates. */
export function CommentLikeButton({
  kind, parentId, commentId, myUid, myDisplayName, initialCount,
}: Props) {
  const { colors, mode } = useTheme();
  const [reaction, setReaction] = useState<ReactionType | null>(null);
  const [count, setCount] = useState(initialCount);
  const [pickerOpen, setPickerOpen] = useState(false);
  const busyRef = useRef(false);
  // Locks the local state once the user has interacted, so a late-arriving
  // initial-fetch result can't clobber the optimistic toggle.
  const userInteractedRef = useRef(false);
  const pickerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    if (!myUid) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = kind === 'catch'
          ? await fetchMyCatchCommentReaction(parentId, commentId, myUid)
          : await fetchMyPostCommentReaction(parentId, commentId, myUid);
        if (!cancelled && !userInteractedRef.current) setReaction(r);
      } catch {
        // Best-effort.
      }
    })();
    return () => { cancelled = true; };
  }, [kind, parentId, commentId, myUid]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    Animated.spring(pickerAnim, { toValue: 1, useNativeDriver: true, bounciness: 6 }).start();
  }, [pickerAnim]);

  const closePicker = useCallback(() => {
    Animated.timing(pickerAnim, { toValue: 0, duration: 140, useNativeDriver: true })
      .start(({ finished }) => { if (finished) setPickerOpen(false); });
  }, [pickerAnim]);

  const pickReaction = useCallback(async (r: ReactionType) => {
    if (!myUid || busyRef.current) return;
    busyRef.current = true;
    userInteractedRef.current = true;
    const prev = reaction;
    const same = prev === r;
    // Optimistic: same emoji → remove; other emoji → switch; null → add.
    setReaction(same ? null : r);
    setCount((c) => Math.max(0, c + (prev === null ? 1 : same ? -1 : 0)));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (kind === 'catch') {
        await toggleCatchCommentReaction(parentId, commentId, myUid, myDisplayName, r);
      } else {
        await togglePostCommentReaction(parentId, commentId, myUid, myDisplayName, r);
      }
    } catch {
      // Rollback on failure (rate-limit, rules, etc.).
      setReaction(prev);
      setCount((c) => Math.max(0, c + (prev === null ? -1 : same ? 1 : 0)));
    } finally {
      busyRef.current = false;
    }
  }, [kind, parentId, commentId, myUid, myDisplayName, reaction]);

  const onQuickTap = useCallback(() => {
    if (!myUid) return;
    // Default to heart on quick-tap from no-reaction; otherwise toggle the
    // existing one off. Switching emojis requires long-press → picker.
    pickReaction(reaction ?? 'heart');
  }, [myUid, reaction, pickReaction]);

  return (
    <>
      <Pressable
        onPress={onQuickTap}
        onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); openPicker(); }}
        delayLongPress={280}
        hitSlop={8}
        disabled={!myUid}
        accessibilityRole="button"
        accessibilityLabel={reaction ? 'Промени реакцията' : 'Хареса'}
        accessibilityState={{ selected: !!reaction }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
      >
        {reaction ? (
          <Text style={{ fontSize: 13 }}>{REACTIONS[reaction].emoji}</Text>
        ) : (
          <Ionicons name="heart-outline" size={13} color={colors.textMuted} />
        )}
        {count > 0 ? (
          <Text style={{ ...typography.caption, color: reaction ? colors.primary : colors.textMuted, fontSize: 11 }}>
            {count}
          </Text>
        ) : null}
      </Pressable>

      {/* Centered glass picker — modal so it floats above the comment row and
          doesn't push siblings around when it opens. */}
      <Modal visible={pickerOpen} transparent animationType="none" onRequestClose={closePicker}>
        <Pressable style={pickerStyles.backdrop} onPress={closePicker}>
          <Animated.View
            style={[
              pickerStyles.sheet,
              {
                opacity: pickerAnim,
                transform: [{ scale: pickerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
              },
            ]}
          >
            <BlurView
              intensity={mode === 'dark' ? 70 : 84}
              tint={mode === 'dark' ? 'dark' : 'light'}
              style={StyleSheet.absoluteFillObject}
            />
            <LinearGradient
              colors={mode === 'dark'
                ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.04)']
                : ['rgba(255,255,255,0.78)', 'rgba(255,255,255,0.30)']}
              start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={[StyleSheet.absoluteFillObject, {
              borderRadius: radius.xl, borderWidth: 1,
              borderColor: mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.82)',
            }]} />
            <View style={{ flexDirection: 'row', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>
              {(Object.entries(REACTIONS) as [ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
                <Pressable
                  key={type}
                  onPress={() => { closePicker(); pickReaction(type); }}
                  style={{
                    alignItems: 'center',
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                    borderRadius: radius.md,
                    backgroundColor: reaction === type
                      ? (mode === 'dark' ? 'rgba(255,255,255,0.18)' : colors.primarySurface)
                      : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 26 }}>{r.emoji}</Text>
                  <Text style={{ ...typography.caption, color: reaction === type ? colors.primary : colors.textMuted, marginTop: 2, fontSize: 9 }}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 10,
  },
});
