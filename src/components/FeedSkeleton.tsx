import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { useTheme } from '../services/themeContext';
import { radius, spacing } from '../theme/typography';

function PostSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Skeleton height={220} borderRadius={0} style={styles.photo} />
      <View style={styles.inner}>
        <Skeleton height={18} width="55%" style={{ marginBottom: 8 }} />
        <Skeleton height={13} width="38%" />
        <View style={[styles.socialRow, { borderTopColor: colors.border }]}>
          <Skeleton height={20} width={44} />
          <Skeleton height={20} width={44} />
          <Skeleton height={20} width={44} />
          <Skeleton height={20} width={44} />
        </View>
      </View>
    </View>
  );
}

export function FeedSkeleton() {
  return (
    <View style={styles.root}>
      <PostSkeleton />
      <PostSkeleton />
      <PostSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  photo: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  inner: { padding: spacing.md },
  socialRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
