import type { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Maps Spot waterType values to Ionicons icon names. */
export const waterTypeIcons: Record<string, IoniconName> = {
  lake: 'water-outline',
  dam: 'layers-outline',
  river: 'git-branch-outline',
  pond: 'ellipse-outline',
  sea: 'boat-outline',
};

/** Maps species category values to Ionicons icon names. */
export const speciesCategoryIcons: Record<string, IoniconName> = {
  cyprinid: 'fish-outline',
  predator: 'flash-outline',
  saltwater: 'boat-outline',
};
