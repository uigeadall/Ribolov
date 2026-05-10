import { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  subscribeMyReactionOnCatch,
  fetchCatchLikeCount,
  fetchReactionSummary,
  toggleCatchReaction,
  subscribeCatchComments,
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
import type { FeedItem } from '../services/catchSync';

type Props = {
  item: FeedItem;
  myUid?: string;
  myDisplayName: string;
  ownerName: string;
  socialEnabled?: boolean;
  isVisible?: boolean;
};

export type FeedPostSocialState = {
  myReaction: ReactionType | null;
  reactionPickerOpen: boolean;
  setReactionPickerOpen: (v: boolean) => void;
  reactionSummary: ReactionSummaryItem[];
  likeBusy: boolean;
  likeCount: number;
  comments: FeedComment[];
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
}: Props): FeedPostSocialState {
  const catchId = item.id;

  const [myReaction, setMyReaction] = useState<ReactionType | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionSummary, setReactionSummary] = useState<ReactionSummaryItem[]>([]);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [editingComment, setEditingComment] = useState<{ id: string; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
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
      const [lc, summary] = await Promise.all([
        fetchCatchLikeCount(catchId),
        fetchReactionSummary(catchId),
      ]);
      if (!cancelled) { setLikeCount(lc); setReactionSummary(summary); }
    })();
    return () => { cancelled = true; };
  }, [socialEnabled, myUid, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return;
    return subscribeMyReactionOnCatch(catchId, myUid, setMyReaction);
  }, [socialEnabled, myUid, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !catchId || !isVisible) return;
    return subscribeCatchComments(catchId, setComments);
  }, [socialEnabled, catchId, isVisible]);

  useEffect(() => {
    if (!socialEnabled || !myUid || !catchId || !isVisible) return;
    return subscribeCatchSaved(myUid, catchId, setSaved);
  }, [socialEnabled, myUid, catchId, isVisible]);

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
    likeBusyRef.current = true;
    setLikeBusy(true);
    const prev = myReaction;
    try {
      const next = await toggleCatchReaction(catchId, myUid, item.ownerUid, myDisplayName, reaction);
      if (!prev && next) setLikeCount((n) => n + 1);
      else if (prev && !next) setLikeCount((n) => Math.max(0, n - 1));
      const summary = await fetchReactionSummary(catchId);
      setReactionSummary(summary);
    } catch (e) {
      Alert.alert('Реакция', e instanceof Error ? e.message : 'Неуспешно действие.');
    } finally {
      likeBusyRef.current = false;
      setLikeBusy(false);
    }
  }, [socialEnabled, myUid, catchId, item.ownerUid, myDisplayName, myReaction]);

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
          Alert.alert('Грешка', 'Неуспешно изпращане.');
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
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно редактиране.');
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
            Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изтриване.');
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
    sendBusyRef.current = true;
    setSendBusy(true);
    const reply = replyingTo;
    try {
      await addCatchComment(catchId, myUid, myDisplayName, t, item.ownerUid, reply ?? undefined);
      setDraft('');
      setReplyingTo(null);
    } catch (e) {
      Alert.alert('Коментар', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      sendBusyRef.current = false;
      setSendBusy(false);
    }
  }, [socialEnabled, myUid, draft, catchId, item.ownerUid, myDisplayName, replyingTo]);

  return {
    myReaction, reactionPickerOpen, setReactionPickerOpen, reactionSummary,
    likeBusy, likeCount, comments, draft, setDraft, replyingTo, setReplyingTo,
    sendBusy, editingComment, setEditingComment, editBusy,
    saved, saveBusy, likersOpen, setLikersOpen, likers, likersLoading,
    openLikers, onPickReaction, onToggleSave, onShare, onReportCatch,
    onSaveEdit, onDeleteComment, onSendComment,
  };
}
