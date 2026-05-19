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
  /** Потребителят е избрал да участва в седмичните/месечните класации */
  enterLeaderboard?: boolean;
  location?: { latitude: number; longitude: number; name?: string };
  syncedToCloud?: boolean;
  tripId?: string;
  conditions?: {
    temperatureC?: number;
    pressureHpa?: number;
    windKmh?: number;
    moonPhase?: number;
    moonPhaseName?: string;
    fishingRating?: number;
  };
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

/**
 * Snapshot of a reshared item, stored on the new post so the embedded card
 * survives if the original is deleted later.
 */
export type ResharedRef = {
  kind: 'catch' | 'post';
  id: string;
  ownerUid: string;
  ownerName: string;
  ownerPhotoUrl?: string;
  /** Free-form post: text body. Catch: optional notes/photoTitle. */
  text?: string;
  photoUri?: string;
  /** Catch only: species + weight, used for the embedded card label. */
  speciesName?: string;
  weightKg?: number;
  /** ISO date of the original item — shown as a "originally …" timestamp. */
  date: string;
};

/**
 * A free-form social post (not tied to a logged catch).
 * Lives in Firestore `posts/{id}`. Has its own subcollections for likes/comments/saves
 * mirroring publicCatches so existing reaction/comment services can be reused.
 */
export type Post = {
  id: string;
  ownerUid: string;
  ownerName: string;
  ownerPhotoUrl?: string;
  text: string;
  photoUri?: string;
  photoStoragePath?: string;
  /** Lowercased hashtag tokens (no '#' prefix). Stored for query filtering. */
  hashtags: string[];
  /** UIDs mentioned in the text. Used to fan out notifications. */
  mentionUids: string[];
  /** ISO date string at creation — used to sort posts and catches in a merged feed. */
  date: string;
  createdAt?: unknown;
  likeCount?: number;
  commentCount?: number;
  isPublic?: boolean;
  /** Set when this post is a quote-reshare of another feed item. */
  reshareOf?: ResharedRef;
};

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
