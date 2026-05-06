import React from 'react';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  weatherCode: number;
  size?: number;
  color?: string;
};

/** WMO код → икона (опростено). */
export function WeatherIcon({ weatherCode, size = 36, color = '#0E4D64' }: Props) {
  let name: keyof typeof Ionicons.glyphMap = 'partly-sunny-outline';
  if (weatherCode === 0) name = 'sunny-outline';
  else if (weatherCode <= 3) name = 'cloud-outline';
  else if (weatherCode <= 48) name = 'water-outline';
  else if (weatherCode <= 67) name = 'rainy-outline';
  else if (weatherCode <= 77) name = 'snow-outline';
  else if (weatherCode <= 82) name = 'rainy-outline';
  else name = 'thunderstorm-outline';

  return <Ionicons name={name} size={size} color={color} />;
}
