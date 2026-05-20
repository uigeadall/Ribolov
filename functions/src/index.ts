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
// Notification preferences — gate every push behind users/{uid}/settings/notifications
// ---------------------------------------------------------------------------

type NotifPrefs = {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  messages: boolean;
  storyReactions: boolean;
  mentions: boolean;
};

// Missing prefs default to true (opt-out, not opt-in) so existing users keep
// receiving notifications until they explicitly disable a category.
async function getNotifPrefs(uid: string): Promise<NotifPrefs> {
  const snap = await db.doc(`users/${uid}/settings/notifications`).get();
  const d = (snap.data() ?? {}) as Partial<NotifPrefs>;
  return {
    likes: d.likes !== false,
    comments: d.comments !== false,
    follows: d.follows !== false,
    messages: d.messages !== false,
    storyReactions: d.storyReactions !== false,
    mentions: d.mentions !== false,
  };
}

function shouldNotify(type: string | undefined, prefs: NotifPrefs): boolean {
  switch (type) {
    case "like": return prefs.likes;
    case "comment": return prefs.comments;
    case "follow": return prefs.follows;
    case "message": return prefs.messages;
    case "mention": return prefs.mentions;
    case "storyLike":
    case "storyComment": return prefs.storyReactions;
    default: return true;
  }
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

    const type = data.type as string | undefined;

    // Skip the "message" type — those are written by onNewMessage which already
    // handles its own push. Avoids a double-push if this function ever fires for
    // a message-type notification doc.
    if (type === "message") return;

    // Honor the recipient's notification preferences.
    const prefs = await getNotifPrefs(userId);
    if (!shouldNotify(type, prefs)) return;

    // Fetch the recipient's push token
    const tokenSnap = await db.doc(`users/${userId}/private/pushToken`).get();
    const token: string = tokenSnap.data()?.expoPushToken ?? "";
    if (!token || !token.startsWith("ExponentPushToken[")) return;

    const actorName = (data.actorName ?? "Рибар") as string;

    let title = "Ribolov";
    let body = "Имаш ново известие.";

    switch (type) {
      case "like":
        title = "Ново харесване";
        body = `${actorName} хареса твой улов.`;
        break;
      case "comment":
        title = "Нов коментар";
        body = `${actorName} коментира твой улов.`;
        break;
      case "follow":
        title = "Нов последовател";
        body = `${actorName} те последва.`;
        break;
      case "storyLike":
        title = "Реакция на история";
        body = `${actorName} реагира на твоята история.`;
        break;
      case "storyComment":
        title = "Коментар на история";
        body = `${actorName} коментира твоята история.`;
        break;
      case "mention":
        title = "Спомена те";
        body = `${actorName} те спомена в публикация.`;
        break;
    }

    await sendExpoPush(token, title, body, {
      type,
      notifId: event.params.notifId,
      // Carry catchId/storyId/actorUid so the tap handler can deep-link.
      catchId: typeof data.catchId === "string" ? data.catchId : "",
      storyId: typeof data.storyId === "string" ? data.storyId : "",
      actorUid: typeof data.actorUid === "string" ? data.actorUid : "",
      actorName,
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
    const sharedRef = msgData.sharedRef as { kind?: string } | undefined;

    // Read conversation to get participants
    const convSnap = await db.doc(`conversations/${convId}`).get();
    const convData = convSnap.data() as Record<string, unknown> | undefined;
    if (!convData) return;

    const participantIds = convData.participantIds as string[] | undefined;
    const participantNames = convData.participantNames as Record<string, string> | undefined;
    if (!participantIds || !participantNames || !senderUid) return;

    const recipientUid = participantIds.find((id) => id !== senderUid);
    if (!recipientUid) return;

    // Idempotency guard. onDocumentCreated has at-least-once delivery, so a duplicate
    // fire would re-increment unreadMessageCount and re-send push. Mark the message
    // doc atomically and bail on retry. Admin SDK bypasses rules; clients can't
    // observe or modify `_fnProcessed` thanks to message update rules.
    const claimed = await db.runTransaction(async (tx) => {
      const msgSnap = await tx.get(event.data!.ref);
      if (!msgSnap.exists) return false;
      if ((msgSnap.data() as Record<string, unknown>)?._fnProcessed) return false;
      tx.update(event.data!.ref, { _fnProcessed: true });
      return true;
    });
    if (!claimed) return;

    // Honor "messages" preference for both in-app notification AND push.
    const prefs = await getNotifPrefs(recipientUid);
    if (!prefs.messages) return;

    // Muted-conversation check. When the recipient has muted this specific
    // conv we suppress BOTH the in-app notification doc and the Expo push,
    // but still bump the unread aggregate so toggling unmute later + opening
    // the chat decrements correctly. The client-side bell-badge subscriber
    // already filters muted convs out of the visible count.
    const mutedSnap = await db
      .doc(`users/${recipientUid}/mutedConversations/${convId}`)
      .get();
    const isMuted = mutedSnap.exists;

    const senderName: string = participantNames[senderUid] ?? "Рибар";

    let body: string;
    if (text) {
      body = text;
    } else if (sharedRef?.kind === "catch") {
      body = "🎣 Сподели улов";
    } else if (sharedRef?.kind === "post") {
      body = "📰 Сподели публикация";
    } else if (sharedRef?.kind === "spot") {
      body = "📍 Сподели място";
    } else if (mediaType === "photo") {
      body = "📷 Снимка";
    } else {
      body = "📹 Видео";
    }

    // Write a single in-app notification per conversation (deterministic id).
    // New messages overwrite the doc so the latest preview rises to the top
    // and the unread-bell badge reflects one entry per active conversation.
    // Skipped entirely for muted convs.
    if (!isMuted) {
      await db.doc(`users/${recipientUid}/notifications/message_${convId}`).set({
        actorUid: senderUid,
        actorName: senderName.slice(0, 120),
        type: "message",
        convId,
        preview: body.slice(0, 200),
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Bump the recipient's per-user unread aggregate. The client can't do this
    // itself because the users/{uid} rule requires isSelf(uid) — a cross-user
    // write would reject and roll back the entire send batch. Admin SDK
    // bypasses rules; merge:true handles the brand-new-user case. We bump
    // even for muted convs so unmute + open still decrements correctly.
    await db.doc(`users/${recipientUid}`).set(
      { unreadMessageCount: FieldValue.increment(1) },
      { merge: true },
    );

    // Push is also gated on mute — the OS notification is the noisiest part
    // of "muted means muted".
    if (isMuted) return;
    const tokenSnap = await db.doc(`users/${recipientUid}/private/pushToken`).get();
    const token: string = tokenSnap.data()?.expoPushToken ?? "";
    if (!token || !token.startsWith("ExponentPushToken[")) return;

    await sendExpoPush(token, senderName, body, {
      type: "message",
      convId,
      senderUid,
      senderName,
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

// ---------------------------------------------------------------------------
// cleanupExpiredWaterReports — runs every 6 hours
// ---------------------------------------------------------------------------
// Water-condition reports (waterReports) have a 24h TTL. The client used to
// stamp expiresAt with Date.now() + TTL, which depended on the device clock
// and could be wildly off. We now rely on the server-stamped createdAt and
// delete anything older than 24h here.

export const cleanupExpiredWaterReports = onSchedule("every 6 hours", async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

  const snapshot = await db
    .collection("waterReports")
    .where("createdAt", "<", cutoff)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  const batch = db.batch();
  for (const docRef of snapshot.docs) {
    batch.delete(docRef.ref);
  }
  await batch.commit();
});

// ---------------------------------------------------------------------------
// cleanupOldNotifications — runs daily
// ---------------------------------------------------------------------------
// Notification docs accumulate forever under users/{uid}/notifications. At
// scale this dominates Firestore storage cost. Strategy: delete anything
// that is BOTH read AND older than 30 days. Unread notifs stick around
// forever — losing one to a sweep would be a bad UX call.
//
// Runs daily at low-traffic hour. Per invocation we process at most
// MAX_DOCS_PER_RUN deletes across a collectionGroup query to keep runtime
// bounded; if a tenant accumulates more than that, the next run mops up.

const NOTIFS_MAX_AGE_DAYS = 30;
const NOTIFS_MAX_DOCS_PER_RUN = 4000;

export const cleanupOldNotifications = onSchedule("every day 04:00", async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - NOTIFS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  // collectionGroup spans every users/{uid}/notifications subcollection.
  // Requires a collectionGroup index on (read ASC, createdAt ASC) — added
  // to firestore.indexes.json alongside this function.
  const snapshot = await db
    .collectionGroup("notifications")
    .where("read", "==", true)
    .where("createdAt", "<", cutoff)
    .limit(NOTIFS_MAX_DOCS_PER_RUN)
    .get();

  if (snapshot.empty) {
    // eslint-disable-next-line no-console
    console.log("[cleanupOldNotifications] no expired notifs to delete");
    return;
  }

  // Batch in groups of 400 (Firestore caps batches at 500; leave headroom).
  let processed = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const docRef of snapshot.docs) {
    batch.delete(docRef.ref);
    inBatch += 1;
    processed += 1;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  // eslint-disable-next-line no-console
  console.log(`[cleanupOldNotifications] deleted ${processed} expired read notifications`);
});
