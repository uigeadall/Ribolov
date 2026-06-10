import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '../storage/kv';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { spacing, typography, radius } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';

const STORAGE_KEY = '@ribolov/onboardingChecklistDismissed';

type Step = {
  key: 'photo' | 'catch' | 'follow';
  done: boolean;
  title: string;
  cta: string;
  onPress: () => void;
};

type Props = {
  hasProfilePhoto: boolean;
  catchCount: number;
  followingCount: number;
};

export function OnboardingChecklist({ hasProfilePhoto, catchCount, followingCount }: Props) {
  const { colors, mode } = useTheme();
  const navigation = useAppNavigation();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => setDismissed(v === '1')).catch(() => setDismissed(false));
  }, []);

  const steps: Step[] = useMemo(() => [
    {
      key: 'photo',
      done: hasProfilePhoto,
      title: 'Добави профилна снимка',
      cta: 'Към профила',
      onPress: () => navigation.navigate('ProfileTab', { screen: 'ProfileMain' }),
    },
    {
      key: 'catch',
      done: catchCount > 0,
      title: 'Запиши първия си улов',
      cta: 'Добави улов',
      onPress: () => (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} }),
    },
    {
      key: 'follow',
      done: followingCount > 0,
      title: 'Последвай първия рибар',
      cta: 'Намери приятели',
      onPress: () => navigation.navigate('ProfileTab', { screen: 'Friends' }),
    },
  ], [hasProfilePhoto, catchCount, followingCount, navigation]);

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const nextStep = steps.find((s) => !s.done);

  // Auto-dismiss once everything is done so it disappears from the screen.
  useEffect(() => {
    if (allDone && dismissed === false) {
      AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
      setDismissed(true);
    }
  }, [allDone, dismissed]);

  const styles = useMemo(() => StyleSheet.create({
    // Flat hairline card per the home dark-premium language (no gradient/shadow).
    wrapper: {
      marginHorizontal: spacing.xl,
      marginBottom: spacing.xl,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    inner: { padding: spacing.md + 2 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: spacing.md,
    },
    kicker: {
      fontSize: 10,
      fontFamily: 'Nunito_700Bold',
      color: colors.primary,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
    },
    title: {
      fontSize: 17,
      fontFamily: 'Nunito_800ExtraBold',
      color: colors.text,
      marginTop: 2,
    },
    progress: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    dismissBtn: {
      width: 28, height: 28, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    // Progress bar
    progressBar: {
      height: 4,
      borderRadius: 2,
      backgroundColor: mode === 'dark' ? 'rgba(78,174,224,0.12)' : 'rgba(21,112,184,0.10)',
      overflow: 'hidden',
      marginBottom: spacing.md,
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    stepsList: { gap: spacing.sm },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    stepCheck: {
      width: 22, height: 22, borderRadius: 11,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5,
    },
    stepCheckDone: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    stepCheckTodo: {
      backgroundColor: 'transparent',
      borderColor: colors.border,
    },
    stepText: {
      fontSize: 14,
      fontFamily: 'Nunito_600SemiBold',
      color: colors.text,
      flex: 1,
    },
    stepTextDone: {
      color: colors.textMuted,
      textDecorationLine: 'line-through' as const,
    },
    nextCta: {
      marginTop: spacing.md,
      paddingVertical: 11,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    nextCtaText: {
      color: '#fff',
      fontFamily: 'Nunito_800ExtraBold',
      fontSize: 14,
    },
  }), [colors, mode]);

  if (dismissed !== false || allDone) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Готово</Text>
            <Text style={styles.title}>Стани активен рибар</Text>
            <Text style={styles.progress}>
              {completedCount} от {steps.length} стъпки завършени
            </Text>
          </View>
          <Pressable
            style={styles.dismissBtn}
            onPress={() => {
              void Haptics.selectionAsync();
              AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
              setDismissed(true);
            }}
            hitSlop={6}
            accessibilityLabel="Скрий"
          >
            <Ionicons name="close" size={14} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(completedCount / steps.length) * 100}%` }]} />
        </View>

        <View style={styles.stepsList}>
          {steps.map((s) => (
            <View key={s.key} style={styles.step}>
              <View style={[styles.stepCheck, s.done ? styles.stepCheckDone : styles.stepCheckTodo]}>
                {s.done ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
              </View>
              <Text style={[styles.stepText, s.done && styles.stepTextDone]}>{s.title}</Text>
            </View>
          ))}
        </View>

        {nextStep ? (
          <Pressable style={styles.nextCta} onPress={() => { void Haptics.selectionAsync(); nextStep.onPress(); }}>
            <Text style={styles.nextCtaText}>{nextStep.cta}</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
