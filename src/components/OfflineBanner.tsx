import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { spacing, typography } from '../theme/typography';

export function OfflineBanner() {
  const online = useNetworkStatus();
  const slideAnim = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: online ? -40 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [online, slideAnim]);

  return (
    <Animated.View
      style={[styles.bar, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents="none"
    >
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text style={styles.text}>Офлайн — проверете интернет връзката</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
    backgroundColor: '#F59E0B',
    zIndex: 9999,
  },
  text: { ...typography.small, color: '#fff', fontWeight: '600' },
});
