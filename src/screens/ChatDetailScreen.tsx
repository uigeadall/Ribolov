import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  ActivityIndicator,
  Animated,
  Modal,
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { uploadImageToR2 } from '../services/r2Upload';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { ActionSheet } from '../components/ActionSheet';
import { ImageViewer } from '../components/ImageViewer';
import { StoryVideoPlayer } from '../components/StoryVideoPlayer';
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
import { getBlockedUids, blockUser, unblockUser } from '../services/blockUser';
import { handleError } from '../utils/handleError';
import { notifyInfo } from '../utils/notify';
import { checkImageSize } from '../utils/imageSize';
import { getImageVariant, ImageSize } from '../utils/imageVariants';

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
    // Capture the loop so we can stop() it on unmount. Without this, every
    // time the typing indicator appears/disappears (which can happen many
    // times in a single conversation) a fresh loop is started and the
    // previous ones keep ticking forever, accumulating CPU/battery cost.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -4, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      anim.setValue(0);
    };
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
  // Optimistic-send buffer: text messages get inserted here BEFORE the
  // Firestore write completes so the user sees their bubble immediately.
  // Cleared when the subscription's `tailMsgs` snapshot includes a message
  // with the same id (the clientId we used as the doc id).
  const [pendingMsgs, setPendingMsgs] = useState<DirectMessage[]>([]);
  // Default false — we flip to true once the subscription's tail looks full (100 messages),
  // which is our signal that there's plausibly more older history worth fetching.
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Staged media: a photo the user picked but hasn't sent yet. The composer
  // shows a thumbnail preview above the input + treats the text field as
  // the caption. Pressing send uploads and dispatches; the X clears it.
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: 'photo' } | null>(null);
  const [otherPresence, setOtherPresence] = useState<{ online: boolean; lastSeen?: number }>({ online: false });
  const [typingUid, setTypingUid] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState('');
  const [viewerVisible, setViewerVisible] = useState(false);
  // Separate state for the video viewer — chat videos open a fullscreen
  // player on tap instead of trying to fall through the photo viewer (which
  // would render a blank black image since ImageViewer can't play video).
  // null = closed, string = video uri being viewed.
  const [videoViewerUri, setVideoViewerUri] = useState<string | null>(null);
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
  const flatRef = useRef<FlashListRef<ChatItem>>(null);
  // Per-row Swipeable refs so we can close the swipe after the user has
  // committed to replying. Keyed by message id; cleared on unmount.
  const swipeRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const isAtBottomRef = useRef(true);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStartedRef = useRef(false);
  // Synchronous double-tap gate for the send button. The button's disabled
  // prop reads the `sending` state which is only flipped to true in the
  // EDIT path — regular text sends use an optimistic insert and never set
  // `sending=true`. So a sub-frame double tap on a normal text message
  // got past the disabled prop, both closures captured the same `text`,
  // each generated a fresh clientId, and Firestore got two distinct
  // messages with identical content. This ref blocks the second entry
  // synchronously before the closure can copy `text` for a second time.
  const sendingRef = useRef(false);
  // Track screen-mounted status so the optimistic-send fire-and-forget
  // error path (which can resolve after the user has backed out of the
  // screen) doesn't fire setState on an unmounted component. Same idea
  // as a cancellation flag, but mounted-tracking is the right shape here
  // because the fire-and-forget closure doesn't get a cleanup hook.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
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
    const tailIds = new Set(tailMsgs.map((m) => m.id));
    // Pending messages whose ids haven't yet appeared in the server tail.
    const stillPending = pendingMsgs.filter((p) => !tailIds.has(p.id));
    if (olderMsgs.length === 0) return [...tailMsgs, ...stillPending];
    const olderOnly = olderMsgs.filter((m) => !tailIds.has(m.id));
    return [...olderOnly, ...tailMsgs, ...stillPending];
  }, [olderMsgs, tailMsgs, pendingMsgs]);

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

  // Chat detail subscriptions are scoped to this exact convId — useFocusEffect
  // tears them down when the user navigates away (back to Chats, or to any
  // other screen) and re-establishes on return. Without this, opening 5 chats
  // in a session would leave 5×4 listeners alive in the background, each
  // racking up reads on every new message in those convs. Inbox unread state
  // is handled by separate listeners in HomeScreen / ChatsScreen, so pausing
  // the per-chat listeners here doesn't affect the global badge.
  useFocusEffect(
    useCallback(() => {
      if (!configured || !user) return;
      // Read the per-user unread count BEFORE clearing it so we know how many
      // messages to flag with the "N нови" divider. We must await this — firing
      // it concurrently with markConversationRead means the transaction may zero
      // unreadCounts before the read sees it, and the divider never appears.
      // Best-effort: if the read fails we just skip the divider.
      let mounted = true;
      (async () => {
        const count = await fetchMyUnreadInConversation(convId, user.uid).catch(() => 0);
        // Guard the setState in case the user backs out before this resolves;
        // otherwise React logs a set-state-on-unmounted warning.
        if (mounted && count > 0) setInitialUnreadCount(count);
        markConversationRead(convId, user.uid).catch(() => {});
      })();
      const unsubMsgs = subscribeConversationMessages(convId, (next) => {
        setTailMsgs(next);
        // Drop any optimistic pendings that the server now has — match by id
        // since the clientId is the doc id.
        const confirmedIds = new Set(next.map((m) => m.id));
        setPendingMsgs((prev) => prev.filter((p) => !confirmedIds.has(p.id)));
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
        mounted = false;
        unsubMsgs();
        unsubPresence();
        unsubTyping();
        unsubReactions();
        void setTypingStatus(convId, user.uid, false);
      };
    }, [convId, otherUid, configured, user]),
  );

  // Load blocked status once. Refetched after block/unblock actions.
  // The callback accepts an optional `isCancelled` predicate so the
  // useEffect below can stop setState when the screen unmounts mid-fetch.
  // The block/unblock handlers call it without a predicate (their setState
  // happens synchronously inside the handler).
  const refreshBlockedStatus = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (!user?.uid) return;
      try {
        const set = await getBlockedUids(user.uid);
        if (isCancelled()) return;
        setBlockedByMe(set.has(otherUid));
      } catch {
        if (isCancelled()) return;
        setBlockedByMe(false);
      }
    },
    [user?.uid, otherUid],
  );

  useEffect(() => {
    let cancelled = false;
    void refreshBlockedStatus(() => cancelled);
    return () => { cancelled = true; };
  }, [refreshBlockedStatus]);

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


  const cancelEdit = useCallback(() => {
    setEditingMsg(null);
    setText('');
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  // Stage a photo into pendingMedia rather than sending immediately — the
  // composer's send button will upload + dispatch on the next tap, with the
  // text field doubling as a caption.
  const pickMedia = useCallback(async (source: 'camera' | 'gallery') => {
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
    // quality: 0.75 was 0.5. At 0.5 photos with text or fine detail
    // (screenshots, lure shots, catch close-ups) showed visible JPEG
    // artifacts; bumping to 0.75 lands at a much better quality/size
    // ratio without bloating uploads. The resize step below caps long-
    // edge at 1600px before the upload — matching AddCatchScreen's
    // pre-upload normalization so chat photos aren't sent as raw 4032px
    // captures.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.75 };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!checkImageSize(asset)) return;
    let resizedUri = asset.uri;
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
      );
      resizedUri = manipulated.uri;
    } catch {
      // Manipulator failed on this device — fall back to the raw asset.
      // R2 rules still cap the file size, so the worst case is a heavier
      // upload, not a broken one.
    }
    setPendingMedia({ uri: resizedUri, type: 'photo' });
  }, [user, blockedByMe]);

  // Uploads a staged photo and dispatches it as a message with an optional
  // caption. Extracted so both the new staged-flow and any future
  // "send-immediately" path can share it.
  const uploadAndSendMedia = useCallback(async (mediaUri: string, caption: string) => {
    if (!user) return;
    const clientId = makeMessageClientId();
    const replyRef = replyingTo ? buildReplyRef(replyingTo) : undefined;
    // Capture the reply target BEFORE clearing state so the rollback below
    // can restore the actual recipient. Without this capture, the catch
    // block reads `replyingTo` after it's been cleared to null, and the
    // rollback silently restores null — the user's reply context vanishes.
    const capturedReplyingTo = replyingTo;
    setReplyingTo(null);
    setUploading(true);
    try {
      const requestedPath = `chatMedia/${convId}/${user.uid}_${Date.now()}.jpg`;
      const { url } = await uploadImageToR2(mediaUri, requestedPath);
      const myName = user.displayName?.trim() || user.email?.trim() || 'Рибар';
      await sendConversationMessage(convId, user.uid, caption.trim(), otherUid, myName, url, 'photo', clientId, replyRef);
    } catch (e) {
      if (replyRef) setReplyingTo(capturedReplyingTo);
      handleError(e);
      // Re-throw so callers (send()) can restore pendingMedia + caption.
      // Without this, the upload-fail path swallows the error and send()'s
      // try/catch never sees it — the user's photo and typed caption are
      // lost with no recovery.
      throw e;
    } finally {
      setUploading(false);
    }
  }, [user, convId, otherUid, blockedByMe, replyingTo]);

  const send = useCallback(async () => {
    if (!user || sendingRef.current) return;
    if (blockedByMe) {
      notifyInfo('Блокиран потребител', 'Разблокирай го от менюто, за да изпратиш съобщение.');
      return;
    }
    sendingRef.current = true;
    try {
      // Staged media path: upload the photo (text becomes its caption) and
      // clear both the media slot and the input on success. We do this first
      // so a user with both pending media AND typed text gets one combined
      // message rather than two separate ones. On failure (upload rejected,
      // network gone), we restore pendingMedia + the caption so the user can
      // retry rather than having their photo + text vanish silently.
      if (pendingMedia && !editingMsg) {
        const caption = text.trim();
        const stagedMedia = pendingMedia;
        setPendingMedia(null);
        setText('');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        try {
          await uploadAndSendMedia(stagedMedia.uri, caption);
        } catch {
          // uploadAndSendMedia already calls handleError for the toast; we
          // just need to put the user's draft back. Reply target restoration
          // is handled inside uploadAndSendMedia.
          setPendingMedia(stagedMedia);
          setText(caption);
        }
        return;
      }
      if (!text.trim()) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const trimmed = text.trim();
      clearTypingStatus();

      // Editing path — update text on existing message instead of sending a new one.
      // Editing still needs the round-trip-blocking UX because we have to display
      // the new text; can't optimistically guess server-side edited-at.
      if (editingMsg) {
        setSending(true);
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
      // Capture before clearing — see comment on `uploadAndSendMedia` above.
      // The fire-and-forget closure below reads this on a network failure to
      // restore the reply context the user was composing against.
      const capturedReplyingTo = replyingTo;
      setReplyingTo(null);
      const clientId = makeMessageClientId();
      const myName = user.displayName?.trim() || user.email?.trim() || 'Рибар';

      // Optimistic insert: drop a placeholder bubble into the local list right
      // now, keyed by `clientId` (which is also the eventual Firestore doc id).
      // When the snapshot subscription fires with the real message it'll match
      // on id and React reconciles in place. Without this, the user has to wait
      // for the Firestore round-trip to see their message — and on slow networks
      // or with App Check token resolution that round-trip can take 5–30s while
      // appearing to "hang". The spinner used to gate the button on that await;
      // now the button frees immediately and the message looks sent.
      const optimisticMsg: DirectMessage = {
        id: clientId,
        senderUid: user.uid,
        text: trimmed,
        // Plain number — formatMsgTime's `typeof === 'number'` branch
        // handles this directly. Previously we passed a fake Firestore
        // timestamp shape `{ toMillis }` which formatMsgTime didn't
        // recognize (it only checks `toDate` and `seconds`), so the
        // optimistic bubble showed an empty time string until the server
        // snapshot arrived and replaced the shape.
        createdAt: Date.now() as DirectMessage['createdAt'],
        replyTo: replyRef,
      };
      setPendingMsgs((prev) => {
        if (prev.some((m) => m.id === clientId)) return prev;
        return [...prev, optimisticMsg];
      });

      // Fire-and-forget the actual write. We deliberately don't await — the
      // optimistic message is already visible, the input is already empty, and
      // the subscription will replace the placeholder once the write lands. On
      // failure we remove the optimistic bubble + restore the draft.
      (async () => {
        try {
          await sendConversationMessage(convId, user.uid, trimmed, otherUid, myName, undefined, undefined, clientId, replyRef);
        } catch (e) {
          const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
          if (code === 'unavailable' || code === 'failed-precondition') {
            await enqueueMessage(convId, user.uid, trimmed, otherUid, myName, undefined, undefined, clientId, replyRef).catch(() => {});
            // notifyInfo (toast) is safe to call on an unmounted screen —
            // the Toast root lives globally — so we don't gate it.
            notifyInfo('Офлайн', 'Съобщението ще бъде изпратено, когато се свържеш с интернет.');
          } else {
            // Genuine failure (rules, App Check, etc.) — yank the optimistic
            // bubble + put the text back so the user can retry. Skip the
            // setStates if the user has already left the screen, otherwise
            // React logs setState-on-unmounted. handleError's toast is
            // global so it can still fire.
            if (isMountedRef.current) {
              setPendingMsgs((prev) => prev.filter((m) => m.id !== clientId));
              setText(trimmed);
              if (replyRef) setReplyingTo(capturedReplyingTo);
            }
            handleError(e);
          }
        }
      })();
    } finally {
      sendingRef.current = false;
    }
  }, [convId, text, user, otherUid, clearTypingStatus, editingMsg, blockedByMe, replyingTo, pendingMedia, uploadAndSendMedia]);

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
      Toast.show({ type: 'error', text1: 'Неуспешно действие', visibilityTime: 2400 });
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
    // Staged photo preview that sits above the composer when the user has
    // picked an image but not sent yet.
    mediaPreviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    mediaPreviewThumb: {
      width: 56,
      height: 56,
      borderRadius: 10,
      backgroundColor: colors.background,
    },
    mediaPreviewClose: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
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
  // With staged media the send button works even when the caption is empty,
  // so it can dispatch a photo-only message. Disabled solely when blocked,
  // already sending, or there's nothing at all to send.
  const sendDisabled = sending || uploading || blockedByMe || (!hasSendText && !pendingMedia);
  const sendActive = (hasSendText || !!pendingMedia) && !blockedByMe;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen padded={false} safeAreaEdges={['top', 'left', 'right']} avoidKeyboard={false}>

        {/* Gradient header */}
        <LinearGradient colors={heroColors} style={{ paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, gap: 10 }}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Назад"
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
                  <Image source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }} style={{ width: 42, height: 42, borderRadius: 21 }} contentFit="cover" cachePolicy="memory-disk" />
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
            <ThemedTextInput
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
        <FlashList
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
          // FlashList handles unmeasured-row scrolls internally — no
          // onScrollToIndexFailed equivalent needed, and retrying via setTimeout
          // would just race the recycler. Drop the old FlatList-only callback.
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
            // Hide reactions on soft-deleted messages — the reactions doc
            // isn't cleaned up server-side, but showing emojis under "Изтрито
            // съобщение" is confusing and leaks that someone reacted before
            // the delete.
            const msgReactions = isDeleted ? {} : reactions[item.id] ?? {};
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
                        <Image source={{ uri: getImageVariant(item.sharedRef.photoUrl, ImageSize.gridThumb) ?? item.sharedRef.photoUrl }} style={styles.sharedCardImage} contentFit="cover" cachePolicy="memory-disk" />
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
                        source={{ uri: getImageVariant(item.mediaUrl, ImageSize.gridThumb) ?? item.mediaUrl }}
                        style={{ width: 200, height: 150, borderRadius: 10 }}
                        contentFit="cover"
                      />
                    </Pressable>
                  ) : item.mediaUrl && item.mediaType === 'video' ? (
                    // Video tile — black thumbnail with a play overlay. We
                    // don't have a frame-extracted poster (would need a
                    // server-side or client-side thumbnailing pass), so the
                    // black tile reads as "video, tap to play". The previous
                    // version was a non-tappable inline "📹 Видео" label —
                    // users couldn't actually open the video at all.
                    <Pressable
                      onPress={() => setVideoViewerUri(item.mediaUrl!)}
                      style={{ width: 200, height: 150, borderRadius: 10, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
                      accessibilityRole="button"
                      accessibilityLabel="Гледай видеото"
                    >
                      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="play" size={26} color="#fff" />
                      </View>
                      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 8, fontWeight: '600' }}>
                        Видео
                      </Text>
                    </Pressable>
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

        {/* Staged media preview — sits directly above the composer when the
            user has picked a photo but hasn't sent yet. Shows a 56px thumb
            with an X to discard. The text input below doubles as the caption. */}
        {pendingMedia ? (
          <View style={styles.mediaPreviewRow}>
            <Image
              source={{ uri: pendingMedia.uri }}
              style={styles.mediaPreviewThumb}
              contentFit="cover"
              // Drop the staged media if the underlying file:// URI is no
              // longer readable. Android can clean up the picker's temp file
              // after the user navigates away + back, or after a background
              // memory-pressure event. Without this, the row renders a broken
              // thumb that sends as a corrupt upload on tap.
              onError={() => setPendingMedia(null)}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.caption, color: colors.text, fontWeight: '700' }}>
                Готово за изпращане
              </Text>
              <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>
                Добави описание или натисни изпращане.
              </Text>
            </View>
            <Pressable
              onPress={() => setPendingMedia(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Премахни снимката"
              style={styles.mediaPreviewClose}
            >
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {/* Input row */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Pressable
            onPress={() => {
              if (blockedByMe) {
                notifyInfo('Блокиран потребител', 'Разблокирай го, за да изпратиш медия.');
                return;
              }
              ActionSheet.show({
                title: 'Изпрати медия',
                options: [
                  { label: 'Камера', icon: 'camera-outline', onPress: () => pickMedia('camera') },
                  { label: 'Галерия', icon: 'images-outline', onPress: () => pickMedia('gallery') },
                ],
              });
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
            <ThemedTextInput
              style={styles.input}
              placeholder={
                blockedByMe ? 'Блокиран потребител'
                : editingMsg ? 'Редактирай съобщението…'
                : pendingMedia ? 'Добави описание (по желание)…'
                : 'Съобщение…'
              }
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
            style={[styles.sendBtn, { backgroundColor: sendActive ? colors.primary : colors.surfaceAlt }]}
          >
            {sending || uploading
              ? <ActivityIndicator size="small" color={sendActive ? '#fff' : colors.textMuted} />
              : <Ionicons name={editingMsg ? 'checkmark' : 'arrow-up'} size={20} color={sendActive ? '#fff' : colors.textMuted} />
            }
          </Pressable>
        </View>

        <ImageViewer uri={viewerUri} visible={viewerVisible} onClose={() => setViewerVisible(false)} />

        {/* Fullscreen video viewer for chat-sent videos. Reuses
            StoryVideoPlayer for the actual playback (loop, mute toggle,
            "needs rebuild" fallback when the native module is missing) so
            video plumbing stays in one place. Tap close to dismiss; no
            swipe-down because chat videos can be lengthy and an accidental
            scroll-down shouldn't kill playback. */}
        <Modal
          visible={videoViewerUri !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setVideoViewerUri(null)}
          statusBarTranslucent
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {videoViewerUri ? (
              <StoryVideoPlayer
                uri={videoViewerUri}
                paused={false}
                width={Dimensions.get('window').width}
                height={Dimensions.get('window').height}
              />
            ) : null}
            <Pressable
              onPress={() => setVideoViewerUri(null)}
              hitSlop={12}
              style={{
                position: 'absolute',
                top: 52,
                right: 20,
                zIndex: 10,
                backgroundColor: 'rgba(0,0,0,0.55)',
                borderRadius: 20,
                padding: 6,
              }}
              accessibilityRole="button"
              accessibilityLabel="Затвори видеото"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
        </Modal>

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
                          // Clear any in-flight edit BEFORE switching to reply.
                          // Without these resets, an unsaved edit draft sits in
                          // the input — the user thinks they're replying to msg
                          // but accidentally sends their edit-A text as the
                          // reply body (and the actual edit gets dropped
                          // silently when send() routes to the reply branch).
                          if (editingMsg) setText('');
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
                          // expo-clipboard's setStringAsync replaces react-
                          // native's deprecated Clipboard.setString. The
                          // RN-bundled one will be removed in a future
                          // release; switching now avoids the deprecation
                          // warning + a future migration.
                          void Clipboard.setStringAsync(msg.text);
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
                    <Image source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }} style={{ width: 84, height: 84, borderRadius: 42 }} contentFit="cover" cachePolicy="memory-disk" />
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
