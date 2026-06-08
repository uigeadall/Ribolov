import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { radius, spacing, typography } from '../../../theme/typography';
import type { Tournament } from '../../../types';
import { useHomeTheme } from '../useHomeTheme';
import { HomeSectionHeader } from './HomeSectionHeader';

type Props = { tournaments: Tournament[] };

/** The user's active tournaments with a countdown to the soonest ending.
    Shows up to two; renders nothing when the user has none. */
export function TournamentsSection({ tournaments }: Props) {
  const navigation = useAppNavigation();
  const { cardBg, cardBorder, textColor, mutedColor, primary } = useHomeTheme();
  if (tournaments.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
      <HomeSectionHeader
        label="Твои турнири"
        accentColor="#E8902E"
        link={tournaments.length > 1
          ? { text: 'Виж всички →', onPress: () => (navigation as any).navigate('ProfileTab', { screen: 'Tournaments' }) }
          : undefined}
      />
      {tournaments.slice(0, 2).map((t) => {
        const daysLeft = t.endDate
          ? Math.max(0, Math.ceil((Date.parse(t.endDate + 'T23:59:59') - Date.now()) / 86_400_000))
          : null;
        return (
          <Pressable
            key={t.id}
            onPress={() => (navigation as any).navigate('ProfileTab', { screen: 'TournamentDetail', params: { id: t.id } })}
            style={{
              backgroundColor: cardBg,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: cardBorder,
              padding: spacing.md,
              marginBottom: spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <View style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: 'rgba(232,144,46,0.16)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="trophy" size={22} color="#E8902E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.bodyBold, color: textColor }} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={{ ...typography.caption, color: mutedColor, marginTop: 2 }} numberOfLines={1}>
                {daysLeft === 0
                  ? 'Завършва днес'
                  : daysLeft === 1
                  ? 'Остава 1 ден'
                  : daysLeft != null
                  ? `Остават ${daysLeft} дни`
                  : 'Активен'}
                {t.speciesName ? ` · ${t.speciesName}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={mutedColor} />
          </Pressable>
        );
      })}
    </View>
  );
}
