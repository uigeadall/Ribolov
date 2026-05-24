import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

const { width: W, height: H } = Dimensions.get('window');

const CONFETTI_EMOJIS = ['🎣', '🐟', '🏆', '⭐', '🎉', '🐠'];
const CONFETTI_COUNT = 18;

// Pre-computed per-particle randomness. Generated once at module load so every
// celebration uses the same layout — keeps the animation deterministic across
// reruns (helps if QA replays the moment) and avoids burning CPU regenerating
// 18 random pairs every mount.
const CONFETTI_PARTICLES = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
  emoji: CONFETTI_EMOJIS[i % CONFETTI_EMOJIS.length],
  startX: Math.random() * W,
  // Drift sideways during the fall so they don't look like a straight column.
  driftX: (Math.random() - 0.5) * 120,
  // Stagger start so they rain in instead of all dropping simultaneously.
  delay: Math.random() * 700,
  // Rotation amount in degrees end-to-end.
  rotate: (Math.random() - 0.5) * 720,
  // Font size variance — some 22px, some 32px.
  size: 22 + Math.floor(Math.random() * 14),
  // Fall duration variance — heavier particles fall faster than light ones (illusion).
  duration: 1800 + Math.floor(Math.random() * 1200),
}));

type Props = {
  visible: boolean;
  /** Display data for the just-caught fish — title + photo. Photo is optional;
      a fish emoji renders as fallback. */
  speciesName: string;
  weightKg?: number | null;
  photoUri?: string | null;
  /** True if the catch is already being shared to the public feed — hides the
      "share publicly" CTA in that case so the user doesn't see a button that
      would be a no-op. */
  alreadyShared: boolean;
  onShare: () => void;
  onClose: () => void;
};

/** Celebration shown the very first time a user logs a catch, ever. Fires
    confetti, surfaces the photo, and lets them either share publicly or
    dismiss into the logbook. AddCatchScreen owns the "is this the first
    catch?" decision and the AsyncStorage flag that prevents re-firing — this
    component just renders when told to. */
export function FirstCatchCelebration({
  visible,
  speciesName,
  weightKg,
  photoUri,
  alreadyShared,
  onShare,
  onClose,
}: Props) {
  const { colors, mode } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.6)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      cardScale.setValue(0.6);
      cardOpacity.setValue(0);
      return;
    }
    // Card pop-in — spring so it feels celebratory rather than mechanical.
    Animated.parallel([
      Animated.spring(cardScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 9,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
    // Confetti rain — single timer drives every particle via interpolation.
    // Loops twice so the celebration fills ~6 seconds before users get bored.
    Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      { iterations: 2 },
    ).start();
  }, [visible, progress, cardScale, cardOpacity]);

  const weightLine = useMemo(() => {
    if (weightKg == null || weightKg <= 0) return null;
    return `${weightKg} кг`;
  }, [weightKg]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Backdrop — dark gradient rather than flat black so the celebration
          card pops against it. */}
      <LinearGradient
        colors={mode === 'dark' ? ['rgba(5,12,26,0.96)', 'rgba(3,8,16,0.99)'] : ['rgba(14,77,100,0.92)', 'rgba(9,53,69,0.97)']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Confetti layer — pointerEvents none so taps fall through to the
          card / close affordances underneath. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        {CONFETTI_PARTICLES.map((p, idx) => {
          // Each particle reads the global `progress` value but shifts its own
          // start by `p.delay/3000` so they don't all drop in lockstep.
          const shifted = Animated.modulo(
            Animated.add(progress, new Animated.Value(p.delay / 3000)),
            1,
          );
          const translateY = shifted.interpolate({
            inputRange: [0, 1],
            outputRange: [-60, H + 60],
          });
          const translateX = shifted.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0, p.driftX, 0],
          });
          const rotate = shifted.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${p.rotate}deg`],
          });
          const opacity = shifted.interpolate({
            inputRange: [0, 0.1, 0.85, 1],
            outputRange: [0, 1, 1, 0],
          });
          return (
            <Animated.Text
              key={idx}
              style={[
                styles.confetti,
                {
                  left: p.startX,
                  fontSize: p.size,
                  transform: [{ translateY }, { translateX }, { rotate }],
                  opacity,
                },
              ]}
            >
              {p.emoji}
            </Animated.Text>
          );
        })}
      </View>

      {/* Centerpiece card */}
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              transform: [{ scale: cardScale }],
              opacity: cardOpacity,
            },
          ]}
        >
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.45)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.firstBadge}>
                <Text style={styles.firstBadgeText}>1-ВИ УЛОВ</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.photoWrap, { backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ fontSize: 72 }}>🐟</Text>
              <View style={styles.firstBadge}>
                <Text style={styles.firstBadgeText}>1-ВИ УЛОВ</Text>
              </View>
            </View>
          )}

          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.text }]}>Поздравления!</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Записа първия си улов в дневника.
            </Text>
            <View style={[styles.speciesRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={{ fontSize: 22 }}>🎣</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.speciesName, { color: colors.text }]} numberOfLines={1}>{speciesName}</Text>
                {weightLine ? (
                  <Text style={[styles.weightLine, { color: colors.primary }]}>{weightLine}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.actions}>
              {!alreadyShared ? (
                <Pressable
                  onPress={onShare}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Ionicons name="share-social-outline" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>Сподели в лентата</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: alreadyShared ? colors.primary : 'transparent', borderColor: colors.border },
                ]}
              >
                <Text style={[styles.secondaryBtnText, { color: alreadyShared ? '#fff' : colors.text }]}>
                  Готово
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const CARD_W = Math.min(W - 48, 360);

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: CARD_W,
    borderRadius: radius.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  photoWrap: {
    width: '100%',
    height: 220,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  firstBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: '#FFD700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  firstBadgeText: {
    color: '#2a1800',
    fontSize: 10,
    fontFamily: 'Nunito_800ExtraBold',
    letterSpacing: 1,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  speciesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  speciesName: {
    ...typography.bodyBold,
    fontSize: 16,
  },
  weightLine: {
    ...typography.body,
    fontFamily: 'Nunito_800ExtraBold',
    marginTop: 2,
  },
  actions: {
    gap: spacing.sm,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  primaryBtnText: {
    color: '#fff',
    ...typography.bodyBold,
    fontSize: 15,
  },
  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    ...typography.bodyBold,
    fontSize: 15,
  },
  confetti: {
    position: 'absolute',
    top: 0,
  },
});
