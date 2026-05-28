import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import type { DocumentSnapshot } from 'firebase/firestore';

import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import AsyncStorage from '../storage/kv';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { EmptyState } from '../components/EmptyState';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { speciesList } from '../data/species';
import { collection, getDocs, limit, orderBy, query, startAt, endAt, startAfter } from 'firebase/firestore';
import { ensureFirebase } from '../services/firebase';
import { useAuth } from '../services/authContext';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { getBlockedUids } from '../services/blockUser';
import type { RootStackParamList } from '../navigation/types';

type Tab = 'users' | 'waters' | 'species';
type UserResult = { uid: string; displayName: string; city?: string; photoUrl?: string };

// Highest Unicode sort character — used to bound prefix queries
const PREFIX_END = '';
const PAGE_SIZE = 20;

export default function SearchScreen() {
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Search'>>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('users');
  // Pre-seed the input from route.params.initialQuery. Callers like
  // PostDetailScreen pass a tapped @handle here — previously the value was
  // ignored, so users landed on a blank search with their handle as
  // placeholder-only and had to retype it. The auto-search effect below
  // fires the lookup immediately so the result list lands without a
  // second tap.
  const [query2, setQuery2] = useState(route.params?.initialQuery ?? '');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const lastUserDocRef = useRef<DocumentSnapshot | null>(null);
  const activeQueryRef = useRef('');
  // Cached block list so we filter every fresh query AND every paginated
  // loadMore. Without this, a blocked user shows up in search results
  // (privacy violation — the searcher can navigate to a profile they
  // explicitly blocked, and worse, a user who blocked THIS user can be
  // searched and contacted). Refreshed each fresh query so a mid-session
  // block becomes effective immediately.
  const blockedUidsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem('@ribolov/recentSearches').then((v) => {
      if (v) setRecentSearches(JSON.parse(v) as string[]);
    }).catch(() => {});
  }, []);

  // Auto-search when the screen mounts with an initialQuery param. Fires
  // once per route entry (re-navigating with a different param re-fires).
  // Triggers only for the default 'users' tab — water + species are
  // synchronous useMemo lookups that already pick up query2 on the
  // first render without needing an explicit kick.
  const autoSearchedForRef = useRef<string | null>(null);
  useEffect(() => {
    const initial = route.params?.initialQuery?.trim();
    if (!initial || initial.length < 2) return;
    if (autoSearchedForRef.current === initial) return;
    autoSearchedForRef.current = initial;
    void searchUsers(initial);
    // intentionally omit searchUsers from deps — it's stable across renders
    // and including it would re-run this effect every time `user.uid`
    // changes (which would re-kick the auto-search on auth state flips).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.initialQuery]);

  const saveSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 6);
      AsyncStorage.setItem('@ribolov/recentSearches', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
      backgroundColor: colors.card,
    },
    searchWrap: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surfaceAlt, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, gap: spacing.sm,
    },
    input: {
      flex: 1, paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
      fontSize: 16, color: colors.text,
    },
    tabs: {
      flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    tabBtn: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    },
    tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { ...typography.small, color: colors.text, fontWeight: '600' },
    tabTextActive: { color: colors.white },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    iconWrap: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center',
    },
    rowTitle: { ...typography.bodyBold, color: colors.text },
    rowSub: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    empty: {
      ...typography.body, color: colors.textMuted,
      textAlign: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.xl,
    },
    loadMore: {
      paddingVertical: spacing.md, alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    loadMoreText: { ...typography.bodyBold, color: colors.primary },
  }), [colors, insets.top]);

  const toResult = (d: { id: string; data: () => unknown }): UserResult => {
    const data = d.data() as { displayName?: string; city?: string; photoUrl?: string };
    return { uid: d.id, displayName: data.displayName ?? 'Рибар', city: data.city, photoUrl: data.photoUrl };
  };

  const searchUsers = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setUserResults([]);
      setHasMore(false);
      lastUserDocRef.current = null;
      return;
    }
    activeQueryRef.current = trimmed;
    setSearching(true);
    lastUserDocRef.current = null;
    try {
      const fb = ensureFirebase();
      if (!fb) return;
      // Refresh the block list per fresh query so a recent block applies.
      // `getBlockedUids` is server-cached so the cost is low.
      if (user?.uid) {
        blockedUidsRef.current = await getBlockedUids(user.uid).catch(() => new Set<string>());
      }
      const snap = await getDocs(
        query(
          collection(fb.db, 'users'),
          orderBy('displayName'),
          startAt(trimmed),
          endAt(trimmed + PREFIX_END),
          limit(PAGE_SIZE + 1)
        )
      );
      if (activeQueryRef.current !== trimmed) return; // stale result from previous query
      const docs = snap.docs.slice(0, PAGE_SIZE);
      lastUserDocRef.current = docs[docs.length - 1] ?? null;
      setHasMore(snap.docs.length > PAGE_SIZE);
      const blocked = blockedUidsRef.current;
      setUserResults(docs.map(toResult).filter((r) => r.uid !== user?.uid && !blocked.has(r.uid)));
    } catch {
      setUserResults([]);
      setHasMore(false);
    } finally {
      setSearching(false);
    }
  }, [user?.uid]);

  const loadMoreUsers = useCallback(async () => {
    // Pair the cursor with the query that produced it. Using `query2` state
    // here would mismatch if the user typed something new before infinite
    // scroll fires — Firestore would startAfter a doc from the OLD query
    // anchored to the NEW prefix, yielding stale/empty results.
    const trimmed = activeQueryRef.current;
    if (loadingMore || !hasMore || !lastUserDocRef.current || trimmed.length < 2) return;
    setLoadingMore(true);
    try {
      const fb = ensureFirebase();
      if (!fb) return;
      const snap = await getDocs(
        query(
          collection(fb.db, 'users'),
          orderBy('displayName'),
          startAt(trimmed),
          endAt(trimmed + PREFIX_END),
          startAfter(lastUserDocRef.current),
          limit(PAGE_SIZE + 1)
        )
      );
      // If the active query changed while we were awaiting, discard the page.
      if (activeQueryRef.current !== trimmed) return;
      const docs = snap.docs.slice(0, PAGE_SIZE);
      lastUserDocRef.current = docs[docs.length - 1] ?? null;
      setHasMore(snap.docs.length > PAGE_SIZE);
      const blocked = blockedUidsRef.current;
      setUserResults((prev) => [
        ...prev,
        ...docs.map(toResult).filter((r) => r.uid !== user?.uid && !blocked.has(r.uid)),
      ]);
    } catch {
      // silent — user can scroll back and retry
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, user?.uid]);

  const waterResults = useMemo(() => {
    const q = query2.trim().toLowerCase();
    if (!q) return [];
    const dams = DAMS.filter((d) => d.name.toLowerCase().includes(q) || d.region.toLowerCase().includes(q))
      .slice(0, 10).map((d) => ({ id: d.id, name: d.name, sub: d.region, kind: 'dam' as const }));
    const rivers = RIVERS.filter((r) => r.name.toLowerCase().includes(q) || r.region.toLowerCase().includes(q))
      .slice(0, 10).map((r) => ({ id: r.id, name: r.name, sub: r.region, kind: 'river' as const }));
    return [...dams, ...rivers];
  }, [query2]);

  const speciesResults = useMemo(() => {
    const q = query2.trim().toLowerCase();
    if (!q) return [];
    return speciesList.filter((s) => s.nameBg.toLowerCase().includes(q) || s.nameLatin.toLowerCase().includes(q));
  }, [query2]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const handleQueryChange = (text: string) => {
    setQuery2(text);
    if (tab !== 'users') return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) {
      setUserResults([]);
      setHasMore(false);
      lastUserDocRef.current = null;
      return;
    }
    searchTimer.current = setTimeout(() => { void searchUsers(text); }, 250);
  };

  const handleSubmitSearch = () => {
    saveSearch(query2);
  };

  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === 'users') searchUsers(query2);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </Pressable>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            placeholder="Търси..."
            placeholderTextColor={colors.textMuted}
            value={query2}
            onChangeText={handleQueryChange}
            onSubmitEditing={handleSubmitSearch}
            style={styles.input}
            autoFocus
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
      </View>

      <View style={styles.tabs}>
        {(['users', 'waters', 'species'] as Tab[]).map((t) => {
          const label = t === 'users' ? 'Рибари' : t === 'waters' ? 'Водоеми' : 'Видове';
          const active = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              onPress={() => {
                void Haptics.selectionAsync();
                handleTabChange(t);
              }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {query2.trim() === '' && recentSearches.length > 0 && (
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 11, fontFamily: 'Nunito_700Bold', color: colors.textMuted, letterSpacing: 0.5 }}>ПОСЛЕДНИ ТЪРСЕНИЯ</Text>
            <Pressable onPress={() => { setRecentSearches([]); AsyncStorage.removeItem('@ribolov/recentSearches').catch(() => {}); }}>
              <Text style={{ fontSize: 11, fontFamily: 'Nunito_600SemiBold', color: colors.primary }}>Изчисти</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recentSearches.map((s) => (
              <Pressable key={s} onPress={() => { setQuery2(s); if (tab === 'users') searchUsers(s); }}
                style={{ backgroundColor: colors.primarySurface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.cardEdge }}>
                <Text style={{ fontSize: 12, fontFamily: 'Nunito_600SemiBold', color: colors.primary }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {tab === 'users' && (
        <FlatList
          data={userResults}
          keyExtractor={(u) => u.uid}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreUsers}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            // Suppress while a search is in flight so the empty state
            // doesn't flicker between "loading" and "no results" before
            // the request resolves.
            query2.length < 2 ? (
              <EmptyState
                icon="people-outline"
                title="Намери рибари"
                subtitle="Въведи поне 2 букви от името."
              />
            ) : searching ? null : (
              <EmptyState
                icon="search-outline"
                title="Няма намерени рибари"
                subtitle="Опитай с друго или по-пълно име."
              />
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadMore}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : hasMore ? (
              <Pressable style={styles.loadMore} onPress={loadMoreUsers}>
                <Text style={styles.loadMoreText}>Зареди още</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                void Haptics.selectionAsync();
                navigation.navigate('UserPublicProfile', { uid: item.uid, displayName: item.displayName, photoUrlHint: item.photoUrl });
              }}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="person-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.displayName}</Text>
                {item.city ? <Text style={styles.rowSub}>{item.city}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}

      {tab === 'waters' && (
        <FlatList
          data={waterResults}
          keyExtractor={(w) => w.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query2.trim().length === 0 ? (
              <EmptyState
                icon="water-outline"
                title="Намери водоем"
                subtitle="Въведи название на язовир или река."
              />
            ) : (
              <EmptyState
                icon="search-outline"
                title="Няма намерени водоеми"
                subtitle="Провери правописа или опитай с друго название."
              />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                void Haptics.selectionAsync();
                navigation.navigate('WaterDetail', { kind: item.kind, id: item.id });
              }}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.kind === 'dam' ? 'layers-outline' : 'git-branch-outline'} size={20} color={item.kind === 'dam' ? colors.primary : '#2E9B5A'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowSub}>{item.sub} · {item.kind === 'dam' ? 'Язовир' : 'Река'}</Text>
              </View>
              <Ionicons name="map-outline" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}

      {tab === 'species' && (
        <FlatList
          data={speciesResults}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query2.trim().length === 0 ? (
              <EmptyState
                icon="fish-outline"
                emoji="🐟"
                title="Намери вид риба"
                subtitle="Въведи вид на български или латински."
              />
            ) : (
              <EmptyState
                icon="search-outline"
                title="Няма намерени видове"
                subtitle="Опитай с друго название."
              />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                void Haptics.selectionAsync();
                navigation.navigate('Main', {
                  screen: 'ProfileTab',
                  params: { screen: 'Species', params: { screen: 'SpeciesDetail', params: { id: item.id } } },
                });
              }}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="fish-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.nameBg}</Text>
                <Text style={styles.rowSub}>{item.nameLatin}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
