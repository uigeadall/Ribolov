import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
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

// Caps for outbound Expo push payload fields. Expo's API itself accepts
// fairly long strings but the iOS/Android notification UI truncates at much
// smaller sizes, and excessively long payloads can be rejected outright.
// Capping here also limits the blast radius of a malformed source doc
// (e.g. a 2000-char comment preview slipping through into a title slot).
const PUSH_TITLE_MAX = 100;
const PUSH_BODY_MAX = 200;

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  const safeTitle = String(title ?? "").slice(0, PUSH_TITLE_MAX);
  const safeBody = String(body ?? "").slice(0, PUSH_BODY_MAX);
  const message = {
    to: token,
    sound: "default",
    title: safeTitle,
    body: safeBody,
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
  tournamentReminders: boolean;
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
    tournamentReminders: d.tournamentReminders !== false,
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
    const sharedRef = msgData.sharedRef as
      | { kind?: string; id?: string; ownerUid?: string }
      | undefined;

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
    // Cheap pre-check: if the message was already processed by a prior
    // invocation, skip everything below. The atomic claim+bump transaction
    // further down is the authoritative guard; this is just an early bail.
    if ((msgData as Record<string, unknown>)?._fnProcessed) return;

    // SharedRef validation — done INSIDE onNewMessage (not in a separate
    // trigger) so an invalid shared catch/post/spot doesn't cause the
    // unread counter to drift. If a separate trigger soft-deleted the
    // message AFTER onNewMessage incremented unreadMessageCount, the
    // recipient's badge would show 1 unread for a message they can't see.
    // By inlining the check we either commit BOTH the count bump AND the
    // notification, or neither.
    if (sharedRef && sharedRef.kind && sharedRef.id) {
      let valid = false;
      try {
        if (sharedRef.kind === "catch") {
          const snap = await db.doc(`publicCatches/${sharedRef.id}`).get();
          valid = snap.exists;
        } else if (sharedRef.kind === "post") {
          const snap = await db.doc(`posts/${sharedRef.id}`).get();
          valid = snap.exists;
        } else if (sharedRef.kind === "spot") {
          // Spots are private; only the owner can share them. The sender
          // must declare ownership AND the spot must exist under that uid.
          if (sharedRef.ownerUid && sharedRef.ownerUid === senderUid) {
            const snap = await db.doc(`users/${senderUid}/spots/${sharedRef.id}`).get();
            valid = snap.exists;
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[onNewMessage] sharedRef check failed`, e);
      }
      if (!valid) {
        // Soft-delete: strip the sharedRef + clear text so the client renders
        // a "deleted message" placeholder rather than a broken shared card.
        // We do NOT bump unread or write a notification — bailing here means
        // the recipient never sees a phantom unread.
        try {
          await event.data!.ref.update({
            deletedAt: FieldValue.serverTimestamp(),
            sharedRef: FieldValue.delete(),
            text: "",
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[onNewMessage] sharedRef soft-delete failed`, e);
        }
        return;
      }
    }

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

    // Write the in-app notification doc FIRST. It uses a deterministic id
    // (`message_${convId}`) so a duplicate fire (parallel retry, etc.) just
    // overwrites the same row — idempotent, no side effect to worry about.
    // Skipped for muted convs.
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

    // ATOMIC claim + unread bump. Previously these were two separate writes
    // with the claim ahead of the bump — if the unread `set` failed AFTER
    // the claim, the function returned with claim=true and unread missing,
    // and there's no automatic retry on v2 background functions. The
    // recipient would have a notification doc but no unread badge bump.
    //
    // Combining them in a transaction ensures: either both commit (correct)
    // or neither commits and the function throws (CF logs the error; an
    // operator can replay or a sweeper can resurface). The transaction also
    // serves as the idempotency claim — a concurrent retry would see
    // `_fnProcessed` set in the transaction read and skip.
    const claimed = await db.runTransaction(async (tx) => {
      const msgSnap = await tx.get(event.data!.ref);
      if (!msgSnap.exists) return false;
      if ((msgSnap.data() as Record<string, unknown>)?._fnProcessed) return false;
      tx.update(event.data!.ref, { _fnProcessed: true });
      tx.set(
        db.doc(`users/${recipientUid}`),
        { unreadMessageCount: FieldValue.increment(1) },
        { merge: true },
      );
      return true;
    });
    if (!claimed) return;

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
      // `typeof NaN === "number"` is true — without the isFinite check, a
      // single NaN weight (corrupt write, division-by-zero in client) would
      // poison the aggregation: NaN propagates through every sum and sort,
      // tangling ranks across the entire leaderboard.
      const kg: number = typeof d.weightKg === "number" && Number.isFinite(d.weightKg) ? d.weightKg : 0;

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
// We delete by server-stamped `createdAt` age, NOT the client-stamped
// `expiresAt` field on the doc. Reason: stories.ts addStory() computes
// expiresAt = Date.now() + 24h from the device's wall-clock, which can be
// wildly wrong on devices with skewed clocks or wrong timezones. If the
// clock is 6 hours behind, the story stays in the feed 6 hours past its
// intended expiry. Same fix pattern as cleanupExpiredWaterReports below.
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export const cleanupExpiredStories = onSchedule("every 1 hours", async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - STORY_TTL_MS);

  const snapshot = await db
    .collection("stories")
    .where("createdAt", "<", cutoff)
    .limit(200)
    .get();

  for (const docRef of snapshot.docs) {
    await db.recursiveDelete(docRef.ref);
  }
});

// ---------------------------------------------------------------------------
// cleanupExpiredLivePins — runs every 30 minutes
// ---------------------------------------------------------------------------
// Live "fishing here right now" pins have a 4h TTL. We delete by server
// `createdAt` age, not the client-stamped `expiresAt` field. Same fix as
// cleanupExpiredStories — `expiresAt = Date.now() + 4h` in liveFishingPins.ts
// uses the device's wall-clock, which can be hours off on a misset phone.
// A skewed clock would either leave pins lingering long past their intent
// or evict them too early. The server-stamped createdAt + Cloud-Function
// Date.now() comparison side-steps the device entirely.
const LIVE_PIN_TTL_MS = 4 * 60 * 60 * 1000;

export const cleanupExpiredLivePins = onSchedule("every 30 minutes", async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - LIVE_PIN_TTL_MS);

  const snapshot = await db
    .collection("liveFishingPins")
    .where("createdAt", "<", cutoff)
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

// ---------------------------------------------------------------------------
// tournamentEndingSoonReminder — daily at 09:00 Europe/Sofia
// ---------------------------------------------------------------------------
// Sends an Expo push to every participant of every tournament whose endDate
// is *tomorrow* (in YYYY-MM-DD form). Gives competitors a final-day heads-up
// to submit a catch and check standings.
//
// Idempotency: after sending pushes for tournament T we write a marker doc
// `tournaments/{T}/_meta/reminderSent24h` with a `sentAt` timestamp. If the
// scheduler re-fires (or if the function is invoked twice in the same day
// due to a deploy-time backfill), we read the marker first and skip. The
// marker also lets a host see in the console whether a reminder fired.

export const tournamentEndingSoonReminder = onSchedule(
  { schedule: "every day 09:00", timeZone: "Europe/Sofia" },
  async () => {
    // ISO YYYY-MM-DD for tomorrow in the configured timezone. The scheduler
    // already runs in Europe/Sofia, but Date() inside the function uses the
    // container's UTC clock — so we compute against UTC and add 24h, which is
    // close enough at any timezone offset (the 1-day boundary won't shift).
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);

    const tournamentsSnap = await db
      .collection("tournaments")
      .where("endDate", "==", tomorrowIso)
      .get();

    if (tournamentsSnap.empty) {
      // eslint-disable-next-line no-console
      console.log(`[tournamentEndingSoonReminder] no tournaments ending on ${tomorrowIso}`);
      return;
    }

    let totalSent = 0;
    for (const tDoc of tournamentsSnap.docs) {
      const t = tDoc.data() as { name?: string; speciesName?: string };
      const tournamentId = tDoc.id;
      const tournamentName = (t.name ?? "Турнир").slice(0, 80);

      // Idempotency guard — if we already sent for this tournament, skip.
      // The marker also doubles as an audit trail.
      const markerRef = db.doc(`tournaments/${tournamentId}/_meta/reminderSent24h`);
      const markerSnap = await markerRef.get();
      if (markerSnap.exists) {
        // eslint-disable-next-line no-console
        console.log(`[tournamentEndingSoonReminder] ${tournamentId} already reminded — skip`);
        continue;
      }

      // Hard cap — a tournament shouldn't realistically have more than a few
      // hundred participants. If something writes 1M docs to the subcollection
      // we don't want this loop to send a million pushes; cap and warn.
      const PARTICIPANT_LIMIT = 1000;
      const participantsSnap = await db
        .collection(`tournaments/${tournamentId}/participants`)
        .limit(PARTICIPANT_LIMIT)
        .get();
      if (participantsSnap.size >= PARTICIPANT_LIMIT) {
        // eslint-disable-next-line no-console
        console.warn(`[tournamentEndingSoonReminder] ${tournamentId} hit participant cap of ${PARTICIPANT_LIMIT}`);
      }
      if (participantsSnap.empty) {
        // Still write the marker so we don't keep re-checking the empty list.
        await markerRef.set({ sentAt: FieldValue.serverTimestamp(), recipients: 0 });
        continue;
      }

      let sent = 0;
      for (const pDoc of participantsSnap.docs) {
        const uid = pDoc.id;
        try {
          const prefs = await getNotifPrefs(uid);
          if (!prefs.tournamentReminders) continue;
          const tokenSnap = await db.doc(`users/${uid}/private/pushToken`).get();
          const token: string = tokenSnap.data()?.expoPushToken ?? "";
          if (!token || !token.startsWith("ExponentPushToken[")) continue;

          await sendExpoPush(
            token,
            `„${tournamentName}" завършва утре`,
            t.speciesName
              ? `Последен шанс да добавиш улов от ${t.speciesName} и да изкатериш класацията.`
              : "Последен шанс да добавиш улов и да изкатериш класацията.",
            { type: "tournamentEndingSoon", tournamentId },
          );
          sent += 1;
        } catch (e) {
          // One bad participant shouldn't kill the rest of the loop.
          // eslint-disable-next-line no-console
          console.warn(`[tournamentEndingSoonReminder] ${tournamentId}/${uid} failed`, e);
        }
      }

      await markerRef.set({
        sentAt: FieldValue.serverTimestamp(),
        recipients: sent,
      });
      totalSent += sent;
    }

    // eslint-disable-next-line no-console
    console.log(`[tournamentEndingSoonReminder] sent ${totalSent} pushes across ${tournamentsSnap.size} tournaments`);
  },
);

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

// ---------------------------------------------------------------------------
// deleteMyAccount — callable function for "delete my account" flow
// ---------------------------------------------------------------------------
// Why callable, not auth.user().onDelete():
// - onDelete triggers AFTER Auth deletion, but Auth deletion itself requires
//   recent-login (sensitive op) which the client must complete first. By the
//   time the trigger fires, the user is gone — admin SDK still works but the
//   error surface is split between two boundaries (the Auth call fails first
//   from the client, then onDelete runs invisibly). A callable lets the
//   client do auth deletion + cascade in one observable round-trip.
//
// Flow on the client:
//   1. Call deleteMyAccount() — server scrubs all cloud data
//   2. On success, call user.delete() (Firebase Auth) — removes the auth record
//   3. Sign out + wipe local storage
//
// Cascade scope: every collection where the user owns data or has a backref.
// Soft limits per phase via .limit(N) so a malformed account with absurd
// amounts of data can't run forever. Phases are independent — a failure in
// one doesn't roll back earlier ones (acceptable: the user can re-invoke and
// remaining phases will mop up).

const DELETE_PHASE_LIMIT = 500;
const DELETE_BATCH_SIZE = 400; // Firestore batches cap at 500; leave headroom

async function deleteByQuery(
  q: admin.firestore.Query,
  label: string,
): Promise<number> {
  let total = 0;
  let hasMore = true;
  while (hasMore) {
    const snap = await q.limit(DELETE_PHASE_LIMIT).get();
    if (snap.empty) break;
    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      inBatch += 1;
      if (inBatch >= DELETE_BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();
    total += snap.size;
    hasMore = snap.size === DELETE_PHASE_LIMIT;
  }
  if (total > 0) {
    // eslint-disable-next-line no-console
    console.log(`[deleteMyAccount] ${label}: deleted ${total}`);
  }
  return total;
}

/** Recursively delete a doc and all its subcollections via the admin SDK
    helper. Used for top-level docs owned by the user (their tournaments,
    groups, posts) where there are subcollections (likes, comments, members)
    that the basic batch-delete wouldn't touch. */
async function recursiveDelete(refs: admin.firestore.DocumentReference[]): Promise<void> {
  for (const ref of refs) {
    await db.recursiveDelete(ref).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn(`[deleteMyAccount] recursiveDelete failed for ${ref.path}`, e);
    });
  }
}

export const deleteMyAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  // ── Phase 1: top-level docs the user owns (recursive — includes subcols)
  const ownedQueries: Array<[admin.firestore.Query, string]> = [
    [db.collection("publicCatches").where("ownerUid", "==", uid), "publicCatches"],
    [db.collection("posts").where("ownerUid", "==", uid), "posts"],
    [db.collection("stories").where("uid", "==", uid), "stories"],
    [db.collection("tournaments").where("hostUid", "==", uid), "tournaments(hosted)"],
    [db.collection("groups").where("createdBy", "==", uid), "groups(created)"],
    [db.collection("liveFishingPins").where("ownerUid", "==", uid), "liveFishingPins"],
    [db.collection("waterReports").where("reporterUid", "==", uid), "waterReports"],
  ];
  for (const [q, label] of ownedQueries) {
    try {
      // Paginate: a user with >DELETE_PHASE_LIMIT owned docs (e.g. 600 hosted
      // tournaments) would otherwise see only the first 500 deleted, leaving
      // the rest orphaned. We keep fetching pages while .size hits the limit.
      // recursiveDelete itself walks every subcollection per doc.
      let pageTotal = 0;
      let hasMore = true;
      while (hasMore) {
        const snap = await q.limit(DELETE_PHASE_LIMIT).get();
        if (snap.empty) break;
        await recursiveDelete(snap.docs.map((d) => d.ref));
        pageTotal += snap.size;
        // If we got a full page, there may be more — keep looping. The next
        // query will skip the just-deleted docs because they no longer match.
        hasMore = snap.size === DELETE_PHASE_LIMIT;
      }
      if (pageTotal > 0) {
        // eslint-disable-next-line no-console
        console.log(`[deleteMyAccount] ${label}: recursively deleted ${pageTotal}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[deleteMyAccount] ${label} phase failed`, e);
    }
  }

  // ── Phase 2: backref cleanup — entries in OTHER users' subcollections
  // pointing back at this user. These can't be done with recursiveDelete on
  // the owned docs because they live elsewhere.

  // 2a) Likes/reactions the user left across publicCatches and posts.
  //     Note: collectionGroup queries need an index for the where field.
  //     The .uid match in /likes works because the doc id IS the uid.
  // We can't query "where doc-id == uid" via collectionGroup directly;
  // instead, we know the doc id pattern and do a single doc.delete per
  // catch/post. That requires knowing all the parent ids, which is
  // unbounded. Pragmatic alternative: leave orphan likes — they show
  // "Рибар" instead of a name and the count stays correct. The privacy
  // exposure is minimal (a like with no resolvable user) and a Cloud
  // Function couldn't enumerate every catch ever liked anyway.

  // 2b) Comments the user left across catches and posts.
  await deleteByQuery(
    db.collectionGroup("comments").where("authorUid", "==", uid),
    "comments(authored)",
  );

  // 2c) Tournament photo entries the user submitted.
  await deleteByQuery(
    db.collectionGroup("photoEntries").where("ownerUid", "==", uid),
    "tournamentEntries",
  );

  // 2d) Group memberships — the per-group `members/{uid}` doc.
  //     Doc id is the uid, so collectionGroup + where(documentId, ==, uid).
  await deleteByQuery(
    db.collectionGroup("members").where("uid", "==", uid),
    "groupMemberships",
  );

  // 2e) Followers/Following — the user's own subcollections deleted by
  //     phase 3 below, but BACKREFS in other users' /followers and
  //     /following live under /users/{otherUid}. Resolve via the user's
  //     own /following list first to know whose /followers we need to
  //     touch (and vice versa).
  try {
    const followingSnap = await db.collection(`users/${uid}/following`).get();
    let batch = db.batch();
    let inBatch = 0;
    for (const d of followingSnap.docs) {
      batch.delete(db.doc(`users/${d.id}/followers/${uid}`));
      inBatch += 1;
      if (inBatch >= DELETE_BATCH_SIZE) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();

    const followersSnap = await db.collection(`users/${uid}/followers`).get();
    batch = db.batch();
    inBatch = 0;
    for (const d of followersSnap.docs) {
      batch.delete(db.doc(`users/${d.id}/following/${uid}`));
      inBatch += 1;
      if (inBatch >= DELETE_BATCH_SIZE) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[deleteMyAccount] follow backref cleanup failed`, e);
  }

  // 2f) Conversations the user is part of. For two-user chats we keep the
  //     conversation doc but strip the user's senderUid messages (soft
  //     delete — `deletedAt`) so the other party retains their own messages.
  //     If the other party is also gone, the conversation will be cleaned
  //     up the next time they delete their account.
  try {
    // Paginate the conversation list using a cursor — we can't rely on
    // "delete then re-query" pagination here because we don't delete the
    // conversation doc (the other participant retains the chat with our
    // messages soft-deleted). Without a cursor, a `array-contains` query
    // returns the same convs every iteration → infinite loop. We sort by
    // doc id + use startAfter() to advance through the list once.
    let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
    while (true) {
      let query = db
        .collection("conversations")
        .where("participantIds", "array-contains", uid)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(DELETE_PHASE_LIMIT);
      if (cursor) query = query.startAfter(cursor);
      const convSnap = await query.get();
      if (convSnap.empty) break;
      for (const conv of convSnap.docs) {
        // Soft-delete the user's own messages. We cap at DELETE_PHASE_LIMIT
        // messages per conv — if a single user has sent more than that in
        // one chat (~500), the tail stays untouched. Going beyond would
        // require an inner cursor too; the cost/benefit is bad here since
        // such users are rare and a follow-up sweep can mop up. Most chats
        // have ≤100 messages from any single participant.
        const msgs = await conv.ref
          .collection("messages")
          .where("senderUid", "==", uid)
          .limit(DELETE_PHASE_LIMIT)
          .get();
        if (msgs.empty) continue;
        let batch = db.batch();
        let inBatch = 0;
        for (const m of msgs.docs) {
          batch.update(m.ref, { deletedAt: FieldValue.serverTimestamp(), text: "" });
          inBatch += 1;
          if (inBatch >= DELETE_BATCH_SIZE) { await batch.commit(); batch = db.batch(); inBatch = 0; }
        }
        if (inBatch > 0) await batch.commit();
      }
      if (convSnap.size < DELETE_PHASE_LIMIT) break;
      cursor = convSnap.docs[convSnap.docs.length - 1];
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[deleteMyAccount] conversation cleanup failed`, e);
  }

  // ── Phase 3: the user's own /users/{uid} doc + all its subcollections.
  //     recursiveDelete handles every subcollection (following, followers,
  //     notifications, savedCatches, blockedUsers, settings, private, etc.)
  try {
    await db.recursiveDelete(db.doc(`users/${uid}`));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[deleteMyAccount] users/${uid} delete failed`, e);
  }

  // eslint-disable-next-line no-console
  console.log(`[deleteMyAccount] cascade complete for ${uid}`);
  return { ok: true };
});

// (Note: sharedRef validation moved inline into onNewMessage above. The
// previous standalone `validateSharedRefInMessage` trigger raced with
// onNewMessage's unread-counter bump — an invalid ref would soft-delete
// the message AFTER the counter was already incremented, leaving the
// recipient with a phantom unread. The inlined check makes both writes
// happen together or neither.)
