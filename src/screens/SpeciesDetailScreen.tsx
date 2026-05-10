import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { SectionHeader } from '../components/SectionHeader';
import { speciesList } from '../data/species';
import { imageHeadersForUrl, speciesPhotos } from '../data/speciesPhotos';
import type { SpeciesStackParamList } from '../navigation/types';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';

type R = RouteProp<SpeciesStackParamList, 'SpeciesDetail'>;

function createDetailStyles(colors: AppColors, mode: 'light' | 'dark') {
  return StyleSheet.create({
    heroCard: {
      overflow: 'hidden',
    },
    heroImage: {
      width: '100%',
      height: 228,
      backgroundColor: colors.surfaceAlt,
    },
    photoCredit: {
      ...typography.small,
      color: colors.textMuted,
      lineHeight: 18,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    heroBody: {
      padding: spacing.lg + 4,
    },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    heroIconWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.lg,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    heroTexts: { flex: 1, minWidth: 0 },
    heroTitle: { ...typography.h2, fontSize: 24, color: colors.text, letterSpacing: -0.4 },
    heroLatin: {
      ...typography.body,
      color: colors.textMuted,
      marginTop: spacing.xs,
      fontStyle: 'italic',
      lineHeight: 22,
    },
    heroMeta: {
      ...typography.caption,
      color: colors.primary,
      marginTop: spacing.sm,
      fontWeight: '600',
    },
    infoCardRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    infoIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoCardTitle: { ...typography.bodyBold, color: colors.text, fontSize: 16 },
    infoCardBody: {
      ...typography.body,
      color: colors.text,
      marginTop: spacing.sm,
      lineHeight: 24,
    },
    banCard: {
      borderLeftWidth: 4,
      borderLeftColor: colors.warning,
      backgroundColor: mode === 'dark' ? 'rgba(232,197,71,0.12)' : 'rgba(232,168,58,0.14)',
    },
    banTitle: { ...typography.bodyBold, color: colors.warning, fontSize: 16 },
    sectionBodyCard: {
      marginTop: spacing.sm,
      paddingVertical: spacing.md + 4,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
    },
    bodyText: { ...typography.body, color: colors.text, lineHeight: 24 },
    sectionBlock: {
      marginTop: spacing.lg,
    },
  });
}

type SectionProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  styles: ReturnType<typeof createDetailStyles>;
};

function ArticleSection({ title, subtitle, children, styles }: SectionProps) {
  return (
    <View style={styles.sectionBlock}>
      <SectionHeader title={title} subtitle={subtitle} />
      <Card style={styles.sectionBodyCard}>
        <Text style={styles.bodyText}>{children}</Text>
      </Card>
    </View>
  );
}

export default function SpeciesDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createDetailStyles(colors, mode), [colors, mode]);
  const sp = speciesList.find((x) => x.id === route.params.id);
  const photo = sp ? speciesPhotos[sp.id] : undefined;

  if (!sp) {
    return (
      <Screen padded={false}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl }}>
          <EmptyState icon="alert-circle-outline" title="Видът не е намерен" subtitle="Може да е премахнат или линкът е стар." />
          <Button title="Назад към видовете" variant="secondary" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.sm,
          paddingBottom: spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Card style={[styles.heroCard, { marginBottom: spacing.md }]}>
          {photo ? (
            <>
              <Image
                source={{ uri: photo.url, headers: imageHeadersForUrl(photo.url) }}
                style={styles.heroImage}
                contentFit="cover"
                transition={220}
              />
              <Text style={styles.photoCredit}>Снимка: {photo.credit}</Text>
            </>
          ) : null}
          <View style={styles.heroBody}>
            <View style={styles.heroRow}>
              {!photo ? (
                <View style={styles.heroIconWrap}>
                  <Ionicons name="fish" size={32} color={colors.primary} />
                </View>
              ) : null}
              <View style={styles.heroTexts}>
                <Text style={styles.heroTitle}>{sp.nameBg}</Text>
                <Text style={styles.heroLatin}>{sp.nameLatin}</Text>
                {sp.maxWeightKg != null ? (
                  <Text style={styles.heroMeta}>Документирано до ~{sp.maxWeightKg} кг</Text>
                ) : null}
              </View>
            </View>
          </View>
        </Card>

        {sp.minSizeCm != null ? (
          <Card style={{ marginBottom: spacing.md }}>
            <View style={styles.infoCardRow}>
              <View style={styles.infoIconCircle}>
                <Ionicons name="resize-outline" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoCardTitle}>Минимален размер за улов</Text>
                <Text style={styles.infoCardBody}>
                  Ориентировъчно <Text style={{ ...typography.bodyBold, color: colors.text }}>{sp.minSizeCm} см</Text> — задължително
                  потвърди актуалните правила и заповедите за конкретния водообект (ИАРА / платен зонал).
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {sp.banPeriod ? (
          <Card style={[styles.banCard, { marginBottom: spacing.md }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
              <Ionicons name="warning-outline" size={22} color={colors.warning} />
              <Text style={styles.banTitle}>Забранен период</Text>
            </View>
            <Text style={styles.infoCardBody}>
              <Text style={{ ...typography.bodyBold, color: colors.text }}>
                {sp.banPeriod.from} – {sp.banPeriod.to}
              </Text>
              {'\n'}
              {sp.banPeriod.note}
            </Text>
          </Card>
        ) : null}

        <ArticleSection styles={styles} title="Описание">
          {sp.description}
        </ArticleSection>

        <ArticleSection styles={styles} title="Местообитание">
          {sp.habitat}
        </ArticleSection>

        <ArticleSection styles={styles} title="Какъв размер да очакваш" subtitle="На практика в различни водоеми">
          {sp.typicalSize}
        </ArticleSection>

        <ArticleSection styles={styles} title="Биология">
          {sp.biology}
        </ArticleSection>

        <ArticleSection styles={styles} title="Техника на улова">
          {sp.anglingTips}
        </ArticleSection>

        <ArticleSection styles={styles} title="Примамки и стръвни">
          {sp.baitsAndLures}
        </ArticleSection>

        <ArticleSection styles={styles} title="Сезонност">
          {sp.bestSeason}
        </ArticleSection>
      </ScrollView>
    </Screen>
  );
}
