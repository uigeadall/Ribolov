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

/** Dashed-border "do this to fill the section" pressable used by the
    Following / Nearest-water / Recent sections when they have no data. */
export function EmptyHint({ icon, text, onPress }: Props) {
  const { cardBg, cardBorder, primary, mutedColor } = useHomeTheme();
  return (
    <Pressable onPress={onPress} style={[s.emptyHint, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={[s.emptyHintIcon, { backgroundColor: primary + '18' }]}>
        <Ionicons name={icon} size={20} color={primary} />
      </View>
      <Text style={[s.emptyHintText, { color: mutedColor }]}>{text}</Text>
      <Ionicons name="chevron-forward" size={16} color={mutedColor} />
    </Pressable>
  );
}
