import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { sectionStyles as s } from './sectionStyles';
import { useHomeTheme } from '../useHomeTheme';

type Props = {
  label: string;
  /** Optional right-aligned link (e.g. "Виж всички →"). */
  link?: { text: string; onPress: () => void };
};

/** Overline label (+ optional accent link) that repeats across home sections.
    The per-section accent bars died with the dark-premium redesign — one
    accent colour, carried by the link. */
export function HomeSectionHeader({ label, link }: Props) {
  const { accent, mutedColor } = useHomeTheme();
  return (
    <View style={s.sectionRow}>
      <Text style={[s.sectionLabel, { color: mutedColor }]}>{label}</Text>
      {link ? (
        <Pressable onPress={link.onPress} hitSlop={8}>
          <Text style={[s.sectionLink, { color: accent }]}>{link.text}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
