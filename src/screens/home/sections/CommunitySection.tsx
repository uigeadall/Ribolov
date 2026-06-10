import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { useAuth } from '../../../services/authContext';
import { getFeaturedAnglerOfWeek, type FeaturedAngler } from '../../../services/cloudSync';
import { spacing, radius, typography } from '../../../theme/typography';
import type { RankedClassicPhoto } from '../../../services/classicsContest';
import { useHomeTheme } from '../useHomeTheme';
import { HomeSectionHeader } from './HomeSectionHeader';

type Props = { classic: RankedClassicPhoto | null };

/** "Общност" — the weekly classics photo and the featured angler merged into
    one grouped card. Replaces ClassicsHighlight + the standalone
    FeaturedAnglerCard. Each half self-hides; the section hides if both empty. */
export function CommunitySection({ classic }: Props) {
  const navigation = useAppNavigation();
  const { user, configured } = useAuth();
  const { surface, hairline, textColor, mutedColor, accent, accentSoft, onAccent } = useHomeTheme();

  const [angler, setAngler] = useState<FeaturedAngler | null>(null);
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    getFeaturedAnglerOfWeek(user?.uid)
      .then((res) => { if (!cancelled) setAngler(res); })
      .catch(() => { if (!cancelled) setAngler(null); });
    return () => { cancelled = true; };
  }, [user?.uid, configured]);

  const photo = classic?.item.photoUri ? classic : null;
  if (!photo && !angler) return null;

  return (
    <View style={S.wrap}>
      <HomeSectionHeader
        label="Общност"
        link={photo ? { text: 'Класики →', onPress: () => navigation.navigate('ProfileTab', { screen: 'Classics' }) } : undefined}
      />
      <View style={[S.group, { backgroundColor: surface, borderColor: hairline }]}>
        {photo && (
          <Pressable style={S.photoBlock} onPress={() => navigation.navigate('ProfileTab', { screen: 'Classics' })}>
            <Image source={{ uri: photo.item.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
            {/* Photo overlay — the design language's one allowed gradient use. */}
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={S.photoOverlay}>
              <Text style={S.photoKicker}>Снимка на седмицата · {photo.item.ownerName ?? 'Рибар'}</Text>
              <Text style={S.photoTitle} numberOfLines={1}>{photo.item.photoTitle ?? photo.item.speciesName}</Text>
              <View style={S.photoActions}>
                <View style={S.likePill}>
                  <Ionicons name="heart" size={12} color="#ff6b6b" />
                  <Text style={S.likeText}>{photo.likes}</Text>
                </View>
                <View style={[S.votePill, { backgroundColor: accent }]}>
                  <Ionicons name="heart-outline" size={12} color={onAccent} />
                  <Text style={[S.likeText, { color: onAccent }]}>Гласувай</Text>
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        )}

        {photo && angler && <View style={[S.divider, { backgroundColor: hairline }]} />}

        {angler && (
          <Pressable
            style={S.anglerRow}
            onPress={() => {
              void Haptics.selectionAsync();
              navigation.navigate('UserPublicProfile', {
                uid: angler.uid,
                displayName: angler.displayName,
                photoUrlHint: angler.photoUrl,
              });
            }}
          >
            <View style={[S.avatar, { backgroundColor: accentSoft }]}>
              {angler.photoUrl ? (
                <Image source={{ uri: angler.photoUrl }} style={S.avatarImg} contentFit="cover" />
              ) : (
                <Text style={[S.avatarInitial, { color: accent }]}>
                  {angler.displayName.slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typography.overline, S.anglerKicker, { color: mutedColor }]}>Рибар на седмицата</Text>
              <Text style={[S.anglerName, { color: textColor }]} numberOfLines={1}>{angler.displayName}</Text>
              <Text style={[S.anglerMeta, { color: mutedColor }]} numberOfLines={1}>
                {angler.publicCount} {angler.publicCount === 1 ? 'улов' : 'улова'} тази седмица
                {angler.city ? ` · ${angler.city}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={mutedColor} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  group: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  photoBlock: { height: 190 },
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 120, justifyContent: 'flex-end', padding: spacing.md,
  },
  photoKicker: {
    fontSize: 10, fontFamily: 'Nunito_700Bold',
    color: 'rgba(255,255,255,0.7)', letterSpacing: 0.8, textTransform: 'uppercase',
  },
  photoTitle: {
    fontSize: 16, fontFamily: 'Nunito_800ExtraBold',
    color: '#fff', marginTop: 2, marginBottom: 8, letterSpacing: -0.3,
  },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  likePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  likeText: { fontSize: 12, fontFamily: 'Nunito_700Bold', color: '#fff' },
  votePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
  },
  divider: { height: StyleSheet.hairlineWidth },
  anglerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: 44, height: 44 },
  avatarInitial: { fontSize: 18, fontFamily: 'Nunito_800ExtraBold' },
  anglerKicker: { fontSize: 9 },
  anglerName: { fontSize: 15, fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.2, marginTop: 1 },
  anglerMeta: { fontSize: 11, fontFamily: 'Nunito_600SemiBold', marginTop: 1 },
});
