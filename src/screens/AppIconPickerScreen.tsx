import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';
import {
  APP_ICON_VARIANTS,
  changeAppIcon,
  getCurrentAppIcon,
  isAppIconNativeAvailable,
  isAppIconSwitchingSupported,
  type AppIconId,
} from '../services/appIcon';

export default function AppIconPickerScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const supported = isAppIconSwitchingSupported();
  const [current, setCurrent] = useState<AppIconId>('Default');
  const [pending, setPending] = useState<AppIconId | undefined>(undefined);

  useEffect(() => {
    if (supported) setCurrent(getCurrentAppIcon());
  }, [supported]);

  const onPick = useCallback(async (id: AppIconId) => {
    if (id === current || pending !== undefined) return;
    void Haptics.selectionAsync();
    setPending(id);
    const ok = await changeAppIcon(id);
    setPending(undefined);
    if (ok) {
      setCurrent(id);
      // Don't trumpet success — iOS already shows its own confirmation alert
      // for icon changes. A toast on top would feel like nagging.
    } else {
      Toast.show({
        type: 'error',
        text1: 'Не успяхме да сменим иконата',
        text2: 'Опитай отново след малко.',
        position: 'bottom',
        visibilityTime: 2500,
      });
    }
  }, [current, pending]);

  return (
    <Screen padded={false}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Икона на приложението</Text>
        <View style={{ width: 28 }} />
      </View>

      {!supported ? (
        // Distinguishes two failure modes so the message points at the right
        // fix: (a) running on Android — feature not supported there;
        // (b) running on iOS but the native module isn't bundled (Expo Go,
        // or a dev client built before this dependency was added) — needs a
        // fresh native build.
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}>
          {Platform.OS === 'ios' && !isAppIconNativeAvailable() ? (
            <EmptyState
              icon="construct-outline"
              title="Изисква нов билд"
              subtitle="Сменянето на иконата работи само в нов билд на приложението — Expo Go и стари dev билдове не съдържат необходимия нативен код."
            />
          ) : (
            <EmptyState
              icon="phone-portrait-outline"
              title="Само за iOS"
              subtitle="Сменянето на иконата на приложението е достъпно само на iPhone и iPad засега."
            />
          )}
        </View>
      ) : (
        <>
          <Text style={[styles.intro, { color: colors.textMuted }]}>
            Избери иконата, която искаш да виждаш на началния екран. Системата ще покаже потвърждение преди да я приложи.
          </Text>
          <View style={styles.grid}>
            {APP_ICON_VARIANTS.map((v) => {
              const selected = v.id === current;
              const busy = pending === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => { void onPick(v.id); }}
                  disabled={pending !== undefined}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      borderWidth: selected ? 2 : 1,
                      opacity: pending !== undefined && !busy ? 0.5 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${v.name}${selected ? ' (избрана)' : ''}`}
                >
                  <View style={styles.iconWrap}>
                    <Image source={v.preview} style={styles.iconImg} resizeMode="cover" />
                    {selected ? (
                      <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{v.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}

const ICON_SIZE = 88;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...typography.h2, flex: 1, textAlign: 'center' },
  intro: {
    ...typography.body,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    lineHeight: 22,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  card: {
    width: '47%',
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    // Shadow keeps cards from blending into the background on light mode.
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: Platform.OS === 'android' ? 2 : 0,
  },
  iconWrap: { position: 'relative' },
  iconImg: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: 20,
  },
  checkBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  name: { ...typography.bodyBold, textAlign: 'center' },
});
