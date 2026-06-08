import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import type { Catch } from '../../../types/index';
import { useHomeTheme } from '../useHomeTheme';
import { sectionStyles as ss } from './sectionStyles';
import { HomeSectionHeader } from './HomeSectionHeader';
import { EmptyHint } from './EmptyHint';
import { CatchRailSkeleton } from './CatchRailSkeleton';

type Props = { catches: Catch[]; loading?: boolean };

/** The user's latest logbook entries as a horizontal rail. Shows skeleton
    tiles while loading, then either the rail or a "log your first catch" hint. */
export function RecentCatchesSection({ catches, loading }: Props) {
  const navigation = useAppNavigation();
  const { mode, colors, textColor } = useHomeTheme();
  return (
    <>
      <HomeSectionHeader
        label="Недавни улови"
        link={catches.length > 0 ? { text: 'Виж всички →', onPress: () => navigation.navigate('LogbookTab', { screen: 'LogbookList' }) } : undefined}
      />
      {catches.length > 0 ? (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
        >
          {catches.map((c) => (
            <Pressable
              key={c.id}
              style={[ss.catchCard, { backgroundColor: c.photoUri ? 'transparent' : (mode === 'dark' ? '#0E1E35' : colors.primarySurface) }]}
              onPress={() => navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })}
            >
              {c.photoUri ? (
                <>
                  <Image source={{ uri: c.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.75)']}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                    style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, justifyContent: 'flex-end', padding: 10 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Nunito_700Bold' }} numberOfLines={1}>{c.speciesName}</Text>
                    {c.weightKg != null && <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>{c.weightKg} кг</Text>}
                  </LinearGradient>
                </>
              ) : (
                <View style={ss.catchEmpty}>
                  <Text style={{ fontSize: 28 }}>🐟</Text>
                  <Text style={{ fontSize: 10, color: textColor, fontFamily: 'Nunito_600SemiBold', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>{c.speciesName}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : loading ? (
        <CatchRailSkeleton />
      ) : (
        <EmptyHint
          icon="add-circle-outline"
          text="Запиши първия си улов — ще го виждаш тук"
          onPress={() => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} })}
        />
      )}
    </>
  );
}
