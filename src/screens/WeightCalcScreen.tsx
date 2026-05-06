import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

/** Груба оценка: тегло (кг) ≈ (дължина см³ × обиколка см²) / 1600 (опростена формула за шараноподобни форми). */
function estimateKg(lengthCm: number, girthCm: number): number | null {
  if (!lengthCm || !girthCm || lengthCm <= 0 || girthCm <= 0) return null;
  const w = (lengthCm ** 3 * girthCm ** 2) / 1_600_000;
  return Math.round(w * 100) / 100;
}

export default function WeightCalcScreen() {
  const { colors } = useTheme();
  const [len, setLen] = useState('');
  const [girth, setGirth] = useState('');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: spacing.md,
          color: colors.text,
          marginBottom: spacing.sm,
          fontSize: 16,
          backgroundColor: colors.card,
        },
        result: { ...typography.h3, color: colors.primary, marginTop: spacing.md },
        hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 20 },
      }),
    [colors]
  );

  const L = parseFloat(len.replace(',', '.'));
  const G = parseFloat(girth.replace(',', '.'));
  const est = estimateKg(L, G);

  return (
    <Screen scroll>
      <Text style={styles.title}>Калкулатор за тегло</Text>
      <Text style={styles.hint}>
        Въведи дължина и обиколка (пред гърдите) в сантиметри. Резултатът е само ориентировъчен.
      </Text>

      <Card style={{ marginTop: spacing.lg }}>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="Дължина (см)"
          placeholderTextColor={colors.textMuted}
          value={len}
          onChangeText={setLen}
        />
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="Обиколка (см)"
          placeholderTextColor={colors.textMuted}
          value={girth}
          onChangeText={setGirth}
        />
        {est != null ? <Text style={styles.result}>Оценка: {est} кг</Text> : null}
      </Card>
    </Screen>
  );
}
