import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { requireFirebase } from './firebase';
import type { ForecastDay } from './weather';

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

    const fb = requireFirebase();

    // Use setDoc with merge so it works even if the user doc doesn't exist yet
    await setDoc(doc(fb.db, 'users', uid), { expoPushToken: token }, { merge: true });
  } catch {
    // Best-effort — never crash the app over a push token
  }
}

export async function getUserPushToken(uid: string): Promise<string | null> {
  try {
    const fb = requireFirebase();
    const snap = await getDoc(doc(fb.db, 'users', uid));
    const token = snap.data()?.expoPushToken;
    return typeof token === 'string' && token.startsWith('ExponentPushToken') ? token : null;
  } catch {
    return null;
  }
}

const FORECAST_NOTIF_KEY = '@ribolov/lastForecastNotif';

/**
 * Fires a local notification once per calendar day when an upcoming day (next 3 days)
 * has a fishing rating of 4 or 5 stars. Gated by AsyncStorage so it doesn't spam.
 */
export async function scheduleForecastNotificationIfGood(forecast: ForecastDay[]): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const last = await AsyncStorage.getItem(FORECAST_NOTIF_KEY);
    if (last === today) return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    // Skip today (index 0), look at next 3 days
    const upcoming = forecast.slice(1, 4);
    const best = upcoming.reduce<ForecastDay | null>(
      (b, d) => (!b || d.fishingRating > b.fishingRating ? d : b),
      null
    );
    if (!best || best.fishingRating < 4) return;

    const stars = '⭐'.repeat(best.fishingRating);
    const rain = best.precipProbability > 0 ? ` · 💧 ${best.precipProbability}%` : '';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🎣 Добри условия за риболов!',
        body: `${best.dayLabel} — ${stars} · ${best.maxTempC}°C${rain}`,
        data: { type: 'forecast' },
        sound: true,
      } as any,
      trigger: null,
    });

    await AsyncStorage.setItem(FORECAST_NOTIF_KEY, today);
  } catch {
    // Best-effort — never crash the app
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
