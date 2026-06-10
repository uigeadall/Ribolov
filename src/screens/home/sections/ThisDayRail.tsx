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

type Props = { catches: Catch[] };

/** "В този ден" — a horizontal rail of the user's catches from this calendar
    day in prior years. Renders nothing until there's at least one. */
export function ThisDayRail({ catches }: Props) {
  const navigation = useAppNavigation();
  const { surface, textColor, accent, onAccent } = useHomeTheme();
  if (catches.length === 0) return null;
  return (
    <>
      <HomeSectionHeader label="В този ден" />
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
      >
        {catches.map((c) => {
          const yearsAgo = new Date().getFullYear() - new Date(c.date).getFullYear();
          const ageLabel = yearsAgo === 1 ? 'преди 1 година' : `преди ${yearsAgo} години`;
          return (
            <Pressable
              key={c.id}
              style={[ss.catchCard, { backgroundColor: c.photoUri ? 'transparent' : surface }]}
              onPress={() => navigation.navigate('LogbookTab', { screen: 'CatchDetail', params: { id: c.id } })}
            >
              {c.photoUri ? (
                <>
                  <Image source={{ uri: c.photoUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.78)']}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: accent, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ color: onAccent, fontSize: 9, fontFamily: 'Nunito_700Bold', letterSpacing: 0.3 }} numberOfLines={1}>{ageLabel}</Text>
                  </View>
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Nunito_700Bold' }} numberOfLines={1}>{c.speciesName}</Text>
                    {c.weightKg != null ? (
                      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>{c.weightKg} кг</Text>
                    ) : null}
                  </View>
                </>
              ) : (
                <View style={ss.catchEmpty}>
                  <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: accent, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ color: onAccent, fontSize: 9, fontFamily: 'Nunito_700Bold', letterSpacing: 0.3 }} numberOfLines={1}>{ageLabel}</Text>
                  </View>
                  <Text style={{ fontSize: 28 }}>🐟</Text>
                  <Text style={{ fontSize: 10, color: textColor, fontFamily: 'Nunito_600SemiBold', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>
                    {c.speciesName}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}
