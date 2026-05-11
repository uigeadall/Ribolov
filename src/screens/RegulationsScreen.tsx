import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { GENERAL_REGULATIONS, SIZE_LIMITS, USEFUL_LINKS } from '../data/regulations';

export default function RegulationsScreen() {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState<string | null>(null);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
        disclaimer: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
        sectionTitle: { ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
        sectionHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          padding: spacing.md,
        },
        sectionIcon: { fontSize: 20 },
        sectionLabel: { ...typography.bodyBold, color: colors.text, flex: 1 },
        chevron: { ...typography.body, color: colors.textMuted },
        bullet: {
          ...typography.body,
          color: colors.text,
          lineHeight: 22,
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.sm,
        },
        sizeRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          paddingVertical: spacing.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        },
        speciesName: { ...typography.bodyBold, color: colors.text, flex: 1 },
        sizeChip: {
          backgroundColor: colors.primarySurface,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.sm,
          paddingVertical: 3,
          borderWidth: 1,
          borderColor: colors.border,
        },
        sizeChipText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
        banText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
        linkBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          padding: spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        linkLabel: { ...typography.body, color: colors.primary, flex: 1 },
      }),
    [colors]
  );

  return (
    <Screen scroll padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.title}>Правила и забрани</Text>
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.disclaimer}>
            Информацията е справочна и не замества официалните актове на ИАРА. Проверявайте
            действащите заповеди и правилата на конкретния водоем преди всеки излет.
          </Text>
        </Card>

        {/* Accordion sections */}
        {GENERAL_REGULATIONS.map((section) => (
          <Card key={section.id} style={{ marginBottom: spacing.sm, padding: 0, overflow: 'hidden' }}>
            <Pressable
              style={styles.sectionHeader}
              onPress={() => setExpanded(expanded === section.id ? null : section.id)}
            >
              <Text style={styles.sectionIcon}>{section.icon}</Text>
              <Text style={styles.sectionLabel}>{section.title}</Text>
              <Text style={styles.chevron}>{expanded === section.id ? '▲' : '▼'}</Text>
            </Pressable>
            {expanded === section.id
              ? section.items.map((item, i) => (
                  <Text key={i} style={styles.bullet}>• {item}</Text>
                ))
              : null}
          </Card>
        ))}

        {/* Size limits table */}
        <Text style={styles.sectionTitle}>Минимални размери</Text>
        <Card>
          {SIZE_LIMITS.map((sl, i) => (
            <View key={i} style={styles.sizeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.speciesName}>{sl.speciesName}</Text>
                {sl.banPeriod ? (
                  <Text style={styles.banText}>🚫 {sl.banPeriod}{sl.note ? ` — ${sl.note}` : ''}</Text>
                ) : null}
              </View>
              <View style={styles.sizeChip}>
                <Text style={styles.sizeChipText}>≥ {sl.minSizeCm} см</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Links */}
        <Text style={styles.sectionTitle}>Официални източници</Text>
        <Card style={{ padding: 0 }}>
          {USEFUL_LINKS.map((link, i) => (
            <Pressable key={i} style={styles.linkBtn} onPress={() => Linking.openURL(link.url).catch(() => {})}>
              <Text style={styles.linkLabel}>{link.label}</Text>
              <Text style={{ color: colors.textMuted }}>↗</Text>
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}
