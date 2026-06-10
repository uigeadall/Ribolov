import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sectionStyles as s } from './sectionStyles';
import { useHomeTheme } from '../useHomeTheme';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  onPress: () => void;
};

/** Flat "do this to fill the section" pressable used by the
    Following / Nearest-water / Recent sections when they have no data. */
export function EmptyHint({ icon, text, onPress }: Props) {
  const { surface, hairline, accent, accentSoft, mutedColor } = useHomeTheme();
  return (
    <Pressable onPress={onPress} style={[s.emptyHint, { backgroundColor: surface, borderColor: hairline }]}>
      <View style={[s.emptyHintIcon, { backgroundColor: accentSoft }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <Text style={[s.emptyHintText, { color: mutedColor }]}>{text}</Text>
      <Ionicons name="chevron-forward" size={16} color={mutedColor} />
    </Pressable>
  );
}
