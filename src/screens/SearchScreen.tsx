import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { speciesList } from '../data/species';
import { collection, getDocs, limit, orderBy, query, startAt, endAt, startAfter } from 'firebase/firestore';
import { ensureFirebase } from '../services/firebase';
import { useAuth } from '../services/authContext';
import { useAppNavigation } from '../navigation/useAppNavigation';

type Tab = 'users' | 'waters' | 'species';
type UserResult = { uid: string; displayName: string; city?: string; photoUrl?: string };

// Highest Unicode sort character — used to bound prefix queries
const PREFIX_END = '';
const PAGE_SIZE = 20;

export default function SearchScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('users');
  const [query2, setQuery2] = useState('');
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const lastUserDocRef = useRef<DocumentSnapshot | null>(null);
  const activeQueryRef = useRef('');

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
      setUserResults(docs.map(toResult).filter((r) => r.uid !== user?.uid));
    } catch {
      setUserResults([]);
      setHasMore(false);
    } finally {
      setSearching(false);
    }
  }, [user?.uid]);

  const loadMoreUsers = useCallback(async () => {
    const trimmed = query2.trim();
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
      const docs = snap.docs.slice(0, PAGE_SIZE);
      lastUserDocRef.current = docs[docs.length - 1] ?? null;
      setHasMore(snap.docs.length > PAGE_SIZE);
      setUserResults((prev) => [
        ...prev,
        ...docs.map(toResult).filter((r) => r.uid !== user?.uid),
      ]);
    } catch {
      // silent — user can scroll back and retry
    } finally {
      setLoadingMore(false);
    }
  }, [query2, loadingMore, hasMore, user?.uid]);

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

  const handleQueryChange = (text: string) => {
    setQuery2(text);
    if (tab === 'users') searchUsers(text);
  };

  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === 'users') searchUsers(query2);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </Pressable>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            placeholder="Търси..."
            placeholderTextColor={colors.textMuted}
            value={query2}
            onChangeText={handleQueryChange}
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
            <Pressable key={t} style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={() => handleTabChange(t)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'users' && (
        <FlatList
          data={userResults}
          keyExtractor={(u) => u.uid}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreUsers}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query2.length < 2 ? 'Въведи поне 2 букви за търсене на рибари' : searching ? '' : 'Няма намерени рибари'}
            </Text>
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
              onPress={() => navigation.navigate('UserPublicProfile', { uid: item.uid, displayName: item.displayName, photoUrlHint: item.photoUrl })}
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
            <Text style={styles.empty}>
              {query2.trim().length === 0 ? 'Въведи название на язовир или река' : 'Няма намерени водоеми'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('Main', {
                screen: 'MapTab',
                params: item.kind === 'dam' ? { focusDamId: item.id } : { focusRiverId: item.id },
              })}
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
            <Text style={styles.empty}>
              {query2.trim().length === 0 ? 'Въведи вид риба на български или латински' : 'Няма намерени видове'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('Main', {
                screen: 'ProfileTab',
                params: { screen: 'Species', params: { screen: 'SpeciesDetail', params: { id: item.id } } },
              })}
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
