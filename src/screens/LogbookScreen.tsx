import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SectionList,
  Pressable,
  TextInput,
  ScrollView,
  Switch,
  Platform,
  Modal,
  Animated,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { shadowButton } from '../theme/shadows';
import { catchesStore } from '../storage/storage';
import { Catch } from '../types';
import { speciesList } from '../data/species';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import * as Haptics from 'expo-haptics';
import { FishingRefreshControl } from '../components/FishingRefreshControl';

const CATCH_ACCENTS = ['#1A7A9C', '#2E9B5A', '#0E4D64', '#7BB7CC', '#006E8A', '#C49A00'];
function speciesAccent(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return CATCH_ACCENTS[Math.abs(h) % CATCH_ACCENTS.length];
}

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
    statNum: { ...typography.h3, fontSize: 22, color: colors.primary, letterSpacing: -1 },
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
  onEdit: (item: Catch) => void;
};

const CatchListRow = React.memo(function CatchListRow({
  item, colors, styles, personalBests, user, onPress, onDelete, onEdit,
}: CatchListRowProps) {
  const isPB = isPersonalBestCatch(item, personalBests);
  const accent = speciesAccent(item.speciesName);

  const renderRightActions = () => (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: spacing.sm }}>
      <Pressable
        onPress={() => { void Haptics.selectionAsync(); onEdit(item); }}
        style={{ backgroundColor: colors.primary, width: 80, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md, marginRight: spacing.xs }}
      >
        <Ionicons name="pencil-outline" size={20} color={colors.white} />
        <Text style={{ color: colors.white, fontSize: 11, fontWeight: '700' }}>Редактирай</Text>
      </Pressable>
      <Pressable
        onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onDelete(item); }}
        style={{ backgroundColor: colors.danger, width: 80, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md }}
      >
        <Ionicons name="trash-outline" size={20} color={colors.white} />
        <Text style={{ color: colors.white, fontSize: 11, fontWeight: '700' }}>Изтрий</Text>
      </Pressable>
    </View>
  );

  const renderLeftActions = () => (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        void Share.share({ message: `${item.speciesName} - ${item.weightKg ?? '—'}кг` });
      }}
      style={{ backgroundColor: colors.accent, width: 80, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md, marginBottom: spacing.sm, marginRight: spacing.xs }}
    >
      <Ionicons name="share-outline" size={20} color={colors.white} />
      <Text style={{ color: colors.white, fontSize: 11, fontWeight: '700' }}>Сподели</Text>
    </Pressable>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      overshootRight={false}
      overshootLeft={false}
    >
      <Pressable
        onPress={() => onPress(item)}
        android_ripple={{ color: `${colors.primary}18` }}
        style={({ pressed }) => (pressed && Platform.OS === 'ios' ? { opacity: 0.92 } : undefined)}
      >
        <View style={{
          flexDirection: 'row',
          height: 90,
          borderRadius: radius.md,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.cardEdge ?? colors.border,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.07,
          shadowRadius: 3,
          elevation: 2,
        }}>
          {/* Left accent bar */}
          <View style={{ width: 4, backgroundColor: accent }} />

          {/* Center content */}
          <View style={{ flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' }}>
            {/* Species + PB badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>
                {item.speciesName}
              </Text>
              {isPB ? (
                <View style={{ backgroundColor: '#FFD70022', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#C49A0055' }}>
                  <Text style={{ color: '#C49A00', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>⭐ РЕКОРД</Text>
                </View>
              ) : null}
            </View>

            {/* Weight hero */}
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.primary, letterSpacing: -0.5, marginTop: 2 }}>
              {item.weightKg != null ? `${item.weightKg} кг` : '— кг'}
            </Text>

            {/* Meta row: date + location + released */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {new Date(item.date).toLocaleDateString('bg-BG')}
              </Text>
              {item.location?.name ? (
                <>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>·</Text>
                  <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                  <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                    {item.location.name}
                  </Text>
                </>
              ) : null}
              {item.released ? (
                <View style={{ backgroundColor: colors.accent + '18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent + '55' }}>
                  <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '700' }}>пуснат</Text>
                </View>
              ) : null}
              {user && !item.syncedToCloud ? (
                <Ionicons name="cloud-upload-outline" size={13} color={colors.textMuted} />
              ) : null}
            </View>
          </View>

          {/* Right photo or placeholder */}
          <View style={{ width: 60, height: 70, alignSelf: 'center', marginRight: spacing.sm, borderRadius: radius.sm, overflow: 'hidden' }}>
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={{ width: 60, height: 70 }} contentFit="cover" />
            ) : (
              <View style={{ width: 60, height: 70, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
                <Ionicons name="fish-outline" size={28} color={colors.primary} />
              </View>
            )}
            {(item.extraPhotoUris?.length ?? 0) > 0 ? (
              <View style={{ position: 'absolute', bottom: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>+{item.extraPhotoUris!.length}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
});

type CatchGridItemProps = {
  item: Catch;
  colors: AppColors;
  personalBests: ReturnType<typeof computePersonalBests>;
  onPress: (item: Catch) => void;
};

const CatchGridItem = React.memo(function CatchGridItem({ item, colors, personalBests, onPress }: CatchGridItemProps) {
  const isPB = isPersonalBestCatch(item, personalBests);
  return (
    <Pressable
      onPress={() => onPress(item)}
      android_ripple={{ color: `${colors.primary}18` }}
      style={({ pressed }) => ({ flex: 1, margin: spacing.xs, opacity: pressed && Platform.OS === 'ios' ? 0.9 : 1 })}
    >
      <View style={{ borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={{ width: '100%', aspectRatio: 1 }} contentFit="cover" />
        ) : (
          <View style={{ width: '100%', aspectRatio: 1, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="fish-outline" size={36} color={colors.primary} />
          </View>
        )}
        <View style={{ padding: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ ...typography.caption, fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{item.speciesName}</Text>
            {isPB ? <Text style={{ fontSize: 11 }}>🏆</Text> : null}
          </View>
          {item.weightKg != null ? (
            <Text style={{ ...typography.small, color: colors.primary, fontWeight: '700', marginTop: 1 }}>{item.weightKg} кг</Text>
          ) : null}
          <Text style={{ ...typography.small, color: colors.textMuted, marginTop: 1 }}>{new Date(item.date).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' })}</Text>
        </View>
      </View>
    </Pressable>
  );
});

function SpeciesChip({ label, selected, onPress, colors, styles }: SpeciesChipProps) {
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
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

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

type LogbookCalendarProps = {
  catches: Catch[];
  colors: AppColors;
  onDayPress: (date: string) => void;
  selectedDay: string | null;
  calMonth: { year: number; month: number };
  setCalMonth: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>;
  personalBests: ReturnType<typeof computePersonalBests>;
  user: { uid: string } | null;
  styles: ReturnType<typeof createLogbookStyles>;
  onOpenCatch: (item: Catch) => void;
  onDeleteCatch: (item: Catch) => void;
  onEditCatch: (item: Catch) => void;
  bottomPad: number;
};

function LogbookCalendar({
  catches, colors, onDayPress, selectedDay, calMonth, setCalMonth,
  personalBests, user, styles, onOpenCatch, onDeleteCatch, onEditCatch, bottomPad,
}: LogbookCalendarProps) {
  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
  const firstDow = (new Date(calMonth.year, calMonth.month, 1).getDay() + 6) % 7;

  const catchesByDay = useMemo(() => {
    const map = new Map<string, Catch[]>();
    catches.forEach((c) => {
      const d = c.date.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(c);
    });
    return map;
  }, [catches]);

  const monthLabel = new Date(calMonth.year, calMonth.month, 1).toLocaleDateString('bg-BG', {
    month: 'long',
    year: 'numeric',
  });

  const goToPrev = () => {
    setCalMonth((prev) => {
      const m = prev.month === 0 ? 11 : prev.month - 1;
      const y = prev.month === 0 ? prev.year - 1 : prev.year;
      return { year: y, month: m };
    });
  };

  const goToNext = () => {
    setCalMonth((prev) => {
      const m = prev.month === 11 ? 0 : prev.month + 1;
      const y = prev.month === 11 ? prev.year + 1 : prev.year;
      return { year: y, month: m };
    });
  };

  const selectedDayCatches: Catch[] = selectedDay
    ? (catchesByDay.get(selectedDay) ?? [])
    : (() => {
        const all: Catch[] = [];
        for (let d = 1; d <= daysInMonth; d++) {
          const key = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const cs = catchesByDay.get(key);
          if (cs) all.push(...cs);
        }
        return all.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      })();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Month navigation */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      }}>
        <Pressable onPress={goToPrev} hitSlop={8} style={{ padding: spacing.sm }}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </Pressable>
        <Text style={{ ...typography.h3, color: colors.text, textTransform: 'capitalize' }}>
          {monthLabel}
        </Text>
        <Pressable onPress={goToNext} hitSlop={8} style={{ padding: spacing.sm }}>
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Day-of-week header */}
      <View style={{ flexDirection: 'row', paddingHorizontal: spacing.md }}>
        {DAY_LABELS.map((lbl) => (
          <View key={lbl} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.xs }}>
            <Text style={{ ...typography.small, color: colors.textMuted, fontWeight: '700' }}>{lbl}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md }}>
        {cells.map((day, idx) => {
          if (day === null) {
            return <View key={`empty-${idx}`} style={{ width: `${100 / 7}%`, height: 52 }} />;
          }
          const dateKey = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const hasCatches = catchesByDay.has(dateKey);
          const isSelected = selectedDay === dateKey;
          return (
            <Pressable
              key={dateKey}
              onPress={() => { if (hasCatches) onDayPress(dateKey); }}
              style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 }}
            >
              <View style={{
                width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
                borderRadius: 18,
                ...(isSelected ? {
                  backgroundColor: colors.primarySurface,
                  borderWidth: 1,
                  borderColor: colors.primary,
                } : {}),
              }}>
                <Text style={{
                  ...typography.body,
                  color: hasCatches ? colors.primary : colors.text,
                  fontWeight: hasCatches ? '700' : '400',
                }}>
                  {day}
                </Text>
              </View>
              {hasCatches ? (
                <View style={{
                  width: 5, height: 5, borderRadius: 2.5,
                  backgroundColor: colors.primary, marginTop: 2,
                }} />
              ) : (
                <View style={{ width: 5, height: 5, marginTop: 2 }} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Catches for selected day / month */}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        <Text style={[styles.filterSectionLabel, { marginBottom: spacing.xs }]}>
          {selectedDay
            ? `УЛОВИ – ${new Date(selectedDay + 'T12:00:00').toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })} (${selectedDayCatches.length})`
            : `ВСИЧКИ ЗА МЕСЕЦА (${selectedDayCatches.length})`}
        </Text>
        {selectedDayCatches.length === 0 ? (
          <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg }}>
            Няма улови
          </Text>
        ) : (
          selectedDayCatches.map((item, i) => (
            <View key={item.id}>
              {i > 0 && <View style={{ height: spacing.sm }} />}
              <CatchListRow
                item={item}
                colors={colors}
                styles={styles}
                personalBests={personalBests}
                user={user}
                onPress={onOpenCatch}
                onDelete={onDeleteCatch}
                onEdit={onEditCatch}
              />
            </View>
          ))
        )}
        <View style={{ height: bottomPad }} />
      </View>
    </ScrollView>
  );
}

function LogbookSkeleton({ colors, mode }: { colors: AppColors; mode: 'light' | 'dark' }) {
  const styles = useMemo(() => createLogbookStyles(colors, mode), [colors, mode]);
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, marginTop: spacing.sm }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 2, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Skeleton width={60} height={60} borderRadius={radius.md} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={14} width="60%" />
            <Skeleton height={11} width="40%" />
            <Skeleton height={11} width="80%" />
          </View>
          <Skeleton width={20} height={20} borderRadius={10} />
        </View>
      ))}
    </View>
  );
}

function useCountUp(target: number, duration = 800): number {
  const [val, setVal] = React.useState(0);
  React.useEffect(() => {
    if (target === 0) { setVal(0); return; }
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

export default function LogbookScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + spacing.xl;

  const [items, setItems] = useState<Catch[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Catch | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [gridView, setGridView] = useState(false);
  const [calendarView, setCalendarView] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [calSelectedDay, setCalSelectedDay] = useState<string | null>(null);
  const [chipFilter, setChipFilter] = useState<string | null>(null);

  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef = useRef(false);
  const celebrationScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (showCelebration) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(celebrationScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 80,
      }).start();
    } else {
      celebrationScale.setValue(0);
    }
  }, [showCelebration, celebrationScale]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setInitialLoading(true);
    const list = await catchesStore.list();
    setItems(list);
    setInitialLoading(false);
    if (list.length === 1 && !celebrationShownRef.current) {
      AsyncStorage.getItem('@ribolov/firstCatchCelebrated').then((v) => {
        if (!v) {
          setShowCelebration(true);
          celebrationShownRef.current = true;
        }
      }).catch(() => {});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return items.filter((c) => {
      if (speciesId && c.speciesId !== speciesId) return false;
      if (chipFilter && c.speciesName !== chipFilter) return false;
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
  }, [items, debouncedQuery, speciesId, chipFilter, releasedOnly, dateFrom, dateTo]);

  const totalKg = filtered.reduce((s, i) => s + (i.weightKg ?? 0), 0);
  const personalBests = useMemo(() => computePersonalBests(items), [items]);
  const uniqueSpeciesCount = useMemo(
    () => new Set(items.map((c) => c.speciesId ?? c.speciesName)).size,
    [items]
  );

  const speciesChipList = useMemo(
    () => [...new Set(items.map((c) => c.speciesName))].sort((a, b) => a.localeCompare(b, 'bg')),
    [items]
  );

  const animatedCount = useCountUp(filtered.length);
  const animatedKgInt = useCountUp(Math.round(totalKg * 10));
  const animatedKg = (animatedKgInt / 10).toFixed(1);

  const handleStatsLongPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const statsText =
      `Общо улови: ${items.length}\n` +
      `Видове: ${uniqueSpeciesCount}\n` +
      `Общо кг: ${items.reduce((s, c) => s + (c.weightKg ?? 0), 0).toFixed(1)}`;
    void Share.share({ message: `🎣 Моята риболовна статистика\n\n${statsText}` });
  }, [items, uniqueSpeciesCount]);

  const sections = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const map = new Map<string, Catch[]>();
    sorted.forEach((c) => {
      const key = c.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    });
    return [...map.entries()].map(([key, data]) => ({
      title: new Date(key + '-01').toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' }),
      key,
      data,
    }));
  }, [filtered]);
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

  const handleSwipeDelete = useCallback((catchItem: Catch) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setItems((prev) => prev.filter((c) => c.id !== catchItem.id));
    catchesStore.remove(catchItem.id).catch(() => {});
    setPendingDelete(catchItem);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    undoTimerRef.current = setTimeout(() => setPendingDelete(null), 4000);
  }, []);

  const handleSwipeEdit = useCallback((catchItem: Catch) => {
    navigation.navigate('AddCatch', { editCatchId: catchItem.id });
  }, [navigation]);

  const handleUndoDelete = useCallback(async () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (!pendingDelete) return;
    await catchesStore.save(pendingDelete);
    setItems((prev) =>
      [...prev, pendingDelete].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    );
    setPendingDelete(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [pendingDelete]);

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
    ({ item }: { item: Catch }) => gridView ? (
      <CatchGridItem
        item={item}
        colors={colors}
        personalBests={personalBests}
        onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })}
      />
    ) : (
      <CatchListRow
        item={item}
        colors={colors}
        styles={styles}
        personalBests={personalBests}
        user={user}
        onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })}
        onDelete={handleSwipeDelete}
        onEdit={handleSwipeEdit}
      />
    ),
    [gridView, colors, styles, personalBests, user, navigation, handleSwipeDelete, handleSwipeEdit]
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
      <View style={{ flex: 1, position: 'relative' }}>
        <View style={styles.topRow}>
          <View style={styles.titleCol}>
            <SectionHeader hint="ДНЕВНИК" title="Улови" subtitle={subtitle} />
          </View>
          <Pressable
            onPress={() => { setGridView((v) => !v); setCalendarView(false); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={gridView ? 'Списък' : 'Мрежа'}
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: gridView ? colors.primarySurface : colors.surfaceAlt, borderWidth: 1, borderColor: gridView ? colors.primary : colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}
          >
            <Ionicons name={gridView ? 'list-outline' : 'grid-outline'} size={20} color={colors.primary} />
          </Pressable>
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
            onPress={() => { setCalendarView((v) => !v); setGridView(false); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Календар"
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: calendarView ? colors.primarySurface : colors.surfaceAlt, borderWidth: 1, borderColor: calendarView ? colors.primary : colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
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

        <Pressable style={styles.statsRow} onLongPress={handleStatsLongPress} delayLongPress={400}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{animatedCount}</Text>
            <Text style={styles.statLbl}>
              {filtersActive ? `от ${items.length} записа` : items.length === 1 ? 'запис' : 'записа'}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{animatedKg}</Text>
            <Text style={styles.statLbl}>{filtersActive ? 'кг в избора' : 'кг общо'}</Text>
          </View>
        </Pressable>

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

        {/* ── Species quick-filter chips ── */}
        {!initialLoading && speciesChipList.length >= 2 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.xs, alignItems: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              onPress={() => { void Haptics.selectionAsync(); setChipFilter(null); }}
              accessibilityRole="button"
              android_ripple={{ color: `${colors.primary}22` }}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: chipFilter === null ? colors.primary : colors.card,
                borderWidth: 1,
                borderColor: chipFilter === null ? colors.primary : colors.border,
                marginRight: spacing.xs,
                opacity: pressed && Platform.OS === 'ios' ? 0.85 : 1,
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: chipFilter === null ? colors.white : colors.text }}>
                Всички
              </Text>
            </Pressable>
            {speciesChipList.map((name) => (
              <Pressable
                key={name}
                onPress={() => { void Haptics.selectionAsync(); setChipFilter((prev) => (prev === name ? null : name)); }}
                accessibilityRole="button"
                android_ripple={{ color: `${colors.primary}22` }}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.md,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  backgroundColor: chipFilter === name ? colors.primary : colors.card,
                  borderWidth: 1,
                  borderColor: chipFilter === name ? colors.primary : colors.border,
                  marginRight: spacing.xs,
                  maxWidth: 220,
                  opacity: pressed && Platform.OS === 'ios' ? 0.85 : 1,
                })}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: chipFilter === name ? colors.white : colors.text }} numberOfLines={1}>
                  {name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {initialLoading ? (
          <LogbookSkeleton colors={colors} mode={mode} />
        ) : calendarView && !initialLoading ? (
          <LogbookCalendar
            catches={filtered}
            colors={colors}
            onDayPress={(date) => setCalSelectedDay((prev) => (prev === date ? null : date))}
            selectedDay={calSelectedDay}
            calMonth={calMonth}
            setCalMonth={setCalMonth}
            personalBests={personalBests}
            user={user}
            styles={styles}
            onOpenCatch={(c) => navigation.navigate('CatchDetail', { id: c.id })}
            onDeleteCatch={handleSwipeDelete}
            onEditCatch={handleSwipeEdit}
            bottomPad={bottomPad}
          />
        ) : items.length === 0 ? (
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
        ) : gridView ? (
          <FlatList
            key="grid"
            data={filtered}
            keyExtractor={(item) => item.id}
            numColumns={2}
            removeClippedSubviews={Platform.OS === 'android'}
            contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: bottomPad }}
            ListHeaderComponent={
              <Text style={[styles.filterSectionLabel, { marginBottom: spacing.sm, paddingHorizontal: spacing.sm }]}>
                РЕЗУЛТАТИ ({filtered.length})
              </Text>
            }
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListFooterComponent={<View style={styles.listFooterPad} />}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={10}
            {...keyboardAwareScrollProps}
            renderItem={renderCatchItem}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            removeClippedSubviews={Platform.OS === 'android'}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomPad }}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ItemSeparatorComponent={CatchSeparator}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
                <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: colors.primarySurface, paddingHorizontal: spacing.md, paddingVertical: 4,
                  borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
                }}>
                  <Text style={{ ...typography.overline, color: colors.primary, textTransform: 'capitalize' }}>
                    {section.title}
                  </Text>
                  <Text style={{ ...typography.small, color: colors.textMuted, fontWeight: '600' }}>
                    · {section.data.length}
                  </Text>
                </View>
                <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              </View>
            )}
            renderSectionFooter={() => <View style={{ height: spacing.sm }} />}
            ListHeaderComponent={
              <Text style={[styles.filterSectionLabel, { marginBottom: spacing.xs }]}>
                РЕЗУЛТАТИ ({filtered.length})
              </Text>
            }
            ListFooterComponent={<View style={styles.listFooterPad} />}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={10}
            {...keyboardAwareScrollProps}
            renderItem={renderCatchItem}
          />
        )}

        {/* ── Undo delete snackbar ── */}
        {pendingDelete ? (
          <View style={{
            position: 'absolute', bottom: bottomPad, left: spacing.lg, right: spacing.lg,
            backgroundColor: mode === 'dark' ? '#2a2a2a' : '#1c1c1c',
            borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center',
            paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
            gap: spacing.md, elevation: 8,
            shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3, shadowRadius: 8,
          }}>
            <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.6)" />
            <Text style={{ ...typography.body, color: '#fff', flex: 1 }} numberOfLines={1}>
              „{pendingDelete.speciesName}" изтрит
            </Text>
            <Pressable onPress={handleUndoDelete} hitSlop={8}>
              <Text style={{ ...typography.bodyBold, color: colors.primary }}>Отмени</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* ── First catch celebration modal ── */}
      <Modal
        visible={showCelebration}
        animationType="fade"
        transparent
        onRequestClose={() => setShowCelebration(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <View style={{
            backgroundColor: colors.card, borderRadius: radius.xl,
            padding: spacing.xl, margin: spacing.lg,
            alignItems: 'center',
          }}>
            <Animated.Text style={{ fontSize: 72, transform: [{ scale: celebrationScale }] }}>
              🎣
            </Animated.Text>
            <Text style={{ ...typography.h1, color: colors.primary, marginTop: spacing.lg, textAlign: 'center' }}>
              Първи улов!
            </Text>
            <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.md, textAlign: 'center', lineHeight: 22 }}>
              Добре дошъл в дневника! Продължавай да записваш — всеки улов се счита.
            </Text>
            <Pressable
              onPress={() => {
                setShowCelebration(false);
                AsyncStorage.setItem('@ribolov/firstCatchCelebrated', '1').catch(() => {});
              }}
              style={{
                marginTop: spacing.xl,
                backgroundColor: colors.primary,
                paddingHorizontal: spacing.xl,
                paddingVertical: spacing.md,
                borderRadius: radius.pill,
              }}
            >
              <Text style={{ ...typography.bodyBold, color: colors.white }}>Страхотно! 🎉</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
