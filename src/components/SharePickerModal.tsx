import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { useAuth } from '../services/authContext';
import { listMyConversations, sendConversationMessage, makeMessageClientId } from '../services/messaging';
import { getBlockedUids } from '../services/blockUser';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { handleError } from '../utils/handleError';
import { radius, spacing, typography } from '../theme/typography';
import type { ConversationPreview, SharedRef } from '../types';

type Props = {
  visible: boolean;
  onClose: () => void;
  sharedRef: SharedRef | null;
};

function ConversationRow({
  item,
  myUid,
  onPress,
  pendingUid,
}: {
  item: ConversationPreview;
  myUid: string;
  onPress: (item: ConversationPreview) => void;
  pendingUid: string | null;
}) {
  const { colors } = useTheme();
  const avatarUrl = useAvatarUrl({
    ownerUid: item.otherUid,
    isMine: item.otherUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  const initials = item.otherName.slice(0, 1).toUpperCase();
  const isPending = pendingUid === item.otherUid;

  return (
    <Pressable
      onPress={() => onPress(item)}
      disabled={!!pendingUid}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        opacity: pendingUid && !isPending ? 0.5 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={{ width: 44, height: 44, borderRadius: 22 }} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 18 }}>{initials}</Text>
        )}
      </View>
      <Text style={{ ...typography.bodyBold, color: colors.text, flex: 1 }} numberOfLines={1}>
        {item.otherName}
      </Text>
      {isPending ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name="paper-plane" size={20} color={colors.primary} />
      )}
    </Pressable>
  );
}

export function SharePickerModal({ visible, onClose, sharedRef }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [convs, setConvs] = useState<ConversationPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingUid, setPendingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !user?.uid) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // listMyConversations and getBlockedUids both swallow their own errors
      // and return empty collections — so this Promise.all can't reject in
      // practice. We still wrap defensively to keep the modal from going stale
      // on an unrelated throw (e.g. setState on unmounted).
      try {
        const [list, blocked] = await Promise.all([
          listMyConversations(user.uid, 50),
          getBlockedUids(user.uid).catch(() => new Set<string>()),
        ]);
        if (cancelled) return;
        setConvs(list.filter((c) => !blocked.has(c.otherUid)));
      } catch (e) {
        if (__DEV__) console.warn('SharePickerModal: load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, user?.uid]);

  const handlePick = useCallback(async (conv: ConversationPreview) => {
    if (!user || !sharedRef || pendingUid) return;
    setPendingUid(conv.otherUid);
    try {
      const myName = user.displayName ?? 'Рибар';
      await sendConversationMessage(
        conv.convId,
        user.uid,
        '',
        conv.otherUid,
        myName,
        undefined,
        undefined,
        makeMessageClientId(),
        undefined,
        sharedRef,
      );
      Alert.alert('Изпратено', `Споделено с ${conv.otherName}.`);
      onClose();
    } catch (e) {
      handleError(e);
    } finally {
      setPendingUid(null);
    }
  }, [user, sharedRef, pendingUid, onClose]);

  const styles = useMemo(() => StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%',
      paddingBottom: Math.max(spacing.md, insets.bottom),
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { ...typography.h3, color: colors.text },
  }), [colors, insets.bottom]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* onStartShouldSetResponder claims the gesture without firing onPress, so
            taps inside the sheet don't bubble to the backdrop (which would close
            the modal) and we avoid the nested-Pressable touch-responder conflict
            that produces "Cannot record touch move without a touch start". */}
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Изпрати до приятел</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          {loading ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : convs.length === 0 ? (
            <View style={{ paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, alignItems: 'center' }}>
              <Ionicons name="chatbubbles-outline" size={32} color={colors.textMuted} />
              <Text style={{ ...typography.body, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' }}>
                Нямаш активни разговори. Започни такъв от Приятели.
              </Text>
            </View>
          ) : (
            <FlatList
              data={convs}
              keyExtractor={(c) => c.convId}
              renderItem={({ item }) =>
                user ? (
                  <ConversationRow
                    item={item}
                    myUid={user.uid}
                    onPress={handlePick}
                    pendingUid={pendingUid}
                  />
                ) : null
              }
              ItemSeparatorComponent={() => (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg + 44 + spacing.md }} />
              )}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

/** Helper to build a SharedRef for a catch FeedItem-like object. */
export function buildCatchSharedRef(c: {
  id: string;
  ownerUid?: string;
  speciesName?: string;
  photoTitle?: string;
  weightKg?: number;
  lengthCm?: number;
  photoUri?: string;
}): SharedRef {
  const titleParts: string[] = [];
  if (c.photoTitle) titleParts.push(c.photoTitle);
  else if (c.speciesName) titleParts.push(c.speciesName);
  const subtitleParts: string[] = [];
  if (c.weightKg) subtitleParts.push(`${c.weightKg} кг`);
  if (c.lengthCm) subtitleParts.push(`${c.lengthCm} см`);
  return {
    kind: 'catch',
    id: c.id,
    ownerUid: c.ownerUid,
    title: titleParts.join(' ') || undefined,
    subtitle: subtitleParts.join(' • ') || undefined,
    photoUrl: c.photoUri,
  };
}

/** Helper to build a SharedRef for a free-form feed post. The DM bubble uses
    `title` for the post text preview (clamped to one line) and `subtitle` for
    the author. ChatDetail's shared-card renderer falls back to a newspaper
    icon when there's no photoUrl. */
export function buildPostSharedRef(p: {
  id: string;
  ownerUid?: string;
  ownerName?: string;
  text?: string;
  photoUri?: string;
}): SharedRef {
  // Trim + clamp to keep the in-chat preview tidy — long captions get cut by
  // the receiver's `numberOfLines={1}` anyway, but trimming server-side
  // means we don't ship a 2KB string into every conversation.
  const title = p.text?.trim().slice(0, 140) || undefined;
  return {
    kind: 'post',
    id: p.id,
    ownerUid: p.ownerUid,
    title,
    subtitle: p.ownerName?.trim() || undefined,
    photoUrl: p.photoUri,
  };
}

/** Helper to build a SharedRef for a saved spot (map bookmark). No photo —
    the chat-side renderer shows a 📍 icon for the spot kind. */
export function buildSpotSharedRef(s: {
  id: string;
  name: string;
  waterType?: string;
  latitude?: number;
  longitude?: number;
}): SharedRef {
  // Use water type as the subtitle when available — gives the receiver context
  // without needing them to tap through to coordinates.
  const subtitle = s.waterType
    ? s.waterType
    : (s.latitude != null && s.longitude != null)
      ? `${s.latitude.toFixed(3)}, ${s.longitude.toFixed(3)}`
      : undefined;
  return {
    kind: 'spot',
    id: s.id,
    title: s.name?.trim() || 'Място',
    subtitle,
  };
}
