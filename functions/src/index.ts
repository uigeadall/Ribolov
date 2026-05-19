import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";

admin.initializeApp();
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardRow {
  rank: number;
  ownerUid: string;
  ownerName: string;
  totalKg: number;
  catchCount: number;
  bestKg: number;
}

type Period = "day" | "week" | "month" | "year";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodMinIso(period: Period): string {
  const now = new Date();
  let d: Date;

  switch (period) {
    case "day":
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;
    case "week": {
      const day = now.getDay(); // 0=Sun, 1=Mon ...
      const diffToMonday = day === 0 ? -6 : 1 - day;
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0, 0);
      break;
    }
    case "month":
      d = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
    case "year":
      d = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;
  }

  return d.toISOString();
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  const message = {
    to: token,
    sound: "default",
    title,
    body,
    data,
  };

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
}

// ---------------------------------------------------------------------------
// onNotificationCreated — sends Expo push notifications
// ---------------------------------------------------------------------------

export const onNotificationCreated = onDocumentCreated(
  "users/{userId}/notifications/{notifId}",
  async (event) => {
    const { userId } = event.params;
    const data = event.data?.data() as Record<string, unknown> | undefined;
    if (!data) return;

    // Fetch the recipient's push token
    const tokenSnap = await db.doc(`users/${userId}/private/pushToken`).get();
    const token: string = tokenSnap.data()?.expoPushToken ?? '';
    if (!token || !token.startsWith("ExponentPushToken[")) return;

    const type = data.type as string | undefined;
    const actorName = (data.actorName ?? "Someone") as string;

    let title = "Ribolov";
    let body = "You have a new notification.";

    switch (type) {
      case "like":
        title = "New Like";
        body = `${actorName} liked your catch.`;
        break;
      case "comment":
        title = "New Comment";
        body = `${actorName} commented on your catch.`;
        break;
      case "follow":
        title = "New Follower";
        body = `${actorName} started following you.`;
        break;
      case "storyLike":
        title = "Story Like";
        body = `${actorName} liked your story.`;
        break;
      case "storyComment":
        title = "Story Comment";
        body = `${actorName} commented on your story.`;
        break;
    }

    await sendExpoPush(token, title, body, {
      type,
      notifId: event.params.notifId,
    });
  }
);

// ---------------------------------------------------------------------------
// onNewMessage — sends Expo push notification for new chat messages
// ---------------------------------------------------------------------------

export const onNewMessage = onDocumentCreated(
  "conversations/{convId}/messages/{msgId}",
  async (event) => {
    const { convId } = event.params;
    const msgData = event.data?.data() as Record<string, unknown> | undefined;
    if (!msgData) return;

    const senderUid = msgData.senderUid as string | undefined;
    const text = msgData.text as string | undefined;
    const mediaType = msgData.mediaType as string | undefined;

    // Read conversation to get participants
    const convSnap = await db.doc(`conversations/${convId}`).get();
    const convData = convSnap.data() as Record<string, unknown> | undefined;
    if (!convData) return;

    const participantIds = convData.participantIds as string[] | undefined;
    const participantNames = convData.participantNames as Record<string, string> | undefined;
    if (!participantIds || !participantNames || !senderUid) return;

    const recipientUid = participantIds.find((id) => id !== senderUid);
    if (!recipientUid) return;

    // Fetch recipient's push token
    const tokenSnap = await db.doc(`users/${recipientUid}/private/pushToken`).get();
    const token: string = tokenSnap.data()?.expoPushToken ?? '';
    if (!token || !token.startsWith("ExponentPushToken[")) return;

    const senderName: string = participantNames[senderUid] ?? "Someone";

    let body: string;
    if (text) {
      body = text;
    } else if (mediaType === "photo") {
      body = "📷 Снимка";
    } else {
      body = "📹 Видео";
    }

    await sendExpoPush(token, senderName, body, {
      type: "message",
      convId,
      senderUid,
    });
  }
);

// ---------------------------------------------------------------------------
// aggregateLeaderboards — runs every 10 minutes
// ---------------------------------------------------------------------------

export const aggregateLeaderboards = onSchedule("every 10 minutes", async () => {
  const periods: Period[] = ["day", "week", "month", "year"];

  for (const period of periods) {
    const minIso = periodMinIso(period);

    const snapshot = await db
      .collection("publicCatches")
      .where("date", ">=", minIso)
      .get();

    // Aggregate by ownerUid
    const map = new Map<
      string,
      { ownerName: string; totalKg: number; catchCount: number; bestKg: number }
    >();

    for (const doc of snapshot.docs) {
      const d = doc.data();
      const uid: string = d.ownerUid ?? "";
      const name: string = d.ownerName ?? "Unknown";
      const kg: number = typeof d.weightKg === "number" ? d.weightKg : 0;

      if (!uid) continue;

      const existing = map.get(uid);
      if (existing) {
        existing.totalKg += kg;
        existing.catchCount += 1;
        if (kg > existing.bestKg) existing.bestKg = kg;
      } else {
        map.set(uid, { ownerName: name, totalKg: kg, catchCount: 1, bestKg: kg });
      }
    }

    // Sort by totalKg desc and assign ranks
    const rows: LeaderboardRow[] = Array.from(map.entries())
      .sort((a, b) => b[1].totalKg - a[1].totalKg)
      .map(([ownerUid, agg], index) => ({
        rank: index + 1,
        ownerUid,
        ownerName: agg.ownerName,
        totalKg: agg.totalKg,
        catchCount: agg.catchCount,
        bestKg: agg.bestKg,
      }));

    await db.collection("leaderboardCache").doc(`global_${period}`).set({
      rows,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
});

// ---------------------------------------------------------------------------
// cleanupExpiredStories — runs every 1 hour
// ---------------------------------------------------------------------------

export const cleanupExpiredStories = onSchedule("every 1 hours", async () => {
  const now = Date.now();

  const snapshot = await db
    .collection("stories")
    .where("expiresAt", "<", now)
    .limit(200)
    .get();

  for (const docRef of snapshot.docs) {
    await db.recursiveDelete(docRef.ref);
  }
});

// ---------------------------------------------------------------------------
// cleanupExpiredLivePins — runs every 30 minutes
// ---------------------------------------------------------------------------
// Live "fishing here right now" pins have a 4h TTL. Without cleanup, expired
// pins accumulate in /liveFishingPins forever (clients filter them out but the
// docs stay). Same shape as cleanupExpiredStories.

export const cleanupExpiredLivePins = onSchedule("every 30 minutes", async () => {
  const now = Date.now();

  const snapshot = await db
    .collection("liveFishingPins")
    .where("expiresAt", "<", now)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  // Plain delete is fine — no subcollections under live pins.
  const batch = db.batch();
  for (const docRef of snapshot.docs) {
    batch.delete(docRef.ref);
  }
  await batch.commit();
});
