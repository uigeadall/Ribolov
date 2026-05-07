import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { wmoIconName } from '../theme/weatherIcons';

type Props = {
  weatherCode: number;
  size?: number;
  color?: string;
};

export function WeatherIcon({ weatherCode, size = 36, color = '#0E4D64' }: Props) {
  return <Ionicons name={wmoIconName(weatherCode)} size={size} color={color} />;
}
