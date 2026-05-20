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
import { deleteCatchEverywhere } from '../services/cloudSync';
import { computePersonalBests, isPersonalBestCatch } from '../services/personalBests';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { Catch } from '../types';
import { speciesList } from '../data/species';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import * as Haptics from 'expo-haptics';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATCH_ACCENTS = ['#1A7A9C', '#2E9B5A', '#0E4D64', '#7BB7CC', '#006E8A', '#C49A00'];
function speciesAccent(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return CATCH_ACCENTS[Math.abs(h) % CATCH_ACCENTS.length];
}

function startOfDay(d: Date): number {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}
function endOfDay(d: Date): number {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime();
}

function useCountUp(target: number, duration = 800): number {
  const [val, setVal] = React.useState(0);
  React.useEffect(() => {
    if (target === 0) { setVal(0); return; }
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      setVal(Math.round((1 - Math.pow(1 - progress, 3)) * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

// ── CatchCard ─────────────────────────────────────────────────────────────────

type CatchCardProps = {
  item: Catch;
  colors: AppColors;
  personalBests: ReturnType<typeof computePersonalBests>;
  user: { uid: string } | null;
  onPress: (item: Catch) => void;
  onDelete: (item: Catch) => void;
  onEdit: (item: Catch) => void;
};

const CatchCard = React.memo(function CatchCard({
  item, colors, personalBests, user, onPress, onDelete, onEdit,
}: CatchCardProps) {
  const isPB = isPersonalBestCatch(item, personalBests);
  const accent = speciesAccent(item.speciesName);

  const renderRightActions = () => (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: 12 }}>
      <Pressable
        onPress={() => { void Haptics.selectionAsync(); onEdit(item); }}
        style={{ backgroundColor: colors.primary, width: 70, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14, marginRight: 6 }}
      >
        <Ionicons name="pencil-outline" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Редактирай</Text>
      </Pressable>
      <Pressable
        onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onDelete(item); }}
        style={{ backgroundColor: colors.danger, width: 70, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14 }}
      >
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Изтрий</Text>
      </Pressable>
    </View>
  );

  const renderLeftActions = () => (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        void Share.share({ message: `${item.speciesName} - ${item.weightKg ?? '—'}кг` });
      }}
      style={{ backgroundColor: colors.accent, width: 70, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14, marginBottom: 12, marginRight: 6 }}
    >
      <Ionicons name="share-outline" size={20} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Сподели</Text>
    </Pressable>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} renderLeftActions={renderLeftActions} overshootRight={false} overshootLeft={false}>
      <Pressable
        onPress={() => onPress(item)}
        android_ripple={{ color: `${colors.primary}14` }}
        style={({ pressed }) => pressed && Platform.OS === 'ios' ? { opacity: 0.93 } : undefined}
      >
        <View style={{
          backgroundColor: colors.card,
          borderRadius: 16,
          overflow: 'hidden',
          marginBottom: 12,
          elevation: 2,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        }}>
          {/* Full-width photo or accent strip */}
          {item.photoUri ? (
            <View style={{ height: 170 }}>
              <Image source={{ uri: item.photoUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              {isPB && (
                <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: '#FFD700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#5A3D00' }}>⭐ PB</Text>
                </View>
              )}
              {(item.extraPhotoUris?.length ?? 0) > 0 && (
                <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>+{item.extraPhotoUris!.length}</Text>
                </View>
              )}
              {user && !item.syncedToCloud ? (
                <View style={{ position: 'absolute', bottom: 8, right: 8 }}>
                  <Ionicons name="cloud-upload-outline" size={14} color="rgba(255,255,255,0.8)" />
                </View>
              ) : null}
            </View>
          ) : (
            /* Solid 4px colored accent strip */
            <View style={{ height: 4, backgroundColor: accent }} />
          )}

          {/* Card content */}
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 }}>
            {/* Species + PB badge (no photo case) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, letterSpacing: -0.3, flex: 1 }} numberOfLines={1}>
                {item.speciesName}
              </Text>
              {isPB && !item.photoUri && (
                <View style={{ backgroundColor: '#FFD700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, marginLeft: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#5A3D00' }}>⭐ PB</Text>
                </View>
              )}
              {user && !item.syncedToCloud && !item.photoUri ? (
                <View style={{ marginLeft: 6 }}>
                  <Ionicons name="cloud-upload-outline" size={14} color={colors.textMuted} />
                </View>
              ) : null}
            </View>

            {/* Weight */}
            {item.weightKg != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 8 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: colors.primary, letterSpacing: -0.5 }}>
                  {item.weightKg}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primary, marginLeft: 3 }}>кг</Text>
              </View>
            ) : (
              <Text style={{ fontSize: 28, fontWeight: '900', color: colors.textMuted, letterSpacing: -0.5, marginBottom: 8 }}>—</Text>
            )}

            {/* Meta row: date · location · C&R */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {new Date(item.date).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              {item.location?.name ? (
                <>
                  <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.textMuted }} />
                  <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                  <Text style={{ fontSize: 12, color: colors.textMuted, flexShrink: 1 }} numberOfLines={1}>
                    {item.location.name}
                  </Text>
                </>
              ) : null}
              {item.released ? (
                <>
                  <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.textMuted }} />
                  <View style={{ backgroundColor: '#34C97A22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: '#34C97A55' }}>
                    <Text style={{ color: '#2EA86A', fontSize: 10, fontWeight: '700' }}>C&R</Text>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
});

// ── CatchGridItem ─────────────────────────────────────────────────────────────

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
          <Text style={{ ...typography.small, color: colors.textMuted, marginTop: 1 }}>
            {new Date(item.date).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

// ── LogbookCalendar ───────────────────────────────────────────────────────────

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
  onOpenCatch: (item: Catch) => void;
  onDeleteCatch: (item: Catch) => void;
  onEditCatch: (item: Catch) => void;
  bottomPad: number;
};

function LogbookCalendar({ catches, colors, onDayPress, selectedDay, calMonth, setCalMonth, personalBests, user, onOpenCatch, onDeleteCatch, onEditCatch, bottomPad }: LogbookCalendarProps) {
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

  const monthLabel = new Date(calMonth.year, calMonth.month, 1).toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' });

  const goToPrev = () => setCalMonth((p) => {
    const m = p.month === 0 ? 11 : p.month - 1;
    return { year: p.month === 0 ? p.year - 1 : p.year, month: m };
  });
  const goToNext = () => setCalMonth((p) => {
    const m = p.month === 11 ? 0 : p.month + 1;
    return { year: p.month === 11 ? p.year + 1 : p.year, month: m };
  });

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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        <Pressable onPress={goToPrev} hitSlop={8} style={{ padding: spacing.sm }}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </Pressable>
        <Text style={{ ...typography.h3, color: colors.text, textTransform: 'capitalize' }}>{monthLabel}</Text>
        <Pressable onPress={goToNext} hitSlop={8} style={{ padding: spacing.sm }}>
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: spacing.md }}>
        {DAY_LABELS.map((lbl) => (
          <View key={lbl} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.xs }}>
            <Text style={{ ...typography.small, color: colors.textMuted, fontWeight: '700' }}>{lbl}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md }}>
        {cells.map((day, idx) => {
          if (day === null) return <View key={`e-${idx}`} style={{ width: `${100 / 7}%`, height: 52 }} />;
          const dateKey = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const hasCatches = catchesByDay.has(dateKey);
          const isSelected = selectedDay === dateKey;
          return (
            <Pressable key={dateKey} onPress={() => { if (hasCatches) onDayPress(dateKey); }} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 }}>
              <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, ...(isSelected ? { backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.primary } : {}) }}>
                <Text style={{ ...typography.body, color: hasCatches ? colors.primary : colors.text, fontWeight: hasCatches ? '700' : '400' }}>{day}</Text>
              </View>
              {hasCatches ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.primary, marginTop: 2 }} /> : <View style={{ width: 5, height: 5, marginTop: 2 }} />}
            </Pressable>
          );
        })}
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm }}>
          {selectedDay
            ? `${new Date(selectedDay + 'T12:00:00').toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })} · ${selectedDayCatches.length} улова`
            : `Месецът · ${selectedDayCatches.length} улова`}
        </Text>
        {selectedDayCatches.length === 0 ? (
          <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg }}>Няма улови</Text>
        ) : (
          selectedDayCatches.map((calItem) => (
            <CatchCard key={calItem.id} item={calItem} colors={colors} personalBests={personalBests} user={user} onPress={onOpenCatch} onDelete={onDeleteCatch} onEdit={onEditCatch} />
          ))
        )}
        <View style={{ height: bottomPad }} />
      </View>
    </ScrollView>
  );
}

// ── LogbookSkeleton ───────────────────────────────────────────────────────────

function LogbookSkeleton() {
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: 8, marginTop: spacing.sm }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} width="100%" height={100} borderRadius={20} />
      ))}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LogbookScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomPad = spacing.md;

  const [items, setItems] = useState<Catch[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Catch | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsynced = items.filter((c) => !c.syncedToCloud).length;
    navigation.getParent()?.setOptions({ tabBarBadge: unsynced > 0 ? unsynced : undefined });
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
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [calSelectedDay, setCalSelectedDay] = useState<string | null>(null);
  const [chipFilter, setChipFilter] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef = useRef(false);
  const celebrationScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (showCelebration) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(celebrationScale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }).start();
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
        if (!v) { setShowCelebration(true); celebrationShownRef.current = true; }
      }).catch(() => {});
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

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
  const uniqueSpeciesCount = useMemo(() => new Set(items.map((c) => c.speciesId ?? c.speciesName)).size, [items]);
  const speciesChipList = useMemo(() => [...new Set(items.map((c) => c.speciesName))].sort((a, b) => a.localeCompare(b, 'bg')), [items]);

  const animatedCount = useCountUp(filtered.length);
  const animatedKgInt = useCountUp(Math.round(totalKg * 10));
  const animatedKg = (animatedKgInt / 10).toFixed(1);

  const filtersActive = !!speciesId || releasedOnly || !!dateFrom || !!dateTo || searchQuery.trim().length > 0;

  const resetFilters = () => {
    setSearchQuery('');
    setSpeciesId(null);
    setReleasedOnly(false);
    setDateFrom(null);
    setDateTo(null);
  };

  const handleStatsLongPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const statsText = `Общо улови: ${items.length}\nВидове: ${uniqueSpeciesCount}\nОбщо кг: ${items.reduce((s, c) => s + (c.weightKg ?? 0), 0).toFixed(1)}`;
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

  const handleSwipeDelete = useCallback((catchItem: Catch) => {
    // If a previous delete is still pending, commit its cloud cleanup NOW
    // so rapid sequential deletes don't leak orphan docs/files.
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      const prev = pendingDelete;
      const uid = user?.uid;
      if (prev && uid) void deleteCatchEverywhere(prev.id, uid);
    }
    setItems((prev) => prev.filter((c) => c.id !== catchItem.id));
    catchesStore.remove(catchItem.id).catch(() => {});
    setPendingDelete(catchItem);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    undoTimerRef.current = setTimeout(() => {
      const uid = user?.uid;
      if (uid) void deleteCatchEverywhere(catchItem.id, uid);
      setPendingDelete(null);
      undoTimerRef.current = null;
    }, 4000);
  }, [user, pendingDelete]);

  // Keep refs in sync so unmount cleanup sees the latest values
  const pendingDeleteRef = useRef<Catch | null>(null);
  const userRef = useRef(user);
  useEffect(() => { pendingDeleteRef.current = pendingDelete; }, [pendingDelete]);
  useEffect(() => { userRef.current = user; }, [user]);

  // On unmount only: commit any pending cloud delete immediately.
  useEffect(() => () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const p = pendingDeleteRef.current;
    const u = userRef.current;
    if (p && u?.uid) void deleteCatchEverywhere(p.id, u.uid);
  }, []);

  const handleSwipeEdit = useCallback((catchItem: Catch) => {
    void Haptics.selectionAsync();
    navigation.navigate('AddCatch', { editCatchId: catchItem.id });
  }, [navigation]);

  const handleUndoDelete = useCallback(async () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (!pendingDelete) return;
    await catchesStore.save(pendingDelete);
    setItems((prev) => [...prev, pendingDelete].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)));
    setPendingDelete(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [pendingDelete]);

  const renderCatchItem = useCallback(({ item }: { item: Catch }) =>
    gridView ? (
      <CatchGridItem item={item} colors={colors} personalBests={personalBests} onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })} />
    ) : (
      <CatchCard item={item} colors={colors} personalBests={personalBests} user={user} onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })} onDelete={handleSwipeDelete} onEdit={handleSwipeEdit} />
    ),
    [gridView, colors, personalBests, user, navigation, handleSwipeDelete, handleSwipeEdit]
  );

  const subtitle = items.length === 0
    ? 'Записвай всеки улов с дата, място и детайли.'
    : `${items.length} ${items.length === 1 ? 'запис' : 'записа'} в дневника`;

  // ── Active filter pill style ──
  const activePill = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.primary };
  const activePillText = { fontSize: 12, fontWeight: '600' as const, color: colors.primary };

  // ── Results header ──
  const ResultsHeader = (
    <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' as const, paddingBottom: 8, paddingTop: 4 }}>
      Резултати · {filtered.length}
    </Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>

      {/* ── Flat header (Strava-style) ── */}
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: spacing.lg, paddingBottom: 12, backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>

        {/* Title row with view toggles */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View>
            <Text style={{ fontSize: 30, fontWeight: '900', color: colors.text, letterSpacing: -0.5 }}>Дневник</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{subtitle}</Text>
          </View>

          {/* Segment control: list / grid / gallery / calendar */}
          <View style={{ flexDirection: 'row', backgroundColor: mode === 'dark' ? colors.surfaceAlt : '#EFEFEF', borderRadius: 10, padding: 3, gap: 2 }}>
            {/* List toggle */}
            <Pressable
              onPress={() => { setGridView(false); setCalendarView(false); }}
              hitSlop={4}
              style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: (!calendarView && !gridView) ? colors.card : 'transparent', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="list-outline" size={18} color={(!calendarView && !gridView) ? colors.primary : colors.textMuted} />
            </Pressable>
            {/* Grid toggle */}
            <Pressable
              onPress={() => { setGridView(true); setCalendarView(false); }}
              hitSlop={4}
              style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: (gridView && !calendarView) ? colors.card : 'transparent', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="grid-outline" size={18} color={(gridView && !calendarView) ? colors.primary : colors.textMuted} />
            </Pressable>
            {/* Gallery */}
            <Pressable
              onPress={() => navigation.navigate('PhotoGallery')}
              hitSlop={4}
              style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="images-outline" size={18} color={colors.textMuted} />
            </Pressable>
            {/* Calendar toggle */}
            <Pressable
              onPress={() => { setCalendarView((v) => !v); setGridView(false); }}
              hitSlop={4}
              style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: calendarView ? colors.card : 'transparent', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="calendar-outline" size={18} color={calendarView ? colors.primary : colors.textMuted} />
            </Pressable>
          </View>
        </View>

        {/* Stats row — 3 columns with hairline dividers */}
        <Pressable onLongPress={handleStatsLongPress} delayLongPress={400}>
          <View style={{ flexDirection: 'row', borderRadius: 14, overflow: 'hidden', backgroundColor: mode === 'dark' ? colors.card : '#F4F6F9', borderWidth: 1, borderColor: colors.border }}>
            {/* Catches */}
            <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{animatedCount}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                {filtersActive ? `из ${items.length}` : items.length === 1 ? 'улов' : 'улова'}
              </Text>
            </View>
            {/* Divider */}
            <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 10 }} />
            {/* Kg */}
            <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{animatedKg}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>кг</Text>
            </View>
            {/* Divider */}
            <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 10 }} />
            {/* Species */}
            <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{uniqueSpeciesCount}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>вида</Text>
            </View>
          </View>
        </Pressable>
      </View>

      {/* ── Content panel ── */}
      <View style={{ flex: 1 }}>

        {/* Search bar + filter button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: mode === 'dark' ? colors.surfaceAlt : '#F2F4F8', borderRadius: 24, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 7 }}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              placeholder="Търси вид, място, бележки..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 }}
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => setFiltersOpen(true)}
            hitSlop={8}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: filtersActive ? colors.primary : (mode === 'dark' ? colors.surfaceAlt : '#F2F4F8'), alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="options-outline" size={20} color={filtersActive ? '#fff' : colors.primary} />
            {filtersActive && (
              <View style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF8C00', borderWidth: 1.5, borderColor: colors.background }} />
            )}
          </Pressable>
        </View>

        {/* Active filter pills */}
        {(dateFrom || dateTo || speciesId || releasedOnly) ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, gap: 6, alignItems: 'center' }}>
            {(dateFrom || dateTo) ? (
              <Pressable onPress={() => { setDateFrom(null); setDateTo(null); }} style={activePill}>
                <Ionicons name="calendar-outline" size={13} color={colors.primary} />
                <Text style={activePillText}>Период</Text>
                <Ionicons name="close" size={13} color={colors.primary} />
              </Pressable>
            ) : null}
            {speciesId ? (
              <Pressable onPress={() => setSpeciesId(null)} style={activePill}>
                <Text style={activePillText}>{speciesList.find((s) => s.id === speciesId)?.nameBg}</Text>
                <Ionicons name="close" size={13} color={colors.primary} />
              </Pressable>
            ) : null}
            {releasedOnly ? (
              <Pressable onPress={() => setReleasedOnly(false)} style={activePill}>
                <Text style={activePillText}>Само пуснати</Text>
                <Ionicons name="close" size={13} color={colors.primary} />
              </Pressable>
            ) : null}
            <Pressable onPress={resetFilters} style={[activePill, { backgroundColor: colors.danger + '18', borderColor: colors.danger }]}>
              <Text style={[activePillText, { color: colors.danger }]}>Изчисти всички</Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {/* Species quick-filter chips */}
        {!initialLoading && speciesChipList.length >= 2 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 6, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
            <Pressable
              onPress={() => { void Haptics.selectionAsync(); setChipFilter(null); }}
              style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: chipFilter === null ? colors.primary : colors.card, borderWidth: 1, borderColor: chipFilter === null ? colors.primary : colors.border }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: chipFilter === null ? '#fff' : colors.text }}>Всички</Text>
            </Pressable>
            {speciesChipList.map((name) => (
              <Pressable
                key={name}
                onPress={() => { void Haptics.selectionAsync(); setChipFilter((prev) => (prev === name ? null : name)); }}
                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: chipFilter === name ? colors.primary : colors.card, borderWidth: 1, borderColor: chipFilter === name ? colors.primary : colors.border, maxWidth: 200 }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: chipFilter === name ? '#fff' : colors.text }} numberOfLines={1}>{name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* Date pickers. iOS `inline` calendar grid; themeVariant locked to app theme
            so the wheel doesn't go invisible when system + app themes disagree. */}
        {pickFrom ? (
          <>
            <DateTimePicker
              mode="date"
              value={dateFrom ?? new Date()}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              themeVariant={mode === 'dark' ? 'dark' : 'light'}
              accentColor={colors.primary}
              textColor={colors.text}
              onChange={(e, d) => { if (Platform.OS === 'android') setPickFrom(false); if (e.type === 'set' && d) setDateFrom(d); }}
            />
            {Platform.OS === 'ios' ? <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }}><Button title="Готово" variant="secondary" compact onPress={() => setPickFrom(false)} /></View> : null}
          </>
        ) : null}
        {pickTo ? (
          <>
            <DateTimePicker
              mode="date"
              value={dateTo ?? new Date()}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              themeVariant={mode === 'dark' ? 'dark' : 'light'}
              accentColor={colors.primary}
              textColor={colors.text}
              onChange={(e, d) => { if (Platform.OS === 'android') setPickTo(false); if (e.type === 'set' && d) setDateTo(d); }}
            />
            {Platform.OS === 'ios' ? <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }}><Button title="Готово" variant="secondary" compact onPress={() => setPickTo(false)} /></View> : null}
          </>
        ) : null}

        {/* Main content */}
        {initialLoading ? (
          <LogbookSkeleton />
        ) : calendarView ? (
          <LogbookCalendar
            catches={filtered}
            colors={colors}
            onDayPress={(date) => setCalSelectedDay((prev) => (prev === date ? null : date))}
            selectedDay={calSelectedDay}
            calMonth={calMonth}
            setCalMonth={setCalMonth}
            personalBests={personalBests}
            user={user}
            onOpenCatch={(c) => navigation.navigate('CatchDetail', { id: c.id })}
            onDeleteCatch={handleSwipeDelete}
            onEditCatch={handleSwipeEdit}
            bottomPad={bottomPad + 8}
          />
        ) : items.length === 0 ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingBottom: bottomPad, gap: spacing.lg }}>
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={{
                width: 88, height: 88, borderRadius: 44,
                backgroundColor: colors.primarySurface,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: colors.border,
              }}>
                <Ionicons name="fish" size={42} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 22, fontFamily: 'Nunito_800ExtraBold', color: colors.text, textAlign: 'center', letterSpacing: -0.3 }}>
                Запиши първия си улов
              </Text>
              <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md }}>
                Снимка, тегло, място — само 30 секунди. Ще го виждаш и в картата, статистиките и класиките.
              </Text>
            </View>
            <Pressable
              onPress={() => navigation.navigate('AddCatch')}
              style={{
                marginHorizontal: spacing.md,
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: colors.primary,
                alignItems: 'center', justifyContent: 'center',
                flexDirection: 'row', gap: 8,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 10,
                elevation: 6,
              }}
            >
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: 'Nunito_800ExtraBold', fontSize: 15 }}>Добави улов</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, flexWrap: 'wrap' }}>
              {[
                { icon: 'camera-outline' as const, label: 'Снимка от камерата' },
                { icon: 'location-outline' as const, label: 'Авто-локация' },
                { icon: 'cloud-outline' as const, label: 'Време + луна' },
              ].map((feat) => (
                <View key={feat.label} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 5,
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1, borderColor: colors.border,
                }}>
                  <Ionicons name={feat.icon} size={12} color={colors.primary} />
                  <Text style={{ fontSize: 11, fontFamily: 'Nunito_600SemiBold', color: colors.textMuted }}>{feat.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : filtered.length === 0 ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingBottom: bottomPad }}>
            <EmptyState
              icon="search-outline"
              title="Няма съвпадения"
              subtitle="Опитай с различни филтри."
              action={{ label: 'Изчисти филтри', onPress: resetFilters }}
            />
          </ScrollView>
        ) : gridView ? (
          <FlatList
            key="grid"
            data={filtered}
            keyExtractor={(item) => item.id}
            numColumns={2}
            removeClippedSubviews={Platform.OS === 'android'}
            contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: bottomPad + 8 }}
            ListHeaderComponent={<View style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.sm }}>{ResultsHeader}</View>}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomPad + 8 }}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ItemSeparatorComponent={null}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', paddingVertical: 10, paddingTop: 16 }}>
                {section.title} · {section.data.length} {section.data.length === 1 ? 'улов' : 'улова'}
              </Text>
            )}
            renderSectionFooter={() => <View style={{ height: 8 }} />}
            ListHeaderComponent={ResultsHeader}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={10}
            {...keyboardAwareScrollProps}
            renderItem={renderCatchItem}
          />
        )}
      </View>

      {/* ── Floating add button ── */}
      <Pressable
        onPress={() => navigation.navigate('AddCatch')}
        style={{ position: 'absolute', bottom: 16, right: spacing.lg, width: 60, height: 60, borderRadius: 30, backgroundColor: '#FF8C00', alignItems: 'center', justifyContent: 'center', shadowColor: '#FF6B00', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.6, shadowRadius: 16, elevation: 12 }}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>

      {/* ── Undo snackbar ── */}
      {pendingDelete ? (
        <View style={{ position: 'absolute', bottom: 88, left: spacing.lg, right: spacing.lg, backgroundColor: mode === 'dark' ? '#2a2a2a' : '#1c1c1c', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: 0, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, overflow: 'hidden' }}>
          {/* Left colored accent stripe */}
          <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: colors.danger, borderRadius: 2 }} />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 0, paddingHorizontal: spacing.lg }}>
            <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.6)" />
            <Text style={{ ...typography.body, color: '#fff', flex: 1 }} numberOfLines={1}>
              {'„'}{pendingDelete.speciesName}{'"'} изтрит
            </Text>
            <Pressable onPress={handleUndoDelete} hitSlop={8}>
              <Text style={{ ...typography.bodyBold, color: colors.primary }}>Отмени</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ── Filters bottom sheet ── */}
      <Modal visible={filtersOpen} animationType="slide" transparent onRequestClose={() => setFiltersOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' } as any} onPress={() => setFiltersOpen(false)} />
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.lg, maxHeight: '88%' }}>
            {/* Handle */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }}>
              <Text style={{ ...typography.h3, color: colors.text, flex: 1 }}>Филтри</Text>
              {filtersActive ? (
                <Pressable onPress={resetFilters} hitSlop={8} style={{ paddingHorizontal: spacing.sm }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary }}>Изчисти</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setFiltersOpen(false)} hitSlop={8} style={{ padding: spacing.xs, marginLeft: 4 }}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Species filter */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.sm, textTransform: 'uppercase' }}>Вид риба</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center', marginBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
                <Pressable onPress={() => setSpeciesId(null)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: speciesId === null ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: speciesId === null ? colors.primary : colors.border }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: speciesId === null ? '#fff' : colors.text }}>Всички</Text>
                </Pressable>
                {speciesList.map((s) => (
                  <Pressable key={s.id} onPress={() => setSpeciesId((prev) => (prev === s.id ? null : s.id))} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: speciesId === s.id ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: speciesId === s.id ? colors.primary : colors.border }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: speciesId === s.id ? '#fff' : colors.text }}>{s.nameBg}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Date range */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.sm, textTransform: 'uppercase' }}>Период</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
                <Pressable onPress={() => setPickFrom(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '700' }}>От</Text>
                    <Text style={{ fontSize: 13, color: dateFrom ? colors.primary : colors.textMuted, fontWeight: '700' }}>{dateFrom ? dateFrom.toLocaleDateString('bg-BG') : 'Избери'}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => setPickTo(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '700' }}>До</Text>
                    <Text style={{ fontSize: 13, color: dateTo ? colors.primary : colors.textMuted, fontWeight: '700' }}>{dateTo ? dateTo.toLocaleDateString('bg-BG') : 'Избери'}</Text>
                  </View>
                </Pressable>
                {(dateFrom || dateTo) ? (
                  <Pressable onPress={() => { setDateFrom(null); setDateTo(null); }} hitSlop={8} style={{ width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
                    <Ionicons name="close" size={20} color={colors.primary} />
                  </Pressable>
                ) : null}
              </View>

              {/* Released only */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginBottom: spacing.xl }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Само пуснати (C&R)</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>Показва само риби, върнати във водата.</Text>
                </View>
                <Switch value={releasedOnly} onValueChange={setReleasedOnly} trackColor={{ false: colors.border, true: colors.primaryLight }} thumbColor="#fff" />
              </View>

              {/* Apply */}
              <Pressable onPress={() => setFiltersOpen(false)} style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: spacing.md + 2, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Приложи</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── First catch celebration ── */}
      <Modal visible={showCelebration} animationType="fade" transparent onRequestClose={() => setShowCelebration(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, margin: spacing.lg, alignItems: 'center' }}>
            <Animated.Text style={{ fontSize: 72, transform: [{ scale: celebrationScale }] }}>🎣</Animated.Text>
            <Text style={{ ...typography.h1, color: colors.primary, marginTop: spacing.lg, textAlign: 'center' }}>Първи улов!</Text>
            <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.md, textAlign: 'center', lineHeight: 22 }}>
              Добре дошъл в дневника! Продължавай да записваш — всеки улов се счита.
            </Text>
            <Pressable
              onPress={() => { setShowCelebration(false); AsyncStorage.setItem('@ribolov/firstCatchCelebrated', '1').catch(() => {}); }}
              style={{ marginTop: spacing.xl, backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill }}
            >
              <Text style={{ ...typography.bodyBold, color: '#fff' }}>Страхотно! 🎉</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
