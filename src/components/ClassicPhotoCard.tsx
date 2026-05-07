import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { RankedClassicPhoto } from '../services/classicsContest';

const { width: SW } = Dimensions.get('window');
const CARD_W = SW - spacing.lg * 2;
const GRID_W = (SW - spacing.lg * 2 - spacing.sm) / 2;

function medal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function medalBg(rank: number): string {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return 'rgba(0,0,0,0.55)';
}

type Props = {
  row: RankedClassicPhoto;
  rank: number;
  variant?: 'full' | 'grid';
  onPress?: () => void;
};

export function ClassicPhotoCard({ row, rank, variant = 'full', onPress }: Props) {
  const { colors } = useTheme();
  const isFull = variant === 'full';
  const cardW = isFull ? CARD_W : GRID_W;
  const cardH = isFull ? cardW * 0.65 : cardW * 1.1;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          width: cardW,
          height: cardH,
          borderRadius: radius.lg,
          overflow: 'hidden',
          backgroundColor: colors.surfaceAlt,
        },
        photo: { width: '100%', height: '100%' },
        gradient: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: isFull ? 80 : 70,
          backgroundColor: 'rgba(0,0,0,0.55)',
          justifyContent: 'flex-end',
          padding: spacing.sm,
        },
        rankBadge: {
          position: 'absolute',
          top: spacing.sm,
          left: spacing.sm,
          minWidth: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 6,
          backgroundColor: medalBg(rank),
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        },
        rankText: {
          fontSize: isFull ? 16 : 14,
          fontWeight: '800',
          color: rank <= 3 ? '#1a1a1a' : '#fff',
        },
        author: {
          ...typography.small,
          color: 'rgba(255,255,255,0.8)',
          fontWeight: '600',
        },
        title: {
          ...typography.bodyBold,
          color: '#fff',
          fontSize: isFull ? 15 : 12,
          marginTop: 1,
        },
        likesRow: {
          position: 'absolute',
          top: spacing.sm,
          right: spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: radius.pill,
          paddingHorizontal: 8,
          paddingVertical: 4,
        },
        likesText: {
          ...typography.small,
          color: '#fff',
          fontWeight: '700',
        },
      }),
    [colors, cardW, cardH, rank, isFull]
  );

  return (
    <Pressable style={styles.card} onPress={onPress} android_ripple={{ color: 'rgba(255,255,255,0.15)' }}>
      {row.item.photoUri ? (
        <Image source={{ uri: row.item.photoUri }} style={styles.photo} contentFit="cover" recyclingKey={row.item.id} />
      ) : (
        <View style={[styles.photo, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySurface }]}>
          <Ionicons name="fish-outline" size={48} color={colors.primary} />
        </View>
      )}

      {/* Rank badge */}
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{medal(rank)}</Text>
      </View>

      {/* Likes */}
      <View style={styles.likesRow}>
        <Ionicons name="heart" size={12} color="#ff6b6b" />
        <Text style={styles.likesText}>{row.likes}</Text>
      </View>

      {/* Bottom overlay */}
      <View style={styles.gradient}>
        <Text style={styles.author} numberOfLines={1}>{row.item.ownerName ?? 'Рибар'}</Text>
        {row.item.photoTitle ? (
          <Text style={styles.title} numberOfLines={1}>„{row.item.photoTitle}"</Text>
        ) : (
          <Text style={styles.title} numberOfLines={1}>{row.item.speciesName}</Text>
        )}
      </View>
    </Pressable>
  );
}
