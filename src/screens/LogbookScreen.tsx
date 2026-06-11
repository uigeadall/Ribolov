import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  TextInput,
  ScrollView,
  Switch,
  Platform,
  Modal,
  Share,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '../storage/kv';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useAuth } from '../services/authContext';
import { deleteCatchEverywhere } from '../services/cloudSync';
import { forceRetryCatchSync, getPendingCatchSyncCount } from '../services/catchSyncQueue';
import Toast from 'react-native-toast-message';
import { computePersonalBests, isPersonalBestCatch } from '../services/personalBests';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { Skeleton } from '../components/Skeleton';
import { ComposeFab } from '../components/ComposeFab';
import { useCountUp } from '../hooks/useCountUp';
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

/** Sort catches newest-first. Coalesces unparseable dates to 0 so the
 *  comparator never returns NaN — Array.prototype.sort with a NaN result is
 *  undefined behavior and produced nondeterministic ordering for any catch
 *  with a malformed `date` field. */
function byDateDesc(a: { date: string }, b: { date: string }): number {
  return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
}

// useCountUp moved to src/hooks/useCountUp.ts (Animated-based). Removed the
// rAF-based local copy that duplicated it. The shared hook returns the raw
// animated float so decimal callers (animatedKg below) can format precisely;
// integer callers wrap with Math.round at the call site.

// ── CatchCard ─────────────────────────────────────────────────────────────────

type CatchCardProps = {
  item: Catch;
  colors: AppColors;
  personalBests: ReturnType<typeof computePersonalBests>;
  user: { uid: string } | null;
  onPress: (item: Catch) => void;
  onDelete: (item: Catch) => void;
  onEdit: (item: Catch) => void;
  onRetrySync: (item: Catch) => void;
};

const CatchCard = React.memo(function CatchCard({
  item, colors, personalBests, user, onPress, onDelete, onEdit, onRetrySync,
}: CatchCardProps) {
  const isPB = isPersonalBestCatch(item, personalBests);
  const accent = speciesAccent(item.speciesName);

  const renderRightActions = () => (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginBottom: 12, marginLeft: 6 }}>
      <Pressable
        onPress={() => { void Haptics.selectionAsync(); onEdit(item); }}
        // Edit button widened to 84px and label shortened to "Промени" — the
        // original "Редактирай" wrapped onto two lines at 70px width / fontSize 11.
        style={{ backgroundColor: colors.primary, width: 84, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14, marginRight: 6 }}
      >
        <Ionicons name="pencil-outline" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>Промени</Text>
      </Pressable>
      <Pressable
        onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onDelete(item); }}
        style={{ backgroundColor: colors.danger, width: 84, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14 }}
      >
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>Изтрий</Text>
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
      <Ionicons name="share-outline" size={20} color={colors.onAccent} />
      <Text style={{ color: colors.onAccent, fontSize: 11, fontWeight: '700' }}>Сподели</Text>
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
                // Tap to force-retry the upload. Without this, an abandoned
                // upload (queue gave up after MAX_ATTEMPTS) silently stays
                // local with a file:// photoUri — the user has no way to
                // recover the photo. The pill is small but tappable with a
                // generous hit slop.
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); onRetrySync(item); }}
                  hitSlop={10}
                  style={{
                    position: 'absolute',
                    bottom: 6,
                    right: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 12,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Опитай отново качване"
                >
                  <Ionicons name="cloud-upload-outline" size={12} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Опитай отново</Text>
                </Pressable>
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
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); onRetrySync(item); }}
                  hitSlop={8}
                  style={{ marginLeft: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel="Опитай отново синхронизация"
                >
                  <Ionicons name="cloud-upload-outline" size={14} color={colors.textMuted} />
                </Pressable>
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
  onRetrySync: (item: Catch) => void;
  bottomPad: number;
  refreshing: boolean;
  onRefresh: () => void;
};

function LogbookCalendar({ catches, colors, onDayPress, selectedDay, calMonth, setCalMonth, personalBests, user, onOpenCatch, onDeleteCatch, onEditCatch, onRetrySync, bottomPad, refreshing, onRefresh }: LogbookCalendarProps) {
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
        return all.sort(byDateDesc);
      })();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
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
            <CatchCard key={calItem.id} item={calItem} colors={colors} personalBests={personalBests} user={user} onPress={onOpenCatch} onDelete={onDeleteCatch} onEdit={onEditCatch} onRetrySync={onRetrySync} />
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

  // Track the previous signed-in uid so we can detect a TRUE sign-out
  // (had a user → now don't) vs the "never signed in" state common on
  // APK sideloads where the user opens Logbook before authenticating.
  // Previous version wiped items whenever `!user`, which made the entire
  // logbook appear empty on the APK because Logbook is designed to work
  // locally with or without auth — most users on a fresh install have
  // local catches but no Firebase account yet.
  const prevUserUidRef = useRef<string | null>(null);
  useEffect(() => {
    const currentUid = user?.uid ?? null;
    const hadUser = prevUserUidRef.current !== null;
    const isSignedOut = currentUid === null;

    if (hadUser && isSignedOut) {
      // Sign-out cleanup: drop transient UI state (pending undo, tab badge)
      // but keep `items` — local catches survive sign-out now, and the same
      // user signing back in expects to see their logbook intact. Wiping
      // items here would create a flash of "no catches" before the next
      // focus reload restores them.
      if (pendingDelete !== null) setPendingDelete(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      navigation.getParent()?.setOptions({ tabBarBadge: undefined });
    } else if (currentUid !== null) {
      // Signed in — refresh the tab badge to show the count of unsynced
      // catches (zero hides the badge).
      const unsynced = items.filter((c) => !c.syncedToCloud).length;
      navigation.getParent()?.setOptions({ tabBarBadge: unsynced > 0 ? unsynced : undefined });
    }
    // The "never signed in" case (hadUser=false, isSignedOut=true) is a
    // deliberate no-op — local catches stay on screen, no badge work
    // needed since the parent navigator handles the unauthenticated
    // tab badge state directly.

    prevUserUidRef.current = currentUid;
  }, [items, user, navigation, pendingDelete]);

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

  // The first-catch celebration that used to live here was removed in favor
  // of the richer FirstCatchCelebration modal owned by AddCatchScreen
  // (confetti + photo + share CTA). The previous setup fired BOTH modals
  // back-to-back on the user's first save — they were keyed on different
  // AsyncStorage flags so neither suppressed the other.

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setInitialLoading(true);
    try {
      const list = await catchesStore.list();
      setItems(list);
    } catch {
      // AsyncStorage read failure leaves `items` at its previous value rather
      // than clearing it — better to show slightly-stale data than blank the
      // screen on a transient read error. The pull-to-refresh RefreshControl
      // exists for the user to retry. Toast surfaces the failure so they
      // know to retry instead of silently believing the empty/old state.
      Toast.show({
        type: 'error',
        text1: 'Не успяхме да заредим уловите',
        text2: 'Дръпни надолу за нов опит.',
        visibilityTime: 2800,
      });
    } finally {
      // Always clear the skeleton — without this, the spinner stays on
      // screen forever after a failed read.
      setInitialLoading(false);
    }
  }, []);

  // First focus shows the skeleton (no cached data yet). Every subsequent
  // focus — including returning from AddCatch — reuses items in memory and
  // refreshes silently. catchesStore.list() is cheap (memory cache hit),
  // so the reload itself is fast; the toggle to initialLoading=true was
  // what caused the visible flash.
  const initialFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    if (initialFocusRef.current) {
      initialFocusRef.current = false;
      void load();
    } else {
      void load(true);
    }
  }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return items.filter((c) => {
      if (speciesId && c.speciesId !== speciesId) return false;
      if (chipFilter && c.speciesName !== chipFilter) return false;
      if (releasedOnly && !c.released) return false;
      // Only apply the date filter if we have a parseable date. Without the
      // isFinite guard, NaN from a malformed `c.date` is neither `< startOfDay`
      // nor `> endOfDay` — both comparisons return false → the bad-date catch
      // sneaks past the user's date range every time. Filtering it out gives
      // predictable behaviour (the range hides it) and stops a single
      // legacy/corrupt row from polluting tightly-scoped queries.
      if (dateFrom || dateTo) {
        const t = Date.parse(c.date);
        if (!Number.isFinite(t)) return false;
        if (dateFrom && t < startOfDay(dateFrom)) return false;
        if (dateTo && t > endOfDay(dateTo)) return false;
      }
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
    const sorted = [...filtered].sort(byDateDesc);
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
    //
    // Read pendingDelete from the ref, not the useCallback closure: two
    // swipes within the same React render tick (or before React commits
    // the setPendingDelete from the first swipe) both saw `pendingDelete`
    // as the value from when the callback was last rebuilt — typically
    // the previous render's value, often `null`. With that stale read,
    // the first-swipe's catch never got its cloud delete fired,
    // orphaning it. The ref is updated by the effect below, so it
    // reflects whatever React has committed at the moment of the second
    // swipe.
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      const prev = pendingDeleteRef.current;
      const uid = userRef.current?.uid;
      if (prev && uid) void deleteCatchEverywhere(prev.id, uid);
    }
    setItems((prev) => prev.filter((c) => c.id !== catchItem.id));
    setPendingDelete(catchItem);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // Restore the optimistic delete on local storage failure (AsyncStorage
    // full, quota hit). Without rollback, the user sees the row disappear
    // and a fresh focus reload silently restores it from disk — leaving them
    // confused. Surfacing the error + restoring keeps the UI honest.
    //
    // The rollback only fires when this specific catch is still the pending
    // one — rapid sequential swipes can have the FIRST catch's rejection
    // resolve after the SECOND swipe has already moved on, and mutating
    // pendingDelete / undoTimerRef unconditionally would corrupt the
    // second swipe's undo window. Always restore the row to items either
    // way: a failed local-delete means the catch is still on disk, so it
    // belongs back in the list regardless of what's currently pending.
    catchesStore.remove(catchItem.id).catch(() => {
      setItems((prev) => [...prev, catchItem].sort(byDateDesc));
      if (pendingDeleteRef.current?.id === catchItem.id) {
        setPendingDelete(null);
        if (undoTimerRef.current) {
          clearTimeout(undoTimerRef.current);
          undoTimerRef.current = null;
        }
      }
      Toast.show({
        type: 'error',
        text1: 'Изтриването не успя',
        text2: 'Опитай отново след малко.',
        visibilityTime: 2500,
      });
    });
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

  // Tap-to-retry on the cloud-upload pill for unsynced catches. Re-enqueues
  // with a fresh attempt count and flushes immediately so the user sees the
  // pill disappear when the upload finally succeeds.
  const handleRetrySync = useCallback(async (catchItem: Catch) => {
    if (!user) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await forceRetryCatchSync(catchItem.id, false, {
        user: { uid: user.uid, displayName: user.displayName, email: user.email },
      });
      // Refresh the local catch list — the queue updated syncedToCloud on
      // success, but our items state needs a re-read to mirror it.
      const fresh = await catchesStore.list();
      setItems(fresh.sort(byDateDesc));
      Toast.show({ type: 'success', text1: 'Опитваме отново…', visibilityTime: 1500 });
    } catch {
      Toast.show({ type: 'error', text1: 'Грешка', text2: 'Опитай отново по-късно.', visibilityTime: 2000 });
    }
  }, [user]);

  // Bulk-retry all pending uploads — fires from the header pill so a user
  // who sees "3 улова чакат качване" can flush them with one tap instead of
  // tap-to-retry per row.
  //
  // Source the count from getPendingCatchSyncCount (the actual queue) rather
  // than items.filter(!syncedToCloud). The two can diverge: a catch can be
  // in the queue but missing from items (synced and removed locally), or
  // marked synced in items but the queue still has it pending a retry. The
  // earlier derived count occasionally lied either way.
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  const refreshPendingCount = useCallback(async () => {
    try {
      const n = await getPendingCatchSyncCount();
      setPendingUploadCount(n);
    } catch {
      /* best-effort */
    }
  }, []);
  // Re-read on every load (initial + focus + refresh) so the pill follows
  // the queue, not the local items list.
  useEffect(() => { void refreshPendingCount(); }, [items, refreshPendingCount]);

  const handleRetryAll = useCallback(async () => {
    if (!user) return;
    const pending = items.filter((c) => !c.syncedToCloud);
    if (pending.length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Neutral "started" toast — short visibility so it's gone by the time
    // the result toast appears. Earlier this was a success-styled toast
    // fired before any retry had run, which became a lie when every retry
    // failed (user saw a green checkmark + no UI change = silent failure).
    Toast.show({ type: 'info', text1: 'Опитваме отново…', visibilityTime: 1200 });
    const results = await Promise.allSettled(
      pending.map((c) =>
        forceRetryCatchSync(c.id, false, {
          user: { uid: user.uid, displayName: user.displayName, email: user.email },
        }),
      ),
    );
    const fresh = await catchesStore.list();
    setItems(fresh.sort(byDateDesc));
    void refreshPendingCount();
    // Compare what's still pending after the retry against what we attempted —
    // gives us the actual succeeded count even if forceRetryCatchSync
    // rejected without the catch making it through (e.g. queue-side error
    // before push). Falls back to settled outcome counts when items
    // haven't refreshed yet.
    const stillPending = new Set(fresh.filter((c) => !c.syncedToCloud).map((c) => c.id));
    const succeeded = pending.filter((c) => !stillPending.has(c.id)).length;
    const failed = pending.length - succeeded;
    if (failed === 0) {
      Toast.show({
        type: 'success',
        text1: succeeded === 1 ? 'Уловът е качен' : `${succeeded} улова са качени`,
        visibilityTime: 2000,
      });
    } else if (succeeded === 0) {
      const rejected = results.filter((r) => r.status === 'rejected');
      Toast.show({
        type: 'error',
        text1: 'Качването не успя',
        text2: rejected.length === 1 ? 'Опитай отново след малко.' : 'Провери връзката.',
        visibilityTime: 3000,
      });
    } else {
      Toast.show({
        type: 'info',
        text1: `${succeeded} качени · ${failed} чакат`,
        text2: 'Останалите ще опитаме автоматично.',
        visibilityTime: 2500,
      });
    }
  }, [user, items, refreshPendingCount]);

  const handleUndoDelete = useCallback(async () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      // Null out the ref so a subsequent swipe's "is there a pending timer?"
      // check doesn't see this stale handle and skip its commit-now branch.
      // (Pre-fix: clearTimeout-then-leave-non-null meant the next swipe
      // tried to commit a delete for an item that was already undone.)
      undoTimerRef.current = null;
    }
    if (!pendingDelete) return;
    await catchesStore.save(pendingDelete);
    setItems((prev) => [...prev, pendingDelete].sort(byDateDesc));
    setPendingDelete(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [pendingDelete]);

  const renderCatchItem = useCallback(({ item }: { item: Catch }) =>
    gridView ? (
      <CatchGridItem item={item} colors={colors} personalBests={personalBests} onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })} />
    ) : (
      <CatchCard item={item} colors={colors} personalBests={personalBests} user={user} onPress={(c) => navigation.navigate('CatchDetail', { id: c.id })} onDelete={handleSwipeDelete} onEdit={handleSwipeEdit} onRetrySync={handleRetrySync} />
    ),
    [gridView, colors, personalBests, user, navigation, handleSwipeDelete, handleSwipeEdit, handleRetrySync]
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
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 30, fontWeight: '900', color: colors.text, letterSpacing: -0.5 }}>Дневник</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{subtitle}</Text>
            {/* Sync-queue pill — closes the "did my catch save?" loop that
                previously left users guessing while the queue worked in the
                background. Tap to bulk-retry. */}
            {user && pendingUploadCount > 0 ? (
              <Pressable
                onPress={handleRetryAll}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  alignSelf: 'flex-start',
                  marginTop: 6,
                  paddingHorizontal: 10, paddingVertical: 4,
                  borderRadius: 12,
                  backgroundColor: colors.primarySurface,
                  borderWidth: 1, borderColor: colors.primary + '44',
                }}
                accessibilityRole="button"
                accessibilityLabel="Опитай качването отново"
              >
                <Ionicons name="cloud-upload-outline" size={13} color={colors.primary} />
                <Text style={{ fontSize: 11, fontFamily: 'Manrope_700Bold', color: colors.primary }}>
                  {pendingUploadCount === 1
                    ? '1 улов чака качване'
                    : `${pendingUploadCount} улова чакат качване`}
                </Text>
              </Pressable>
            ) : null}
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
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{Math.round(animatedCount)}</Text>
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
            onRetrySync={handleRetrySync}
            bottomPad={bottomPad + 8}
            refreshing={refreshing}
            onRefresh={onRefresh}
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
              <Text style={{ fontSize: 22, fontFamily: 'Manrope_800ExtraBold', color: colors.text, textAlign: 'center', letterSpacing: -0.3 }}>
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
              <Text style={{ color: '#fff', fontFamily: 'Manrope_800ExtraBold', fontSize: 15 }}>Добави улов</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, flexWrap: 'wrap' }}>
              {[
                { icon: 'camera-outline' as const, label: 'Снимка' },
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
                  <Text style={{ fontSize: 11, fontFamily: 'Manrope_600SemiBold', color: colors.textMuted }}>{feat.label}</Text>
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
          <FlashList
            key="grid"
            data={filtered}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: bottomPad + 8 }}
            ListHeaderComponent={<View style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.sm }}>{ResultsHeader}</View>}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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

      {/* The previous "add catch" FAB used to live here. Removed in favor of
          the unified ComposeFab (rendered below) which opens an action sheet
          for both "Сподели улов" and "Напиши пост". Two pluses on one screen
          confused users — they tapped the orange one thinking it would also
          show the post option. */}

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
                <Pressable onPress={() => { setPickTo(false); setPickFrom(true); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '700' }}>От</Text>
                    <Text style={{ fontSize: 13, color: dateFrom ? colors.primary : colors.textMuted, fontWeight: '700' }}>{dateFrom ? dateFrom.toLocaleDateString('bg-BG') : 'Избери'}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => { setPickFrom(false); setPickTo(true); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
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

      {/* Compose FAB — same component as Home and Feed for consistency. */}
      <ComposeFab />
    </View>
  );
}
