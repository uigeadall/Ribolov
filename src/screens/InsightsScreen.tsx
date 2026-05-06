import React, { useMemo } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

export default function InsightsScreen() {
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
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.title}>Инсайти</Text>
        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.body}>
            Тук ще се появят препоръки по сезонност, метеорология и твоите последни улови, когато свържем по-пълна аналитика с
            облака.
          </Text>
          <Text style={[styles.body, { marginTop: spacing.md }]}>
            Дотогава ползвай картата за прогноза и лентата за това какво хващат други на близки водоеми.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
