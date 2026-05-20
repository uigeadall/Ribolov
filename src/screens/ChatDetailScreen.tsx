import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  ActivityIndicator,
  Animated,
  Modal,
  Clipboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { ImageViewer } from '../components/ImageViewer';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { ProfileStackParamList } from '../navigation/types';
import type { DirectMessage, MessageReplyRef } from '../types';
import { useAuth } from '../services/authContext';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { sendConversationMessage, subscribeConversationMessages, markConversationRead, subscribeUserPresence } from '../services/cloudSync';
import {
  setTypingStatus,
  subscribeTyping,
  loadOlderMessages,
  editMessage,
  deleteMessage,
  setMessageReaction,
  subscribeConversationReactions,
  makeMessageClientId,
  markMessagesReadFromList,
  MESSAGE_EDIT_WINDOW_MS,
  fetchMyUnreadInConversation,
  subscribeMutedConversations,
  muteConversation,
  unmuteConversation,
} from '../services/messaging';
import { enqueueMessage } from '../services/messageSyncQueue';
import { ensureFirebase } from '../services/firebase';
import { getBlockedUids, blockUser, unblockUser } from '../services/blockUser';
import { handleError } from '../utils/handleError';
import { notifyInfo } from '../utils/notify';
import { checkImageSize } from '../utils/imageSize';

type R = RouteProp<ProfileStackParamList, 'ChatDetail'>;

const REACTION_EMOJI: Record<string, string> = {
  heart: '❤️',
  fire: '🔥',
  trophy: '🏆',
  fish: '🐟',
  wow: '😮',
};
type ReactionCode = 'heart' | 'fire' | 'trophy' | 'fish' | 'wow';
const REACTION_ORDER: ReactionCode[] = ['heart', 'fire', 'trophy', 'fish', 'wow'];

function formatMsgTime(createdAt: unknown): string {
  if (!createdAt) return '';
  let d: Date | null = null;
  if (typeof createdAt === 'number') {
    d = new Date(createdAt);
  } else {
    const ts = createdAt as { toDate?: () => Date; seconds?: number };
    d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : null;
  }
  if (!d) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const timeStr = d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return timeStr;
  if (isYesterday) return `Вчера ${timeStr}`;
  return `${d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' })} ${timeStr}`;
}

function messagePreviewText(msg: DirectMessage): string {
  if (msg.deletedAt) return 'Изтрито съобщение';
  if (msg.sharedRef) {
    if (msg.sharedRef.kind === 'catch') return '🎣 Споделен улов';
    if (msg.sharedRef.kind === 'post') return '📰 Споделена публикация';
    return '📍 Споделено място';
  }
  if (msg.mediaUrl) return msg.mediaType === 'video' ? '📹 Видео' : '📷 Снимка';
  return (msg.text ?? '').slice(0, 200);
}

function buildReplyRef(msg: DirectMessage): MessageReplyRef {
  return {
    messageId: msg.id,
    senderUid: msg.senderUid,
    preview: messagePreviewText(msg),
  };
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const t = v as { toMillis?: () => number; seconds?: number };
  if (t.toMillis) return t.toMillis();
  if (t.seconds) return t.seconds * 1000;
  return 0;
}

/** Bubble augmented with grouping flags so the renderer can adapt corner radii,
    spacing, and whether to show the timestamp/read-tick. A "group" is a run of
    consecutive messages from the same sender within GROUP_GAP_MS. */
type MessageItem = DirectMessage & {
  groupFirst: boolean;
  groupLast: boolean;
};
type ChatItem =
  | MessageItem
  | { _sep: true; label: string; id: string }
  | { _unreadDivider: true; id: string; count: number };

const GROUP_GAP_MS = 3 * 60 * 1000;

function msgDateKey(createdAt: unknown): string {
  const ms = toMillis(createdAt);
  if (!ms) return '';
  return new Date(ms).toDateString();
}

function msgDayLabel(createdAt: unknown): string {
  const ms = toMillis(createdAt);
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Днес';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  return d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });
}

function TypingDot({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -4, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ])
    ).start();
  }, [anim, delay]);
  return <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, transform: [{ translateY: anim }] }} />;
}

export default function ChatDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const { convId, otherName, otherUid } = route.params;
  const [olderMsgs, setOlderMsgs] = useState<DirectMessage[]>([]);
  const [tailMsgs, setTailMsgs] = useState<DirectMessage[]>([]);
  // Default false — we flip to true once the subscription's tail looks full (100 messages),
  // which is our signal that there's plausibly more older history worth fetching.
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [otherPresence, setOtherPresence] = useState<{ online: boolean; lastSeen?: number }>({ online: false });
  const [typingUid, setTypingUid] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState('');
  const [viewerVisible, setViewerVisible] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [reactions, setReactions] = useState<Record<string, Record<string, string>>>({});
  const [editingMsg, setEditingMsg] = useState<DirectMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null);
  const [reactionTarget, setReactionTarget] = useState<DirectMessage | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [scrolledUp, setScrolledUp] = useState(false);
  // One-shot flag: have we already scrolled the unread divider into view?
  // Without this, every content-size change (every new message) would try to
  // jump back to the divider — annoying once you're past it.
  const dividerScrolledRef = useRef(false);
  // Snapshot of how many unread messages there were when the screen was
  // opened. Captured ONCE on mount before `markConversationRead` runs so we
  // can render an "N нови съобщения" divider above the boundary. Set to null
  // after the first effect so re-renders don't reset it.
  const [initialUnreadCount, setInitialUnreadCount] = useState<number | null>(null);
  // Per-conv mute state for the header sheet.
  const [convMuted, setConvMuted] = useState(false);
  // Header info sheet visibility.
  const [infoOpen, setInfoOpen] = useState(false);
  const flatRef = useRef<FlatList<ChatItem>>(null);
  // Per-row Swipeable refs so we can close the swipe after the user has
  // committed to replying. Keyed by message id; cleared on unmount.
  const swipeRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const isAtBottomRef = useRef(true);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStartedRef = useRef(false);
  const insets = useSafeAreaInsets();

  // Hide the floating tab bar so it doesn't cover the input
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => parent?.setOptions({ tabBarStyle: undefined });
    }, [navigation])
  );

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  const otherInitials = otherName.slice(0, 1).toUpperCase();
  const avatarUrl = useAvatarUrl({
    ownerUid: otherUid,
    isMine: false,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });

  // Combined message list. olderMsgs hold paginated history; tailMsgs hold the live tail.
  // Subscription may overlap with older — dedupe by id, prefer the subscription's copy
  // (fresher readAt/editedAt/deletedAt).
  const msgs = useMemo<DirectMessage[]>(() => {
    if (olderMsgs.length === 0) return tailMsgs;
    const tailIds = new Set(tailMsgs.map((m) => m.id));
    const olderOnly = olderMsgs.filter((m) => !tailIds.has(m.id));
    return [...olderOnly, ...tailMsgs];
  }, [olderMsgs, tailMsgs]);

  const chatItems = useMemo<ChatItem[]>(() => {
    const result: ChatItem[] = [];
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? msgs.filter((m) => (m.text ?? '').toLowerCase().includes(q))
      : msgs;
    // Find the boundary message id for the "N нови" divider — the oldest of
    // the last `initialUnreadCount` non-mine messages. We compute it once up
    // front so insertion in the loop is just an id compare. Skip when there's
    // no unread snapshot, when search is active, or when our own uid is the
    // only sender in view (nothing to mark).
    let unreadAnchorId: string | null = null;
    if (initialUnreadCount && initialUnreadCount > 0 && !q && user) {
      const notMine = filtered.filter((m) => m.senderUid !== user.uid);
      const anchor = notMine[Math.max(0, notMine.length - initialUnreadCount)];
      if (anchor) unreadAnchorId = anchor.id;
    }
    let prevKey = '';
    let prevSender = '';
    let prevMs = 0;
    let lastBubbleIdx = -1;
    filtered.forEach((msg) => {
      const key = msgDateKey(msg.createdAt);
      const ms = toMillis(msg.createdAt);
      if (key && key !== prevKey) {
        // Day boundary always breaks the group and finalizes the previous run.
        if (lastBubbleIdx >= 0) {
          const prev = result[lastBubbleIdx];
          if (prev && !('_sep' in prev) && !('_unreadDivider' in prev)) prev.groupLast = true;
        }
        result.push({ _sep: true, label: msgDayLabel(msg.createdAt), id: `sep-${key}` });
        prevKey = key;
        prevSender = '';
      }
      // Insert the new-messages divider before the anchor message. This also
      // breaks the previous group (so the divider sits in its own row).
      if (unreadAnchorId && msg.id === unreadAnchorId) {
        if (lastBubbleIdx >= 0) {
          const prev = result[lastBubbleIdx];
          if (prev && !('_sep' in prev) && !('_unreadDivider' in prev)) prev.groupLast = true;
        }
        result.push({
          _unreadDivider: true,
          id: `unread-${unreadAnchorId}`,
          count: initialUnreadCount ?? 0,
        });
        prevSender = '';
      }
      const sameSender = msg.senderUid === prevSender;
      const closeInTime = prevMs > 0 && ms - prevMs < GROUP_GAP_MS;
      const continues = sameSender && closeInTime;
      // If this bubble continues the previous group, the previous one is not the last anymore.
      if (continues && lastBubbleIdx >= 0) {
        const prev = result[lastBubbleIdx];
        if (prev && !('_sep' in prev) && !('_unreadDivider' in prev)) prev.groupLast = false;
      }
      const bubble: MessageItem = {
        ...msg,
        groupFirst: !continues,
        groupLast: true, // tentatively last; flipped when next continues
      };
      result.push(bubble);
      lastBubbleIdx = result.length - 1;
      prevSender = msg.senderUid;
      prevMs = ms;
    });
    return result;
  }, [msgs, searchTerm, initialUnreadCount, user]);

  useEffect(() => {
    if (!configured || !user) return;
    // Read the per-user unread count BEFORE clearing it so we know how many
    // messages to flag with the "N нови" divider. Best-effort — if the read
    // fails we just skip the divider (it's a nicety, not load-bearing).
    fetchMyUnreadInConversation(convId, user.uid).then((count) => {
      if (count > 0) setInitialUnreadCount(count);
    }).catch(() => {});
    markConversationRead(convId, user.uid).catch(() => {});
    const unsubMsgs = subscribeConversationMessages(convId, (next) => {
      setTailMsgs(next);
      // A full 100-message tail signals there may be older history — enable the load-earlier
      // button. We only flip this on the first full snapshot; pagination owns the flag after.
      if (next.length >= 100) setHasMoreOlder((prev) => prev || true);
      markConversationRead(convId, user.uid).catch(() => {});
      // Stamp readAt on incoming unread messages so the sender sees the read tick.
      markMessagesReadFromList(convId, user.uid, next).catch(() => {});
    });
    const unsubPresence = subscribeUserPresence(otherUid, setOtherPresence);
    const unsubTyping = subscribeTyping(convId, user.uid, setTypingUid);
    const unsubReactions = subscribeConversationReactions(convId, setReactions);
    return () => {
      unsubMsgs();
      unsubPresence();
      unsubTyping();
      unsubReactions();
      void setTypingStatus(convId, user.uid, false);
    };
  }, [convId, otherUid, configured, user]);

  // Load blocked status once. Refetched after block/unblock actions.
  const refreshBlockedStatus = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const set = await getBlockedUids(user.uid);
      setBlockedByMe(set.has(otherUid));
    } catch {
      setBlockedByMe(false);
    }
  }, [user?.uid, otherUid]);

  useEffect(() => { refreshBlockedStatus(); }, [refreshBlockedStatus]);

  const clearTypingStatus = useCallback(() => {
    if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
    if (user && typingStartedRef.current) {
      typingStartedRef.current = false;
      void setTypingStatus(convId, user.uid, false);
    }
  }, [convId, user]);

  const handleLoadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder) return;
    const oldest = (olderMsgs[0] ?? tailMsgs[0])?.createdAt;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const older = await loadOlderMessages(convId, oldest, 40);
      if (older.length === 0) {
        setHasMoreOlder(false);
      } else {
        setOlderMsgs((prev) => [...older, ...prev]);
        if (older.length < 40) setHasMoreOlder(false);
      }
    } catch (e) {
      handleError(e);
    } finally {
      setLoadingOlder(false);
    }
  }, [convId, hasMoreOlder, loadingOlder, olderMsgs, tailMsgs]);

  const send = useCallback(async () => {
    if (!user || !text.trim()) return;
    if (blockedByMe) {
      notifyInfo('Блокиран потребител', 'Разблокирай го от менюто, за да изпратиш съобщение.');
      return;
    }
    setSending(true);
    // Subtle confirmation that the send was registered, even before the network
    // round-trip completes. Light feedback so back-to-back messages don't buzz.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const trimmed = text.trim();
    clearTypingStatus();

    // Editing path — update text on existing message instead of sending a new one.
    if (editingMsg) {
      try {
        await editMessage(convId, editingMsg.id, user.uid, trimmed);
        setEditingMsg(null);
        setText('');
      } catch (e) {
        handleError(e);
      } finally {
        setSending(false);
      }
      return;
    }

    setText('');
    const replyRef = replyingTo ? buildReplyRef(replyingTo) : undefined;
    setReplyingTo(null);
    const clientId = makeMessageClientId();
    try {
      const myName = user.displayName ?? user.email ?? 'Рибар';
      await sendConversationMessage(convId, user.uid, trimmed, otherUid, myName, undefined, undefined, clientId, replyRef);
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === 'unavailable' || code === 'failed-precondition') {
        const myName = user.displayName ?? user.email ?? 'Рибар';
        await enqueueMessage(convId, user.uid, trimmed, otherUid, myName, undefined, undefined, clientId, replyRef).catch(() => {});
        notifyInfo('Офлайн', 'Съобщението ще бъде изпратено, когато се свържеш с интернет.');
      } else {
        setText(trimmed);
        if (replyRef) setReplyingTo(replyingTo);
        handleError(e);
      }
    } finally {
      setSending(false);
    }
  }, [convId, text, user, otherUid, clearTypingStatus, editingMsg, blockedByMe, replyingTo]);

  const cancelEdit = useCallback(() => {
    setEditingMsg(null);
    setText('');
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const pickAndSendMedia = useCallback(async (source: 'camera' | 'gallery') => {
    if (!user) return;
    if (blockedByMe) {
      notifyInfo('Блокиран потребител', 'Разблокирай го, за да изпратиш медия.');
      return;
    }
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      notifyInfo('Няма достъп', 'Разреши достъп до камерата/галерията.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.5 };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!checkImageSize(asset)) return;

    setUploading(true);
    const clientId = makeMessageClientId();
    const replyRef = replyingTo ? buildReplyRef(replyingTo) : undefined;
    setReplyingTo(null);
    try {
      const fb = ensureFirebase();
      if (!fb) throw new Error('Firebase не е наличен.');
      const token = await fb.auth.currentUser?.getIdToken(true);
      if (!token) throw new Error('Не е влезено в акаунт.');
      const bucket = fb.auth.app.options.storageBucket;
      if (!bucket) throw new Error('Firebase Storage не е конфигуриран.');
      const storagePath = `chatMedia/${convId}/${user.uid}_${Date.now()}.jpg`;
      const uploadResult = await uploadAsync(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
        asset.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` },
        },
      );
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Upload failed (${uploadResult.status}): ${uploadResult.body}`);
      }
      const meta = JSON.parse(uploadResult.body) as { name: string; downloadTokens: string };
      const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(meta.name)}?alt=media&token=${meta.downloadTokens}`;
      const myName = user.displayName ?? user.email ?? 'Рибар';
      await sendConversationMessage(convId, user.uid, '', otherUid, myName, url, 'photo', clientId, replyRef);
    } catch (e) {
      if (replyRef) setReplyingTo(replyingTo);
      handleError(e);
    } finally {
      setUploading(false);
    }
  }, [user, convId, otherUid, blockedByMe, replyingTo]);

  const handleLongPressMessage = useCallback((msg: DirectMessage) => {
    if (!user) return;
    // Direct open the unified popover — reactions + actions in one modal,
    // iMessage-style. Replaces the previous two-step flow that went through
    // an Alert before opening the reaction modal.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReactionTarget(msg);
  }, [user]);

  const handleReact = useCallback(async (msg: DirectMessage, code: ReactionCode | null) => {
    if (!user) return;
    setReactionTarget(null);
    try {
      const mine = reactions[msg.id]?.[user.uid];
      // Tap the same reaction again to remove it; otherwise set/replace.
      const next = mine && code === mine ? null : code;
      await setMessageReaction(convId, msg.id, user.uid, next);
    } catch (e) {
      handleError(e);
    }
  }, [user, convId, reactions]);

  const handleBlockToggle = useCallback(() => {
    if (!user) return;
    if (blockedByMe) {
      Alert.alert('Разблокирай', `Сигурен ли си, че искаш да разблокираш ${otherName}?`, [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Разблокирай',
          onPress: async () => {
            try { await unblockUser(user.uid, otherUid); setBlockedByMe(false); }
            catch (e) { handleError(e); }
          },
        },
      ]);
    } else {
      Alert.alert('Блокирай', `Блокирай ${otherName}? Няма да виждаш повече съобщения от него.`, [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Блокирай',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(user.uid, otherUid);
              setBlockedByMe(true);
              navigation.goBack();
            } catch (e) { handleError(e); }
          },
        },
      ]);
    }
  }, [user, otherUid, otherName, blockedByMe, navigation]);

  // Subscribe to mute state so the toggle row reflects truth and the visual
  // bell-off can decorate the header if we want it later.
  useEffect(() => {
    if (!user) return;
    return subscribeMutedConversations(user.uid, (set) => setConvMuted(set.has(convId)));
  }, [user, convId]);

  const onToggleConvMute = useCallback(async () => {
    if (!user) return;
    const next = !convMuted;
    setConvMuted(next);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (next) await muteConversation(user.uid, convId);
      else await unmuteConversation(user.uid, convId);
    } catch {
      setConvMuted(!next);
      Alert.alert('Грешка', 'Неуспешно действие.');
    }
  }, [user, convId, convMuted]);

  const styles = useMemo(() => StyleSheet.create({
    // Base bubble shapes — grouping styles below override specific corners + tail.
    bubbleMine: {
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
    },
    bubbleOther: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bubbleDeleted: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    // Tail corners — applied only to groupLast (the bubble closest to the new message).
    tailMine: { borderBottomRightRadius: 4 },
    tailOther: { borderBottomLeftRadius: 4 },
    msgMine: { ...typography.body, color: '#fff' },
    msgOther: { ...typography.body, color: colors.text },
    msgDeleted: { ...typography.body, color: colors.textMuted, fontStyle: 'italic' },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingTop: 10,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    // Round "+" attach button — matches the send button's footprint so both ends balance.
    attachBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 1,
    },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: colors.surfaceAlt,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    },
    input: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      maxHeight: 120,
      paddingVertical: 0,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 1,
    },
    // Floating "scroll to latest" button — sits above the input row when scrolled up.
    scrollToBottomFab: {
      position: 'absolute',
      right: spacing.md,
      bottom: 78,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 5,
      zIndex: 10,
    },
    reactionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 2,
      gap: 3,
    },
    reactionPillText: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
    editBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primarySurface,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: 6,
      borderRadius: radius.sm,
    },
    blockBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: '#FEE2E2',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      borderRadius: radius.sm,
    },
    replyBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: 6,
      borderRadius: radius.sm,
    },
    quoteBlockMine: {
      borderLeftWidth: 3,
      borderLeftColor: 'rgba(255,255,255,0.5)',
      paddingLeft: 8,
      marginBottom: 6,
      paddingVertical: 2,
    },
    quoteBlockOther: {
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: 8,
      marginBottom: 6,
      paddingVertical: 2,
    },
    sharedCard: {
      flexDirection: 'row',
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 8,
      marginBottom: 6,
      maxWidth: 240,
    },
    sharedCardImage: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.surfaceAlt },
    sharedCardKind: { ...typography.caption, color: colors.primary, fontWeight: '700' },
    sharedCardTitle: { ...typography.bodyBold, color: colors.text },
    sharedCardSubtitle: { ...typography.caption, color: colors.textMuted },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? 8 : 4,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
    },
    reactionModalBackdrop: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center', justifyContent: 'center',
      padding: spacing.lg,
    },
    reactionModalCard: {
      flexDirection: 'row',
      gap: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reactionModalBtn: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
    },
    // Action sheet below the emoji row. Vertical list of icon+label buttons,
    // separated by hairline borders. Mirrors the existing Alert affordances
    // but as a single, unified popover.
    actionsCard: {
      marginTop: spacing.sm,
      width: '100%',
      maxWidth: 320,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    actionRowDestructive: {
      borderBottomWidth: 0,
    },
    actionLabel: { ...typography.body, color: colors.text, fontSize: 15, flex: 1 },
    actionLabelDestructive: { color: colors.danger },
    // Swipe-right-to-reply chrome — the icon revealed on swipe.
    swipeReplyIndicator: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      width: 56,
    },
    swipeReplyDot: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.primarySurface,
      borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
  }), [colors]);

  if (!configured || !user) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Нужен е вход и Firebase за чата.</Text>
      </Screen>
    );
  }

  const hasSendText = text.trim().length > 0;
  const sendDisabled = sending || !hasSendText || blockedByMe;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen padded={false} safeAreaEdges={['top', 'left', 'right']} avoidKeyboard={false}>

        {/* Gradient header */}
        <LinearGradient colors={heroColors} style={{ paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, gap: 10 }}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={8}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>

            <Pressable
              onPress={() => setInfoOpen(true)}
              style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Информация за разговора"
            >
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={{ width: 42, height: 42, borderRadius: 21 }} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18 }}>{otherInitials}</Text>
                )}
                {otherPresence.online && (
                  <View style={{ position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#2ECC71', borderWidth: 2, borderColor: '#fff' }} />
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }} numberOfLines={1}>{otherName}</Text>
                {/* Status pill — typing overrides presence; presence overrides lastSeen. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  {typingUid ? (
                    <>
                      <View style={{ flexDirection: 'row', gap: 2 }}>
                        {[0, 1, 2].map((i) => <TypingDot key={i} delay={i * 180} color="#A8F0C6" />)}
                      </View>
                      <Text style={{ fontSize: 11, color: '#A8F0C6', fontWeight: '600' }}>пише…</Text>
                    </>
                  ) : otherPresence.online ? (
                    <>
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#2ECC71' }} />
                      <Text style={{ fontSize: 11, color: '#A8F0C6', fontWeight: '600' }}>Онлайн</Text>
                    </>
                  ) : otherPresence.lastSeen ? (
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                      {`Последно виждан ${formatMsgTime(otherPresence.lastSeen)}`}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setInfoOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Опции"
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
            </Pressable>
          </View>
        </LinearGradient>

        {searchOpen && (
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 2 }}
              placeholder="Търси в съобщенията…"
              placeholderTextColor={colors.textMuted}
              value={searchTerm}
              onChangeText={setSearchTerm}
              autoFocus
              clearButtonMode="while-editing"
            />
            <Pressable onPress={() => { setSearchOpen(false); setSearchTerm(''); }} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        )}

        {blockedByMe && (
          <View style={styles.blockBanner}>
            <Ionicons name="ban-outline" size={18} color="#B91C1C" />
            <Text style={{ ...typography.caption, color: '#B91C1C', flex: 1 }}>
              Този потребител е блокиран. Разблокирай го от менюто.
            </Text>
          </View>
        )}

        {/* Messages */}
        <FlatList
          ref={flatRef}
          data={chatItems}
          keyExtractor={(m) => ('_sep' in m ? m.id : m.id)}
          contentContainerStyle={
            chatItems.length === 0
              ? { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg }
              : { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
              <View style={{
                width: 80, height: 80, borderRadius: 40,
                backgroundColor: colors.primarySurface,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="chatbubble-ellipses-outline" size={36} color={colors.primary} />
              </View>
              <Text style={{ ...typography.h3, color: colors.text, textAlign: 'center' }}>
                Започнете разговор с {otherName}
              </Text>
              <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center' }}>
                Напишете първото съобщение или споделете улов.
              </Text>
            </View>
          }
          onContentSizeChange={() => {
            // First-paint: jump to the unread divider if we have one. After
            // that, follow the user (scroll-to-end if they're at the bottom).
            if (!dividerScrolledRef.current && initialUnreadCount && initialUnreadCount > 0) {
              const dividerIdx = chatItems.findIndex((it) => '_unreadDivider' in it);
              if (dividerIdx >= 0) {
                dividerScrolledRef.current = true;
                try {
                  flatRef.current?.scrollToIndex({ index: dividerIdx, animated: false, viewPosition: 0.15 });
                } catch { /* invalid index briefly during settle */ }
                return;
              }
            }
            if (isAtBottomRef.current) flatRef.current?.scrollToEnd({ animated: false });
          }}
          // scrollToIndex can throw INVALID_INDEX if the row isn't measured
          // yet; this fallback lets RN estimate and finish the scroll.
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.15 });
            }, 80);
          }}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
            isAtBottomRef.current = atBottom;
            // Threshold the scrolled-up state so the FAB doesn't flicker at the edge.
            const wantsFab = !atBottom && (contentSize.height - (contentOffset.y + layoutMeasurement.height)) > 200;
            setScrolledUp((prev) => (prev !== wantsFab ? wantsFab : prev));
          }}
          scrollEventThrottle={100}
          ListHeaderComponent={
            hasMoreOlder && msgs.length > 0 ? (
              <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
                <Pressable
                  onPress={handleLoadOlder}
                  disabled={loadingOlder}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  {loadingOlder
                    ? <ActivityIndicator size="small" color={colors.textMuted} />
                    : <Ionicons name="arrow-up-circle-outline" size={16} color={colors.textMuted} />
                  }
                  <Text style={{ ...typography.caption, color: colors.textMuted, fontWeight: '600' }}>
                    {loadingOlder ? 'Зареждане…' : 'Зареди по-стари'}
                  </Text>
                </Pressable>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if ('_sep' in item) {
              return (
                <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, fontWeight: '600' }}>{item.label}</Text>
                  </View>
                </View>
              );
            }
            if ('_unreadDivider' in item) {
              // Full-width thin line with a centered "N нови съобщения" pill —
              // disappears on next mount of this screen (the snapshot only
              // captures the count at entry time).
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.md, paddingHorizontal: spacing.lg }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: '#E53935', opacity: 0.5 }} />
                  <View style={{ backgroundColor: '#E53935', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                      {item.count === 1 ? '1 ново съобщение' : `${item.count} нови съобщения`}
                    </Text>
                  </View>
                  <View style={{ flex: 1, height: 1, backgroundColor: '#E53935', opacity: 0.5 }} />
                </View>
              );
            }
            const mine = item.senderUid === user.uid;
            const isDeleted = !!item.deletedAt;
            const isEdited = !!item.editedAt;
            const msgReactions = reactions[item.id] ?? {};
            const reactionCounts: Record<string, number> = {};
            for (const code of Object.values(msgReactions)) {
              reactionCounts[code] = (reactionCounts[code] ?? 0) + 1;
            }
            const reactionEntries = Object.entries(reactionCounts);

            // Group-aware spacing: tight margin between grouped bubbles, larger gap
            // between groups. Tail (asymmetric corner) only on the last bubble of a group.
            const isLast = item.groupLast;
            const isFirst = item.groupFirst;

            // Swipe-right (revealed from the left) to reply. The whole bubble
            // is wrapped so the gesture works regardless of whether you grab
            // the text, a media thumb, or whitespace. We close the swipe on
            // open so the reply ribbon below the composer is the only visible
            // signal that the action took effect.
            const renderLeftReplyAction = () => (
              <View style={styles.swipeReplyIndicator}>
                <View style={styles.swipeReplyDot}>
                  <Ionicons name="return-up-back" size={18} color={colors.primary} />
                </View>
              </View>
            );

            return (
              <Swipeable
                ref={(r) => { swipeRefs.current.set(item.id, r); }}
                friction={2}
                leftThreshold={50}
                renderLeftActions={isDeleted ? undefined : renderLeftReplyAction}
                onSwipeableOpen={(dir) => {
                  if (dir !== 'left' || isDeleted) return;
                  setReplyingTo(item);
                  setEditingMsg(null);
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  swipeRefs.current.get(item.id)?.close();
                }}
                overshootLeft={false}
                containerStyle={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  marginBottom: isLast ? 10 : 2,
                  marginTop: isFirst ? 4 : 0,
                }}
              >
              <Pressable
                onLongPress={isDeleted ? undefined : () => handleLongPressMessage(item)}
                delayLongPress={350}
              >
                <View style={[
                  isDeleted ? styles.bubbleDeleted : mine ? styles.bubbleMine : styles.bubbleOther,
                  isLast ? (mine ? styles.tailMine : styles.tailOther) : null,
                ]}>
                  {item.replyTo && !isDeleted ? (
                    <View style={mine ? styles.quoteBlockMine : styles.quoteBlockOther}>
                      <Text style={{ fontSize: 11, color: mine ? 'rgba(255,255,255,0.75)' : colors.primary, fontWeight: '700' }} numberOfLines={1}>
                        {item.replyTo.senderUid === user.uid ? 'Ти' : otherName}
                      </Text>
                      <Text style={{ fontSize: 12, color: mine ? 'rgba(255,255,255,0.75)' : colors.textMuted }} numberOfLines={2}>
                        {item.replyTo.preview}
                      </Text>
                    </View>
                  ) : null}
                  {isDeleted ? (
                    <Text style={styles.msgDeleted}>Съобщението е изтрито</Text>
                  ) : item.sharedRef ? (
                    <Pressable
                      onPress={() => {
                        if (item.sharedRef?.kind === 'catch') {
                          navigation.navigate('CatchDetail', { id: item.sharedRef.id });
                        }
                        // post/spot share opens the bubble — full deep-linking is a future step.
                      }}
                      style={styles.sharedCard}
                    >
                      {item.sharedRef.photoUrl ? (
                        <Image source={{ uri: item.sharedRef.photoUrl }} style={styles.sharedCardImage} contentFit="cover" cachePolicy="memory-disk" />
                      ) : (
                        <View style={[styles.sharedCardImage, { alignItems: 'center', justifyContent: 'center' }]}>
                          <Ionicons
                            name={item.sharedRef.kind === 'spot' ? 'location' : item.sharedRef.kind === 'post' ? 'newspaper-outline' : 'fish-outline'}
                            size={26}
                            color={colors.primary}
                          />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sharedCardKind}>
                          {item.sharedRef.kind === 'catch' ? 'УЛОВ' : item.sharedRef.kind === 'post' ? 'ПУБЛИКАЦИЯ' : 'МЯСТО'}
                        </Text>
                        {item.sharedRef.title ? (
                          <Text style={styles.sharedCardTitle} numberOfLines={1}>{item.sharedRef.title}</Text>
                        ) : null}
                        {item.sharedRef.subtitle ? (
                          <Text style={styles.sharedCardSubtitle} numberOfLines={1}>{item.sharedRef.subtitle}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ) : item.mediaUrl && item.mediaType === 'photo' ? (
                    <Pressable onPress={() => { setViewerUri(item.mediaUrl!); setViewerVisible(true); }}>
                      <Image
                        source={{ uri: item.mediaUrl }}
                        style={{ width: 200, height: 150, borderRadius: 10 }}
                        contentFit="cover"
                      />
                    </Pressable>
                  ) : item.mediaUrl && item.mediaType === 'video' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="videocam" size={20} color={mine ? '#fff' : colors.text} />
                      <Text style={mine ? styles.msgMine : styles.msgOther}>Видео</Text>
                    </View>
                  ) : null}
                  {item.text && !isDeleted ? (
                    <Text style={mine ? styles.msgMine : styles.msgOther}>{item.text}</Text>
                  ) : null}
                  {item.createdAt && isLast ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 4 }}>
                      {isEdited && !isDeleted ? (
                        <Text style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,0.55)' : colors.textMuted, fontStyle: 'italic' }}>
                          ред.
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,0.55)' : colors.textMuted }}>
                        {formatMsgTime(item.createdAt)}
                      </Text>
                      {mine && !isDeleted ? (
                        <Ionicons
                          name={item.readAt ? 'checkmark-done' : 'checkmark'}
                          size={13}
                          color={item.readAt ? '#A8F0C6' : 'rgba(255,255,255,0.55)'}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
                {reactionEntries.length > 0 && !isDeleted ? (
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                    {reactionEntries.map(([code, count]) => (
                      <View key={code} style={styles.reactionPill}>
                        <Text style={{ fontSize: 12 }}>{REACTION_EMOJI[code] ?? '•'}</Text>
                        {count > 1 ? <Text style={styles.reactionPillText}>{count}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
              </Swipeable>
            );
          }}
        />

        {/* Typing indicator is now shown inline in the header status pill, so the
            separate bottom bubble has been removed to reduce visual noise. */}

        {/* Edit banner */}
        {editingMsg && (
          <View style={styles.editBanner}>
            <Ionicons name="pencil" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700' }}>Редактираш съобщение</Text>
              <Text style={{ ...typography.caption, color: colors.textMuted }} numberOfLines={1}>{editingMsg.text}</Text>
            </View>
            <Pressable onPress={cancelEdit} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        )}

        {/* Reply banner */}
        {replyingTo && !editingMsg && (
          <View style={styles.replyBanner}>
            <Ionicons name="return-up-back" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700' }}>
                Отговор на {replyingTo.senderUid === user.uid ? 'теб' : otherName}
              </Text>
              <Text style={{ ...typography.caption, color: colors.textMuted }} numberOfLines={1}>
                {messagePreviewText(replyingTo)}
              </Text>
            </View>
            <Pressable onPress={cancelReply} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        )}

        {/* Scroll-to-bottom FAB — appears when the user scrolls more than 200px up. */}
        {scrolledUp && (
          <Pressable
            onPress={() => flatRef.current?.scrollToEnd({ animated: true })}
            style={styles.scrollToBottomFab}
            accessibilityRole="button"
            accessibilityLabel="Към последното съобщение"
          >
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Pressable>
        )}

        {/* Input row */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Pressable
            onPress={() => {
              if (blockedByMe) {
                notifyInfo('Блокиран потребител', 'Разблокирай го, за да изпратиш медия.');
                return;
              }
              Alert.alert('Изпрати медия', undefined, [
                { text: 'Камера', onPress: () => pickAndSendMedia('camera') },
                { text: 'Галерия', onPress: () => pickAndSendMedia('gallery') },
                { text: 'Отказ', style: 'cancel' },
              ]);
            }}
            hitSlop={8}
            style={[styles.attachBtn, { opacity: blockedByMe || editingMsg ? 0.4 : 1 }]}
            disabled={!!editingMsg}
          >
            {uploading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="add" size={26} color={colors.primary} />
            }
          </Pressable>

          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder={blockedByMe ? 'Блокиран потребител' : editingMsg ? 'Редактирай съобщението…' : 'Съобщение…'}
              placeholderTextColor={colors.textMuted}
              value={text}
              editable={!blockedByMe}
              onChangeText={(t) => {
                setText(t);
                if (!user || blockedByMe || editingMsg) return;
                if (!typingStartedRef.current) {
                  typingStartedRef.current = true;
                  void setTypingStatus(convId, user.uid, true);
                }
                if (typingTimeout.current) clearTimeout(typingTimeout.current);
                typingTimeout.current = setTimeout(() => {
                  typingStartedRef.current = false;
                  void setTypingStatus(convId, user.uid, false);
                }, 2000);
              }}
              multiline
              maxLength={2000}
            />
          </View>

          <Pressable
            onPress={send}
            disabled={sendDisabled}
            style={[styles.sendBtn, { backgroundColor: hasSendText && !blockedByMe ? colors.primary : colors.surfaceAlt }]}
          >
            {sending
              ? <ActivityIndicator size="small" color={hasSendText ? '#fff' : colors.textMuted} />
              : <Ionicons name={editingMsg ? 'checkmark' : 'arrow-up'} size={20} color={hasSendText && !blockedByMe ? '#fff' : colors.textMuted} />
            }
          </Pressable>
        </View>

        <ImageViewer uri={viewerUri} visible={viewerVisible} onClose={() => setViewerVisible(false)} />

        {/* Unified long-press popover — reaction palette on top, action list
            (Reply / Copy / Edit / Delete) below. Replaces both the previous
            Alert and the separate reaction modal. */}
        <Modal
          visible={!!reactionTarget}
          transparent
          animationType="fade"
          onRequestClose={() => setReactionTarget(null)}
        >
          <Pressable style={styles.reactionModalBackdrop} onPress={() => setReactionTarget(null)}>
            <Pressable
              onPress={(e) => e.stopPropagation?.()}
              style={{ alignItems: 'center', width: '100%' }}
            >
              <View style={styles.reactionModalCard}>
                {REACTION_ORDER.map((code) => {
                  const mineReaction = reactionTarget && user
                    ? reactions[reactionTarget.id]?.[user.uid]
                    : undefined;
                  const isMine = mineReaction === code;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => reactionTarget && handleReact(reactionTarget, code)}
                      style={[styles.reactionModalBtn, isMine ? { backgroundColor: colors.primarySurface } : null]}
                    >
                      <Text style={{ fontSize: 26 }}>{REACTION_EMOJI[code]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Action list — derived from the same per-message flags the old
                  Alert used. We close the popover before each action so screens
                  pushed below (Edit banner activates, Delete confirm) aren't
                  hidden behind the modal. */}
              {reactionTarget ? (() => {
                const msg = reactionTarget;
                const mine = msg.senderUid === user.uid;
                const createdMs = toMillis(msg.createdAt);
                const withinEditWindow = createdMs > 0 && Date.now() - createdMs < MESSAGE_EDIT_WINDOW_MS;
                const canEdit = mine && withinEditWindow && !msg.deletedAt && !msg.mediaUrl;
                const canDelete = mine && withinEditWindow && !msg.deletedAt;
                const canReply = !msg.deletedAt;
                const canCopy = !!msg.text && !msg.deletedAt;
                if (!canReply && !canCopy && !canEdit && !canDelete) return null;
                return (
                  <View style={styles.actionsCard}>
                    {canReply ? (
                      <Pressable
                        style={styles.actionRow}
                        onPress={() => {
                          setReactionTarget(null);
                          setReplyingTo(msg);
                          setEditingMsg(null);
                        }}
                      >
                        <Ionicons name="return-up-back" size={20} color={colors.text} />
                        <Text style={styles.actionLabel}>Отговори</Text>
                      </Pressable>
                    ) : null}
                    {canCopy ? (
                      <Pressable
                        style={styles.actionRow}
                        onPress={() => {
                          setReactionTarget(null);
                          Clipboard.setString(msg.text);
                        }}
                      >
                        <Ionicons name="copy-outline" size={20} color={colors.text} />
                        <Text style={styles.actionLabel}>Копирай</Text>
                      </Pressable>
                    ) : null}
                    {canEdit ? (
                      <Pressable
                        style={styles.actionRow}
                        onPress={() => {
                          setReactionTarget(null);
                          setEditingMsg(msg);
                          setText(msg.text);
                        }}
                      >
                        <Ionicons name="pencil" size={20} color={colors.text} />
                        <Text style={styles.actionLabel}>Редактирай</Text>
                      </Pressable>
                    ) : null}
                    {canDelete ? (
                      <Pressable
                        style={[styles.actionRow, styles.actionRowDestructive]}
                        onPress={() => {
                          setReactionTarget(null);
                          Alert.alert('Изтриване', 'Това съобщение ще бъде премахнато за всички.', [
                            { text: 'Отказ', style: 'cancel' },
                            {
                              text: 'Изтрий',
                              style: 'destructive',
                              onPress: async () => {
                                try { await deleteMessage(convId, msg.id, user.uid); }
                                catch (e) { handleError(e); }
                              },
                            },
                          ]);
                        }}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        <Text style={[styles.actionLabel, styles.actionLabelDestructive]}>Изтрий</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })() : null}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Conversation info sheet — opens from the header tap. Replaces the
            old Alert.alert "Опции" with a structured bottom sheet that puts
            profile / mute / search / block in the same place. */}
        <Modal
          visible={infoOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setInfoOpen(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
            onPress={() => setInfoOpen(false)}
          >
            <Pressable
              onPress={() => { /* swallow taps inside the sheet */ }}
              style={{
                backgroundColor: colors.card,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                paddingTop: spacing.sm,
                paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm),
              }}
            >
              {/* Drag handle */}
              <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md }} />

              {/* Identity header — large avatar + name + online status */}
              <View style={{ alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: 6 }}>
                <View style={{
                  width: 88, height: 88, borderRadius: 44,
                  backgroundColor: colors.primarySurface,
                  alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                  borderWidth: 2, borderColor: otherPresence.online ? '#2ECC71' : colors.border,
                }}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={{ width: 84, height: 84, borderRadius: 42 }} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 36 }}>{otherInitials}</Text>
                  )}
                </View>
                <Text style={{ ...typography.h2, color: colors.text, marginTop: spacing.sm }} numberOfLines={1}>
                  {otherName}
                </Text>
                <Text style={{ ...typography.caption, color: otherPresence.online ? '#2ECC71' : colors.textMuted, fontWeight: '600' }}>
                  {otherPresence.online
                    ? 'Онлайн'
                    : otherPresence.lastSeen
                      ? `Последно виждан ${formatMsgTime(otherPresence.lastSeen)}`
                      : 'Офлайн'}
                </Text>
              </View>

              {/* Action rows */}
              <View style={{ paddingHorizontal: spacing.md, gap: 4 }}>
                {[
                  {
                    icon: 'person-outline' as const,
                    label: 'Виж профил',
                    onPress: () => {
                      setInfoOpen(false);
                      navigation.navigate('UserPublicProfile', { uid: otherUid, displayName: otherName });
                    },
                  },
                  {
                    icon: convMuted ? 'notifications' as const : 'notifications-off-outline' as const,
                    label: convMuted ? 'Включи известията' : 'Заглуши разговора',
                    onPress: () => { onToggleConvMute(); },
                  },
                  {
                    icon: searchOpen ? 'close-outline' as const : 'search-outline' as const,
                    label: searchOpen ? 'Затвори търсене' : 'Търси в чата',
                    onPress: () => {
                      setInfoOpen(false);
                      setSearchOpen((v) => !v);
                      setSearchTerm('');
                    },
                  },
                  {
                    icon: blockedByMe ? 'lock-open-outline' as const : 'ban-outline' as const,
                    label: blockedByMe ? 'Разблокирай' : 'Блокирай потребител',
                    destructive: !blockedByMe,
                    onPress: () => {
                      setInfoOpen(false);
                      handleBlockToggle();
                    },
                  },
                ].map((row, i) => (
                  <Pressable
                    key={i}
                    onPress={row.onPress}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      borderRadius: radius.md,
                      backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                    })}
                  >
                    <Ionicons
                      name={row.icon}
                      size={22}
                      color={row.destructive ? colors.danger : colors.text}
                    />
                    <Text style={{
                      ...typography.body,
                      color: row.destructive ? colors.danger : colors.text,
                      fontSize: 15,
                    }}>
                      {row.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </Screen>
    </KeyboardAvoidingView>
  );
}
