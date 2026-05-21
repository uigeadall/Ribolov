import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

type Props = {
  children: React.ReactNode;
  /** Animation duration in ms. Default 220ms — long enough to perceive, short
      enough not to feel sluggish on a frequently-loaded list. */
  duration?: number;
  /** Use a small upward translate alongside opacity. Default true — it adds
      a tiny "settling" motion that makes the fade feel intentional. Set
      false on screens where any layout movement would be jarring. */
  withTranslate?: boolean;
};

/**
 * Fades its children in on mount. Used to soften the "skeleton → content"
 * jump cut that React Native's conditional rendering produces by default.
 *
 * Pattern at consumer sites:
 *
 *   {loading ? <Skeleton /> : <FadeIn><Content /></FadeIn>}
 *
 * The fade lives on the content side (not the skeleton) because the skeleton
 * is what unmounts — there's no parent to cross-fade between them, only an
 * appearance event we can hook into.
 *
 * Uses native driver. No layout thrash. No re-mount cost beyond the single
 * `Animated.Value` per instance.
 */
export function FadeIn({ children, duration = 220, withTranslate = true }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(withTranslate ? 8 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration, useNativeDriver: true }),
    ]).start();
    // We intentionally don't reset on cleanup — the component is meant to
    // mount once when content arrives, then stay visible. If the parent
    // re-renders (e.g. on pull-to-refresh), we don't want to re-flash.
  }, [opacity, translateY, duration]);

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}
