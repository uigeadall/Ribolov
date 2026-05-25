import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

type NotifData = Record<string, unknown>;

function routeNotification(
  ref: NavigationContainerRefWithCurrent<RootStackParamList>,
  data: NotifData,
) {
  if (!ref.isReady()) return;
  const type = data.type as string | undefined;
  const actorUid = typeof data.actorUid === 'string' ? data.actorUid : '';
  const actorName = typeof data.actorName === 'string' ? data.actorName : 'Рибар';
  const catchId = typeof data.catchId === 'string' ? data.catchId : '';
  const postId = typeof data.postId === 'string' ? data.postId : '';

  // Helper navigators — keeps the type switch readable and ensures every
  // path follows the nested Main → Tab → Screen shape that react-navigation
  // needs for cold-start deep links to actually land on the right stack.
  const goCatch = (id: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ref.navigate as any)('Main', {
      screen: 'LogbookTab',
      params: { screen: 'CatchDetail', params: { id } },
    });
  const goPost = (id: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ref.navigate as any)('Main', {
      screen: 'FeedTab',
      params: { screen: 'PostDetail', params: { id } },
    });
  const goProfile = (uid: string, displayName: string) =>
    ref.navigate('UserPublicProfile', { uid, displayName });

  // Follow + story interactions → the actor's profile (the story or follow
  // doesn't have its own deep-link target).
  if ((type === 'follow' || type === 'storyLike' || type === 'storyComment') && actorUid) {
    goProfile(actorUid, actorName);
    return;
  }

  // Mention → the post the user was mentioned IN, not the mentioner's
  // profile. The PostDetail route now exists (created since the original
  // comment was written), so we can finally land on the actual context.
  // Falls back to the actor's profile only when postId is missing (legacy
  // mention docs that used the catchId slot).
  if (type === 'mention') {
    if (postId) { goPost(postId); return; }
    if (catchId) { goPost(catchId); return; } // legacy: post id stored in catchId slot
    if (actorUid) { goProfile(actorUid, actorName); return; }
    return;
  }

  // Reshare → the new reshare post that quoted the user's content. Push
  // payload from onNotificationCreated carries postId; without this case
  // the notification was a dead-end tap.
  if (type === 'reshare' && postId) {
    goPost(postId);
    return;
  }

  // Personal best (followers receive these) → the catch that set the PB.
  // Catch-only — PBs don't have a post-side representation.
  if (type === 'personalBest' && catchId) {
    goCatch(catchId);
    return;
  }

  // Likes + comments. Two flavours:
  //   1. Target is a POST (postId set) — land in PostDetail
  //   2. Target is a CATCH (catchId only) — land in CatchDetail
  // The previous version only handled (2), so post-likes/comments tapped
  // from the lock screen went nowhere.
  if (type === 'like' || type === 'comment') {
    if (postId) { goPost(postId); return; }
    if (catchId) { goCatch(catchId); return; }
    return;
  }

  if (type === 'message' && typeof data.convId === 'string' && typeof data.senderUid === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ref.navigate as any)('Main', {
      screen: 'ProfileTab',
      params: {
        screen: 'ChatDetail',
        params: {
          convId: data.convId,
          otherUid: data.senderUid,
          otherName: typeof data.senderName === 'string' ? data.senderName : 'Рибар',
        },
      },
    });
  }
}

export function useNotificationNavigation(
  ref: NavigationContainerRefWithCurrent<RootStackParamList>,
  isReady: boolean,
) {
  const pendingData = useRef<NotifData | null>(null);
  const coldStartHandled = useRef(false);

  // Foreground / background tap listener
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotifData;
      if (isReady) {
        routeNotification(ref, data);
      } else {
        pendingData.current = data;
      }
    });
    return () => sub.remove();
  }, [ref, isReady]);

  // Once navigator is ready: flush pending + handle cold-start tap
  useEffect(() => {
    if (!isReady) return;

    if (pendingData.current) {
      routeNotification(ref, pendingData.current);
      pendingData.current = null;
    }

    if (!coldStartHandled.current) {
      coldStartHandled.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (!response) return;
          routeNotification(ref, response.notification.request.content.data as NotifData);
        })
        .catch(() => {});
    }
  }, [ref, isReady]);
}
