import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Text, StyleSheet, View, Pressable, FlatList, Modal, ActivityIndicator,
} from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import { ensureFirebase } from '../services/firebase';
import type { ProfileStackParamList } from '../navigation/types';
import type { Tournament } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { shadowCard } from '../theme/shadows';
import { useAuth } from '../services/authContext';
import { joinTournament } from '../services/cloudSync';
import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import {
  fetchTournamentPhotoEntries,
  getMyLikedEntries,
  submitCatchToTournament,
  toggleTournamentEntryLike,
  type TournamentPhotoEntry,
} from '../services/tournaments';
import { useAppNavigation } from '../navigation/useAppNavigation';

type R = RouteProp<ProfileStackParamList, 'TournamentDetail'>;

export default function TournamentDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const [entries, setEntries] = useState<TournamentPhotoEntry[]>([]);
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [myCatches, setMyCatches] = useState<Catch[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [viewer, setViewer] = useState<TournamentPhotoEntry | null>(null);

  useEffect(() => {
    const fb = ensureFirebase();
    if (!fb) { setT(null); return; }
    getDoc(doc(fb.db, 'tournaments', route.params.id)).then((snap) => {
      setT(snap.exists() ? (snap.data() as Tournament) : null);
    });
  }, [route.params.id]);

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      const list = await fetchTournamentPhotoEntries(route.params.id);
      setEntries(list);
      if (user?.uid && list.length > 0) {
        const liked = await getMyLikedEntries(route.params.id, user.uid, list.map((e) => e.id));
        setMyLikes(liked);
      }
    } finally {
      setEntriesLoading(false);
    }
  }, [route.params.id, user?.uid]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs,
    },
    screenTitle: { ...typography.h2, color: colors.text, flex: 1 },
    meta: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    body: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
    sectionLabel: {
      ...typography.overline, color: colors.textMuted, letterSpacing: 1,
      marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm,
    },
    entryCard: {
      marginHorizontal: spacing.lg, marginBottom: spacing.md,
      borderRadius: radius.lg, overflow: 'hidden',
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardEdge,
      ...shadowCard(mode),
    },
    photo: { width: '100%', height: 220 },
    entryFooter: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm,
    },
    ownerName: { ...typography.bodyBold, color: colors.text, flex: 1, fontSize: 14 },
    species: { ...typography.caption, color: colors.textMuted },
    likeBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: spacing.md, paddingVertical: 7,
      borderRadius: radius.pill, backgroundColor: colors.primarySurface,
    },
    likeCount: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    pickCatchItem: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    pickThumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.primarySurface },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      maxHeight: '75%', borderTopWidth: 1, borderTopColor: colors.border,
    },
    modalHandle: {
      width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
      alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.md,
    },
    modalTitle: { ...typography.h3, color: colors.text, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  }), [colors, mode]);

  const onJoin = async () => {
    if (!user || !t) return;
    setBusy(true);
    try {
      await joinTournament(t.id, user.uid, user.displayName || user.email || 'Рибар');
      Toast.show({ type: 'success', text1: 'Записан си!', text2: `Участваш в „${t.name}".`, visibilityTime: 2500 });
    } finally {
      setBusy(false);
    }
  };

  const onLike = async (entry: TournamentPhotoEntry) => {
    if (!user?.uid) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isLiked = myLikes.has(entry.id);
    setMyLikes((prev) => {
      const next = new Set(prev);
      isLiked ? next.delete(entry.id) : next.add(entry.id);
      return next;
    });
    setEntries((prev) =>
      prev.map((e) => e.id === entry.id ? { ...e, likeCount: e.likeCount + (isLiked ? -1 : 1) } : e)
    );
    await toggleTournamentEntryLike(route.params.id, entry.id, user.uid);
  };

  const openSubmitModal = async () => {
    const list = await catchesStore.list();
    setMyCatches(list.filter((c) => !!c.photoUri));
    setSubmitOpen(true);
  };

  const submitCatch = async (c: Catch) => {
    if (!user || !c.photoUri) return;
    setSubmitting(true);
    try {
      await submitCatchToTournament(route.params.id, {
        catchId: c.id,
        ownerUid: user.uid,
        ownerName: user.displayName || user.email || 'Рибар',
        photoUri: c.photoUri,
        speciesName: c.speciesName,
      });
      setSubmitOpen(false);
      Toast.show({ type: 'success', text1: 'Снимката е добавена!', visibilityTime: 2000 });
      void loadEntries();
    } catch {
      Toast.show({ type: 'error', text1: 'Грешка', text2: 'Неуспешно добавяне.', visibilityTime: 2500 });
    } finally {
      setSubmitting(false);
    }
  };

  if (t === undefined) {
    return (
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
        </View>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={28} width="70%" />
          <Skeleton height={16} width="50%" />
          <Skeleton height={16} width="40%" />
          <Skeleton height={200} borderRadius={radius.lg} style={{ marginTop: spacing.md }} />
        </View>
      </Screen>
    );
  }

  if (!t) {
    return (
      <Screen>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={{ marginBottom: spacing.md }}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Турнирът не е намерен.</Text>
      </Screen>
    );
  }

  return (
    <Screen padded={false} scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
                <Ionicons name="chevron-back" size={28} color={colors.primary} />
              </Pressable>
              <Text style={styles.screenTitle} numberOfLines={2}>{t.name}</Text>
            </View>

            <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
              <Card>
                <Text style={styles.meta}>📅 {t.startDate} – {t.endDate}</Text>
                <Text style={styles.meta}>🏠 Домакин: {t.hostName}</Text>
                {t.description?.trim() ? (
                  <Text style={styles.body}>{t.description}</Text>
                ) : null}
                <Text style={[styles.meta, { marginTop: spacing.sm }]}>
                  Категория: {t.category}{t.speciesName ? ` · ${t.speciesName}` : ''}
                </Text>
              </Card>
            </View>

            {user ? (
              <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.sm }}>
                <Button title="Участвай" onPress={onJoin} loading={busy} />
                <Button title="Добави твоя улов" variant="secondary" onPress={openSubmitModal} />
              </View>
            ) : null}

            {(entries.length > 0 || entriesLoading) ? (
              <Text style={styles.sectionLabel}>СНИМКИ ОТ УЧАСТНИЦИТЕ</Text>
            ) : null}

            {entriesLoading && entries.length === 0 ? (
              <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
                {[0, 1].map((i) => (
                  <View key={i} style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
                    <Skeleton height={220} borderRadius={0} />
                    <Skeleton height={52} borderRadius={0} />
                  </View>
                ))}
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          !entriesLoading ? (
            <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
              <Ionicons name="images-outline" size={40} color={colors.textMuted} />
              <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center' }}>
                Все още няма снимки.{'\n'}Бъди първият участник!
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.entryCard} onPress={() => setViewer(item)}>
            <Image source={{ uri: item.photoUri }} style={styles.photo} contentFit="cover" />
            <View style={styles.entryFooter}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ownerName} numberOfLines={1}>{item.ownerName}</Text>
                {item.speciesName ? <Text style={styles.species}>{item.speciesName}</Text> : null}
              </View>
              <Pressable
                style={[styles.likeBtn, myLikes.has(item.id) && { backgroundColor: '#ff6b6b22' }]}
                onPress={() => onLike(item)}
                hitSlop={8}
              >
                <Ionicons
                  name={myLikes.has(item.id) ? 'heart' : 'heart-outline'}
                  size={18}
                  color={myLikes.has(item.id) ? '#ff6b6b' : colors.textMuted}
                />
                <Text style={[styles.likeCount, myLikes.has(item.id) && { color: '#ff6b6b' }]}>
                  {item.likeCount}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />

      {/* Full-screen viewer */}
      <Modal visible={!!viewer} transparent={false} animationType="fade" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {viewer ? (
            <Image source={{ uri: viewer.photoUri }} style={{ flex: 1 }} contentFit="contain" />
          ) : null}
          <Pressable
            onPress={() => setViewer(null)}
            style={{ position: 'absolute', top: 56, right: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          {viewer ? (
            <View style={{ position: 'absolute', bottom: 48, left: spacing.lg, right: spacing.lg, gap: 4 }}>
              <Text style={{ ...typography.bodyBold, color: '#fff' }}>{viewer.ownerName}</Text>
              {viewer.speciesName ? (
                <Text style={{ ...typography.caption, color: 'rgba(255,255,255,0.7)' }}>{viewer.speciesName}</Text>
              ) : null}
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, alignSelf: 'flex-start' }}
                onPress={() => onLike(viewer)}
              >
                <Ionicons name={myLikes.has(viewer.id) ? 'heart' : 'heart-outline'} size={22} color={myLikes.has(viewer.id) ? '#ff6b6b' : '#fff'} />
                <Text style={{ ...typography.bodyBold, color: '#fff' }}>{viewer.likeCount}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Submit catch bottom sheet */}
      <Modal visible={submitOpen} transparent animationType="slide" onRequestClose={() => setSubmitOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setSubmitOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Избери улов за добавяне</Text>
            {submitting ? (
              <View style={{ alignItems: 'center', padding: spacing.xl }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : myCatches.length === 0 ? (
              <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing.xl }}>
                Нямаш улови с добавена снимка.
              </Text>
            ) : (
              <FlatList
                data={myCatches}
                keyExtractor={(c) => c.id}
                style={{ maxHeight: 420 }}
                renderItem={({ item: c }) => (
                  <Pressable style={styles.pickCatchItem} onPress={() => submitCatch(c)}>
                    <Image source={{ uri: c.photoUri }} style={styles.pickThumb} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...typography.bodyBold, color: colors.text }}>{c.speciesName}</Text>
                      <Text style={{ ...typography.caption, color: colors.textMuted }}>{c.date}</Text>
                      {c.weightKg ? (
                        <Text style={{ ...typography.caption, color: colors.textMuted }}>{c.weightKg} кг</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
