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
  /** Optional short video clip attached to the catch. Capped at 15 seconds
      during upload (utils/videoLimits.ts). videoStoragePath mirrors the
      R2/Storage object key so post deletion can clean up the bucket.
      videoDurationMs is captured at pick time and used for inline player
      progress + analytics. */
  videoUri?: string;
  videoStoragePath?: string;
  videoDurationMs?: number;
  /** Poster image (JPEG) shown by the inline player before the video
      reaches readyToPlay. Generated client-side from the first frame at
      pick time and uploaded to R2 alongside the clip. Same lifecycle as
      videoStoragePath — kept so deletion can sweep the orphan poster. */
  videoThumbnailUri?: string;
  videoThumbnailStoragePath?: string;
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
  /** Optional 15-second video clip attached to the post. Capped at 15s on
      pick (same VIDEO_MAX_SECONDS as catch videos). videoStoragePath
      mirrors the R2 object key so post deletion can clean up the bucket.
      videoThumbnailUri is a JPEG poster generated client-side; the inline
      feed player renders it as a background while the video buffers. */
  videoUri?: string;
  videoStoragePath?: string;
  videoDurationMs?: number;
  videoThumbnailUri?: string;
  videoThumbnailStoragePath?: string;
  /** Lowercased hashtag tokens (no '#' prefix). Stored for query filtering. */
  hashtags: string[];
  /** UIDs mentioned in the text. Used to fan out notifications. */
  mentionUids: string[];
  /** ISO date string at creation — used to sort posts and catches in a merged feed. */
  date: string;
  createdAt?: unknown;
  likeCount?: number;
  commentCount?: number;
  /** Per-reaction-type tally maintained atomically by togglePostReaction so
      PostCard can render the emoji breakdown without the per-card
      fetchPostReactionSummary call (which read up to 50 docs per visible
      post). Optional because legacy posts predate this field. */
  reactionCounts?: Partial<Record<'heart' | 'fire' | 'trophy' | 'fish' | 'wow', number>>;
  isPublic?: boolean;
  /** Set when this post is a quote-reshare of another feed item. */
  reshareOf?: ResharedRef;
};

/** Denormalized preview of the message being replied to. Inlined so the bubble
    renders without an extra Firestore round-trip. */
export type MessageReplyRef = {
  messageId: string;
  senderUid: string;
  /** Plain-text preview of the quoted message (≤200 chars). For media use "📷 Снимка" etc. */
  preview: string;
};

/** Reference to a fishing-domain item shared into a chat (catch / post / spot). */
export type SharedRef = {
  kind: 'catch' | 'post' | 'spot';
  id: string;
  ownerUid?: string;
  /** Denormalized so the in-chat card renders without an extra fetch. */
  title?: string;
  subtitle?: string;
  photoUrl?: string;
};

export type DirectMessage = {
  id: string;
  senderUid: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  createdAt?: unknown;
  /** Set when the recipient opens the conversation. Used for read receipts. */
  readAt?: unknown;
  /** Set when the sender edits the message text within the edit window. */
  editedAt?: unknown;
  /** Set when the sender soft-deletes the message. Client renders a tombstone. */
  deletedAt?: unknown;
  replyTo?: MessageReplyRef;
  sharedRef?: SharedRef;
};

export type DirectMessageReaction = {
  /** Map of uid → emoji code ('heart' | 'fire' | 'trophy' | 'fish' | 'wow'). */
  reactions: Record<string, string>;
};

export type ConversationPreview = {
  convId: string;
  otherUid: string;
  otherName: string;
  lastMessage?: string;
  lastMessageAt?: number;
  /** uid of whoever sent the last message — used to prefix "Ти: " when it was me. */
  lastSenderUid?: string;
  unreadCount: number;
};
