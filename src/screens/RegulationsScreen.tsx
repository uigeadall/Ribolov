import React, { useMemo } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

export default function RegulationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        body: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
      }),
    [colors]
  );

  return (
    <Screen scroll padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.title}>Нормативна основа</Text>
        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.body}>
            Информацията в приложението не замества официалните актове на ИАРА и правилата на конкретния воден обект
            (платен риболов, забрани, квоти).
          </Text>
          <Text style={[styles.body, { marginTop: spacing.md }]}>
            Винаги проверявай действащите размери, сезони и разрешени методи преди да ловиш — особено около размножителни
            периоди и при особени режими на водоема.
          </Text>
          <Text style={[styles.body, { marginTop: spacing.md }]}>
            При улова спазвай доброволното връщане на несъответстващи по размер риби и опазването на средата.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
