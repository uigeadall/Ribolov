import type { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Maps a WMO weather code to the appropriate Ionicons icon name. */
export function wmoIconName(code: number): IoniconName {
  if (code === 0) return 'sunny-outline';
  if (code <= 3) return 'partly-sunny-outline';
  if (code <= 48) return 'cloudy-outline';
  if (code <= 67) return 'rainy-outline';
  if (code <= 77) return 'snow-outline';
  if (code <= 82) return 'rainy-outline';        // rain showers
  if (code <= 86) return 'snow-outline';         // snow showers — were falling through to thunderstorm
  return 'thunderstorm-outline';                 // 95-99
}
