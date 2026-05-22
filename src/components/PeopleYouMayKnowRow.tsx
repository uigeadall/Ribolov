import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { followUser, suggestPeopleToFollow, type SuggestedUser } from '../services/cloudSync';
import { sendFollowNotification } from '../services/socialFeed';
import { useAppNavigation } from '../navigation/useAppNavigation';

type Props = {
  /** Hides the row entirely when empty (don't render the section title either). */
  collapseWhenEmpty?: boolean;
};

const TILE_WIDTH = 132;

export function PeopleYouMayKnowRow({ collapseWhenEmpty = true }: Props) {
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const navigation = useAppNavigation();

  const [items, setItems] = useState<SuggestedUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [followBusy, setFollowBusy] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!configured || !user?.uid) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    suggestPeopleToFollow(user.uid, 10)
      .then((res) => { if (!cancelled) setItems(res); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid, configured]);

  const onPressUser = useCallback((u: SuggestedUser) => {
    navigation.navigate('UserPublicProfile', {
      uid: u.uid,
      displayName: u.displayName,
      photoUrlHint: u.photoUrl,
    });
  }, [navigation]);

  // Track dismissal timers per-uid so we can clear them on unmount and avoid
  // setState-on-unmounted warnings if the row tears down within the 700ms
  // window after a follow.
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    return () => {
      for (const t of dismissTimersRef.current.values()) clearTimeout(t);
      dismissTimersRef.current.clear();
    };
  }, []);

  const onFollow = useCallback(async (u: SuggestedUser) => {
    if (!user) return;
    setFollowBusy((prev) => new Set([...prev, u.uid]));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await followUser(user.uid, u.uid, u.displayName);
      await sendFollowNotification(u.uid, user.uid, user.displayName ?? 'Рибар').catch(() => {});
      setFollowed((prev) => new Set([...prev, u.uid]));
      // Brief confirmation flash, then remove the tile so the row stays fresh
      // and the user can see new suggestions instead of a pile of "Следваш" pills.
      const id = setTimeout(() => {
        dismissTimersRef.current.delete(u.uid);
        setDismissed((prev) => new Set([...prev, u.uid]));
      }, 700);
      dismissTimersRef.current.set(u.uid, id);
    } catch {
      // followUser threw — without this, the tile would stay in a permanent
      // half-state: not followed, not dismissed, but busy clears via finally.
      // Surface nothing user-facing (Haptic was the action acknowledgement);
      // just let the user retry by tapping again.
    } finally {
      setFollowBusy((prev) => { const s = new Set(prev); s.delete(u.uid); return s; });
    }
  }, [user]);

  const onDismiss = useCallback((u: SuggestedUser) => {
    void Haptics.selectionAsync();
    setDismissed((prev) => new Set([...prev, u.uid]));
  }, []);

  const visible = useMemo(
    () => (items ?? []).filter((u) => !dismissed.has(u.uid)),
    [items, dismissed],
  );

  const styles = useMemo(() => StyleSheet.create({
    section: {
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.card,
    },
    titleRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, marginBottom: spacing.sm,
    },
    title: {
      ...typography.bodyBold, color: colors.text, fontSize: 14, flex: 1,
    },
    subtitle: { ...typography.small, color: colors.textMuted, fontSize: 11 },
    scrollPad: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.xs },
    tile: {
      width: TILE_WIDTH,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: mode === 'dark' ? '#0E1E35' : '#FFFFFF',
      padding: spacing.sm + 2,
      alignItems: 'center',
    },
    dismissBtn: {
      position: 'absolute',
      top: 4, right: 4,
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      alignItems: 'center', justifyContent: 'center',
    },
    avatar: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', marginTop: 6, marginBottom: 8,
    },
    avatarText: { fontSize: 22, fontWeight: '800', color: colors.primary },
    name: {
      fontSize: 12, fontFamily: 'Nunito_700Bold', color: colors.text,
      textAlign: 'center', maxWidth: '100%', marginBottom: 2,
    },
    mutual: {
      fontSize: 10, fontFamily: 'Nunito_600SemiBold', color: colors.textMuted,
      textAlign: 'center', marginBottom: 8,
    },
    followBtn: {
      alignSelf: 'stretch',
      paddingVertical: 7,
      borderRadius: radius.pill,
      alignItems: 'center', justifyContent: 'center',
      flexDirection: 'row', gap: 4,
    },
    followBtnIdle: { backgroundColor: colors.primary },
    followBtnDone: { backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.border },
    followBtnText: { fontSize: 11, fontFamily: 'Nunito_700Bold', color: '#fff' },
    followBtnTextDone: { color: colors.primary },
    emptyText: { ...typography.small, color: colors.textMuted, paddingHorizontal: spacing.lg },
  }), [colors, mode]);

  if (!configured || !user) return null;
  if (loading) {
    if (collapseWhenEmpty && items == null) {
      return (
        <View style={styles.section}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Хора, които може да познаваш</Text>
          </View>
          <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        </View>
      );
    }
  }
  if (!loading && visible.length === 0) {
    if (collapseWhenEmpty) return null;
    return (
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Хора, които може да познаваш</Text>
        </View>
        <Text style={styles.emptyText}>Засега няма предложения. Последвай повече рибари, за да получиш по-добри препоръки.</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Ionicons name="people-outline" size={16} color={colors.primary} style={{ marginRight: 6 }} />
        <Text style={styles.title}>Хора, които може да познаваш</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollPad}>
        {visible.map((u) => {
          const isFollowed = followed.has(u.uid);
          const busy = followBusy.has(u.uid);
          const initials = u.displayName.slice(0, 1).toUpperCase();
          return (
            <View key={u.uid} style={styles.tile}>
              <Pressable onPress={() => onDismiss(u)} style={styles.dismissBtn} hitSlop={8}>
                <Ionicons name="close" size={13} color={colors.textMuted} />
              </Pressable>
              <Pressable onPress={() => onPressUser(u)} style={{ alignItems: 'center', width: '100%' }}>
                <View style={styles.avatar}>
                  {u.photoUrl ? (
                    <Image source={{ uri: u.photoUrl }} style={{ width: 56, height: 56 }} contentFit="cover" />
                  ) : (
                    <Text style={styles.avatarText}>{initials}</Text>
                  )}
                </View>
                <Text style={styles.name} numberOfLines={1}>{u.displayName}</Text>
                <Text style={styles.mutual} numberOfLines={1}>
                  {u.mutualCount} {u.mutualCount === 1 ? 'общ' : 'общи'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void onFollow(u)}
                disabled={busy || isFollowed}
                style={[styles.followBtn, isFollowed ? styles.followBtnDone : styles.followBtnIdle, busy && { opacity: 0.6 }]}
                hitSlop={6}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : isFollowed ? (
                  <>
                    <Ionicons name="checkmark" size={12} color={colors.primary} />
                    <Text style={[styles.followBtnText, styles.followBtnTextDone]}>Следваш</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="add" size={12} color="#fff" />
                    <Text style={styles.followBtnText}>Последвай</Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
