import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { Button } from '../components/Button';
import { fetchPublicFeed, type CloudCatch } from '../services/catchSync';
import { getImageVariant, ImageSize } from '../utils/imageVariants';

const { width: SCREEN_W } = Dimensions.get('window');

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  accent: string;
};

// Three slides instead of four — the previous "social" and "map" slides
// described separate features but most users absorbed them as a single
// "the rest of the app" concept. Merging them shaves ~5 seconds off the
// onboarding flow without losing meaningful information. The social
// preview (real public-catch cards) stays on the merged slide via the
// `previewCatches` hook below; the map prose just appends to the body.
const SLIDES: Slide[] = [
  {
    key: 'welcome',
    icon: 'fish',
    title: 'Добре дошъл в Риболов',
    body: 'Твоят риболовен дневник, общност и карта на водоемите — всичко на едно място.',
    accent: '#14B8B8',
  },
  {
    key: 'logbook',
    icon: 'book',
    title: 'Записвай всеки улов',
    body: 'Вид риба, тегло, снимка, локация и бележки. Всичко се пази на телефона — дори без интернет.',
    accent: '#0F766E',
  },
  {
    key: 'social',
    icon: 'newspaper',
    title: 'Общност и карта',
    body: 'Виж улови от истински рибари, харесвай и участвай в класирания. Над 300 язовира и реки с прогноза за 7 дни и фаза на луната.',
    accent: '#1E8E5A',
  },
];

type Props = { onDone: () => void };

/** The "social" slide renders a 3-card preview of real public catches so new
    users see the community is alive before they sign up. Fetched eagerly on
    mount (not lazily when the slide appears) so the swipe to the slide finds
    photos already loaded and avoids a visible loading flash mid-onboarding.
    Falls back to the generic illustration when offline or the fetch fails —
    no spinner ever — because losing this slide is acceptable but blocking the
    onboarding flow on a network round-trip is not. */
function useOnboardingPreviewCatches(): CloudCatch[] | null {
  const [items, setItems] = useState<CloudCatch[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPublicFeed(6)
      .then((page) => {
        if (cancelled) return;
        // Keep only ones with photos — the preview is the photo, no value in
        // a card with a fish emoji placeholder during onboarding.
        const withPhotos = page.items.filter((c) => c.photoUri).slice(0, 3);
        setItems(withPhotos.length >= 2 ? withPhotos : null);
      })
      .catch(() => { if (!cancelled) setItems(null); });
    return () => { cancelled = true; };
  }, []);
  return items;
}

export default function OnboardingScreen({ onDone }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);
  const previewCatches = useOnboardingPreviewCatches();

  const goNext = () => {
    if (index < SLIDES.length - 1) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
      setIndex(index + 1);
    } else {
      // Final slide → onboarding completes. Success haptic marks the
      // meaningful state transition (entering the app for real). Matches
      // the haptic pattern used on first-catch celebration + catch save.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    }
  };

  // Swipe-gesture support — keeps `index` in sync when the user manually
  // pages between slides. Previously `scrollEnabled={false}` blocked swipes
  // entirely, which surprised users who instinctively tried to flick
  // sideways like every other onboarding flow they've ever seen.
  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (nextIndex !== index && nextIndex >= 0 && nextIndex < SLIDES.length) {
      void Haptics.selectionAsync();
      setIndex(nextIndex);
    }
  };

  // Tap a dot to jump to that slide. Small accessibility / power-user win —
  // matches the pattern most paged onboarding flows use.
  const goToSlide = (i: number) => {
    if (i === index) return;
    void Haptics.selectionAsync();
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item }) => {
          // Special render for the social slide when we managed to load real
          // public catches — shows three photo cards above the title so users
          // see actual community activity, not a generic "newspaper" icon.
          if (item.key === 'social' && previewCatches && previewCatches.length >= 2) {
            return (
              <View style={[styles.slide, { width: SCREEN_W }]}>
                <View style={styles.previewRow}>
                  {previewCatches.map((c, i) => (
                    <View key={c.id} style={[styles.previewCard, { transform: [{ rotate: `${(i - 1) * 4}deg` }, { translateY: i === 1 ? -6 : 0 }] }]}>
                      <Image
                        source={{ uri: getImageVariant(c.photoUri!, ImageSize.gridThumb) ?? c.photoUri! }}
                        style={styles.previewImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                      <View style={styles.previewBadge}>
                        <Text style={styles.previewBadgeText} numberOfLines={1}>{c.speciesName}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.body, { color: colors.textMuted }]}>{item.body}</Text>
              </View>
            );
          }
          return (
            <View style={[styles.slide, { width: SCREEN_W }]}>
              <View style={[styles.iconRing, { backgroundColor: item.accent }]}>
                <Ionicons name={item.icon} size={56} color="#fff" />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.body, { color: colors.textMuted }]}>{item.body}</Text>
            </View>
          );
        }}
      />

      {/* Dots — tappable to jump to a slide. The active dot stretches into a
          pill (24×8) while inactive dots stay as 8×8 circles; the contrast
          + width change reads as a progress bar on first glance. */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <Pressable
            key={i}
            onPress={() => goToSlide(i)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Слайд ${i + 1} от ${SLIDES.length}`}
            accessibilityState={{ selected: i === index }}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: i === index ? colors.primary : colors.border,
                  width: i === index ? 24 : 8,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>

      {/* Actions */}
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Button
          title={isLast ? 'Започни' : 'Напред'}
          onPress={goNext}
          style={{ flex: 1 }}
        />
        {!isLast ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onDone();
            }}
            style={styles.skip}
            hitSlop={8}
          >
            <Text style={[styles.skipText, { color: colors.textMuted }]}>Пропусни</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const PREVIEW_CARD = 130;

const styles = StyleSheet.create({
  root: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // Fan-shaped row of 3 cards — middle card lifted + flanking cards rotated
  // outward gives a Polaroid-stack feel that signals "real photos" rather
  // than "stock illustration".
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: -10,
    marginBottom: spacing.xl,
    height: PREVIEW_CARD + 30,
  },
  previewCard: {
    width: PREVIEW_CARD,
    height: PREVIEW_CARD,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    borderWidth: 3,
    borderColor: '#fff',
  },
  previewImage: { width: '100%', height: '100%' },
  previewBadge: {
    position: 'absolute',
    bottom: 6, left: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6,
  },
  previewBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Manrope_700Bold',
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  actions: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  skip: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipText: { ...typography.body },
});
