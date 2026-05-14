import React, { useEffect, useRef } from 'react';
import { RefreshControl, RefreshControlProps, Animated, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../services/themeContext';

export function FishingRefreshControl(props: RefreshControlProps) {
  const { colors } = useTheme();
  const { refreshing, ...rest } = props;

  const bobAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (refreshing) {
      // Scale in
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 100, friction: 8 }).start();
      // Bob loop
      Animated.loop(
        Animated.sequence([
          Animated.timing(bobAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(bobAnim, { toValue: -1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.timing(scaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      bobAnim.stopAnimation();
      bobAnim.setValue(0);
    }
  }, [refreshing]);

  const rotate = bobAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-15deg', '15deg'] });

  return (
    <>
      {refreshing && (
        <Animated.View style={[styles.fishContainer, {
          transform: [{ scale: scaleAnim }, { rotate }],
        }]}>
          <Animated.Text style={styles.fish}>🎣</Animated.Text>
        </Animated.View>
      )}
      <RefreshControl
        refreshing={refreshing}
        tintColor={Platform.OS === 'ios' ? colors.primary : undefined}
        colors={Platform.OS === 'android' ? [colors.primary, colors.accent] : undefined}
        progressBackgroundColor={Platform.OS === 'android' ? colors.card : undefined}
        {...rest}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fishContainer: {
    position: 'absolute',
    top: -52,
    alignSelf: 'center',
    zIndex: 10,
  },
  fish: {
    fontSize: 28,
  },
});
