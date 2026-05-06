import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { StarRatingBar } from '../components/StarRatingBar';
import { KNOTS } from '../data/knots';
import type { SpeciesStackParamList } from '../navigation/types';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

type R = RouteProp<SpeciesStackParamList, 'KnotDetail'>;

export default function KnotDetailScreen() {
  const route = useRoute<R>();
  const { colors } = useTheme();
  const k = KNOTS.find((x) => x.id === route.params.id);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        sub: { ...typography.body, color: colors.textMuted, marginTop: 4 },
        row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
        section: { ...typography.overline, color: colors.primary, marginTop: spacing.lg },
        body: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
        step: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
      }),
    [colors]
  );

  if (!k) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Възелът не е намерен.</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              backgroundColor: colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name={k.icon as keyof typeof Ionicons.glyphMap} size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{k.name}</Text>
            {k.alternateName ? <Text style={styles.sub}>{k.alternateName}</Text> : null}
          </View>
        </View>

        <View style={styles.row}>
          <View>
            <Text style={{ ...typography.caption, color: colors.textMuted }}>Сложност</Text>
            <StarRatingBar rating={k.difficulty} color={colors.primary} emptyColor={colors.border} size={14} />
          </View>
          <View>
            <Text style={{ ...typography.caption, color: colors.textMuted }}>Здравина</Text>
            <Text style={{ ...typography.bodyBold, color: colors.text }}>{k.strength}%</Text>
          </View>
        </View>

        <Text style={styles.section}>Описание</Text>
        <Text style={styles.body}>{k.description}</Text>

        <Text style={styles.section}>Стъпки</Text>
        {k.steps.map((s, i) => (
          <Text key={i} style={styles.step}>
            {i + 1}. {s}
          </Text>
        ))}

        <Text style={styles.section}>Съвети</Text>
        {k.tips.map((t, i) => (
          <Text key={i} style={styles.step}>
            • {t}
          </Text>
        ))}

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.caption, color: colors.textMuted }}>Видео търсене</Text>
          <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>{k.videoQuery}</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
