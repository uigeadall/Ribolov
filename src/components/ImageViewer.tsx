import React, { useRef } from 'react';
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

export function ImageViewer({ uri, visible, onClose }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const scaleRef = useRef(1);
  const lastScale = useRef(1);

  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastTranslate = useRef({ x: 0, y: 0 });

  const resetTransform = () => {
    scaleRef.current = 1;
    lastScale.current = 1;
    lastTranslate.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  };

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
          // Pinch
          const t1 = touches[0];
          const t2 = touches[1];
          const dist = Math.sqrt(
            Math.pow(t1.pageX - t2.pageX, 2) + Math.pow(t1.pageY - t2.pageY, 2)
          );
          if (!(panResponder as any)._startDist) {
            (panResponder as any)._startDist = dist;
            (panResponder as any)._startScale = scaleRef.current;
          }
          const newScale = Math.max(1, Math.min(4, (panResponder as any)._startScale * (dist / (panResponder as any)._startDist)));
          scale.setValue(newScale - scaleRef.current + 1);
        } else if (scaleRef.current > 1) {
          // Pan when zoomed
          translateX.setValue(gs.dx);
          translateY.setValue(gs.dy);
        }
      },

      onPanResponderRelease: (_, gs) => {
        (panResponder as any)._startDist = null;
        scale.flattenOffset();
        translateX.flattenOffset();
        translateY.flattenOffset();

        const newScale = Math.max(1, Math.min(4, scaleRef.current));
        scaleRef.current = newScale;
        lastScale.current = newScale;
        lastTranslate.current = {
          x: lastTranslate.current.x + gs.dx,
          y: lastTranslate.current.y + gs.dy,
        };

        if (newScale <= 1) {
          // Snap back if swiped down while not zoomed
          if (gs.dy > 100 && Math.abs(gs.dx) < 80) {
            onClose();
            return;
          }
          resetTransform();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={styles.backdrop}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 6 },
  imageWrap: { width: W, height: H },
  image: { width: '100%', height: '100%' },
});
