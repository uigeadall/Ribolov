import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Skeleton } from './Skeleton';
import { useTheme } from '../services/themeContext';
import { spacing, radius } from '../theme/typography';

type Variant = 'row' | 'tile' | 'grid';

type Props = {
  /** Layout hint: 'row' = avatar + 2-line text, 'tile' = block + caption, 'grid' = 3-col image grid */
  variant?: Variant;
  /** How many placeholder items to render. */
  count?: number;
};

/**
 * Generic skeleton list used by screens that show row-shaped or tile-shaped
 * content. Replaces a blocking ActivityIndicator so the UI feels "loaded"
 * even before content arrives.
 */
export function ListSkeleton({ variant = 'row', count = 6 }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const items = Array.from({ length: count });

  if (variant === 'grid') {
    const tileSize = Math.floor((width - spacing.lg * 2 - 8) / 3);
    return (
      <View style={styles.grid}>
        {items.slice(0, 9).map((_, i) => (
          <Skeleton key={i} width={tileSize} height={tileSize} borderRadius={radius.sm} />
        ))}
      </View>
    );
  }

  if (variant === 'tile') {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        {items.map((_, i) => (
          <View key={i} style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Skeleton height={180} borderRadius={0} />
            <View style={styles.tileBody}>
              <Skeleton height={14} width="60%" style={{ marginBottom: 6 }} />
              <Skeleton height={11} width="40%" />
            </View>
          </View>
        ))}
      </View>
    );
  }

  // row
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md }}>
      {items.map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton height={13} width="55%" />
            <Skeleton height={11} width="35%" />
          </View>
          <Skeleton width={60} height={28} borderRadius={radius.pill} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tile: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  tileBody: { padding: spacing.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
