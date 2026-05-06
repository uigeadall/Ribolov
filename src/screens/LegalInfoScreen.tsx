import React, { useMemo } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

export default function LegalInfoScreen() {
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
        <Text style={styles.title}>Правна информация</Text>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={{ ...typography.bodyBold, color: colors.text }}>Приложение „Риболов“</Text>
          <Text style={styles.body}>
            Приложението е с информационна цел. Авторите не носят отговорност за решения, взети на база прогнози, данни за видове
            или социално споделено съдържание.
          </Text>
          <Text style={styles.body}>
            Локационни услуги и качване на снимки изискват съответните разрешения от операционната система. Данните в облака се
            обработват според правилата на избрания от теб доставчик (Firebase и свързани услуги).
          </Text>
          <Text style={styles.body}>
            При изтриване на акаунт се прави опит за изчистване на свързани записи в базата съгласно имплементацията в приложението.
            Запазени резервни копия при доставчици може да изискват отделни процедури.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
