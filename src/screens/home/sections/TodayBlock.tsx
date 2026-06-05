import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import type { WeatherSnapshot } from '../../../services/weather';
import { useHomeTheme } from '../useHomeTheme';
import { fishingLabel } from '../homeHelpers';
import { selectTodayCard } from '../selectTodayCard';

type Props = {
  followingCatches: { ownerUid: string; ownerName?: string; date: string }[];
  weather: WeatherSnapshot | null;
  nearestSpotName: string | null;
};

/** Adaptive "Today" priority card. Picks the single most relevant prompt
    (fresh follower activity > good conditions > baseline) via selectTodayCard
    and renders it with the matching CTA. */
export function TodayBlock({ followingCatches, weather, nearestSpotName }: Props) {
  const navigation = useAppNavigation();
  const { textColor, mutedColor, primary, accent } = useHomeTheme();

  const card = selectTodayCard({
    followingCatches,
    fishingRating: weather?.fishingRating ?? null,
    nearestSpotName,
  });

  let emoji: string;
  let title: string;
  let sub: string;
  let ctaLabel: string;
  let onPress: () => void;

  if (card.kind === 'social') {
    emoji = '🎣';
    title = card.othersCount > 0
      ? `${card.actorName} и още ${card.othersCount} споделиха`
      : `${card.actorName} сподели нов улов`;
    sub = 'Виж какво кълве при приятелите ти';
    ctaLabel = 'Към лентата';
    onPress = () => (navigation as any).navigate('FeedTab');
  } else if (card.kind === 'conditions') {
    const fl = fishingLabel(card.rating);
    emoji = '🔥';
    title = 'Чудесни условия за риболов';
    sub = card.spotName ? `${fl.text} · ${card.spotName}` : fl.text;
    ctaLabel = 'Запиши улов';
    onPress = () => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  } else {
    emoji = '🐟';
    title = 'Готов ли си за риболов?';
    sub = card.spotName ? `Запиши улова си от ${card.spotName}` : 'Запиши улова си в дневника';
    ctaLabel = 'Запиши улов';
    onPress = () => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  }

  const rating = card.kind === 'social' ? null : card.rating;

  return (
    <GlassCard style={S.card} onPress={onPress}>
      <View style={S.row}>
        <Text style={S.emoji}>{emoji}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[S.title, { color: textColor }]} numberOfLines={1}>{title}</Text>
          <Text style={[S.sub, { color: mutedColor }]} numberOfLines={1}>{sub}</Text>
          {rating != null && (
            <View style={S.stars}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Ionicons key={i} name={i <= rating ? 'star' : 'star-outline'} size={12} color={accent} />
              ))}
            </View>
          )}
        </View>
      </View>
      <View style={[S.cta, { backgroundColor: primary }]}>
        <Text style={S.ctaText}>{ctaLabel}</Text>
        <Ionicons name="chevron-forward" size={15} color="#fff" />
      </View>
    </GlassCard>
  );
}

const S = StyleSheet.create({
  card: { marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emoji: { fontSize: 30 },
  title: { fontSize: 16, fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: 'Nunito_600SemiBold', marginTop: 2 },
  stars: { flexDirection: 'row', gap: 2, marginTop: 6 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: 14, paddingVertical: 10,
  },
  ctaText: { color: '#fff', fontSize: 14, fontFamily: 'Nunito_800ExtraBold' },
});
