import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import type { RankedClassicPhoto } from '../../../services/classicsContest';
import { useHomeTheme } from '../useHomeTheme';
import { HomeSectionHeader } from './HomeSectionHeader';

type Props = { classic: RankedClassicPhoto | null };

/** "Снимка на седмицата" — the current top-ranked classics photo. Renders
    nothing until a winning photo with an image is available. */
export function ClassicsHighlight({ classic }: Props) {
  const navigation = useAppNavigation();
  const { accent } = useHomeTheme();
  if (!classic?.item.photoUri) return null;
  return (
    <>
      <HomeSectionHeader
        label="Снимка на седмицата"
        accentColor="#FFD700"
        link={{ text: 'Класики →', onPress: () => navigation.navigate('ProfileTab', { screen: 'Classics' }) }}
      />
      <Pressable style={S.classicsCard} onPress={() => navigation.navigate('ProfileTab', { screen: 'Classics' })}>
        <Image source={{ uri: classic.item.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={S.classicsOverlay}>
          <Text style={S.classicsOwner}>{classic.item.ownerName ?? 'Рибар'}</Text>
          <Text style={S.classicsTitle} numberOfLines={1}>{classic.item.photoTitle ?? classic.item.speciesName}</Text>
          <View style={S.classicsActions}>
            <View style={S.classicsLike}>
              <Ionicons name="heart" size={12} color="#ff6b6b" />
              <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: '#fff' }}>{classic.likes}</Text>
            </View>
            <View style={[S.classicsVote, { backgroundColor: accent }]}>
              <Ionicons name="heart-outline" size={12} color="#fff" />
              <Text style={{ fontSize: 12, fontFamily: 'Nunito_700Bold', color: '#fff' }}>Гласувай</Text>
            </View>
          </View>
        </LinearGradient>
        <View style={S.classicsBadge}>
          <Text style={{ fontSize: 13 }}>🥇</Text>
          <Text style={{ fontSize: 10, fontFamily: 'Nunito_800ExtraBold', color: '#2a1800' }}>ПОБЕДИТЕЛ</Text>
        </View>
      </Pressable>
    </>
  );
}

const S = StyleSheet.create({
  classicsCard: {
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
    borderRadius: 24, overflow: 'hidden', height: 200,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22, shadowRadius: 16, elevation: 8,
  },
  classicsOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 130, justifyContent: 'flex-end', padding: spacing.md,
  },
  classicsOwner: {
    fontSize: 11, fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255,255,255,0.65)',
  },
  classicsTitle: {
    fontSize: 16, fontFamily: 'Nunito_800ExtraBold',
    color: '#fff', marginTop: 2, marginBottom: 8,
  },
  classicsActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  classicsLike: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  classicsVote: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
  },
  classicsBadge: {
    position: 'absolute', top: spacing.md, left: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFD700',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, elevation: 4,
  },
});
