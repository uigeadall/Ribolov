export type ReactionType = 'heart' | 'fire' | 'trophy' | 'fish' | 'wow';

export const REACTIONS: Record<ReactionType, { emoji: string; label: string }> = {
  heart:  { emoji: '❤️', label: 'Харесвам' },
  fire:   { emoji: '🔥', label: 'Огън' },
  trophy: { emoji: '🏆', label: 'Трофей' },
  fish:   { emoji: '🎣', label: 'Улов' },
  wow:    { emoji: '😮', label: 'Уау' },
};

export type ReactionSummaryItem = { type: ReactionType; emoji: string; count: number };

export type FeedComment = {
  id: string;
  authorUid: string;
  authorName: string;
  text: string;
  createdAt?: unknown;
  editedAt?: unknown;
  replyToId?: string;
  replyToName?: string;
};

export type SocialNotification = {
  id: string;
  actorUid: string;
  actorName: string;
  type: 'like' | 'comment' | 'follow' | 'storyLike' | 'storyComment' | 'mention' | 'message';
  catchId?: string;
  storyId?: string;
  /** Present for 'message' notifications — the conversation this message belongs to. */
  convId?: string;
  preview?: string;
  reactionEmoji?: string;
  read: boolean;
  createdAt?: unknown;
};

export type CatchLiker = { uid: string; displayName: string; reaction?: ReactionType };
