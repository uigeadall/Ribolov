import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { typography } from '../theme/typography';
import {
  fetchCatchCommentLike,
  toggleCatchCommentLike,
} from '../services/socialComments';
import {
  fetchPostCommentLike,
  togglePostCommentLike,
} from '../services/posts';

type Kind = 'catch' | 'post';

type Props = {
  kind: Kind;
  parentId: string;
  commentId: string;
  myUid?: string;
  myDisplayName: string;
  initialCount: number;
};

/** Heart-shaped like button rendered inside an individual comment row. Owns
    its own toggle state so the parent doesn't have to track N comment likes.
    Initial liked-state is fetched via a one-shot getDoc on mount; subsequent
    updates are handled optimistically. Avoids the N-listener leak that an
    onSnapshot-per-comment would create when a profile or feed renders many
    comment rows at once. */
export function CommentLikeButton({
  kind, parentId, commentId, myUid, myDisplayName, initialCount,
}: Props) {
  const { colors } = useTheme();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const busyRef = useRef(false);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    if (!myUid) return;
    let cancelled = false;
    void (async () => {
      try {
        const isLiked = kind === 'catch'
          ? await fetchCatchCommentLike(parentId, commentId, myUid)
          : await fetchPostCommentLike(parentId, commentId, myUid);
        if (!cancelled) setLiked(isLiked);
      } catch {
        // Best-effort — if the lookup fails we leave liked=false; the toggle
        // will overwrite this on user interaction.
      }
    })();
    return () => { cancelled = true; };
  }, [kind, parentId, commentId, myUid]);

  const onPress = async () => {
    if (!myUid || busyRef.current) return;
    busyRef.current = true;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (kind === 'catch') {
        await toggleCatchCommentLike(parentId, commentId, myUid, myDisplayName);
      } else {
        await togglePostCommentLike(parentId, commentId, myUid, myDisplayName);
      }
    } catch {
      setLiked(wasLiked);
      setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      disabled={!myUid}
      accessibilityRole="button"
      accessibilityLabel={liked ? 'Премахни харесване' : 'Хареса'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
    >
      <Ionicons
        name={liked ? 'heart' : 'heart-outline'}
        size={13}
        color={liked ? '#E53935' : colors.textMuted}
      />
      {count > 0 ? (
        <Text style={{ ...typography.caption, color: liked ? '#E53935' : colors.textMuted, fontSize: 11 }}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
