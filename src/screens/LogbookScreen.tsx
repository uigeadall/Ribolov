import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  ScrollView,
  Switch,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useAuth } from '../services/authContext';
import { computePersonalBests, isPersonalBestCatch } from '../services/personalBests';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { shadowButton } from '../theme/shadows';
import { catchesStore } from '../storage/storage';
import { Catch } from '../types';
import { speciesList } from '../data/species';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function createLogbookStyles(colors: AppColors, mode: 'light' | 'dark') {
  return StyleSheet.create({
    topRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      gap: spacing.sm,
    },
    titleCol: { flex: 1, minWidth: 0 },
    addBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
      ...shadowButton(mode),
    },
    statsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    statBox: {
      flex: 1,
      backgroundColor: colors.primarySurface,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    statNum: { ...typography.h3, fontSize: 22, color: colors.primary, letterSpacing: -0.5 },
    statLbl: { ...typography.small, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
    filtersCardInner: {
      gap: spacing.md,
    },
    filterHeadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    filterCardTitle: { ...typography.overline, color: colors.primary, letterSpacing: 1.1 },
    clearFiltersBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
    clearFiltersText: { ...typography.bodyBold, fontSize: 14, color: colors.primary },
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
    chipsRow: {
      paddingVertical: 2,
      gap: spacing.xs,
      alignItems: 'center',
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: spacing.xs,
      maxWidth: 220,
    },
    chipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: { ...typography.small, color: colors.text, fontWeight: '600' },
    chipTextSelected: { color: colors.white },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    datesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    datePill: {
      flex: 1,
      minWidth: 108,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    datePillLabel: { ...typography.small, color: colors.textMuted, fontWeight: '700' },
    datePillValue: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },
    clearDatesBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySurface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    releasedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: spacing.xs,
      gap: spacing.md,
    },
    releasedLabelWrap: { flex: 1 },
    releasedLabel: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
    releasedHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    row: { flexDirection: 'row', alignItems: 'center' },
    thumb: {
      width: 60,
      height: 60,
      borderRadius: radius.md,
    },
    thumbPlaceholder: {
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    itemBody: { flex: 1, marginLeft: spacing.md, minWidth: 0 },
    itemTitle: { ...typography.h3, fontSize: 15, color: colors.text },
    photoTitleLine: { ...typography.small, color: colors.primary, marginTop: 2, fontStyle: 'italic' },
    itemMeta: { ...typography.small, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
    rowTrail: { alignItems: 'flex-end', justifyContent: 'center', gap: spacing.sm, marginLeft: spacing.sm },
    badge: {
      backgroundColor: colors.accent + '18',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accent + '66',
    },
    badgeText: { color: colors.accent, ...typography.small, fontWeight: '700' },
    listFooterPad: { height: spacing.md },
  });
}

type SpeciesChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: AppColors;
  styles: ReturnType<typeof createLogbookStyles>;
};

type CatchListRowProps = {
  item: Catch;
  colors: AppColors;
  styles: ReturnType<typeof createLogbookStyles>;
  personalBests: ReturnType<typeof computePersonalBests>;
  user: { uid: string } | null;
  onPress: (item: Catch) => void;
  onDelete: (item: Catch) => void;
};

const CatchListRow = React.memo(function CatchListRow({
  item, colors, styles, personalBests, user, onPress, onDelete,
}: CatchListRowProps) {
  return (
    <Swipeable
      renderRightActions={() => (
        <Pressable
          onPress={() => onDelete(item)}
          style={{ backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', width: 76, borderRadius: radius.md, marginBottom: spacing.sm }}
        >
          <Ionicons name="trash-outline" size={22} color={colors.white} />
          <Text style={{ color: colors.white, fontSize: 11, fontWeight: '700', marginTop: 2 }}>Изтрий</Text>
        </Pressable>
      )}
      overshootRight={false}
    >
      <Pressable
        onPress={() => onPress(item)}
        android_ripple={{ color: `${colors.primary}18` }}
        style={({ pressed }) => (pressed && Platform.OS === 'ios' ? { opacity: 0.92 } : undefined)}
      >
        <Card style={{ padding: spacing.sm + 2 }}>
          <View style={styles.row}>
            <View>
              {item.photoUri ? (
                <Image source={{ uri: item.photoUri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Ionicons name="fish-outline" size={30} color={colors.primary} />
                </View>
              )}
              {(item.extraPhotoUris?.length ?? 0) > 0 ? (
                <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2 }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>+{item.extraPhotoUris!.length}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.itemBody}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.speciesName}</Text>
                {isPersonalBestCatch(item, personalBests) ? <Text style={{ fontSize: 14 }}>🏆</Text> : null}
              </View>
              {item.photoTitle ? (
                <Text style={styles.photoTitleLine} numberOfLines={1}>
                  „{item.photoTitle}"
                </Text>
              ) : null}
              <Text style={styles.itemMeta}>
                {new Date(item.date).toLocaleDateString('bg-BG')}
                {item.weightKg != null ? ` · ${item.weightKg} кг` : ''}
                {item.lengthCm != null ? ` · ${item.lengthCm} см` : ''}
              </Text>
              {item.location?.name ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {item.location.name}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.rowTrail}>
              {item.released ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Пуснат</Text>
                </View>
              ) : null}
              {user && !item.syncedToCloud ? (
                <Ionicons name="cloud-upload-outline" size={16} color={colors.textMuted} />
              ) : null}
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </View>
        </Card>
      </Pressable>
    </Swipeable>
  );
});

function SpeciesChip({ label, selected, onPress, colors, styles }: SpeciesChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: `${colors.primary}22` }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && Platform.OS === 'ios' ? { opacity: 0.85 } : null,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function LogbookScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + spacing.xl;

  const [items, setItems] = useState<Catch[]>([]);
  const styles = useMemo(() => createLogbookStyles(colors, mode), [colors, mode]);

  // Badge shows count of unsynced catches on the tab bar
  useEffect(() => {
    if (!user) return;
    const unsynced = items.filter((c) => !c.syncedToCloud).length;
    navigation.getParent()?.setOptions({
      tabBarBadge: unsynced > 0 ? unsynced : undefined,
    });
  }, [items, user, navigation]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [speciesId, setSpeciesId] = useState<string | null>(null);
  const [releasedOnly, setReleasedOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [pickFrom, setPickFrom] = useState(false);
  const [pickTo, setPickTo] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const load = useCallback(async () => {
    const list = await catchesStore.list();
    setItems(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return items.filter((c) => {
      if (speciesId && c.speciesId !== speciesId) return false;
      if (releasedOnly && !c.released) return false;
      const t = new Date(c.date).getTime();
      if (dateFrom && t < startOfDay(dateFrom)) return false;
      if (dateTo && t > endOfDay(dateTo)) return false;
      if (q) {
        const blob = [c.speciesName, c.location?.name, c.notes, c.bait].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [items, debouncedQuery, speciesId, releasedOnly, dateFrom, dateTo]);

  const totalKg = filtered.reduce((s, i) => s + (i.weightKg ?? 0), 0);
  const personalBests = useMemo(() => computePersonalBests(items), [items]);
  const filtersActive =
    !!speciesId || releasedOnly || !!dateFrom || !!dateTo || searchQuery.trim().length > 0;

  const resetFilters = () => {
    setSearchQuery('');
    setSpeciesId(null);
    setReleasedOnly(false);
    setDateFrom(null);
    setDateTo(null);
  };

  const subtitle =
    items.length === 0
      ? 'Записвай всеки улов с дата, място и детайли — всичко остава на телефона.'
      : `${items.length} ${items.length === 1 ? 'запис' : 'записа'} в дневника · преглед и филтри по-долу`;

  const handleSwipeDelete = (item: Catch) => {
    Alert.alert('Изтриване', `Изтриване на „${item.speciesName}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await catchesStore.remove(item.id);
          await load();
        },
      },
    ]);
  };

  // Card(60 thumb + 10+10 padding + 1+1 border) + 8 separator
  const CATCH_ROW_H = 82;
  const CATCH_SEP_H = spacing.sm;
  const getCatchItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: CATCH_ROW_H,
      offset: (CATCH_ROW_H + CATCH_SEP_H) * index,
      index,
    }),
    []
  );

  const CatchSeparator = useCallback(() => <View style={{ height: CATCH_SEP_H }} />, []);

  const renderCatchItem = useCallback(
    ({ item }: { item: Catch }) => (
      <CatchListRow
        item={item}
        colors={colors}
        styles={styles}
        personalBests={personalBests}
        user={user}
        onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })}
        onDelete={handleSwipeDelete}
      />
    ),
    [colors, styles, personalBests, user, navigation, handleSwipeDelete]
  );

  const filtersCard = (
    <Card style={{ marginHorizontal: spacing.lg, marginBottom: spacing.sm }}>
      <View style={styles.filtersCardInner}>
        <View style={styles.filterHeadRow}>
          <Text style={styles.filterCardTitle}>ФИЛТРИ</Text>
          {filtersActive ? (
            <Pressable style={styles.clearFiltersBtn} onPress={resetFilters} hitSlop={8}>
              <Text style={styles.clearFiltersText}>Изчисти</Text>
            </Pressable>
          ) : null}
        </View>

        <View>
          <Text style={styles.filterSectionLabel}>Търсене</Text>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              placeholder="Вид, място, бележки, примамка…"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
            />
          </View>
        </View>

        <View>
          <Text style={styles.filterSectionLabel}>Вид риба</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            keyboardShouldPersistTaps="handled"
          >
            <SpeciesChip
              label="Всички"
              selected={speciesId === null}
              onPress={() => setSpeciesId(null)}
              colors={colors}
              styles={styles}
            />
            {speciesList.map((s) => (
              <SpeciesChip
                key={s.id}
                label={s.nameBg}
                selected={speciesId === s.id}
                onPress={() => setSpeciesId((prev) => (prev === s.id ? null : s.id))}
                colors={colors}
                styles={styles}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.divider} />

        <View>
          <Text style={styles.filterSectionLabel}>Период</Text>
          <View style={styles.datesRow}>
            <Pressable style={styles.datePill} onPress={() => setPickFrom(true)}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.datePillLabel}>От дата</Text>
                <Text style={styles.datePillValue} numberOfLines={1}>
                  {dateFrom ? dateFrom.toLocaleDateString('bg-BG') : 'Избери'}
                </Text>
              </View>
            </Pressable>
            <Pressable style={styles.datePill} onPress={() => setPickTo(true)}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.datePillLabel}>До дата</Text>
                <Text style={styles.datePillValue} numberOfLines={1}>
                  {dateTo ? dateTo.toLocaleDateString('bg-BG') : 'Избери'}
                </Text>
              </View>
            </Pressable>
            {dateFrom || dateTo ? (
              <Pressable
                style={styles.clearDatesBtn}
                onPress={() => {
                  setDateFrom(null);
                  setDateTo(null);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Изчисти периода"
              >
                <Ionicons name="close" size={22} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.releasedRow}>
          <View style={styles.releasedLabelWrap}>
            <Text style={styles.releasedLabel}>Само пуснати риби</Text>
            <Text style={styles.releasedHint}>Показва записи, маркирани като върнати във водата.</Text>
          </View>
          <Switch
            value={releasedOnly}
            onValueChange={setReleasedOnly}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={colors.white}
          />
        </View>
      </View>
    </Card>
  );

  return (
    <Screen padded={false}>
      <View style={{ flex: 1 }}>
        <View style={styles.topRow}>
          <View style={styles.titleCol}>
            <SectionHeader hint="ДНЕВНИК" title="Улови" subtitle={subtitle} />
          </View>
          <Pressable
            onPress={() => navigation.navigate('PhotoGallery')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Галерия"
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}
          >
            <Ionicons name="images-outline" size={20} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.addBtn}
            onPress={() => navigation.navigate('AddCatch')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добави улов"
          >
            <Ionicons name="add" size={26} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{filtered.length}</Text>
            <Text style={styles.statLbl}>
              {filtersActive ? `от ${items.length} записа` : items.length === 1 ? 'запис' : 'записа'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{totalKg.toFixed(1)}</Text>
            <Text style={styles.statLbl}>{filtersActive ? 'кг в избора' : 'кг общо'}</Text>
          </View>
        </View>

        {filtersCard}

        {pickFrom ? (
          <>
            <DateTimePicker
              mode="date"
              value={dateFrom ?? new Date()}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, d) => {
                if (Platform.OS === 'android') setPickFrom(false);
                if (event.type === 'set' && d) setDateFrom(d);
              }}
            />
            {Platform.OS === 'ios' ? (
              <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }}>
                <Button title="Готово" variant="secondary" compact onPress={() => setPickFrom(false)} />
              </View>
            ) : null}
          </>
        ) : null}
        {pickTo ? (
          <>
            <DateTimePicker
              mode="date"
              value={dateTo ?? new Date()}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, d) => {
                if (Platform.OS === 'android') setPickTo(false);
                if (event.type === 'set' && d) setDateTo(d);
              }}
            />
            {Platform.OS === 'ios' ? (
              <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }}>
                <Button title="Готово" variant="secondary" compact onPress={() => setPickTo(false)} />
              </View>
            ) : null}
          </>
        ) : null}

        {items.length === 0 ? (
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              paddingHorizontal: spacing.xl,
              paddingBottom: bottomPad,
            }}
            showsVerticalScrollIndicator={false}
          >
            <EmptyState
              icon="book-outline"
              title="Дневникът е празен"
              subtitle={'Добави първия улов с бутона „+” горе или оттук — после ще го виждаш в списъка и на картата.'}
            />
            <Button title="Добави улов" onPress={() => navigation.navigate('AddCatch')} style={{ marginTop: spacing.lg }} />
          </ScrollView>
        ) : filtered.length === 0 ? (
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              paddingHorizontal: spacing.xl,
              paddingBottom: bottomPad,
            }}
            showsVerticalScrollIndicator={false}
          >
            <EmptyState icon="search-outline" title="Няма съвпадения" subtitle="Няма записи за тези филтри. Опитай друга комбинация." />
            <Button title="Изчисти филтри" variant="secondary" onPress={resetFilters} style={{ marginTop: spacing.lg }} />
          </ScrollView>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomPad }}
            ListHeaderComponent={
              <Text style={[styles.filterSectionLabel, { marginBottom: spacing.sm }]}>
                РЕЗУЛТАТИ ({filtered.length})
              </Text>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            ItemSeparatorComponent={CatchSeparator}
            ListFooterComponent={<View style={styles.listFooterPad} />}
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={10}
            getItemLayout={getCatchItemLayout}
            {...keyboardAwareScrollProps}
            renderItem={renderCatchItem}
          />
        )}
      </View>
    </Screen>
  );
}
