import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { getFeaturedAnglerOfWeek, type FeaturedAngler } from '../services/cloudSync';
import { useAppNavigation } from '../navigation/useAppNavigation';

export function FeaturedAnglerCard() {
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const navigation = useAppNavigation();
  const [angler, setAngler] = useState<FeaturedAngler | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    let cancelled = false;
    getFeaturedAnglerOfWeek(user?.uid)
      .then((res) => { if (!cancelled) setAngler(res); })
      .catch(() => { if (!cancelled) setAngler(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid, configured]);

  const styles = useMemo(() => StyleSheet.create({
    wrapper: {
      marginHorizontal: spacing.xl,
      marginBottom: spacing.xl,
      borderRadius: radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: mode === 'dark' ? 'rgba(255,215,100,0.25)' : 'rgba(196,154,0,0.22)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 14,
      elevation: 6,
    },
    inner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md + 2,
    },
    avatarRing: {
      width: 62, height: 62, borderRadius: 31,
      padding: 2,
      backgroundColor: '#FFD86A',
      alignItems: 'center', justifyContent: 'center',
    },
    avatar: {
      width: 58, height: 58, borderRadius: 29,
      backgroundColor: colors.primarySurface,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { fontSize: 22, fontWeight: '800', color: colors.primary },
    body: { flex: 1, minWidth: 0 },
    kicker: {
      fontSize: 10,
      fontFamily: 'Manrope_700Bold',
      color: mode === 'dark' ? '#FFD86A' : '#9A7700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    name: {
      fontSize: 17,
      fontFamily: 'Manrope_800ExtraBold',
      color: colors.text,
      letterSpacing: -0.3,
    },
    meta: {
      ...typography.small,
      color: colors.textMuted,
      marginTop: 2,
    },
    chevron: {
      width: 28, height: 28, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.card,
    },
  }), [colors, mode]);

  if (loading || !angler) return null;

  const initials = angler.displayName.slice(0, 1).toUpperCase();
  const bgColors: [string, string, string] = mode === 'dark'
    ? ['rgba(255,215,100,0.10)', 'rgba(255,180,40,0.06)', 'rgba(0,0,0,0)']
    : ['rgba(255,228,140,0.55)', 'rgba(255,210,100,0.30)', 'rgba(255,255,255,0)'];

  return (
    <Pressable
      style={styles.wrapper}
      onPress={() => {
        void Haptics.selectionAsync();
        navigation.navigate('UserPublicProfile', {
          uid: angler.uid,
          displayName: angler.displayName,
          photoUrlHint: angler.photoUrl,
        });
      }}
    >
      <LinearGradient colors={bgColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
      <View style={styles.inner}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            {angler.photoUrl ? (
              <Image source={{ uri: angler.photoUrl }} style={{ width: 58, height: 58 }} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.kicker}>🏅 Рибар на седмицата</Text>
          <Text style={styles.name} numberOfLines={1}>{angler.displayName}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {angler.publicCount} {angler.publicCount === 1 ? 'улов' : 'улова'} тази седмица
            {angler.city ? ` · ${angler.city}` : ''}
          </Text>
        </View>
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      </View>
    </Pressable>
  );
}
