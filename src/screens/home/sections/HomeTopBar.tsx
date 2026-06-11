import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BadgeIcon } from '../../../components/BadgeIcon';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing, typography } from '../../../theme/typography';
import { useHomeTheme } from '../useHomeTheme';
import { greeting } from '../homeHelpers';

type Props = {
  firstName: string;
  dateStr: string;
  locLabel: string;
  unreadMsgs: number;
  unreadNotifs: number;
};

/** Flat app bar + greeting block. Replaces the gradient HeroHeader — weather
    now lives in the conditions card, not the header. */
export function HomeTopBar({ firstName, dateStr, locLabel, unreadMsgs, unreadNotifs }: Props) {
  const navigation = useAppNavigation();
  const { textColor, mutedColor, accent } = useHomeTheme();

  return (
    <View style={S.wrap}>
      <View style={S.bar}>
        <View style={S.brand}>
          <Ionicons name="fish-outline" size={16} color={accent} />
          <Text style={[typography.overline, { color: mutedColor }]}>Риболов</Text>
        </View>
        <View style={S.icons}>
          <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Chats' })} hitSlop={12}>
            <BadgeIcon name="chatbubble-outline" size={23} color={mutedColor} count={unreadMsgs} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('ProfileTab', { screen: 'Notifications' })} hitSlop={12}>
            <BadgeIcon name="notifications-outline" size={23} color={mutedColor} count={unreadNotifs} />
          </Pressable>
        </View>
      </View>

      <Text style={[S.greeting, { color: textColor }]}>
        {greeting()}, {firstName}
      </Text>
      <Text style={[S.meta, { color: mutedColor }]} numberOfLines={1}>
        {dateStr} · {locLabel}
      </Text>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  bar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  greeting: {
    fontSize: 30, fontFamily: 'Manrope_800ExtraBold',
    letterSpacing: -0.8, lineHeight: 36,
  },
  meta: {
    fontSize: 13, fontFamily: 'Manrope_600SemiBold',
    letterSpacing: 0.2, marginTop: 4, textTransform: 'capitalize',
  },
});
