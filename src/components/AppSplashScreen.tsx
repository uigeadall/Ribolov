import React, { useEffect, useMemo } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const LOGO_SIZE = 76;

/**
 * "Horizon at dawn" splash — a thin water line bisects the screen, with the
 * fish icon hovering above and a faint mirror reflection below. Single slow
 * ripple from the waterline gives the screen a calm, atmospheric pulse.
 */
export default function AppSplashScreen() {
  const a = useMemo(() => ({
    logoOpacity: new Animated.Value(0),
    logoY: new Animated.Value(-18),
    horizonScale: new Animated.Value(0),
    horizonOpacity: new Animated.Value(0),
    reflectionOpacity: new Animated.Value(0),
    wordOpacity: new Animated.Value(0),
    wordY: new Animated.Value(10),
    ripple: new Animated.Value(0),
  }), []);

  useEffect(() => {
    // 1) Logo descends in from above
    Animated.parallel([
      Animated.timing(a.logoOpacity, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a.logoY, { toValue: 0, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // 2) Horizon line draws outward from the center
    Animated.parallel([
      Animated.timing(a.horizonOpacity, { toValue: 1, duration: 480, delay: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a.horizonScale, { toValue: 1, duration: 760, delay: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // 3) Reflection fades in below the line
    Animated.timing(a.reflectionOpacity, { toValue: 0.22, duration: 700, delay: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

    // 4) Wordmark + tagline slide up
    Animated.parallel([
      Animated.timing(a.wordOpacity, { toValue: 1, duration: 560, delay: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a.wordY, { toValue: 0, duration: 560, delay: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Continuous: a single very slow ripple expanding from the waterline center
    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(a.ripple, { toValue: 1, duration: 3600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(a.ripple, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    rippleLoop.start();
    return () => { rippleLoop.stop(); };
  }, [a]);

  const rippleScale = a.ripple.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] });
  const rippleOpacity = a.ripple.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] });

  return (
    <LinearGradient
      colors={['#020812', '#06192F', '#0A2A4F', '#06192F']}
      locations={[0, 0.45, 0.55, 1]}
      style={styles.container}
    >
      {/* Above the horizon — sky */}
      <View style={styles.skyHalf} pointerEvents="none">
        <Animated.View
          style={[
            styles.logoFloat,
            { opacity: a.logoOpacity, transform: [{ translateY: a.logoY }] },
          ]}
        >
          <Ionicons name="fish" size={LOGO_SIZE} color="#FFFFFF" />
        </Animated.View>
      </View>

      {/* Horizon line — bisects the screen */}
      <View style={styles.horizonContainer} pointerEvents="none">
        <Animated.View
          style={[
            styles.horizonLine,
            {
              opacity: a.horizonOpacity,
              transform: [{ scaleX: a.horizonScale }],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(74,168,232,0)', 'rgba(140,200,240,0.7)', 'rgba(74,168,232,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        {/* Single slow ripple from the center of the horizon line */}
        <Animated.View
          style={[
            styles.ripple,
            {
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />
      </View>

      {/* Below the horizon — water with reflection */}
      <View style={styles.waterHalf} pointerEvents="none">
        <Animated.View style={[styles.reflectionFloat, { opacity: a.reflectionOpacity }]}>
          <Ionicons
            name="fish"
            size={LOGO_SIZE}
            color="#FFFFFF"
            style={{ transform: [{ scaleY: -1 }] }}
          />
        </Animated.View>
      </View>

      {/* Wordmark + tagline near the bottom */}
      <Animated.View
        style={[
          styles.wordWrap,
          { opacity: a.wordOpacity, transform: [{ translateY: a.wordY }] },
        ]}
      >
        <Text style={styles.wordmark}>РИБОЛОВ</Text>
        <Text style={styles.tagline}>Дневник за рибари</Text>
      </Animated.View>
    </LinearGradient>
  );
}

const HORIZON_Y = SCREEN_H * 0.5;
const LOGO_OFFSET_FROM_LINE = 72;
const REFLECTION_OFFSET_FROM_LINE = 18;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },

  // Sky (top half)
  skyHalf: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HORIZON_Y,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  logoFloat: {
    marginBottom: LOGO_OFFSET_FROM_LINE,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle blue text glow on the icon
    shadowColor: '#4AA8E8',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },

  // Horizon line
  horizonContainer: {
    position: 'absolute',
    top: HORIZON_Y - 1,
    left: 0,
    right: 0,
    height: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  horizonLine: {
    width: SCREEN_W * 0.86,
    height: 1,
    overflow: 'hidden',
  },
  ripple: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: 'rgba(74, 168, 232, 0.55)',
  },

  // Water (bottom half)
  waterHalf: {
    position: 'absolute',
    top: HORIZON_Y,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  reflectionFloat: {
    marginTop: REFLECTION_OFFSET_FROM_LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Wordmark
  wordWrap: {
    position: 'absolute',
    bottom: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 28,
    fontWeight: '300',
    color: '#FFFFFF',
    letterSpacing: 8,
    paddingLeft: 8,
    textShadowColor: 'rgba(74, 168, 232, 0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  tagline: {
    marginTop: 10,
    fontSize: 11,
    color: 'rgba(200, 230, 240, 0.55)',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
