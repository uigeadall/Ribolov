import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';

/** A single tappable row in the action sheet. */
export type ActionSheetOption = {
  label: string;
  onPress: () => void;
  /** Renders the row in danger-red. Use sparingly — one per sheet, max. */
  destructive?: boolean;
  /** Optional Ionicon name shown on the left. */
  icon?: keyof typeof Ionicons.glyphMap;
};

export type ActionSheetConfig = {
  title?: string;
  message?: string;
  options: ActionSheetOption[];
  /** Cancel button label. Defaults to 'Отказ'. Pass null to omit. */
  cancelLabel?: string | null;
};

// ─── Imperative API ──────────────────────────────────────────────────────────
//
// We expose a module-level `show()` so call sites don't have to manage
// visibility state. The single `ActionSheetHost` mounted at the App root
// listens via an exposed `setActive` setter. This matches the ergonomics
// of `Alert.alert(...)` and `ActionSheetIOS.showActionSheetWithOptions(...)`,
// which is what every existing call site already uses.

type Setter = (cfg: ActionSheetConfig | null) => void;
let hostSetter: Setter | null = null;

export const ActionSheet = {
  show(cfg: ActionSheetConfig) {
    if (!hostSetter) {
      // Host not mounted (yet). Fail silently — the caller can't really do
      // anything useful here, and this is rare enough that throwing would
      // crash legit code paths during the brief mount window.
      if (__DEV__) console.warn('[ActionSheet] host not mounted; show() ignored');
      return;
    }
    hostSetter(cfg);
  },
  hide() {
    hostSetter?.(null);
  },
};

// ─── Host component ──────────────────────────────────────────────────────────

export function ActionSheetHost() {
  const [active, setActive] = useState<ActionSheetConfig | null>(null);
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    hostSetter = setActive;
    return () => {
      hostSetter = null;
    };
  }, []);

  // Slide-up animation. We don't use Modal's animationType because the
  // built-in 'slide' animates the whole transparent container, including
  // the dimmed backdrop, which makes the fade feel sluggish on iPad.
  const translateY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      void Haptics.selectionAsync();
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 18,
          bounciness: 0,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 400,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [active, translateY, backdropOpacity]);

  const styles = useMemo(() => createStyles(colors, mode), [colors, mode]);

  // Track the deferred-onPress timer so we can cancel it if the host unmounts
  // (or the sheet is shown/hidden again) within the 50 ms window. Otherwise
  // the timer could fire `opt.onPress()` against a stale closure / unmounted
  // screen.
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  const onClose = () => {
    setActive(null);
  };

  const onPickOption = (opt: ActionSheetOption) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Close before firing the callback so the sheet's exit animation isn't
    // racing the navigation/state change the callback triggers.
    setActive(null);
    // setTimeout deferral so the close animation can start before the
    // callback's potentially-heavy work (navigation, network fetch) kicks
    // in on the JS thread.
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      opt.onPress();
    }, 50);
  };

  return (
    <Modal visible={!!active} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} pointerEvents="auto">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Затвори"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.sm, transform: [{ translateY }] },
          ]}
        >
          {/* Drag handle for visual affordance — actual pan-to-dismiss not
              wired (yet); tap-outside-to-close covers the dismissal need. */}
          <View style={styles.handle} />

          {active?.title ? <Text style={styles.title}>{active.title}</Text> : null}
          {active?.message ? <Text style={styles.message}>{active.message}</Text> : null}

          <View style={styles.optionGroup}>
            {active?.options.map((opt, i) => (
              <Pressable
                key={`${opt.label}-${i}`}
                onPress={() => onPickOption(opt)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                style={({ pressed }) => [
                  styles.optionRow,
                  i > 0 ? styles.optionRowDivider : null,
                  pressed ? styles.optionRowPressed : null,
                ]}
              >
                {opt.icon ? (
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={opt.destructive ? colors.danger : colors.primary}
                    style={{ marginRight: spacing.md }}
                  />
                ) : null}
                <Text
                  style={[
                    styles.optionLabel,
                    opt.destructive ? styles.optionLabelDestructive : null,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {active?.cancelLabel !== null ? (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={active?.cancelLabel ?? 'Отказ'}
              style={({ pressed }) => [styles.cancelRow, pressed ? styles.cancelRowPressed : null]}
            >
              <Text style={styles.cancelLabel}>{active?.cancelLabel ?? 'Отказ'}</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function createStyles(colors: AppColors, mode: 'dark' | 'light') {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.md,
      // Subtle elevation so it lifts off the backdrop on Android too.
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: mode === 'dark' ? 0.5 : 0.15,
          shadowRadius: 16,
        },
        android: { elevation: 12 },
      }),
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginBottom: spacing.md,
    },
    title: {
      ...typography.h3,
      color: colors.text,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
      marginBottom: spacing.xs,
    },
    message: {
      ...typography.caption,
      color: colors.textMuted,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    optionGroup: {
      marginTop: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: 16,
    },
    optionRowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    optionRowPressed: {
      backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    },
    optionLabel: {
      ...typography.bodyBold,
      color: colors.text,
      flex: 1,
    },
    optionLabelDestructive: {
      color: colors.danger,
    },
    cancelRow: {
      marginTop: spacing.sm,
      paddingVertical: 16,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    cancelRowPressed: {
      opacity: 0.6,
    },
    cancelLabel: {
      ...typography.bodyBold,
      color: colors.textMuted,
    },
  });
}
