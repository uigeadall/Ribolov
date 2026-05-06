import React, { useMemo } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { Achievement } from '../types';
import { RARITY_COLORS } from '../data/achievements';

type Props = {
  visible: boolean;
  achievements: Achievement[];
  onClose: () => void;
};

function createAchievementUnlockStyles(colors: AppColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      backgroundColor: colors.background,
      borderRadius: radius.xl,
      padding: spacing.xl,
      width: '100%',
      maxWidth: 400,
      alignItems: 'stretch',
    },
    unlockBadge: {
      alignSelf: 'center',
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: { ...typography.h2, color: colors.text, textAlign: 'center', marginBottom: spacing.lg },
    achievement: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 2,
      marginBottom: spacing.sm,
    },
    badgeIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.35)',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { ...typography.bodyBold, fontSize: 16, flex: 1 },
    desc: { ...typography.caption, color: colors.text, marginTop: 4 },
    rarityChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
    rarityText: { color: colors.white, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    btnText: { color: colors.white, ...typography.bodyBold, fontSize: 16 },
  });
}

export function AchievementUnlockModal({ visible, achievements, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createAchievementUnlockStyles(colors), [colors]);
  if (achievements.length === 0) return null;
  const isMulti = achievements.length > 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.unlockBadge}>
            <Ionicons name="trophy-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.title}>
            {isMulti ? `${achievements.length} нови постижения!` : 'Ново постижение!'}
          </Text>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {achievements.map((a) => {
              const theme = RARITY_COLORS[a.rarity];
              return (
                <View
                  key={a.id}
                  style={[styles.achievement, { backgroundColor: theme.bg, borderColor: theme.border }]}
                >
                  <View style={styles.badgeIconWrap}>
                    <Ionicons name={a.icon as keyof typeof Ionicons.glyphMap} size={26} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.row}>
                      <Text style={[styles.name, { color: theme.text }]}>{a.name}</Text>
                      <View style={[styles.rarityChip, { backgroundColor: theme.border }]}>
                        <Text style={styles.rarityText}>{theme.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.desc}>{a.description}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Pressable onPress={onClose} style={styles.btn}>
            <Text style={styles.btnText}>Готово</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
