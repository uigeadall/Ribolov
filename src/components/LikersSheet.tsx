import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { REACTIONS, type CatchLiker } from '../services/socialTypes';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Total like count displayed in the header. Often diverges slightly from
      `likers.length` because the underlying fetch is capped at 80. */
  likeCount: number;
  likers: CatchLiker[];
  loading?: boolean;
  /** Tap a row to navigate to that user's profile. Sheet closes first so the
      navigation lands cleanly. */
  onPressUser: (uid: string, displayName: string) => void;
};

/**
 * Bottom-sheet listing the people who reacted on a catch or post.
 * Extracted from FeedPost so PostCard (and any future surface) can reuse the
 * same UX — drag-to-dismiss handle, glass backdrop, reaction emoji per row.
 *
 * Owns its own PanResponder + Animated.Value so the host component doesn't
 * have to track sheet drag state.
 */
export function LikersSheet({ visible, onClose, likeCount, likers, loading, onPressUser }: Props) {
  const { colors } = useTheme();
  const sheetPanY = useRef(new Animated.Value(0)).current;

  // Reset the drag offset on every open so a previously-dragged sheet doesn't
  // remount halfway off-screen.
  useEffect(() => {
    if (visible) sheetPanY.setValue(0);
  }, [visible, sheetPanY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) sheetPanY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(sheetPanY, { toValue: 700, duration: 200, useNativeDriver: true })
            .start(() => { sheetPanY.setValue(0); onClose(); });
        } else {
          Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
        }
      },
    }),
  ).current;

  const handlePressUser = (uid: string, displayName: string) => {
    sheetPanY.setValue(0);
    onClose();
    onPressUser(uid, displayName);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { sheetPanY.setValue(0); onClose(); }}>
      <Pressable style={styles.backdrop} onPress={() => { sheetPanY.setValue(0); onClose(); }}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              transform: [{ translateY: sheetPanY }],
            },
          ]}
          // Claim the touch responder for taps inside the sheet so empty-area
          // taps don't bubble to the backdrop Pressable and dismiss the modal.
          // Pan gestures still work because panResponder takes over via the
          // move-handler ladder.
          onStartShouldSetResponder={() => true}
          {...panResponder.panHandlers}
        >
          <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Харесали ({likeCount})</Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : (
            <FlatList
              data={likers}
              keyExtractor={(x) => x.uid}
              style={{ maxHeight: 360 }}
              renderItem={({ item: liker }) => (
                <Pressable
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  onPress={() => handlePressUser(liker.uid, liker.displayName)}
                >
                  <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{liker.displayName}</Text>
                  {/* Per-user reaction emoji on the right — shows whether they
                      went ❤️ / 🔥 / 🏆 / 🎣 / 😮 next to their name. */}
                  {liker.reaction ? (
                    <Text style={{ fontSize: 16, marginRight: spacing.xs }}>
                      {REACTIONS[liker.reaction].emoji}
                    </Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg }}>
                  Няма видими харесвания.
                </Text>
              }
            />
          )}
          <Pressable
            onPress={() => { sheetPanY.setValue(0); onClose(); }}
            style={{ marginTop: spacing.md, alignItems: 'center' }}
          >
            <Text style={{ ...typography.bodyBold, color: colors.primary }}>Затвори</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/** Convenience: loads likers via a fetcher and tracks open/loading state.
    Pattern lets callers drop `<LikersSheet>` + a one-liner `open()` button
    without managing the loading state themselves. */
export function useLikersSheet(fetcher: () => Promise<CatchLiker[]>) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [likers, setLikers] = useState<CatchLiker[]>([]);
  // Race guard — if the user opens the sheet twice quickly we want the second
  // load's result to win, not whichever arrives last by network luck.
  const requestIdRef = useRef(0);

  const openSheet = async () => {
    setOpen(true);
    setLoading(true);
    const id = ++requestIdRef.current;
    try {
      const list = await fetcher();
      if (id === requestIdRef.current) setLikers(list);
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  };

  return { open, setOpen, openSheet, loading, likers };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    borderTopWidth: 1,
    maxHeight: '80%',
  },
  title: {
    ...typography.h3,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: {
    ...typography.body,
    flex: 1,
  },
});
