import React, { forwardRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import { typography } from '../theme/typography';
import type { Catch } from '../types';
import { formatCatchDate } from '../utils/formatCatchDate';

type Props = {
  catchItem: Catch;
  /** Author display name shown in the corner. Defaults to "Рибар". */
  ownerName?: string;
  /** Visual format. 'story' = 9:16 portrait (Instagram Stories, WhatsApp
      Status), 'square' = 1:1 (Instagram Feed). Default story. */
  format?: 'story' | 'square';
};

/**
 * Branded share poster for a catch. Renders OFF-SCREEN — the host screen
 * positions it absolutely with a negative offset so it never paints to
 * the user's display, then captures it via the forwarded ViewShot ref.
 *
 * Why a separate poster vs the existing CatchDetail ViewShot:
 * - That one was designed for an "I caught this!" share between friends
 *   — basic text + small chips, screenshot-style
 * - This one is built for VIRALITY — story-aspect, bold typography over
 *   a full-bleed photo, prominent Ribolov branding so people seeing the
 *   share know what app to download
 *
 * Layout uses fixed pixel widths sized to common social formats (1080
 * px wide for either format) so the capture has print-resolution
 * quality regardless of device screen size.
 */
const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const SQUARE_SIZE = 1080;

export const BrandedCatchPoster = forwardRef<ViewShot, Props>(function BrandedCatchPoster(
  { catchItem, ownerName, format = 'story' },
  ref,
) {
  const width = format === 'story' ? STORY_WIDTH : SQUARE_SIZE;
  const height = format === 'story' ? STORY_HEIGHT : SQUARE_SIZE;
  const fallbackName = ownerName?.trim() || 'Рибар';
  const dateLabel = formatCatchDate(catchItem.date);
  const locationLabel = catchItem.location?.name ?? '';
  const weightLabel = catchItem.weightKg != null ? `${catchItem.weightKg} кг` : '';
  const lengthLabel = catchItem.lengthCm != null ? `${catchItem.lengthCm} см` : '';
  const released = !!catchItem.released;

  return (
    <ViewShot ref={ref} options={{ format: 'png', quality: 1, result: 'tmpfile', width, height }}>
      <View style={[styles.poster, { width, height }]}>
        {/* Background — full-bleed photo if present, else navy gradient */}
        {catchItem.photoUri ? (
          <Image
            source={{ uri: catchItem.photoUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#062D3D' }]} />
        )}

        {/* Top vignette so the watermark stays readable on bright photos */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
          style={[StyleSheet.absoluteFillObject, { bottom: height * 0.7 }]}
        />

        {/* Bottom vignette so the title block reads cleanly */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
          locations={[0, 1]}
          style={[StyleSheet.absoluteFillObject, { top: height * 0.35 }]}
        />

        {/* Top-left badge */}
        <View style={styles.topRow}>
          <View style={styles.brandBadge}>
            <Ionicons name="fish" size={28} color="#fff" />
            <Text style={styles.brandText}>Риболов</Text>
          </View>
          {released ? (
            <View style={styles.releasedBadge}>
              <Ionicons name="leaf" size={20} color="#fff" />
              <Text style={styles.releasedText}>ПУСНАТ</Text>
            </View>
          ) : null}
        </View>

        {/* Big title block (bottom 40% of the poster) */}
        <View style={styles.titleBlock}>
          {catchItem.speciesName ? (
            <Text style={styles.species} numberOfLines={2}>{catchItem.speciesName}</Text>
          ) : null}
          {(weightLabel || lengthLabel) ? (
            <Text style={styles.measure}>
              {weightLabel}
              {weightLabel && lengthLabel ? '  ·  ' : ''}
              {lengthLabel}
            </Text>
          ) : null}
          {locationLabel ? (
            <View style={styles.metaRow}>
              <Ionicons name="location" size={28} color="#FFD700" />
              <Text style={styles.location} numberOfLines={1}>{locationLabel}</Text>
            </View>
          ) : null}
          <View style={styles.byline}>
            <Text style={styles.bylineText}>{fallbackName}</Text>
            <Text style={styles.bylineDot}>·</Text>
            <Text style={styles.bylineText}>{dateLabel}</Text>
          </View>
        </View>

        {/* Footer URL — gives non-users a path to find the app */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>ribolov.app</Text>
        </View>
      </View>
    </ViewShot>
  );
});

const styles = StyleSheet.create({
  poster: { backgroundColor: '#000', overflow: 'hidden' },
  topRow: {
    position: 'absolute',
    top: 56,
    left: 56,
    right: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: 'rgba(6,45,61,0.85)',
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  brandText: { ...typography.bodyBold, color: '#fff', fontSize: 28 },
  releasedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'rgba(46,155,90,0.85)',
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  releasedText: { color: '#fff', fontFamily: 'Nunito_700Bold', fontSize: 18, letterSpacing: 1.5 },
  titleBlock: {
    position: 'absolute',
    left: 56,
    right: 56,
    bottom: 140,
    gap: 12,
  },
  species: {
    color: '#fff',
    fontFamily: 'Nunito_700Bold',
    fontSize: 96,
    lineHeight: 100,
    letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  measure: {
    color: '#FFD700',
    fontFamily: 'Nunito_700Bold',
    fontSize: 60,
    letterSpacing: 1,
    marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  location: { color: '#fff', fontFamily: 'Nunito_700Bold', fontSize: 36, opacity: 0.92 },
  byline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  bylineText: { color: '#fff', fontSize: 28, opacity: 0.8 },
  bylineDot: { color: '#fff', fontSize: 28, opacity: 0.5 },
  footer: {
    position: 'absolute',
    bottom: 64,
    left: 56,
    right: 56,
    alignItems: 'center',
  },
  footerText: { color: '#fff', fontSize: 32, opacity: 0.55, letterSpacing: 4 },
});
