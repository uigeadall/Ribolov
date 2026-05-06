import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';

export type BarItem = { label: string; value: number; subLabel?: string };

type Props = {
  data: BarItem[];
  height?: number;
  barColor?: string;
  showValues?: boolean;
  scrollable?: boolean;
};

function createBarChartStyles(colors: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
    col: { flex: 1, alignItems: 'center' },
    barWrap: { width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
    bar: { width: '70%', borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
    value: { ...typography.small, color: colors.textMuted, marginBottom: 2, fontWeight: '600' },
    label: { ...typography.small, color: colors.textMuted, marginTop: 6 },
    subLabel: { ...typography.small, color: colors.textMuted, fontSize: 10 },
  });
}

export function BarChart({
  data,
  height = 140,
  barColor,
  showValues = true,
  scrollable = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createBarChartStyles(colors), [colors]);
  const resolvedBarColor = barColor ?? colors.primary;
  const max = Math.max(...data.map((d) => d.value), 1);

  const content = (
    <View style={[styles.row, scrollable && { paddingHorizontal: spacing.sm }]}>
      {data.map((item, idx) => {
        const ratio = item.value / max;
        const barH = Math.max(2, Math.round(ratio * (height - 36)));
        return (
          <View key={`${item.label}-${idx}`} style={[styles.col, scrollable && { width: 38 }]}>
            <View style={[styles.barWrap, { height: height - 36 }]}>
              {showValues && item.value > 0 ? <Text style={styles.value}>{item.value}</Text> : null}
              <View
                style={[
                  styles.bar,
                  { height: barH, backgroundColor: item.value === 0 ? colors.border : resolvedBarColor },
                ]}
              />
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {item.label}
            </Text>
            {item.subLabel ? <Text style={styles.subLabel}>{item.subLabel}</Text> : null}
          </View>
        );
      })}
    </View>
  );

  return scrollable ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {content}
    </ScrollView>
  ) : (
    content
  );
}
