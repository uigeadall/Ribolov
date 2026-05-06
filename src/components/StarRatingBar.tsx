import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  rating: number;
  color: string;
  emptyColor: string;
  size?: number;
  max?: number;
};

export function StarRatingBar({ rating, color, emptyColor, size = 14, max = 5 }: Props) {
  const full = Math.round(Math.min(max, Math.max(0, rating)));
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: max }, (_, i) => (
        <Ionicons
          key={i}
          name={i < full ? 'star' : 'star-outline'}
          size={size}
          color={i < full ? color : emptyColor}
        />
      ))}
    </View>
  );
}
