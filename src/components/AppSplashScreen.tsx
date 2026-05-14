import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

const RIPPLE_COUNT = 3;
const BASE_RADIUS = 68;
const RIPPLE_SPREAD = 44;

export default function AppSplashScreen() {
  const logoScale = useRef(new Animated.Value(0.72)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const dotOpacity = [
    useRef(new Animated.Value(0.25)).current,
    useRef(new Animated.Value(0.25)).current,
    useRef(new Animated.Value(0.25)).current,
  ];
  const rippleScales = Array.from({ length: RIPPLE_COUNT }, () =>
    useRef(new Animated.Value(1)).current
  );
  const rippleOpacities = Array.from({ length: RIPPLE_COUNT }, () =>
    useRef(new Animated.Value(0)).current
  );

  useEffect(() => {
    // Logo entrance
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();

    // Text fades in slightly after
    Animated.timing(textOpacity, { toValue: 1, duration: 420, delay: 280, useNativeDriver: true }).start();

    // Ripple rings — staggered expanding loops
    rippleScales.forEach((scale, i) => {
      const delay = i * 500;
      const loop = Animated.loop(
        Animated.parallel([
          Animated.timing(scale, { toValue: 2.1, duration: 1600, delay, useNativeDriver: true }),
          Animated.timing(rippleOpacities[i], {
            toValue: 0,
            duration: 1600,
            delay,
            useNativeDriver: true,
          }),
        ])
      );
      // Start ripple opacity at 0.55 then loop fades it
      rippleOpacities[i].setValue(0.55);
      loop.start();
    });

    // Loading dots pulse
    const dotLoop = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot, { toValue: 1, duration: 320, delay, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.25, duration: 320, useNativeDriver: true }),
          Animated.delay(640),
        ])
      ).start();

    dotOpacity.forEach((dot, i) => dotLoop(dot, i * 160 + 500));
  }, []);

  return (
    <LinearGradient
      colors={['#050F12', '#0A2230', '#051A14']}
      locations={[0, 0.55, 1]}
      style={styles.container}
    >
      {/* Ripple rings */}
      <View style={styles.rippleContainer} pointerEvents="none">
        {rippleScales.map((scale, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ripple,
              {
                width: BASE_RADIUS * 2,
                height: BASE_RADIUS * 2,
                borderRadius: BASE_RADIUS,
                marginLeft: -(BASE_RADIUS + RIPPLE_SPREAD * i),
                marginTop: -(BASE_RADIUS + RIPPLE_SPREAD * i),
                opacity: rippleOpacities[i],
                transform: [{ scale }],
              },
            ]}
          />
        ))}
      </View>

      {/* Logo mark */}
      <Animated.View
        style={[
          styles.logoWrap,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}
      >
        <LinearGradient
          colors={['#007A9A', '#004F64']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.logoCircle}
        >
          {/* Hook shape — two layered emoji for depth */}
          <Text style={styles.logoEmoji}>🎣</Text>
        </LinearGradient>

        {/* Shine ring */}
        <View style={styles.shineRing} pointerEvents="none" />
      </Animated.View>

      {/* Wordmark */}
      <Animated.View style={[styles.textBlock, { opacity: textOpacity }]}>
        <Text style={styles.appName}>РИБОЛОВ</Text>
        <Text style={styles.tagline}>Твоят риболовен дневник</Text>
      </Animated.View>

      {/* Loading dots */}
      <Animated.View style={[styles.dotsRow, { opacity: textOpacity }]}>
        {dotOpacity.map((op, i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: op }]} />
        ))}
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#00C4E8',
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  logoCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: {
    fontSize: 46,
    lineHeight: 54,
  },
  shineRing: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    borderColor: 'rgba(0, 196, 232, 0.35)',
  },
  textBlock: {
    alignItems: 'center',
    gap: 6,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 6,
  },
  tagline: {
    fontSize: 13,
    color: 'rgba(200, 230, 240, 0.65)',
    letterSpacing: 0.5,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 40,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00C4E8',
  },
});
