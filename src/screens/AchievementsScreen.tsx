import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { useAuth } from '../services/authContext';
import { computeAchievements, TOTAL_ACHIEVEMENTS } from '../services/achievements';
import { fetchPublicCatchesByOwner } from '../services/cloudSync';
import type { Catch } from '../types';
import { CATEGORY_LABELS, RARITY_COLORS } from '../data/achievements';
import { Achievement, AchievementCategory } from '../types';

const CATEGORY_ORDER: AchievementCategory[] = [
  'quantity',
  'weight',
  'trophy',
  'variety',
  'specialist',
  'release',
  'dedication',
  'geography',
  'journal',
  'social',
];

function createAchievementsStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.lg,
    },
    title: { ...typography.h2, color: colors.text },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    summaryCard: { backgroundColor: colors.card },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    summaryTitle: { ...typography.h2, color: colors.text },
    summarySub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    hint: {
      ...typography.small,
      color: colors.textMuted,
      marginTop: spacing.sm,
      lineHeight: 18,
    },
    progressBar: {
      marginTop: spacing.md,
      height: 8,
      backgroundColor: colors.background,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
    sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    badge: {
      width: '48.5%',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    badgeLocked: { backgroundColor: colors.background, borderColor: colors.border },
    badgeTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    badgeEmoji: { width: 36, height: 36, justifyContent: 'center', alignItems: 'flex-start' },
    rarityChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
    rarityChipText: { color: colors.white, ...typography.small, fontWeight: '700', fontSize: 10, letterSpacing: 0.5 },
    badgeName: { ...typography.bodyBold, color: colors.text, marginTop: spacing.sm, fontSize: 14 },
    badgeDesc: { ...typography.small, color: colors.textMuted, marginTop: 2, minHeight: 28, lineHeight: 14 },
    miniBar: {
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      marginTop: spacing.sm,
      overflow: 'hidden',
    },
    miniBarFill: { height: '100%', backgroundColor: colors.primary },
    badgeProgress: { ...typography.small, color: colors.textMuted, marginTop: 6 },
  });
}

export default function AchievementsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createAchievementsStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const { user, configured } = useAuth();
  const [items, setItems] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let catches: Catch[] = await catchesStore.list();
      // Merge cloud catches so achievements reflect all synced records,
      // not just what's on this device
      if (configured && user) {
        try {
          const cloud = await fetchPublicCatchesByOwner(user.uid, 200);
          const localIds = new Set(catches.map((c) => c.id));
          const onlyCloud = cloud.filter((c) => !localIds.has(c.id)) as unknown as Catch[];
          catches = [...catches, ...onlyCloud];
        } catch {
          // best-effort — local catches still used
        }
      }
      const all = await computeAchievements(catches, {
        firebaseConfigured: configured,
        userLoggedIn: !!user,
      });
      setItems(all);
    } finally {
      setLoading(false);
    }
  }, [configured, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function BadgeCard({ achievement }: { achievement: Achievement }) {
    const colorTheme = RARITY_COLORS[achievement.rarity];
    const pct = Math.min(100, Math.round((achievement.progress / achievement.target) * 100));

    return (
      <View
        style={[
          styles.badge,
          achievement.unlocked
            ? { backgroundColor: colorTheme.bg, borderColor: colorTheme.border }
            : styles.badgeLocked,
        ]}
      >
        <View style={styles.badgeTopRow}>
          <View style={[styles.badgeEmoji, !achievement.unlocked && { opacity: 0.35 }]}>
            <Ionicons
              name={achievement.icon as keyof typeof Ionicons.glyphMap}
              size={32}
              color={achievement.unlocked ? colors.text : colors.textMuted}
            />
          </View>
          <View
            style={[
              styles.rarityChip,
              { backgroundColor: achievement.unlocked ? colorTheme.border : colors.border },
            ]}
          >
            <Text style={styles.rarityChipText}>{colorTheme.label}</Text>
          </View>
        </View>
        <Text style={[styles.badgeName, !achievement.unlocked && { color: colors.textMuted }]} numberOfLines={2}>
          {achievement.name}
        </Text>
        <Text style={styles.badgeDesc} numberOfLines={2}>
          {achievement.description}
        </Text>
        {!achievement.unlocked ? (
          <View style={styles.miniBar}>
            <View style={[styles.miniBarFill, { width: `${pct}%` }]} />
          </View>
        ) : null}
        <Text style={[styles.badgeProgress, achievement.unlocked && { color: colorTheme.text, fontWeight: '700' }]}>
          {achievement.unlocked
            ? 'Отключено'
            : achievement.target === 1
            ? `0 / 1`
            : `${achievement.progress} / ${achievement.target}`}
        </Text>
      </View>
    );
  }

  const unlockedCount = items.filter((a) => a.unlocked).length;
  const progressPct = Math.round((unlockedCount / TOTAL_ACHIEVEMENTS) * 100);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: items.filter((a) => a.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Постижения</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Ionicons name="trophy-outline" size={40} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryTitle}>
                  {unlockedCount} от {TOTAL_ACHIEVEMENTS} отключени
                </Text>
                <Text style={styles.summarySub}>{progressPct}% от всички постижения</Text>
                {configured && user ? (
                  <Text style={styles.hint}>
                    Отключванията се броят само от улов, синхронизирани с облака (след успешен запис в профила).
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
          </Card>

          {grouped.map((group) => (
            <View key={group.category} style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionTitle}>{CATEGORY_LABELS[group.category]}</Text>
              <View style={styles.grid}>
                {group.items.map((a) => (
                  <BadgeCard key={a.id} achievement={a} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
