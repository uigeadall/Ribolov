import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

type BanInfo = { active: boolean; from?: string; to?: string; note?: string };

type Props = {
  speciesName: string;
  banInfo: BanInfo;
};

export function BanPeriodCard({ speciesName, banInfo }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
          backgroundColor: colors.danger + '15',
          borderRadius: radius.md,
          padding: spacing.md,
          marginTop: spacing.md,
          borderWidth: 1,
          borderColor: colors.danger + '44',
        },
        title: { ...typography.bodyBold, color: colors.danger },
        text: { ...typography.caption, color: colors.danger, marginTop: 2 },
      }),
    [colors]
  );

  if (!banInfo.active) return null;

  return (
    <View style={styles.card}>
      <Ionicons name="warning" size={20} color="#9C2222" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Забранен период!</Text>
        <Text style={styles.text}>
          {speciesName} е със забрана от {banInfo.from} до {banInfo.to}.
          {banInfo.note ? ` (${banInfo.note})` : ''} Уловената риба трябва да се пусне обратно.
        </Text>
      </View>
    </View>
  );
}
