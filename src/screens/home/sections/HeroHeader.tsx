import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { WeatherIcon } from '../../../components/WeatherIcon';
import { BadgeIcon } from '../../../components/BadgeIcon';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import type { WeatherSnapshot } from '../../../services/weather';
import { useHomeTheme } from '../useHomeTheme';
import { WAVE, greeting, fishingLabel, moonPhaseEmoji } from '../homeHelpers';

type Props = {
  weather: WeatherSnapshot | null;
  weatherStatus: 'idle' | 'loading' | 'error';
  firstName: string;
  dateStr: string;
  locLabel: string;
  unreadMsgs: number;
  unreadNotifs: number;
  onRetryWeather: () => void;
};

export function HeroHeader({
  weather, weatherStatus, firstName, dateStr, locLabel, unreadMsgs, unreadNotifs, onRetryWeather,
}: Props) {
  const navigation = useAppNavigation();
  const { heroGrad } = useHomeTheme();
  const fLabel = weather ? fishingLabel(weather.fishingRating) : null;

  return (
    <View style={S.hero}>
      <LinearGradient colors={heroGrad} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={S.heroBg} pointerEvents="none" />
      <View style={S.heroInner}>

        {/* App bar */}
        <View style={S.heroBar}>
          <View style={S.heroBrand}>
            <View style={S.heroLogoWrap}>
              <Ionicons name="fish-outline" size={20} color="#fff" />
            </View>
            <View>
              <Text style={S.heroAppName}>РИБОЛОВ</Text>
              <Text style={S.heroAppSub}>Твоят дневник</Text>
            </View>
          </View>
          <View style={S.heroIcons}>
            <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Chats' })} hitSlop={12}>
              <BadgeIcon name="chatbubble-outline" size={23} color="rgba(255,255,255,0.9)" count={unreadMsgs} />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Notifications' })} hitSlop={12}>
              <BadgeIcon name="notifications-outline" size={23} color="rgba(255,255,255,0.9)" count={unreadNotifs} />
            </Pressable>
          </View>
        </View>

        {/* Split: left greeting + right weather temp */}
        <View style={S.heroSplit}>

          {/* Left 60% */}
          <View style={S.heroLeft}>
            <Text style={S.heroGreeting}>{greeting()},{'\n'}{firstName}!</Text>
            <Text style={S.heroDate}>{dateStr}</Text>
            <View style={S.heroLocBadge}>
              <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.8)" />
              <Text style={S.heroLocText} numberOfLines={1}>{locLabel}</Text>
            </View>
          </View>

          {/* Right 40% — temperature + weather icon + fishing label */}
          <View style={S.heroRight}>
            {weatherStatus === 'loading' && !weather ? (
              <ActivityIndicator color="rgba(255,255,255,0.7)" style={{ marginTop: 8 }} />
            ) : weather ? (
              <>
                <WeatherIcon weatherCode={weather.weatherCode} size={36} color="rgba(255,255,255,0.9)" />
                <Text style={S.heroTempNum}>{weather.temperatureC}°</Text>
                {fLabel && (
                  <View
                    style={[
                      S.heroFishingChip,
                      { backgroundColor: fLabel.color + '26', borderColor: fLabel.color + '66' },
                    ]}
                  >
                    <View style={[S.heroFishingChipDot, { backgroundColor: fLabel.color }]} />
                    <Text style={[S.heroFishingChipText, { color: '#fff' }]} numberOfLines={1}>
                      {fLabel.text}
                    </Text>
                  </View>
                )}
              </>
            ) : weatherStatus === 'error' ? (
              <Pressable
                onPress={() => { onRetryWeather(); }}
                hitSlop={8}
                style={{ alignItems: 'flex-end', marginTop: 4, gap: 2 }}
              >
                <Ionicons name="cloud-offline-outline" size={28} color="rgba(255,255,255,0.6)" />
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'Nunito_700Bold' }}>
                  Няма мрежа
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Nunito_600SemiBold' }}>
                  Опитай отново →
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Meta row: wind / humidity / moon — full width glass bar */}
        {weather && (
          <View style={S.heroMetaRow}>
            <View style={S.heroMetaItem}>
              <Ionicons name="flag-outline" size={13} color="rgba(255,255,255,0.75)" />
              <Text style={S.heroMetaText}>{weather.windKmh} км/ч</Text>
            </View>
            <View style={S.heroMetaDivider} />
            <View style={S.heroMetaItem}>
              <Ionicons name="rainy-outline" size={13} color="rgba(255,255,255,0.75)" />
              <Text style={S.heroMetaText}>{weather.precipitationProbability}%</Text>
            </View>
            <View style={S.heroMetaDivider} />
            <View style={S.heroMetaItem}>
              <Text style={S.heroMetaText}>{moonPhaseEmoji(weather.moonPhaseName)}</Text>
              <Text style={S.heroMetaText}>{weather.moonPhaseName}</Text>
            </View>
          </View>
        )}
        {weatherStatus === 'loading' && !weather && (
          <View style={[S.heroMetaRow, { justifyContent: 'center' }]}>
            <ActivityIndicator color="rgba(255,255,255,0.5)" size="small" />
          </View>
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  hero: { paddingBottom: WAVE + 100, overflow: 'hidden' },
  heroBg: { ...StyleSheet.absoluteFillObject },
  heroInner: { paddingHorizontal: spacing.xl, paddingTop: spacing.xs },

  heroBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroLogoWrap: {
    width: 38, height: 38, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroAppName: {
    color: '#fff', fontSize: 19,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.3,
  },
  heroAppSub: {
    color: 'rgba(255,255,255,0.52)', fontSize: 9,
    fontFamily: 'Nunito_700Bold', letterSpacing: 1.8, textTransform: 'uppercase',
  },
  heroIcons: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  heroSplit: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  heroLeft: { flex: 3, paddingRight: spacing.md },
  heroRight: { flex: 2, alignItems: 'flex-end' },

  heroGreeting: {
    color: '#fff', fontSize: 26,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.6,
    marginBottom: 4,
  },
  heroDate: {
    color: 'rgba(255,255,255,0.6)', fontSize: 12,
    fontFamily: 'Nunito_600SemiBold', letterSpacing: 0.3,
    textTransform: 'capitalize', marginBottom: spacing.md,
  },
  heroLocBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  heroLocText: {
    color: 'rgba(255,255,255,0.85)', fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
  },

  heroTempNum: {
    color: '#fff', fontSize: 48,
    fontFamily: 'Nunito_800ExtraBold', letterSpacing: -2,
    lineHeight: 52,
  },
  heroFishingChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14,
    marginTop: 6,
    borderWidth: 1,
  },
  heroFishingChipDot: { width: 8, height: 8, borderRadius: 4 },
  heroFishingChipText: {
    fontSize: 12, fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.1,
  },

  heroMetaRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10,
    marginTop: spacing.sm,
  },
  heroMetaItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5,
  },
  heroMetaDivider: {
    width: 1, height: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  heroMetaText: {
    color: 'rgba(255,255,255,0.82)', fontSize: 11,
    fontFamily: 'Nunito_600SemiBold',
  },
});
