import { useState, useEffect, useCallback } from 'react';
import { Alert, Animated } from 'react-native';
import {
  subscribeMyStoryReaction,
  toggleStoryReaction,
  getStoryReactionSummary,
  subscribeStoryComments,
  addStoryComment,
  deleteStoryComment,
  STORY_REACTIONS,
  type Story,
  type StoryReactionType,
  type StoryReactionSummary,
  type StoryComment,
} from '../services/stories';
import type { User } from 'firebase/auth';

type FlyingEmoji = {
  id: string;
  emoji: string;
  x: number;
  translateY: Animated.Value;
  translateX: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
};

export type { FlyingEmoji };

export type StoryViewerState = {
  myReaction: StoryReactionType | null;
  reactionSummary: StoryReactionSummary[];
  comments: StoryComment[];
  commentDraft: string;
  setCommentDraft: (v: string) => void;
  commentBusy: boolean;
  commentsOpen: boolean;
  setCommentsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  flyingEmojis: FlyingEmoji[];
  removeFlyingEmoji: (id: string) => void;
  handlePickReaction: (type: StoryReactionType, tapX: number) => Promise<void>;
  handleSendComment: () => Promise<void>;
  handleDeleteComment: (commentId: string) => void;
  totalReactions: number;
};

export function useStoryViewer(
  viewing: Story | null,
  user: Pick<User, 'uid' | 'displayName'> | null,
): StoryViewerState {
  const [myReaction, setMyReaction] = useState<StoryReactionType | null>(null);
  const [reactionSummary, setReactionSummary] = useState<StoryReactionSummary[]>([]);
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [flyingEmojis, setFlyingEmojis] = useState<FlyingEmoji[]>([]);

  useEffect(() => {
    if (!viewing || !user) return;
    setMyReaction(null);
    setReactionSummary([]);
    setComments([]);
    const unsubReaction = subscribeMyStoryReaction(viewing.id, user.uid, setMyReaction);
    const unsubComments = subscribeStoryComments(viewing.id, setComments);
    getStoryReactionSummary(viewing.id).then(setReactionSummary);
    return () => { unsubReaction(); unsubComments(); };
  }, [viewing?.id, user?.uid]);

  const removeFlyingEmoji = useCallback((id: string) => {
    setFlyingEmojis((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handlePickReaction = useCallback(async (type: StoryReactionType, tapX: number) => {
    if (!viewing || !user) return;
    const fe: FlyingEmoji = {
      id: `${Date.now()}-${Math.random()}`,
      emoji: STORY_REACTIONS[type].emoji,
      x: tapX,
      translateY: new Animated.Value(0),
      translateX: new Animated.Value(0),
      scale: new Animated.Value(0.3),
      opacity: new Animated.Value(1),
    };
    setFlyingEmojis((prev) => [...prev, fe]);
    try {
      await toggleStoryReaction(viewing.id, user.uid, user.displayName ?? 'Рибар', type);
      const summary = await getStoryReactionSummary(viewing.id);
      setReactionSummary(summary);
    } catch { /* best-effort */ }
  }, [viewing, user]);

  const handleSendComment = useCallback(async () => {
    if (!viewing || !user || !commentDraft.trim() || commentBusy) return;
    setCommentBusy(true);
    try {
      await addStoryComment(viewing.id, user.uid, user.displayName ?? 'Рибар', commentDraft);
      setCommentDraft('');
    } catch (e) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally { setCommentBusy(false); }
  }, [viewing, user, commentDraft, commentBusy]);

  const handleDeleteComment = useCallback((commentId: string) => {
    if (!viewing) return;
    Alert.alert('Изтриване', 'Изтриване на коментара?', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Изтрий', style: 'destructive', onPress: () => deleteStoryComment(viewing.id, commentId).catch(() => {}) },
    ]);
  }, [viewing]);

  const totalReactions = reactionSummary.reduce((s, r) => s + r.count, 0);

  return {
    myReaction, reactionSummary, comments,
    commentDraft, setCommentDraft, commentBusy,
    commentsOpen, setCommentsOpen,
    flyingEmojis, removeFlyingEmoji,
    handlePickReaction, handleSendComment, handleDeleteComment,
    totalReactions,
  };
}
