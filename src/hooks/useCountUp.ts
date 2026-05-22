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
