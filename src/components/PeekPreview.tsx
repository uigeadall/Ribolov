import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, Animated, Pressable, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { spacing, typography, radius } from '../theme/typography';
import { formatTimeAgo } from '../utils/formatCatchDate';
import { getImageVariant, ImageSize } from '../utils/imageVariants';
import type { FeedItem } from '../services/catchSync';

/**
 * Instagram-style peek preview. Held while the user keeps the finger down on
 * a feed card (parent's onLongPress triggers `setItem`); when the gesture
 * ends (onPressOut + close), the modal fades + scales down.
 *
 * No actions inside the preview — like, comment, share are intentionally
 * disabled. The peek is purely "show me this catch in more detail than the
 * feed thumbnail." For interactive flow the user lifts → taps to open the
 * detail screen instead.
 *
 * Why a separate component (not just an inline Modal in FeedPost):
 *   - Keeps FeedPost's tree small; long-press is the parent's only new
 *     responsibility.
 *   - Reusable from PostCard / CatchDetail if we want peek there too.
 *   - Animation state lives here, so a re-render of the underlying card
 *     can't accidentally reset the enter animation mid-frame.
 */

type Props = {
  item: FeedItem | null;
  onClose: () => void;
};

const SCREEN_W = Dimensions.get('window').width;

export function PeekPreview({ item, onClose }: Props) {
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (item) {
      // Spring-in: short, snappy. Not too bouncy — peek should feel
      // confident, not playful.
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    } else {
      // No fade-out animation; modal closes via Modal's animationType=fade
      // so the wrapper component just resets local state.
      scale.setValue(0.92);
      opacity.setValue(0);
    }
  }, [item, scale, opacity]);

  if (!item) return null;

  const photoUri = item.photoUri ? (getImageVariant(item.photoUri, ImageSize.feed) ?? item.photoUri) : null;
  const stats = [
    item.weightKg != null ? `${item.weightKg} кг` : null,
    item.lengthCm != null ? `${item.lengthCm} см` : null,
    item.released ? 'пуснат' : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              opacity,
              transform: [{ scale }],
            },
          ]}
        >
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image
                source={{ uri: photoUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
              {/* Subtle gradient at the bottom of the photo so the white
                  bottom-section reads as continuous with the photo above
                  on iOS where Modal renders without a status-bar overlay. */}
            </View>
          ) : (
            <View style={[styles.photoWrap, { backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="fish-outline" size={72} color={colors.primary + '55'} />
            </View>
          )}
          <View style={styles.body}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }} numberOfLines={1}>
              {item.speciesName}
            </Text>
            {stats ? (
              <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
                {stats}
              </Text>
            ) : null}
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }} numberOfLines={1}>
              {[item.ownerName ?? 'Рибар', item.location?.name, formatTimeAgo(item.date)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {item.notes ? (
              <Text style={{ fontSize: 14, color: colors.text, marginTop: 10, lineHeight: 20 }} numberOfLines={4}>
                {item.notes}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: Math.min(SCREEN_W - spacing.lg * 2, 360),
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  photoWrap: {
    width: '100%',
    aspectRatio: 4 / 5,
  },
  body: {
    padding: spacing.lg,
  },
});
