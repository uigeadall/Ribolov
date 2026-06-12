import React, { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { useAuth } from '../services/authContext';
import { openComposeSheet } from '../components/composeActions';
import { spacing } from '../theme/typography';

const TAB_META: Record<string, { label: string; on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  FeedTab: { label: 'Лента', on: 'newspaper', off: 'newspaper-outline' },
  MapTab: { label: 'Карта', on: 'map', off: 'map-outline' },
  LogbookTab: { label: 'Дневник', on: 'book', off: 'book-outline' },
  ProfileTab: { label: 'Профил', on: 'person', off: 'person-outline' },
};

function AnimatedTabIcon({ focused, color, icon }: { focused: boolean; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.92)).current;
  const prevFocused = useRef(focused);
  useEffect(() => {
    // Spring with a tiny overshoot on activation — tactile, not jump-cut.
    Animated.spring(scale, {
      toValue: focused ? 1.08 : 0.92,
      useNativeDriver: true,
      speed: 30,
      bounciness: focused ? 14 : 0,
    }).start();
    // Haptic only on activation, skipped on first mount.
    if (prevFocused.current !== focused && focused) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    prevFocused.current = focused;
  }, [focused, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={icon} size={22} color={color} />
    </Animated.View>
  );
}

/**
 * Плътна teal лента с 5 равни слота: Лента, Карта, [+], Дневник, Профил.
 * Централният „+" (бял кръг, повдигнат) отваря compose листа и се показва
 * само при логнат потребител. С 4 таба плюсът е в геометричния център.
 */
export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, configured } = useAuth();
  const showCompose = !!user && configured;

  // Android: лентата не бива да стои върху клавиатурата (custom tab bars не
  // се скриват сами като стандартния).
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const s = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const h = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => { s.remove(); h.remove(); };
  }, []);
  if (keyboardUp) return null;

  const renderTab = (route: (typeof state.routes)[number], index: number) => {
    const meta = TAB_META[route.name];
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    // FishAngler-style solid teal bar: white when active, soft white otherwise.
    const color = focused ? colors.onNavy : 'rgba(255,255,255,0.6)';
    const badge = options.tabBarBadge;

    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params as never);
      }
    };
    const onLongPress = () => {
      navigation.emit({ type: 'tabLongPress', target: route.key });
    };

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? meta.label}
        style={styles.slot}
      >
        <View>
          <AnimatedTabIcon focused={focused} color={color} icon={focused ? meta.on : meta.off} />
          {badge != null ? (
            badge === '·' ? (
              <View style={[styles.dotBadge, { backgroundColor: colors.onNavy, borderColor: colors.accent }]} />
            ) : (
              <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.accent }]}>
                <Text style={styles.badgeText}>{String(badge)}</Text>
              </View>
            )
          ) : null}
        </View>
        <Text style={[styles.label, { color }]}>{meta.label}</Text>
      </Pressable>
    );
  };

  const tabs = state.routes.map(renderTab);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.accent,
          borderTopColor: colors.primaryDark,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        },
      ]}
    >
      {tabs.slice(0, 2)}
      {showCompose ? (
        <View style={styles.slot}>
          <Pressable
            onPress={() => openComposeSheet(navigation)}
            accessibilityRole="button"
            accessibilityLabel="Сподели"
            android_ripple={{ color: `${colors.onAccent}22`, borderless: true, radius: 26 }}
            style={({ pressed }) => [
              styles.compose,
              { backgroundColor: colors.onNavy },
              pressed && Platform.OS === 'ios' && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="add" size={30} color={colors.accent} />
          </Pressable>
        </View>
      ) : null}
      {tabs.slice(2)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: spacing.xs,
  },
  slot: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontSize: 10, fontFamily: 'Manrope_700Bold', lineHeight: 12 },
  compose: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontFamily: 'Manrope_700Bold', lineHeight: 11 },
  dotBadge: {
    position: 'absolute',
    top: -3,
    right: -6,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },
});
