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

  if (type === 'follow' && typeof data.actorUid === 'string') {
    ref.navigate('UserPublicProfile', {
      uid: data.actorUid,
      displayName: typeof data.actorName === 'string' ? data.actorName : 'Рибар',
    });
  } else if ((type === 'like' || type === 'comment') && typeof data.catchId === 'string' && data.catchId) {
    // Navigate directly to the catch that was liked/commented
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ref.navigate as any)('Main', {
      screen: 'LogbookTab',
      params: {
        screen: 'CatchDetail',
        params: { id: data.catchId },
      },
    });
  } else if (type === 'message' && typeof data.convId === 'string' && typeof data.senderUid === 'string') {
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
