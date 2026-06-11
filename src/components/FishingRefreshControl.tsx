import React, { useCallback, useEffect, useRef } from 'react';
import { RefreshControl, RefreshControlProps, Animated, StyleSheet, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';

export function FishingRefreshControl(props: RefreshControlProps) {
  const { colors } = useTheme();
  const { refreshing, onRefresh, ...rest } = props;

  // Wrap the caller's onRefresh with a Light haptic. Centralized here so every
  // screen using this component gets the tactile feedback for free — fixes the
  // inconsistency where ChatsScreen and NotificationsScreen had it inline but
  // FeedScreen / StatsScreen / LogbookScreen / SavedPostsScreen / GroupsScreen
  // / ExploreScreen did not.
  const handleRefresh = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRefresh?.();
  }, [onRefresh]);

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
          transform: [{ scale: scaleAnim }],
        }]}>
          <Animated.Text style={[styles.fish, { transform: [{ rotate }] }]}>🎣</Animated.Text>
          {/* Caption so the user knows it's working on a slow connection,
              not stuck. Lives inside the scaling container so it fades in
              and out with the fish. Not rotated — only the fish bobs. */}
          <Animated.Text style={[styles.caption, { color: colors.textMuted }]}>
            Зареждам…
          </Animated.Text>
        </Animated.View>
      )}
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
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
    top: -60,
    alignSelf: 'center',
    zIndex: 10,
    alignItems: 'center',
  },
  fish: {
    fontSize: 28,
  },
  caption: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    marginTop: 2,
    letterSpacing: 0.2,
  },
});
