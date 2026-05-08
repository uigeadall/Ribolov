import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { ensureFirebase } from './firebase';

const EAS_PROJECT_ID = '7e57275b-fc18-4ae3-bfa3-e519e37dae65';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(uid: string): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Общи известия',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0E4D64',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const token = tokenData.data;
    if (!token) return;

    const fb = ensureFirebase();
    if (!fb) return;

    // Use setDoc with merge so it works even if the user doc doesn't exist yet
    await setDoc(doc(fb.db, 'users', uid), { expoPushToken: token }, { merge: true });
  } catch {
    // Best-effort — never crash the app over a push token
  }
}

export async function getUserPushToken(uid: string): Promise<string | null> {
  try {
    const fb = ensureFirebase();
    if (!fb) return null;
    const snap = await getDoc(doc(fb.db, 'users', uid));
    const token = snap.data()?.expoPushToken;
    return typeof token === 'string' && token.startsWith('ExponentPushToken') ? token : null;
  } catch {
    return null;
  }
}

/** Изпраща push известие чрез безплатния Expo push proxy. Не изисква сървър. */
export async function sendPushNotification(opts: {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (!opts.to || !opts.to.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        to: opts.to,
        title: opts.title,
        body: opts.body,
        data: opts.data ?? {},
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      }),
    });
  } catch {
    // Fire-and-forget
  }
}
