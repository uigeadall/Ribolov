import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { wmoIconName } from '../theme/weatherIcons';

type Props = {
  weatherCode: number;
  size?: number;
  color?: string;
  animated?: boolean;
};

function useWeatherAnimation(weatherCode: number, enabled: boolean) {
  const rotate  = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const transY  = useRef(new Animated.Value(0)).current;
  const transX  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled) return;

    rotate.setValue(0);
    scale.setValue(1);
    opacity.setValue(1);
    transY.setValue(0);
    transX.setValue(0);

    let anim: Animated.CompositeAnimation;

    if (weatherCode === 0) {
      // Sunny: slow rotation + gentle breathing scale
      anim = Animated.parallel([
        Animated.loop(
          Animated.timing(rotate, {
            toValue: 1,
            duration: 9000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(scale, { toValue: 0.92, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      ]);
    } else if (weatherCode <= 3) {
      // Partly cloudy: lazy horizontal sway
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(transX, { toValue: 5, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(transX, { toValue: -5, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
    } else if (weatherCode <= 48) {
      // Fog: slow horizontal drift + fade
      anim = Animated.parallel([
        Animated.loop(
          Animated.sequence([
            Animated.timing(transX, { toValue: 9, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(transX, { toValue: -9, duration: 3500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.4, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1.0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      ]);
    } else if (weatherCode <= 67 || (weatherCode >= 80 && weatherCode <= 82)) {
      // Rain / showers: quick drop with gravity feel + slight wobble
      anim = Animated.parallel([
        Animated.loop(
          Animated.sequence([
            Animated.timing(transY, { toValue: 5, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.timing(transY, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.delay(280),
          ]),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(transX, { toValue: 2, duration: 560, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(transX, { toValue: -2, duration: 560, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      ]);
    } else if (weatherCode <= 77) {
      // Snow: gentle dual-axis drift (different periods = organic)
      anim = Animated.parallel([
        Animated.loop(
          Animated.sequence([
            Animated.timing(transY, { toValue: -4, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(transY, { toValue: 4, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(transX, { toValue: 3, duration: 2700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(transX, { toValue: -3, duration: 2700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      ]);
    } else {
      // Thunder: realistic lightning flash pattern + scale spike
      anim = Animated.parallel([
        Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.15, duration: 60, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1.0,  duration: 60, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.25, duration: 40, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1.0,  duration: 80, easing: Easing.linear, useNativeDriver: true }),
            Animated.delay(2000),
          ]),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.18, duration: 80, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1.0,  duration: 160, easing: Easing.in(Easing.ease), useNativeDriver: true }),
            Animated.delay(2000),
          ]),
        ),
      ]);
    }

    anim.start();
    return () => {
      anim.stop();
      rotate.setValue(0);
      scale.setValue(1);
      opacity.setValue(1);
      transY.setValue(0);
      transX.setValue(0);
    };
  }, [weatherCode, enabled, rotate, scale, opacity, transY, transX]);

  const rotateInterp = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return { rotateInterp, scale, opacity, transY, transX };
}

export function WeatherIcon({ weatherCode, size = 36, color = '#0E4D64', animated = true }: Props) {
  const { rotateInterp, scale, opacity, transY, transX } = useWeatherAnimation(weatherCode, animated);

  if (!animated) {
    return <Ionicons name={wmoIconName(weatherCode)} size={size} color={color} />;
  }

  // Order matters: snow codes (71-77) must be checked BEFORE the rain bucket
  // (<= 82) because they're numerically smaller and would otherwise match
  // the rain branch first, leaving the snow branch unreachable.
  const transform =
    weatherCode === 0
      ? [{ rotate: rotateInterp }, { scale }]
      : weatherCode <= 3
      ? [{ translateX: transX }]
      : weatherCode <= 48
      ? [{ translateX: transX }]
      : weatherCode <= 67
      ? [{ translateY: transY }, { translateX: transX }]
      : weatherCode <= 77
      ? [{ translateY: transY }, { translateX: transX }]
      : weatherCode <= 82
      ? [{ translateY: transY }, { translateX: transX }]
      : [{ scale }];

  return (
    <Animated.View style={[styles.icon, { opacity, transform }]}>
      <Ionicons name={wmoIconName(weatherCode)} size={size} color={color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
});
