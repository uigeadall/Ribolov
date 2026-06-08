import React from 'react';
import { ScrollView } from 'react-native';
import { Skeleton } from '../../../components/Skeleton';
import { spacing } from '../../../theme/typography';

/** Placeholder tiles matching the 120×160 catchCard, shown while a catch rail
    loads so we don't flash the empty-state CTA at users who actually have
    catches. */
export function CatchRailSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} width={120} height={160} borderRadius={18} />
      ))}
    </ScrollView>
  );
}
