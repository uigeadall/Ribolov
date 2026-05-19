import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Skeleton } from './Skeleton';
import { useTheme } from '../services/themeContext';
import { spacing } from '../theme/typography';

/**
 * Skeleton for a FeedPost-style catch card. Dimensions match the real
 * component (full-bleed, photo is screenWidth × 5/4) so the layout doesn't
 * "jump" when content swaps in.
 */
function PostSkeleton() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const photoHeight = Math.round(width * (5 / 4));
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {/* Header row: avatar + name */}
      <View style={styles.header}>
        <Skeleton width={36} height={36} borderRadius={18} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton height={13} width="42%" />
          <Skeleton height={10} width="22%" />
        </View>
      </View>
      {/* Photo */}
      <Skeleton height={photoHeight} width="100%" borderRadius={0} />
      {/* Action row */}
      <View style={styles.actionRow}>
        <Skeleton height={22} width={22} borderRadius={11} />
        <Skeleton height={22} width={22} borderRadius={11} />
        <Skeleton height={22} width={22} borderRadius={11} />
        <View style={{ flex: 1 }} />
        <Skeleton height={22} width={22} borderRadius={11} />
      </View>
      {/* Caption + meta */}
      <View style={styles.captionBlock}>
        <Skeleton height={13} width="38%" style={{ marginBottom: 8 }} />
        <Skeleton height={14} width="88%" style={{ marginBottom: 6 }} />
        <Skeleton height={14} width="62%" />
      </View>
    </View>
  );
}

export function FeedSkeleton() {
  return (
    <View>
      <PostSkeleton />
      <PostSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  captionBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
});
