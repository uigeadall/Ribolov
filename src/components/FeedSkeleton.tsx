import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../services/themeContext';
import { radius, spacing } from '../theme/typography';

function SkeletonBox({ w, h, style }: { w: number | string; h: number; style?: object }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width: w as number, height: h, borderRadius: radius.sm, backgroundColor: colors.border, opacity: pulse },
        style,
      ]}
    />
  );
}

function PostSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <SkeletonBox w={40} h={40} style={{ borderRadius: 20 }} />
        <View style={styles.headerText}>
          <SkeletonBox w={120} h={13} />
          <SkeletonBox w={80} h={11} style={{ marginTop: 6 }} />
        </View>
      </View>
      <SkeletonBox w="100%" h={14} style={{ marginBottom: 8 }} />
      <SkeletonBox w="60%" h={12} />
      <SkeletonBox w="100%" h={200} style={{ marginTop: 12, borderRadius: radius.md }} />
      <View style={styles.socialRow}>
        <SkeletonBox w={48} h={18} />
        <SkeletonBox w={48} h={18} />
        <SkeletonBox w={48} h={18} />
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
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  headerText: { flex: 1, gap: 6 },
  socialRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
