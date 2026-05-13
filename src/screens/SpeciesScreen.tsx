import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { SectionHeader } from '../components/SectionHeader';
import { speciesList } from '../data/species';
import { imageHeadersForUrl, speciesPhotos } from '../data/speciesPhotos';
import { Species } from '../types';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { useAppNavigation } from '../navigation/useAppNavigation';

function categoryBand(cat: string): [string, string] {
  switch (cat) {
    case 'saltwater': return ['#005A9E', '#0080CC'];
    case 'predator':  return ['#0E4D64', '#1A7A9C'];
    case 'cyprinid':  return ['#1B6B3A', '#2E9B5A'];
    default:          return ['#006E8A', '#00A8CC'];
  }
}

function createSpeciesListStyles(colors: AppColors) {
  return StyleSheet.create({
    topBlock: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
    },
    statsRow: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    statBox: {
      flex: 1,
      backgroundColor: colors.primarySurface,
      borderRadius: radius.lg,
      paddingVertical: spacing.md + 4,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    statNum: { ...typography.h2, fontSize: 26, color: colors.primary, letterSpacing: -0.5 },
    statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 6, textAlign: 'center', lineHeight: 18 },
    filtersCardInner: { gap: spacing.md },
    filterSectionLabel: {
      ...typography.small,
      fontWeight: '700',
      color: colors.textMuted,
      letterSpacing: 0.35,
      marginBottom: spacing.xs,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
    },
    searchIcon: { marginRight: spacing.sm },
    searchInput: {
      flex: 1,
      paddingVertical: spacing.xs,
      fontSize: 16,
      color: colors.text,
    },
    rowPressable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    thumbWrap: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.primarySurface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    thumbImg: { width: '100%', height: '100%' },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowBody: { flex: 1, minWidth: 0 },
    name: { ...typography.h3, fontSize: 17, color: colors.text },
    latin: { ...typography.caption, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },
    listHeaderLabel: {
      ...typography.small,
      fontWeight: '700',
      color: colors.textMuted,
      letterSpacing: 0.6,
      marginBottom: spacing.sm,
    },
    listFooterPad: { height: spacing.md },
  });
}

export default function SpeciesScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => createSpeciesListStyles(colors), [colors]);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return speciesList;
    return speciesList.filter(
      (sp) =>
        sp.nameBg.toLowerCase().includes(s) ||
        sp.nameLatin.toLowerCase().includes(s) ||
        sp.id.includes(s)
    );
  }, [q]);

  const searchActive = q.trim().length > 0;

  const subtitle =
    searchActive && filtered.length > 0
      ? `${filtered.length} от ${speciesList.length} вида отговарят на търсенето`
      : `Ориентировъчни бележки за ${speciesList.length} вида — правилата винаги проверявай за конкретния водообект.`;

  const renderItem = ({ item }: { item: Species }) => {
    const photo = speciesPhotos[item.id];
    const [bandStart, bandEnd] = categoryBand(item.category);
    return (
      <Pressable
        onPress={() => navigation.navigate('SpeciesDetail', { id: item.id })}
        android_ripple={{ color: `${colors.primary}18` }}
        style={({ pressed }) => [
          { flex: 1, margin: spacing.xs / 2 },
          pressed && Platform.OS === 'ios' ? { opacity: 0.92 } : undefined,
        ]}
      >
        <Card style={{ padding: 0, overflow: 'hidden', flex: 1 }}>
          {/* Coloured top band */}
          <LinearGradient
            colors={[bandStart, bandEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 5 }}
          />
          <View style={{ padding: spacing.sm, alignItems: 'center', gap: spacing.xs }}>
            {photo ? (
              <View style={[styles.thumbWrap, { width: '100%', height: 90, borderRadius: radius.sm }]}>
                <Image
                  source={{ uri: photo.url, headers: imageHeadersForUrl(photo.url) }}
                  style={styles.thumbImg}
                  contentFit="cover"
                  transition={180}
                />
              </View>
            ) : (
              <View style={[styles.iconWrap, { width: '100%', height: 72, borderRadius: radius.sm }]}>
                <Ionicons name="fish-outline" size={28} color={colors.primary} />
              </View>
            )}
            <Text style={[styles.name, { fontSize: 14, textAlign: 'center' }]} numberOfLines={2}>
              {item.nameBg}
            </Text>
            <Text style={[styles.latin, { textAlign: 'center' }]} numberOfLines={1}>
              {item.nameLatin}
            </Text>
          </View>
        </Card>
      </Pressable>
    );
  };

  const filtersCard = (
    <Card style={{ marginHorizontal: spacing.xl, marginBottom: spacing.md }}>
      <View style={styles.filtersCardInner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.filterSectionLabel, { marginBottom: 0 }]}>ТЪРСЕНЕ</Text>
          {searchActive ? (
            <Pressable onPress={() => setQ('')} hitSlop={8} style={{ padding: spacing.xs }}>
              <Text style={{ ...typography.bodyBold, fontSize: 14, color: colors.primary }}>Изчисти</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Име на български или латинско…"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>
      </View>
    </Card>
  );

  return (
    <Screen padded={false}>
      <View style={styles.topBlock}>
        <SectionHeader hint="СПРАВОЧНИК" title="Видове риби" subtitle={subtitle} />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{speciesList.length}</Text>
          <Text style={styles.statLbl}>вида в справочника</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{filtered.length}</Text>
          <Text style={styles.statLbl}>{searchActive ? 'намерени' : 'показани сега'}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => navigation.navigate('WeightCalc')}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          marginHorizontal: spacing.xl, marginBottom: spacing.md,
          padding: spacing.md,
          backgroundColor: colors.primarySurface,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View style={{
          width: 40, height: 40, borderRadius: 10,
          backgroundColor: colors.primary,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="scale-outline" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.bodyBold, color: colors.text }}>Калкулатор за размер</Text>
          <Text style={{ ...typography.small, color: colors.textMuted, marginTop: 2 }}>
            Дължина ↔ тегло · минимален размер по вид
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>

      {filtersCard}

      {filtered.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl }}>
          <EmptyState
            icon="search-outline"
            title="Няма съвпадения"
            subtitle="Опитай друга дума или провери правописа на латинското име."
          />
          <Button title="Изчисти търсенето" variant="secondary" onPress={() => setQ('')} style={{ marginTop: spacing.lg }} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: spacing.md }}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={{ paddingHorizontal: spacing.xs, paddingBottom: spacing.xxl }}
          ListHeaderComponent={
            <Text style={[styles.listHeaderLabel, { paddingHorizontal: spacing.md, marginBottom: spacing.sm }]}>
              РЕЗУЛТАТИ ({filtered.length}
              {searchActive ? ` от ${speciesList.length}` : ''})
            </Text>
          }
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          ListFooterComponent={<View style={styles.listFooterPad} />}
          {...keyboardAwareScrollProps}
        />
      )}
    </Screen>
  );
}
