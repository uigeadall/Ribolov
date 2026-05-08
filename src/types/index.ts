/** Споделени типове за дневника и облака */

export type Species = {
  id: string;
  nameBg: string;
  nameLatin: string;
  category: string;
  minSizeCm?: number;
  banPeriod?: { from: string; to: string; note?: string };
  description: string;
  habitat: string;
  typicalSize: string;
  maxWeightKg?: number;
  biology: string;
  anglingTips: string;
  baitsAndLures: string;
  bestSeason: string;
};

export type AchievementCategory =
  | 'quantity'
  | 'weight'
  | 'trophy'
  | 'variety'
  | 'specialist'
  | 'release'
  | 'dedication'
  | 'geography'
  | 'journal'
  | 'social';

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type Achievement = {
  id: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  name: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  unlocked: boolean;
};

export type Catch = {
  id: string;
  speciesId: string;
  speciesName: string;
  weightKg?: number;
  lengthCm?: number;
  date: string;
  bait?: string;
  notes?: string;
  /** Кратко заглавие за споделена снимка (лента, класики). */
  photoTitle?: string;
  released?: boolean;
  photoUri?: string;
  extraPhotoUris?: string[];
  photoStoragePath?: string;
  /** true ако снимката е заснета с камерата в приложението — изисква се за публични постове и класики */
  photoTakenWithAppCamera?: boolean;
  location?: { latitude: number; longitude: number; name?: string };
  syncedToCloud?: boolean;
};

export type Spot = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
  waterType: 'lake' | 'dam' | 'river' | 'pond' | 'sea';
  isFavorite?: boolean;
  createdAt?: string;
};

export type GearItem = { id: string; name: string; notes?: string };

export type TripPlan = {
  id: string;
  title: string;
  dateIso: string;
  notes?: string;
};

export type TournamentCategory = 'weight' | 'count' | 'length' | 'species';

export type Tournament = {
  id: string;
  name: string;
  description?: string;
  hostUid: string;
  hostName: string;
  startDate: string;
  endDate: string;
  category: TournamentCategory;
  speciesId?: string;
  speciesName?: string;
  isPublic?: boolean;
};

export type TournamentEntry = {
  catchId: string;
  ownerUid: string;
};

export type LeaderEntry = { uid: string; name: string; score: number };

export type DirectMessage = {
  id: string;
  senderUid: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  createdAt?: unknown;
};

export type ConversationPreview = {
  convId: string;
  otherUid: string;
  otherName: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
};
