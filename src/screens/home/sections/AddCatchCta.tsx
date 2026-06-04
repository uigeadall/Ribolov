import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ScalePressable } from '../../../components/ScalePressable';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';

/** The primary "log a new catch" call-to-action card. */
export function AddCatchCta() {
  const navigation = useAppNavigation();
  return (
    <ScalePressable
      style={S.ctaCard}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
      }}
      android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
    >
      <LinearGradient
        colors={['#F5A020', '#E05E00']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Ionicons name="add-circle-outline" size={32} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={S.ctaCardText}>Запиши нов улов</Text>
        <Text style={S.ctaCardSub}>Добави улов в дневника</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
    </ScalePressable>
  );
}

const S = StyleSheet.create({
  ctaCard: {
    marginHorizontal: spacing.xl, marginBottom: spacing.md,
    borderRadius: 22, height: 80, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
    shadowColor: '#E06400', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45, shadowRadius: 16, elevation: 8,
  },
  ctaCardText: {
    color: '#fff', fontSize: 18,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.4,
  },
  ctaCardSub: {
    color: 'rgba(255,255,255,0.72)', fontSize: 12,
    fontFamily: 'Nunito_600SemiBold', marginTop: 2,
  },
});
