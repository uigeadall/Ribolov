import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Pressable, StyleSheet, StatusBar, Text,
  PanResponder, Animated, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  /** Single-image API (legacy — still supported). Ignored when `uris` is set. */
  uri?: string;
  /** Multi-image API. When provided, the viewer renders horizontal swipe
      between images plus a page indicator. */
  uris?: string[];
  /** Starting page when `uris` is provided. Clamped into range. */
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
};

const { width: W, height: H } = Dimensions.get('window');

// Thresholds. Pulled out so the swipe-dismiss + page-swipe feel can be tuned
// without hunting through the gesture handler.
const SWIPE_DISMISS_DY = 110;          // px past which a vertical drag dismisses
const FLICK_DISMISS_VY = 0.7;          // vy threshold for velocity-based dismiss
const HORIZ_PAGE_DX = 60;              // px past which a horizontal drag changes page
const HORIZ_PAGE_VX = 0.5;             // vx threshold for velocity-based page change
const DOUBLE_TAP_WINDOW_MS = 280;      // gap under which two taps count as a double
const DOUBLE_TAP_MAX_MOVEMENT = 10;    // px — drag distance within a single tap
const DOUBLE_TAP_MAX_DISTANCE = 40;    // px — max distance between the two taps
const DOUBLE_TAP_ZOOM = 2.5;           // scale that double-tap zooms TO when zoomed out

export function ImageViewer({ uri, uris, initialIndex = 0, visible, onClose }: Props) {
  // Normalize the two API shapes into a single list. Callers passing `uri`
  // keep working without changes; new multi-photo callers pass `uris` +
  // `initialIndex` to land on a specific page.
  const list = useMemo<string[]>(() => {
    if (uris && uris.length > 0) return uris;
    if (uri) return [uri];
    return [];
  }, [uri, uris]);
  const multi = list.length > 1;

  const clampedInitial = Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1)));
  const [activeIndex, setActiveIndex] = useState(clampedInitial);
  // Mirror activeIndex into a ref so the PanResponder closures (created once
  // on mount) can read the latest value without stale-closure bugs when the
  // user swipes through multiple pages in quick succession.
  const activeIndexRef = useRef(clampedInitial);
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

  const scale = useRef(new Animated.Value(1)).current;
  const scaleRef = useRef(1);
  const lastScale = useRef(1);
  const activePinchScale = useRef(1);

  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastTranslate = useRef({ x: 0, y: 0 });

  // Backdrop fade-on-drag — interpolated below from the drag distance. Driven
  // by translateY only when zoomed out (the user can't dismiss while zoomed in,
  // so we don't dim then). 0 = solid black, 1 = transparent.
  const backdropDimmer = useRef(new Animated.Value(0)).current;

  // Tap tracking for double-tap detection. We can't use a Pressable here
  // because the PanResponder consumes all touches before they reach a child.
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  // Mid-page-change flag so a second swipe during the slide-out animation
  // doesn't double-fire and skip pages.
  const pagingRef = useRef(false);

  const resetTransform = (animate = true) => {
    scaleRef.current = 1;
    lastScale.current = 1;
    activePinchScale.current = 1;
    lastTranslate.current = { x: 0, y: 0 };
    if (animate) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
        Animated.timing(backdropDimmer, { toValue: 0, duration: 140, useNativeDriver: false }),
      ]).start();
    } else {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      backdropDimmer.setValue(0);
    }
  };

  const zoomTo = (target: number) => {
    scaleRef.current = target;
    lastScale.current = target;
    activePinchScale.current = target;
    Animated.spring(scale, { toValue: target, useNativeDriver: true, bounciness: 8 }).start();
  };

  /** Animate the current image off-screen in the swipe direction, then jump
      to the next/prev page and snap a fresh image in from the opposite side.
      Implemented as a hard cut after the slide-out rather than a true cross-
      fade because the next image's URI changes synchronously on setActiveIndex
      and there's nothing to cross-fade with on a single Animated.Image. */
  const changePage = (nextIndex: number, direction: 1 | -1) => {
    if (pagingRef.current) return;
    pagingRef.current = true;
    Animated.timing(translateX, {
      toValue: direction * -W,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
      // Reset position instantly so the incoming image appears centered, not
      // visibly snapping back from the swipe direction.
      resetTransform(false);
      pagingRef.current = false;
    });
  };

  // Reset transforms whenever the viewer opens, the source list changes, or
  // the user navigates to a new page. Without this, the next photo opens at
  // the previous zoom/pan position.
  useEffect(() => {
    if (visible) {
      setActiveIndex(clampedInitial);
      activeIndexRef.current = clampedInitial;
      resetTransform(false);
      lastTapRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, list]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        scale.setOffset(scaleRef.current - 1);
        scale.setValue(1);
        translateX.setOffset(lastTranslate.current.x);
        translateY.setOffset(lastTranslate.current.y);
        translateX.setValue(0);
        translateY.setValue(0);
      },

      onPanResponderMove: (e, gs) => {
        if (pagingRef.current) return;
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          // Pinch — same math as before. _startDist is a hack on the ref'd
          // PanResponder object; refactor candidate but works.
          const t1 = touches[0];
          const t2 = touches[1];
          const dist = Math.sqrt(
            Math.pow(t1.pageX - t2.pageX, 2) + Math.pow(t1.pageY - t2.pageY, 2),
          );
          if (!(panResponder as any)._startDist) {
            (panResponder as any)._startDist = dist;
            (panResponder as any)._startScale = scaleRef.current;
          }
          const newScale = Math.max(1, Math.min(4, (panResponder as any)._startScale * (dist / (panResponder as any)._startDist)));
          activePinchScale.current = newScale;
          scale.setValue(newScale - scaleRef.current + 1);
        } else if (scaleRef.current > 1) {
          // Pan when zoomed
          translateX.setValue(gs.dx);
          translateY.setValue(gs.dy);
        } else if (Math.abs(gs.dy) > Math.abs(gs.dx) && gs.dy > 0) {
          // Vertical drag while zoomed out — track for dismiss + dim the
          // backdrop proportional to drag distance (capped). This is the
          // "premium" Instagram-style ripping-off feel.
          translateY.setValue(gs.dy);
          const dragProgress = Math.min(1, gs.dy / SWIPE_DISMISS_DY);
          scale.setValue(1 - dragProgress * 0.08);
          backdropDimmer.setValue(dragProgress);
        } else if (multi && Math.abs(gs.dx) > Math.abs(gs.dy)) {
          // Horizontal drag while zoomed out and in multi-photo mode — show
          // the image following the finger so the user has visual confirmation
          // a page-swipe is in progress (otherwise the gesture feels dead
          // until release). Boundary edges apply rubber-banding via the dx/3
          // divisor so the user gets resistance instead of free pan-off-edge.
          const atFirst = activeIndexRef.current === 0;
          const atLast = activeIndexRef.current === list.length - 1;
          const blockedDirection =
            (gs.dx > 0 && atFirst) || (gs.dx < 0 && atLast);
          translateX.setValue(blockedDirection ? gs.dx / 3 : gs.dx);
        }
      },

      onPanResponderRelease: (_, gs) => {
        (panResponder as any)._startDist = null;
        scale.flattenOffset();
        translateX.flattenOffset();
        translateY.flattenOffset();

        const newScale = Math.max(1, Math.min(4, activePinchScale.current));
        activePinchScale.current = newScale;
        scaleRef.current = newScale;
        lastScale.current = newScale;
        lastTranslate.current = {
          x: lastTranslate.current.x + gs.dx,
          y: lastTranslate.current.y + gs.dy,
        };

        // Double-tap detection — only fires when the gesture was effectively
        // a tap (tiny movement, not a drag) and we're not in a pinch.
        const wasTap =
          Math.abs(gs.dx) < DOUBLE_TAP_MAX_MOVEMENT &&
          Math.abs(gs.dy) < DOUBLE_TAP_MAX_MOVEMENT;
        if (wasTap) {
          const now = Date.now();
          const prev = lastTapRef.current;
          const closeEnough =
            !!prev &&
            Math.hypot(gs.x0 - prev.x, gs.y0 - prev.y) < DOUBLE_TAP_MAX_DISTANCE;
          const isDouble = prev && (now - prev.t) < DOUBLE_TAP_WINDOW_MS && closeEnough;
          if (isDouble) {
            if (newScale > 1) {
              resetTransform();
            } else {
              zoomTo(DOUBLE_TAP_ZOOM);
            }
            lastTapRef.current = null;
            return;
          }
          lastTapRef.current = { t: now, x: gs.x0, y: gs.y0 };
          return;
        }

        if (newScale <= 1) {
          // Swipe-down dismiss (existing) — distance OR velocity.
          const dismissByDistance = gs.dy > SWIPE_DISMISS_DY && Math.abs(gs.dx) < 80;
          const dismissByVelocity = gs.vy > FLICK_DISMISS_VY && gs.dy > 0 && Math.abs(gs.dx) < 80;
          if (dismissByDistance || dismissByVelocity) {
            Animated.parallel([
              Animated.timing(translateY, { toValue: H, duration: 180, useNativeDriver: true }),
              Animated.timing(backdropDimmer, { toValue: 1, duration: 140, useNativeDriver: false }),
            ]).start(() => onClose());
            return;
          }

          // Horizontal swipe → page change (multi-photo mode only). Direction
          // semantics: dx < 0 = swiped left = go to next page (image slides
          // off to the left). dx > 0 = swiped right = previous page. Boundary
          // edges snap back rather than wrap — wrapping confuses users who
          // see a page indicator and expect linear progress.
          if (multi && Math.abs(gs.dx) > Math.abs(gs.dy)) {
            const meetsDistance = Math.abs(gs.dx) > HORIZ_PAGE_DX;
            const meetsVelocity = Math.abs(gs.vx) > HORIZ_PAGE_VX;
            if (meetsDistance || meetsVelocity) {
              const idx = activeIndexRef.current;
              if (gs.dx < 0 && idx < list.length - 1) {
                changePage(idx + 1, 1);
                return;
              }
              if (gs.dx > 0 && idx > 0) {
                changePage(idx - 1, -1);
                return;
              }
            }
          }

          resetTransform();
        }
      },
    }),
  ).current;

  // Backdrop opacity from dimmer: 1 → fully visible black, 0 → transparent.
  const backdropOpacity = backdropDimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const currentUri = list[activeIndex] ?? '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFillObject}>
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000', opacity: backdropOpacity }]} />
        <View style={styles.center}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {/* Page counter — only shown when there's more than one photo to
              swipe between. Mirrors the "1 / 5" affordance every native
              gallery uses so users immediately understand the gesture. */}
          {multi ? (
            <View style={styles.pageBadge} pointerEvents="none">
              <Text style={styles.pageBadgeText}>
                {activeIndex + 1} / {list.length}
              </Text>
            </View>
          ) : null}
          <Animated.View
            style={[styles.imageWrap, { transform: [{ scale }, { translateX }, { translateY }] }]}
            {...panResponder.panHandlers}
          >
            {currentUri ? (
              <Image source={{ uri: currentUri }} style={styles.image} contentFit="contain" cachePolicy="memory-disk" />
            ) : null}
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 6 },
  pageBadge: {
    position: 'absolute', top: 56, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, zIndex: 10,
  },
  pageBadgeText: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.4 },
  imageWrap: { width: W, height: H },
  image: { width: '100%', height: '100%' },
});
