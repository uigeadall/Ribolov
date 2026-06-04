import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { sectionStyles as s } from './sectionStyles';
import { useHomeTheme } from '../useHomeTheme';

type Props = {
  label: string;
  /** Accent bar colour. Defaults to the theme primary. */
  accentColor?: string;
  /** Optional right-aligned link (e.g. "Виж всички →"). */
  link?: { text: string; onPress: () => void };
};

/** The accent-bar + label (+ optional link) header that repeats across home
    sections. Replaces the inline `S.sectionRow` markup, preserving its look. */
export function HomeSectionHeader({ label, accentColor, link }: Props) {
  const { primary, mutedColor } = useHomeTheme();
  return (
    <View style={s.sectionRow}>
      <View style={s.sectionLeft}>
        <View style={[s.sectionAccent, { backgroundColor: accentColor ?? primary }]} />
        <Text style={[s.sectionLabel, { color: mutedColor }]}>{label}</Text>
      </View>
      {link ? (
        <Pressable onPress={link.onPress} hitSlop={8}>
          <Text style={[s.sectionLink, { color: primary }]}>{link.text}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
