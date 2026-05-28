import { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, Share } from 'react-native';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import {
  subscribeMyReactionOnCatch,
  fetchCatchLikeCount,
  fetchReactionSummary,
  toggleCatchReaction,
  subscribeCatchComments,
  fetchCatchCommentCount,
  addCatchComment,
  editCatchComment,
  deleteCatchComment,
  subscribeCatchSaved,
  toggleSaveCatch,
  fetchCatchLikers,
  REACTIONS,
  type ReactionType,
  type ReactionSummaryItem,
  type FeedComment,
  type CatchLiker,
} from '../services/socialFeed';
import { submitContentReport } from '../services/contentReports';
import { getBlockedUids } from '../services/blockUser';
import type { FeedItem } from '../services/catchSync';

type Props = {
  item: FeedItem;
  myUid?: string;
  myDisplayName: string;
  ownerName: string;
  socialEnabled?: boolean;
  isVisible?: boolean;
  /** Parent state — when true, this hook opens the comments subscription;
      when false, comments stay closed and we serve only a count (1 read
      via getCountFromServer instead of 80+ reads from the full subscription).
      Most users never tap to view comments, so gating saves the bulk of
      per-card Firestore reads. */
  commentsOpen?: boolean;
};

export type FeedPostSocialState = {
  myReaction: ReactionType | null;
  reactionPickerOpen: boolean;
  setReactionPickerOpen: (v: boolean) => void;
  reactionSummary: ReactionSummaryItem[];
  likeBusy: boolean;
  likeCount: number;
  /** Server-side `count()` of the comments subcollection — fetched once
      per card mount, no live subscription. Use for the "View N comments"
      label so callers don't have to subscribe just to display a number. */
  commentCount: number;
  comments: FeedComment[];
  allComments: FeedComment[];
  draft: string;
  setDraft: (v: string) => void;
  replyingTo: { id: string; name: string } | null;
  setReplyingTo: (v: { id: string; name: string } | null) => void;
  sendBusy: boolean;
  editingComment: { id: string; text: string } | null;
  setEditingComment: (v: { id: string; text: string } | null) => void;
  editBusy: boolean;
  saved: boolean;
  saveBusy: boolean;
  likersOpen: boolean;
  setLikersOpen: (v: boolean) => void;
  likers: CatchLiker[];
  likersLoading: boolean;
  openLikers: () => void;
  onPickReaction: (reaction: ReactionType) => Promise<void>;
  onToggleSave: () => Promise<void>;
  onShare: () => Promise<void>;
  onReportCatch: () => void;
  onSaveEdit: () => Promise<void>;
  onDeleteComment: (commentId: string) => void;
  onSendComment: () => Promise<void>;
};

export function useFeedPostSocial({
  item,
  myUid,
  myDisplayName,
  ownerName,
  socialEnabled = false,
  isVisible = true,
  commentsOpen = false,
}: Props): FeedPostSocialState {
  const catchId = item.id;

  const [myReaction, setMyReaction] = useState<ReactionType | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionSummary, setReactionSummary] = useState<ReactionSummaryItem[]>([]);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [editingComment, setEditingComment] = useState<{ id: string; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [pendingComments, setPendingComments] = useState<FeedComment[]>([]);
  const [likers, setLikers] = useState<CatchLiker[]>([]);
  const [likersLoading, setLikersLoading] = useState(false);

  const likeBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const sendBusyRef = useRef(false);
  const likersRequestIdRef = useRef(0);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return;
    let cancelled = false;
    void (async () => {
      // `count()` aggregation calls are 1 read each on Firestore's billing —
      // cheap, and they spare us mounting the per-card `subscribeCatchComments`
      // listener (~80 reads each) just to show "View N comments". Subscribe
      // only when the user opens comments (see effect below).
      const [lc, summary, cc] = await Promise.all([
        fetchCatchLikeCount(catchId),
        fetchReactionSummary(catchId),
        fetchCatchCommentCount(catchId),
      ]);
      if (!cancelled) {
        setLikeCount(lc);
        setReactionSummary(summary);
        setCommentCount(cc);
      }
    })();
    return () => { cancelled = true; };
  }, [socialEnabled, myUid, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return;
    return subscribeMyReactionOnCatch(catchId, myUid, setMyReaction);
  }, [socialEnabled, myUid, catchId, isVisible]);

  // Block-list for filtering comments. Loaded once per myUid change; the
  // comment subscription below filters its incoming list against this set
  // before exposing to the UI. Without this, blocked users' comments
  // appear in the detail view (the feed-level filter doesn't reach down
  // into per-catch comments).
  const blockedUidsRef = useRef<Set<string>>(new Set());
  const [blockedReady, setBlockedReady] = useState(false);
  useEffect(() => {
    if (!myUid) return;
    let cancelled = false;
    getBlockedUids(myUid).then((set) => {
      if (cancelled) return;
      blockedUidsRef.current = set;
      // Bump a ready flag so the comment subscription effect re-runs once
      // the block-list is loaded. Without this, a fast Firestore round-trip
      // could deliver comments before we know who's blocked.
      setBlockedReady(true);
    }).catch(() => {
      if (!cancelled) setBlockedReady(true);
    });
    return () => { cancelled = true; };
  }, [myUid]);

  useEffect(() => {
    // Comments-list subscription is gated on `commentsOpen` — most users
    // never tap to expand comments, and the full subscription cost 80+ reads
    // per visible card. The static commentCount above keeps the "View N
    // comments" label accurate without keeping a listener attached.
    // `blockedReady` stays in the deps so the subscription rebuilds with
    // the filter active once we know who's blocked. If myUid is undefined
    // (signed-out preview), pass through unfiltered.
    if (!socialEnabled || !catchId || !isVisible || !commentsOpen) return;
    return subscribeCatchComments(catchId, (incoming) => {
      const blocked = blockedUidsRef.current;
      if (!myUid || blocked.size === 0) {
        setComments(incoming);
        return;
      }
      setComments(incoming.filter((c) => !blocked.has(c.authorUid)));
    });
  }, [socialEnabled, catchId, isVisible, commentsOpen, myUid, blockedReady]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return;
    return subscribeCatchSaved(myUid, catchId, setSaved);
  }, [socialEnabled, myUid, catchId, isVisible]);

  useEffect(() => {
    // Drop pending entries 1-for-1 against matching real comments. The earlier
    // `comments.some(...)` check matched on (authorUid, text) and dropped ALL
    // pending entries with that pair as soon as the first real one arrived —
    // so two rapid identical comments collapsed to one optimistically until the
    // second snapshot caught up. Now we tally real-vs-pending counts per pair
    // and keep any pending entries beyond the real count.
    setPendingComments((pending) => {
      const realCounts = new Map<string, number>();
      for (const c of comments) {
        const key = `${c.authorUid}|${c.text}`;
        realCounts.set(key, (realCounts.get(key) ?? 0) + 1);
      }
      const dropCounts = new Map<string, number>();
      const remaining: FeedComment[] = [];
      for (const p of pending) {
        const key = `${p.authorUid}|${p.text}`;
        const realCount = realCounts.get(key) ?? 0;
        const alreadyDropped = dropCounts.get(key) ?? 0;
        if (alreadyDropped < realCount) {
          dropCounts.set(key, alreadyDropped + 1);
        } else {
          remaining.push(p);
        }
      }
      return remaining;
    });
  }, [comments]);

  const openLikers = useCallback(async () => {
    if (likeCount === 0) return;
    setLikersOpen(true);
    setLikersLoading(true);
    const requestId = ++likersRequestIdRef.current;
    try {
      const result = await fetchCatchLikers(catchId);
      if (requestId === likersRequestIdRef.current) setLikers(result);
    } finally {
      if (requestId === likersRequestIdRef.current) setLikersLoading(false);
    }
  }, [catchId, likeCount]);

  const onPickReaction = useCallback(async (reaction: ReactionType) => {
    if (!socialEnabled || !myUid || likeBusyRef.current) return;
    setReactionPickerOpen(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const prevReaction = myReaction;
    const prevLikeCount = likeCount;
    const prevSummary = reactionSummary;
    const isToggleOff = prevReaction === reaction;
    const nextReaction: ReactionType | null = isToggleOff ? null : reaction;

    setMyReaction(nextReaction);
    setLikeCount(isToggleOff ? Math.max(0, prevLikeCount - 1) : prevReaction ? prevLikeCount : prevLikeCount + 1);
    setReactionSummary(() => {
      let updated = prevSummary.map((r) => ({ ...r }));
      if (prevReaction) {
        const idx = updated.findIndex((r) => r.type === prevReaction);
        if (idx >= 0) {
          updated[idx].count -= 1;
          if (updated[idx].count <= 0) updated = updated.filter((r) => r.type !== prevReaction);
        }
      }
      if (!isToggleOff) {
        const idx = updated.findIndex((r) => r.type === reaction);
        if (idx >= 0) {
          updated[idx].count += 1;
        } else {
          updated.push({ type: reaction, emoji: REACTIONS[reaction].emoji, count: 1 });
          updated.sort((a, b) => b.count - a.count);
        }
      }
      return updated;
    });

    likeBusyRef.current = true;
    setLikeBusy(true);
    try {
      await toggleCatchReaction(catchId, myUid, item.ownerUid, myDisplayName, reaction);
      fetchReactionSummary(catchId).then(setReactionSummary).catch(() => {});
    } catch (e) {
      setMyReaction(prevReaction);
      setLikeCount(prevLikeCount);
      setReactionSummary(prevSummary);
      Alert.alert('Реакция', e instanceof Error ? e.message : 'Неуспешно действие.');
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  }, [socialEnabled, myUid, catchId, item.ownerUid, myDisplayName, myReaction, likeCount, reactionSummary]);

  const onToggleSave = useCallback(async () => {
    if (!socialEnabled || !myUid || saveBusyRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    saveBusyRef.current = true;
    setSaveBusy(true);
    try {
      await toggleSaveCatch(myUid, catchId);
    } finally {
      saveBusyRef.current = false;
      setSaveBusy(false);
    }
  }, [socialEnabled, myUid, catchId]);

  const onShare = useCallback(async () => {
    const lines = [
      item.photoTitle ? `«${item.photoTitle}»` : null,
      `🎣 ${ownerName}: ${item.speciesName}`,
      item.weightKg != null ? `${item.weightKg} кг` : null,
      item.notes ? item.notes.slice(0, 400) : null,
      item.photoUri ?? null,
    ].filter(Boolean) as string[];
    try {
      await Share.share({ message: lines.join('\n'), title: 'Улов от Ribolov' });
    } catch {
      /* rejected share */
    }
  }, [ownerName, item.photoTitle, item.speciesName, item.weightKg, item.notes, item.photoUri]);

  const onReportCatch = useCallback(() => {
    const uid = myUid;
    if (!socialEnabled || !uid) return;
    const send = (reason: string) => {
      void (async () => {
        try {
          await submitContentReport({ reporterUid: uid, targetType: 'catch', catchId, reason });
          Alert.alert('Благодарим', 'Сигналът е изпратен за преглед.');
        } catch {
          Toast.show({ type: 'error', text1: 'Неуспешно изпращане', visibilityTime: 2400 });
        }
      })();
    };
    Alert.alert('Докладвай публикация', 'Избери приблизителна причина', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Спам / измама', onPress: () => send('Спам или измама') },
      { text: 'Неприлично съдържание', onPress: () => send('Неприлично или обидно съдържание') },
      { text: 'Друго нарушение', onPress: () => send('Друго нарушение на правилата') },
    ]);
  }, [socialEnabled, myUid, catchId]);

  const onSaveEdit = useCallback(async () => {
    if (!editingComment || editBusy) return;
    const trimmed = editingComment.text.trim();
    if (!trimmed) return;
    setEditBusy(true);
    try {
      await editCatchComment(catchId, editingComment.id, trimmed);
      setEditingComment(null);
    } catch (e) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : 'Неуспешно редактиране', visibilityTime: 2400 });
    } finally {
      setEditBusy(false);
    }
  }, [catchId, editingComment, editBusy]);

  const onDeleteComment = useCallback((commentId: string) => {
    Alert.alert('Изтриване', 'Изтриване на коментара?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCatchComment(catchId, commentId);
          } catch (e) {
            Toast.show({ type: 'error', text1: e instanceof Error ? e.message : 'Неуспешно изтриване', visibilityTime: 2400 });
          }
        },
      },
    ]);
  }, [catchId]);

  const onSendComment = useCallback(async () => {
    if (!socialEnabled || !myUid || sendBusyRef.current) return;
    const t = draft.trim();
    if (!t) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const reply = replyingTo;
    const tempId = `temp-${Date.now()}`;
    const tempComment: FeedComment = {
      id: tempId,
      authorUid: myUid,
      authorName: myDisplayName,
      text: t,
      ...(reply ? { replyToId: reply.id, replyToName: reply.name } : {}),
    };

    setPendingComments((prev) => [...prev, tempComment]);
    setDraft('');
    setReplyingTo(null);

    sendBusyRef.current = true;
    setSendBusy(true);
    try {
      await addCatchComment(catchId, myUid, myDisplayName, t, item.ownerUid, reply ?? undefined);
    } catch (e) {
      setPendingComments((prev) => prev.filter((c) => c.id !== tempId));
      // Only restore the failed text if the user hasn't already started
      // typing the next comment. Earlier the unconditional setDraft(t)
      // clobbered whatever they had begun typing since pressing send.
      setDraft((current) => (current.trim() === '' ? t : current));
      setReplyingTo((current) => current ?? reply);
      Alert.alert('Коментар', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      sendBusyRef.current = false;
      setSendBusy(false);
    }
  }, [socialEnabled, myUid, draft, catchId, item.ownerUid, myDisplayName, replyingTo]);

  return {
    myReaction, reactionPickerOpen, setReactionPickerOpen, reactionSummary,
    likeBusy, likeCount, commentCount, comments, allComments: [...comments, ...pendingComments],
    draft, setDraft, replyingTo, setReplyingTo,
    sendBusy, editingComment, setEditingComment, editBusy,
    saved, saveBusy, likersOpen, setLikersOpen, likers, likersLoading,
    openLikers, onPickReaction, onToggleSave, onShare, onReportCatch,
    onSaveEdit, onDeleteComment, onSendComment,
  };
}
