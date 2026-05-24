import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Animates a number from 0 → target with a cubic ease-out.
 *
 * Returns the animated value with the requested decimal precision. Callers
 * that want one-decimal output (`2.5 kg`) pass `precision: 1`; integer
 * counters use the default `precision: 0`. Internally the listener tracks
 * the most recent scaled integer (value × 10^precision) and only fires
 * setValue when the scaled integer changes — that's what fixes the
 * "Maximum update depth exceeded" crash that the naive listener triggered:
 *
 * The previous version pushed every floating-point Animated frame into
 * setValue. With `useNativeDriver: false`, a 700ms animation fires roughly
 * 42 listener callbacks; each one was a parent re-render. When two counters
 * mount at the same time (LogbookScreen has animatedCount + animatedKgInt)
 * plus any other state landing in the same micro-tasks, React's scheduler
 * sees 80+ setState chains within a single commit and bails out with the
 * depth-exceeded error. Emitting only on scaled-integer transitions caps
 * re-renders at the meaningful step count — for a small target like 20
 * that's ~20 renders over the whole animation instead of 42, and for a
 * precision-1 weight like 5.4 over 700ms it's ~54 vs the same 42 frames
 * (but consecutive duplicates are silently dropped, so the React workload
 * never piles up the way the float-stream did).
 */
export function useCountUp(target: number, duration = 700, precision = 0): number {
  const anim = useRef(new Animated.Value(0)).current;
  const [value, setValue] = useState(0);
  // Tracks the most recent scaled integer pushed into state. A ref (not
  // state) because the listener fires outside React's render cycle and we
  // need synchronous reads to compare against the latest emission. Storing
  // the scaled integer (not the divided float) avoids floating-point
  // accumulation drift between renders.
  const lastEmittedScaledRef = useRef(0);

  useEffect(() => {
    const scale = Math.pow(10, Math.max(0, precision));
    // Stop any animation still running from a previous target before
    // starting a new one. Otherwise two Animated.timing chains drive the
    // same Animated.Value concurrently and the listener emits interleaved
    // values — the counter jitters / regresses on rapid stats refresh.
    anim.stopAnimation();
    anim.setValue(0);
    lastEmittedScaledRef.current = 0;
    setValue(0);
    const id = anim.addListener(({ value: v }) => {
      const scaled = Math.round(v * scale);
      if (scaled !== lastEmittedScaledRef.current) {
        lastEmittedScaledRef.current = scaled;
        setValue(scaled / scale);
      }
    });
    Animated.timing(anim, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      // Guarantee the final value lands exactly on the target — without this,
      // if the last listener call fired before the animation hit the end,
      // the displayed counter freezes one step short (e.g. shows 99 instead
      // of 100). `finished` is false when stopAnimation interrupts mid-run,
      // so we don't snap-to-target on an interrupted animation.
      if (finished) {
        const finalScaled = Math.round(target * scale);
        if (finalScaled !== lastEmittedScaledRef.current) {
          lastEmittedScaledRef.current = finalScaled;
          setValue(finalScaled / scale);
        }
      }
    });
    return () => anim.removeListener(id);
  }, [target, duration, precision, anim]);

  return value;
}
