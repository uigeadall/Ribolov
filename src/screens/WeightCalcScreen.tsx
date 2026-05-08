import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

// Fulton condition factor K: W(kg) = K × L(cm)^3 / 100_000
const FISH_SPECIES = [
  { id: 'sharan',   name: 'Шаран',              K: 3.4,  minCm: 35,  emoji: '🐟' },
  { id: 'karakuda', name: 'Каракуда',            K: 3.0,  minCm: 20,  emoji: '🐡' },
  { id: 'amur',     name: 'Бял амур',            K: 2.2,  minCm: 40,  emoji: '🐟' },
  { id: 'tolsto',   name: 'Толстолоб',           K: 2.8,  minCm: 40,  emoji: '🐟' },
  { id: 'lin',      name: 'Линь',                K: 3.2,  minCm: 20,  emoji: '🐠' },
  { id: 'som',      name: 'Сом',                 K: 1.5,  minCm: 70,  emoji: '🐟' },
  { id: 'shtuka',   name: 'Щука',                K: 0.55, minCm: 40,  emoji: '🦈' },
  { id: 'kostur',   name: 'Костур',              K: 2.5,  minCm: 15,  emoji: '🐠' },
  { id: 'pastrava', name: 'Поточна пъстърва',    K: 0.9,  minCm: 22,  emoji: '🐡' },
  { id: 'dagova',   name: 'Дъгова пъстърва',     K: 1.0,  minCm: 25,  emoji: '🐡' },
  { id: 'mryana',   name: 'Мряна',               K: 1.6,  minCm: 30,  emoji: '🐟' },
  { id: 'klen',     name: 'Клен',                K: 1.8,  minCm: 25,  emoji: '🐟' },
] as const;

type Mode = 'lengthToWeight' | 'weightToLength';

function lengthToWeight(K: number, cm: number): number {
  return (K * cm ** 3) / 100_000;
}
function weightToLength(K: number, kg: number): number {
  return Math.cbrt((kg * 100_000) / K);
}

export default function WeightCalcScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string>('sharan');
  const [mode, setMode] = useState<Mode>('lengthToWeight');
  const [input, setInput] = useState('');

  const species = FISH_SPECIES.find((s) => s.id === selectedId) ?? FISH_SPECIES[0];
  const val = parseFloat(input.replace(',', '.'));

  const result = useMemo(() => {
    if (!val || val <= 0) return null;
    if (mode === 'lengthToWeight') return { value: lengthToWeight(species.K, val), unit: 'кг' };
    return { value: weightToLength(species.K, val), unit: 'см' };
  }, [val, mode, species]);

  const isLegal = useMemo(() => {
    if (!val || val <= 0) return null;
    if (mode === 'lengthToWeight') return val >= species.minCm;
    // weight → length: check computed length
    const len = weightToLength(species.K, val);
    return len >= species.minCm;
  }, [val, mode, species]);

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    headerTitle: { ...typography.h2, color: colors.text, flex: 1 },
    sectionLabel: { ...typography.overline, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
    speciesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    speciesChip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, borderWidth: 1.5,
      borderColor: colors.border, backgroundColor: colors.card,
      flexDirection: 'row', alignItems: 'center', gap: 5,
    },
    speciesChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    speciesChipText: { ...typography.small, color: colors.textMuted, fontWeight: '700' },
    speciesChipTextActive: { color: colors.primary },
    modeToggle: {
      flexDirection: 'row', backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md, padding: 3,
    },
    modeItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md - 2 },
    modeActive: { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
    modeText: { ...typography.small, fontWeight: '700', color: colors.textMuted },
    modeTextActive: { color: colors.text },
    inputBox: {
      borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
      fontSize: 22, fontWeight: '700', color: colors.text,
      backgroundColor: colors.card, textAlign: 'center',
    },
    inputBoxFocused: { borderColor: colors.primary },
    unit: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
    resultCard: {
      borderRadius: radius.xl, padding: spacing.lg,
      backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', gap: spacing.xs,
    },
    resultLabel: { ...typography.small, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.5 },
    resultValue: { fontSize: 42, fontWeight: '800', color: colors.primary, letterSpacing: -1 },
    resultUnit: { ...typography.body, color: colors.textMuted },
    legalRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.md, marginTop: spacing.sm,
    },
    legalText: { ...typography.small, fontWeight: '700' },
    hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18, textAlign: 'center' },
  }), [colors]);

  const inputUnit = mode === 'lengthToWeight' ? 'см' : 'кг';
  const outputLabel = mode === 'lengthToWeight' ? 'ПРИБЛИЗИТЕЛНО ТЕГЛО' : 'ПРИБЛИЗИТЕЛНА ДЪЛЖИНА';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Калкулатор за размер</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Species picker */}
        <View>
          <Text style={styles.sectionLabel}>ВИД РИБА</Text>
          <View style={styles.speciesGrid}>
            {FISH_SPECIES.map((sp) => (
              <Pressable
                key={sp.id}
                style={[styles.speciesChip, selectedId === sp.id && styles.speciesChipActive]}
                onPress={() => setSelectedId(sp.id)}
              >
                <Text style={{ fontSize: 14 }}>{sp.emoji}</Text>
                <Text style={[styles.speciesChipText, selectedId === sp.id && styles.speciesChipTextActive]}>
                  {sp.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Mode toggle */}
        <View>
          <Text style={styles.sectionLabel}>ИЗЧИСЛИ ПО</Text>
          <View style={styles.modeToggle}>
            {([
              { value: 'lengthToWeight', label: 'Дължина → Тегло' },
              { value: 'weightToLength', label: 'Тегло → Дължина' },
            ] as { value: Mode; label: string }[]).map((m) => (
              <Pressable
                key={m.value}
                style={[styles.modeItem, mode === m.value && styles.modeActive]}
                onPress={() => { setMode(m.value); setInput(''); }}
              >
                <Text style={[styles.modeText, mode === m.value && styles.modeTextActive]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Input */}
        <View>
          <Text style={styles.sectionLabel}>ВЪВЕДИ {mode === 'lengthToWeight' ? 'ДЪЛЖИНА' : 'ТЕГЛО'}</Text>
          <TextInput
            style={styles.inputBox}
            keyboardType="decimal-pad"
            placeholder={`0  ${inputUnit}`}
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
          />
          <Text style={styles.unit}>в {inputUnit === 'см' ? 'сантиметри' : 'килограми'}</Text>
        </View>

        {/* Result */}
        {result ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>{outputLabel}</Text>
            <Text style={styles.resultValue}>
              {result.value < 10 ? result.value.toFixed(2) : result.value.toFixed(1)}
            </Text>
            <Text style={styles.resultUnit}>{result.unit}</Text>

            {isLegal !== null ? (
              <View style={[styles.legalRow, { backgroundColor: isLegal ? 'rgba(46,155,90,0.12)' : 'rgba(192,57,43,0.12)' }]}>
                <Ionicons name={isLegal ? 'checkmark-circle' : 'close-circle'} size={16} color={isLegal ? '#2E9B5A' : '#c0392b'} />
                <Text style={[styles.legalText, { color: isLegal ? '#2E9B5A' : '#c0392b' }]}>
                  {isLegal
                    ? `Над мин. размер (${species.minCm} см)`
                    : `Под мин. размер (${species.minCm} см) — върни я!`}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Hint */}
        <Text style={styles.hint}>
          Формулата е базирана на коефициента на Фултон (K = {species.K}) за {species.name.toLowerCase()}.
          Резултатите са ориентировъчни — теглото варира с условието на рибата.
        </Text>
      </ScrollView>
    </View>
  );
}
