import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Animates a number from 0 → target with a cubic ease-out.
 * Returns the raw animated value (float) — callers should round or
 * `.toFixed(n)` to format. Returning a rounded int here would freeze the
 * displayed value at integer steps and break decimal callers.
 */
export function useCountUp(target: number, duration = 700): number {
  const anim = useRef(new Animated.Value(0)).current;
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Stop any animation still running from a previous target before
    // starting a new one. Otherwise two Animated.timing chains drive the
    // same Animated.Value concurrently and the listener emits interleaved
    // values — the counter jitters / regresses on rapid stats refresh.
    anim.stopAnimation();
    anim.setValue(0);
    const id = anim.addListener(({ value: v }) => setValue(v));
    Animated.timing(anim, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [target, duration, anim]);

  return value;
}
