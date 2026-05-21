import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Pressable, StyleSheet, StatusBar,
  PanResponder, Animated, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  uri: string;
  visible: boolean;
  onClose: () => void;
};

const { width: W, height: H } = Dimensions.get('window');

// Thresholds. Pulled out so the swipe-dismiss feel can be tuned without
// hunting through the gesture handler.
const SWIPE_DISMISS_DY = 110;          // px past which a vertical drag dismisses
const FLICK_DISMISS_VY = 0.7;          // vy threshold for velocity-based dismiss
const DOUBLE_TAP_WINDOW_MS = 280;      // gap under which two taps count as a double
const DOUBLE_TAP_MAX_MOVEMENT = 10;    // px — taps further apart aren't a double
const DOUBLE_TAP_ZOOM = 2.5;           // scale that double-tap zooms TO when zoomed out

export function ImageViewer({ uri, visible, onClose }: Props) {
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

  const resetTransform = () => {
    scaleRef.current = 1;
    lastScale.current = 1;
    activePinchScale.current = 1;
    lastTranslate.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
      Animated.timing(backdropDimmer, { toValue: 0, duration: 140, useNativeDriver: false }),
    ]).start();
  };

  const zoomTo = (target: number) => {
    scaleRef.current = target;
    lastScale.current = target;
    activePinchScale.current = target;
    Animated.spring(scale, { toValue: target, useNativeDriver: true, bounciness: 8 }).start();
  };

  // Reset transforms whenever the viewer opens or the image changes. The Modal
  // only toggles visibility — without this, the next photo opens at the
  // previous zoom/pan position.
  useEffect(() => {
    if (visible) {
      scaleRef.current = 1;
      lastScale.current = 1;
      activePinchScale.current = 1;
      lastTranslate.current = { x: 0, y: 0 };
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      backdropDimmer.setValue(0);
      lastTapRef.current = null;
    }
  }, [visible, uri, scale, translateX, translateY, backdropDimmer]);

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
          // Scale down slightly as user drags — adds parallax.
          const dragProgress = Math.min(1, gs.dy / SWIPE_DISMISS_DY);
          scale.setValue(1 - dragProgress * 0.08);
          backdropDimmer.setValue(dragProgress);
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
          const isDouble = prev && (now - prev.t) < DOUBLE_TAP_WINDOW_MS;
          if (isDouble) {
            // Toggle: zoomed → out, zoomed-out → in to DOUBLE_TAP_ZOOM.
            // We don't try to zoom to the tap point — keeping it center-zoom
            // matches the simpler iOS Photos behavior and avoids a coordinate
            // math rabbit hole.
            if (newScale > 1) {
              resetTransform();
            } else {
              zoomTo(DOUBLE_TAP_ZOOM);
            }
            lastTapRef.current = null;
            return;
          }
          lastTapRef.current = { t: now, x: gs.x0, y: gs.y0 };
          // Don't reset translate or dimmer for a single tap — nothing changed.
          return;
        }

        if (newScale <= 1) {
          // Swipe-down dismiss — distance OR velocity. The velocity check
          // catches fast flicks that don't travel far enough to clear the
          // distance threshold but feel like deliberate dismiss gestures.
          const dismissByDistance = gs.dy > SWIPE_DISMISS_DY && Math.abs(gs.dx) < 80;
          const dismissByVelocity = gs.vy > FLICK_DISMISS_VY && gs.dy > 0 && Math.abs(gs.dx) < 80;
          if (dismissByDistance || dismissByVelocity) {
            // Continue the throw animation off-screen before closing — feels
            // more physical than instantly snapping closed.
            Animated.parallel([
              Animated.timing(translateY, { toValue: H, duration: 180, useNativeDriver: true }),
              Animated.timing(backdropDimmer, { toValue: 1, duration: 140, useNativeDriver: false }),
            ]).start(() => onClose());
            return;
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFillObject}>
        {/* Backdrop — its own layer so the opacity animation doesn't fight
            with the image's scale/translate. */}
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000', opacity: backdropOpacity }]} />
        <View style={styles.center}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Animated.View
            style={[styles.imageWrap, { transform: [{ scale }, { translateX }, { translateY }] }]}
            {...panResponder.panHandlers}
          >
            <Image source={{ uri }} style={styles.image} contentFit="contain" cachePolicy="memory-disk" />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 6 },
  imageWrap: { width: W, height: H },
  image: { width: '100%', height: '100%' },
});
