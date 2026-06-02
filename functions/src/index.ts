import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

// ---------------------------------------------------------------------------
// Per-callable rate limiting — Firestore-backed token bucket.
// ---------------------------------------------------------------------------
// Why this exists:
//   Cloud Function callables auth-gate the caller but don't bound how many
//   times an authenticated user can invoke them. For functions whose side
//   effects scale up storage (`getR2UploadUrl` → R2 storage), reads
//   (`getSpeciesHeatmap` on a cache miss → 2,500 publicCatches reads), or
//   compute (`deleteMyAccount` → recursive delete walk), an authenticated
//   bad actor can hammer the endpoint and rack up cost or DoS the function.
//
// Token bucket per (uid, key):
//   - One Firestore doc per limiter, at `rateLimits/{uid}_{key}`.
//   - Stores: `tokens` (current count), `refilledAt` (epoch ms of last refill).
//   - On each call: read doc, compute refill based on elapsed time, check
//     >= 1 token, decrement, write back.
//   - Two reads + one write per call. At a 60/hr limit that's negligible
//     cost vs. the protection.
//
// Trade-off: this serializes rate-limit checks through Firestore, so a
// burst of N concurrent calls from the same uid can race and let through
// up to N requests even when tokens were near depletion. Acceptable —
// we're protecting against sustained abuse, not concurrent burst.
// For hard guarantees you'd need a transaction; we deliberately skip that
// to keep the per-call overhead low.

async function checkAndConsumeRateBucket(
  uid: string,
  key: string,
  capacity: number,
  refillPerHour: number,
): Promise<void> {
  const ref = db.doc(`rateLimits/${uid}_${key}`);
  const now = Date.now();
  let snap: admin.firestore.DocumentSnapshot;
  try {
    snap = await ref.get();
  } catch (e) {
    // If we can't read the limiter doc (transient Firestore outage) we let
    // the call through. The limiter is a defense-in-depth tool — failing
    // open keeps the app working when Firestore itself is degraded; the
    // real abuse window during such an outage is brief.
    logger.warn(`[rateLimit] read failed for ${key}/${uid}`, e);
    return;
  }
  const data = snap.exists ? (snap.data() as { tokens?: number; refilledAt?: number }) : null;
  const prevTokens = typeof data?.tokens === "number" ? data.tokens : capacity;
  const prevAt = typeof data?.refilledAt === "number" ? data.refilledAt : now;
  // Refill at refillPerHour tokens/hour, capped at capacity.
  const elapsedMs = Math.max(0, now - prevAt);
  const refilled = Math.min(capacity, prevTokens + elapsedMs * refillPerHour / 3_600_000);
  if (refilled < 1) {
    // Re-stamp `refilledAt` so the next allowed call's elapsed-time math
    // is still accurate (otherwise repeated rejections compound the
    // virtual "elapsed" window and bypass the cap entirely after a long
    // pause). Set tokens to the partial refill so progress isn't lost.
    await ref.set({ tokens: refilled, refilledAt: now }, { merge: true }).catch(() => {});
    throw new HttpsError(
      "resource-exhausted",
      `Too many requests for "${key}". Wait and try again.`,
    );
  }
  await ref.set({ tokens: refilled - 1, refilledAt: now }, { merge: true });
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
  // Quiet-hours block. Both null = feature off. When set, pushes between
  // [startHour:00] and [endHour:00] in the user's local timezone are
  // silently dropped (the Firestore notification doc is still written so
  // the inbox stays accurate — just no buzz on the lock screen).
  // Stored as 24h-format integers 0-23.
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  // IANA timezone string the client picked (e.g. "Europe/Sofia"). Without
  // this, quiet hours would be evaluated in UTC and a 22:00 Sofia rule
  // would actually fire at 00:00 Sofia in winter / 01:00 in summer.
  timezone?: string;
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
    quietHoursEnabled: d.quietHoursEnabled === true,
    quietHoursStart: typeof d.quietHoursStart === "number" ? d.quietHoursStart : 22,
    quietHoursEnd: typeof d.quietHoursEnd === "number" ? d.quietHoursEnd : 7,
    timezone: typeof d.timezone === "string" ? d.timezone : "Europe/Sofia",
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
// Denormalized chat metadata cache
// ---------------------------------------------------------------------------
// `onNewMessage` historically issued 3 separate reads per message (prefs,
// muted-conv, pushToken). At 3M messages/month / 10k DAU that's 9M reads/mo
// of Firestore-paid work for a relatively low-value lookup pattern.
//
// We now mirror the relevant fields onto `conversations/{convId}.participantData[uid]`
// so the message handler reads only the conversation doc and pulls the
// recipient's prefs/token/mute state from there. Lazy backfill on cache miss
// keeps old conversations working without a migration step.

type RecipientChatMeta = {
  messagesPrefEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  muted: boolean;
  pushToken: string;
};

async function loadRecipientChatMeta(
  convId: string,
  recipientUid: string,
  participantData: Record<string, unknown> | undefined,
): Promise<RecipientChatMeta> {
  const cached = participantData?.[recipientUid] as Record<string, unknown> | undefined;
  // SECURITY: the push *delivery target* (pushToken) is owner-only data living
  // in users/{uid}/private/pushToken, and we ALWAYS read it fresh from there —
  // never from this cache. `participantData` sits on the conversation doc, which
  // is client-writable: a participant can write their own entry (the mute
  // toggle). If we trusted a token mirrored here, that participant could point
  // the CF at an arbitrary device and have a peer's message delivered to it. The
  // cache therefore serves ONLY the cheap, non-sensitive prefs/mute fields.
  // Cache-warm signal: `messagesPrefEnabled` is a boolean written exclusively by
  // the CF backfill below — the client (per firestore.rules) can only write
  // `muted`, so its presence reliably means "CF-populated".
  if (cached && typeof cached.messagesPrefEnabled === 'boolean') {
    const tokenSnap = await db.doc(`users/${recipientUid}/private/pushToken`).get();
    const tokenData = (tokenSnap.data() ?? {}) as { expoPushToken?: unknown };
    return {
      messagesPrefEnabled: cached.messagesPrefEnabled !== false,
      quietHoursEnabled: !!cached.quietHoursEnabled,
      quietHoursStart: typeof cached.quietHoursStart === 'number' ? cached.quietHoursStart : 22,
      quietHoursEnd: typeof cached.quietHoursEnd === 'number' ? cached.quietHoursEnd : 7,
      timezone: typeof cached.timezone === 'string' ? cached.timezone : 'Europe/Sofia',
      muted: !!cached.muted,
      pushToken: typeof tokenData.expoPushToken === 'string' ? tokenData.expoPushToken : '',
    };
  }

  // Cache miss — the slow path. 3 reads in parallel.
  const [prefsSnap, mutedSnap, tokenSnap] = await Promise.all([
    db.doc(`users/${recipientUid}/settings/notifications`).get(),
    db.doc(`users/${recipientUid}/mutedConversations/${convId}`).get(),
    db.doc(`users/${recipientUid}/private/pushToken`).get(),
  ]);
  const prefsData = (prefsSnap.data() ?? {}) as Partial<NotifPrefs>;
  const tokenData = (tokenSnap.data() ?? {}) as { expoPushToken?: unknown };
  const meta: RecipientChatMeta = {
    messagesPrefEnabled: prefsData.messages !== false,
    quietHoursEnabled: prefsData.quietHoursEnabled === true,
    quietHoursStart: typeof prefsData.quietHoursStart === 'number' ? prefsData.quietHoursStart : 22,
    quietHoursEnd: typeof prefsData.quietHoursEnd === 'number' ? prefsData.quietHoursEnd : 7,
    timezone: typeof prefsData.timezone === 'string' ? prefsData.timezone : 'Europe/Sofia',
    muted: mutedSnap.exists,
    pushToken: typeof tokenData.expoPushToken === 'string' ? tokenData.expoPushToken : '',
  };

  // Backfill the cache. Fire-and-forget — a failed cache write just means
  // the next call re-runs the slow path. Each backfill is one merge write
  // amortized over all future messages in the conversation.
  // SECURITY: deliberately exclude `pushToken` — it is never mirrored into the
  // client-writable conversation doc (see the cache-hit path above, which always
  // reads it fresh from the owner-only private/pushToken). Caching only the
  // prefs/mute fields keeps the delivery target out of reach of a participant
  // who can write their own participantData entry.
  void db.doc(`conversations/${convId}`).set(
    {
      participantData: {
        [recipientUid]: {
          messagesPrefEnabled: meta.messagesPrefEnabled,
          quietHoursEnabled: meta.quietHoursEnabled,
          quietHoursStart: meta.quietHoursStart,
          quietHoursEnd: meta.quietHoursEnd,
          timezone: meta.timezone,
          muted: meta.muted,
        },
      },
    },
    { merge: true },
  ).catch((e) => logger.warn(`[loadRecipientChatMeta] backfill failed for ${convId}/${recipientUid}`, e));

  return meta;
}

/** True when the current wall-clock time in the user's timezone falls
    inside their quiet-hours window. Handles the cross-midnight case
    (e.g. 22→07) — the natural one for sleep — by checking either
    side. Accepts the subset of fields actually needed so callers can
    feed either a full `NotifPrefs` or a denormalized `RecipientChatMeta`. */
function isQuietHoursActive(
  args: { quietHoursEnabled: boolean; quietHoursStart?: number; quietHoursEnd?: number; timezone?: string },
): boolean {
  if (!args.quietHoursEnabled) return false;
  const start = args.quietHoursStart;
  const end = args.quietHoursEnd;
  if (typeof start !== 'number' || typeof end !== 'number') return false;
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: args.timezone || 'Europe/Sofia',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
    10,
  );
  if (!Number.isFinite(hour)) return false;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** True when the current wall-clock time in the user's timezone falls
    inside their quiet-hours window. Kept for the `onNotificationCreated`
    caller that still passes a full NotifPrefs. */
function isInQuietHours(prefs: NotifPrefs): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const start = prefs.quietHoursStart;
  const end = prefs.quietHoursEnd;
  if (typeof start !== "number" || typeof end !== "number") return false;
  // Get the current hour in the user's local timezone. Intl is available
  // in the Node 20 runtime functions ship on.
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timezone || "Europe/Sofia",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    10,
  );
  if (!Number.isFinite(hour)) return false;
  if (start === end) return false; // empty window
  // Same-day window (e.g. 13→18). Cross-midnight window (e.g. 22→7) wraps.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// ---------------------------------------------------------------------------
// onNotificationCreated — sends Expo push notifications
// ---------------------------------------------------------------------------

export const onNotificationCreated = onDocumentCreated(
  { document: "users/{userId}/notifications/{notifId}", maxInstances: 50 },
  async (event) => {
    const { userId } = event.params;
    const data = event.data?.data() as Record<string, unknown> | undefined;
    if (!data) return;

    const type = data.type as string | undefined;

    // Skip the "message" type — those are written by onNewMessage which already
    // handles its own push. Avoids a double-push if this function ever fires for
    // a message-type notification doc.
    if (type === "message") return;

    // Idempotency claim — same shape as onNewMessage. onDocumentCreated has
    // at-least-once delivery, so a duplicate fire would re-send the Expo push
    // and the recipient would see TWO buzzes for one like/comment/etc. The
    // claim transaction reads + writes the notif doc atomically: a concurrent
    // retry sees _fnProcessed=true and bails before reaching sendExpoPush.
    // Admin SDK bypasses Firestore rules, and the recipient's "mark as read"
    // path uses affectedKeys.hasOnly(['read']) so adding _fnProcessed to the
    // doc doesn't interfere with any client write.
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(event.data!.ref);
      if (!snap.exists) return false;
      if ((snap.data() as Record<string, unknown>)?._fnProcessed) return false;
      tx.update(event.data!.ref, { _fnProcessed: true });
      return true;
    });
    if (!claimed) return;

    // Honor the recipient's notification preferences.
    const prefs = await getNotifPrefs(userId);
    if (!shouldNotify(type, prefs)) return;
    // Quiet hours — silently drop the push if the recipient is in their
    // configured do-not-disturb window. The Firestore notification doc
    // was already written by the originating action, so the inbox stays
    // accurate; we just don't buzz the lock screen.
    if (isInQuietHours(prefs)) return;
    // Per-actor mute. If the recipient has explicitly muted this actor
    // (long-press → "Mute" on a row in their Notifications inbox), drop
    // the push silently. Same shape as quiet hours: the Firestore notif
    // doc still writes so the inbox isn't lying about activity volume —
    // we just don't surface to the OS. Self-actions are already filtered
    // by every notifyX helper, so a missing actorUid here is a malformed
    // call and we skip the check entirely.
    const actorUid = typeof data.actorUid === "string" ? data.actorUid : "";
    if (actorUid) {
      const muteSnap = await db.doc(`users/${userId}/mutedActors/${actorUid}`).get();
      if (muteSnap.exists) return;
    }

    // Fetch the recipient's push token
    const tokenSnap = await db.doc(`users/${userId}/private/pushToken`).get();
    const token: string = tokenSnap.data()?.expoPushToken ?? "";
    if (!token || !token.startsWith("ExponentPushToken[")) return;

    const actorName = (data.actorName ?? "Рибар") as string;
    // Reaction emoji (when present) is more informative than "хареса" — pass
    // it through to the body so the lock-screen preview reflects the actual
    // reaction the user picked.
    const reactionEmoji = typeof data.reactionEmoji === "string" ? data.reactionEmoji : "";
    const preview = typeof data.preview === "string" ? data.preview : "";

    let title = "Ribolov";
    let body = "Имаш ново известие.";

    switch (type) {
      case "like":
        title = "Ново харесване";
        body = reactionEmoji
          ? `${actorName} реагира с ${reactionEmoji} на твой улов.`
          : `${actorName} хареса твой улов.`;
        break;
      case "comment":
        title = "Нов коментар";
        body = preview
          ? `${actorName}: ${preview.slice(0, 80)}`
          : `${actorName} коментира твой улов.`;
        break;
      case "follow":
        title = "Нов последовател";
        body = `${actorName} те последва.`;
        break;
      case "storyLike":
        title = "Реакция на история";
        body = reactionEmoji
          ? `${actorName} реагира с ${reactionEmoji} на твоята история.`
          : `${actorName} реагира на твоята история.`;
        break;
      case "storyComment":
        title = "Коментар на история";
        body = preview
          ? `${actorName}: ${preview.slice(0, 80)}`
          : `${actorName} коментира твоята история.`;
        break;
      case "mention":
        title = "Спомена те";
        body = `${actorName} те спомена в публикация.`;
        break;
      case "reshare":
        title = "Споделено";
        body = `${actorName} сподели твоята публикация.`;
        break;
      case "personalBest":
        title = "Личен рекорд!";
        body = preview
          ? `${actorName}: ${preview.slice(0, 80)}`
          : `${actorName} счупи личен рекорд.`;
        break;
    }

    await sendExpoPush(token, title, body, {
      type,
      notifId: event.params.notifId,
      // Carry catchId/postId/storyId/actorUid so the tap handler can
      // deep-link to the right target. postId was missing before — taps on
      // reshare/comment-on-post notifications had nowhere to land.
      catchId: typeof data.catchId === "string" ? data.catchId : "",
      postId: typeof data.postId === "string" ? data.postId : "",
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
  { document: "conversations/{convId}/messages/{msgId}", maxInstances: 50 },
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
        logger.warn(`[onNewMessage] sharedRef check failed`, e);
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
          logger.warn(`[onNewMessage] sharedRef soft-delete failed`, e);
        }
        return;
      }
    }

    // Single denormalized lookup replaces the previous 3 separate reads
    // (prefs, mutedConversations, pushToken). On cache miss the helper
    // falls back to those reads + writes the result back to participantData
    // for future calls. Net cost per message after warmup: 1 conversation
    // read instead of 4 reads — see the helper for details.
    const meta = await loadRecipientChatMeta(
      convId,
      recipientUid,
      convData.participantData as Record<string, unknown> | undefined,
    );
    if (!meta.messagesPrefEnabled) return;

    // Muted-conversation check. When the recipient has muted this specific
    // conv we suppress BOTH the in-app notification doc and the Expo push,
    // but still bump the unread aggregate so toggling unmute later + opening
    // the chat decrements correctly. The client-side bell-badge subscriber
    // already filters muted convs out of the visible count.
    const isMuted = meta.muted;

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

    // ATOMIC idempotency claim. onDocumentCreated has at-least-once delivery,
    // so a duplicate fire could re-send the push below. Claiming `_fnProcessed`
    // inside a transaction means a concurrent retry reads the flag in the same
    // transaction and bails, so the push fires at most once.
    //
    // This used to also bump a per-recipient `users/{uid}.unreadMessageCount`
    // aggregate, but nothing reads it: the unread badge sums the per-conversation
    // `unreadCounts` map (which is mute-aware), and that map is written by the
    // client's sendConversationMessage batch — the single source of truth. The
    // aggregate only ever drifted (negative once markConversationRead decremented
    // an amount the CF may never have incremented if it wasn't deployed), so it
    // was removed along with its client-side increment/decrement.
    const claimed = await db.runTransaction(async (tx) => {
      const msgSnap = await tx.get(event.data!.ref);
      if (!msgSnap.exists) return false;
      if ((msgSnap.data() as Record<string, unknown>)?._fnProcessed) return false;
      tx.update(event.data!.ref, { _fnProcessed: true });
      return true;
    });
    if (!claimed) return;

    // Push is also gated on mute — the OS notification is the noisiest part
    // of "muted means muted".
    if (isMuted) return;
    // Quiet hours — same treatment as onNotificationCreated. The message
    // is still claimed + unreadMessageCount bumped above, so the recipient
    // sees it the moment they open the app; we just don't buzz the lock
    // screen during their DND window. We use the meta we already loaded
    // (cached or fresh) — no second prefs read.
    if (isQuietHoursActive(meta)) return;
    if (!meta.pushToken || !meta.pushToken.startsWith("ExponentPushToken[")) return;

    await sendExpoPush(meta.pushToken, senderName, body, {
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

// PARALLEL-RUN: the legacy aggregator is kept temporarily as a safety net
// while the new trigger-based rollup system (`onPublicCatchForRollup` +
// `consolidateLeaderboards` + `weeklyLeaderboardDriftFix` below) proves
// itself. Cadence dropped from every-10-min to once-daily — still validates
// the new system's output against a full-scan recompute, but at ~1/144 the
// read cost during the overlap. Remove after 7 days of confirmed agreement.
export const aggregateLeaderboards = onSchedule(
  { schedule: "every 24 hours", maxInstances: 1 },
  async () => {
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
// Trigger-based leaderboard rollups (replaces the full-scan aggregator).
// ---------------------------------------------------------------------------
// Why this exists:
//   The old `aggregateLeaderboards` above does a full collection scan of
//   `publicCatches` every 10 minutes, for each of 4 periods. At 10k DAU
//   with a year of accumulated catches that's ~76M reads/day = ~$1,300/mo
//   just from this one function. The pattern below replaces that with:
//
//     - per-public-catch-write trigger that increments a per-user, per-
//       bucket rollup doc (4 small writes per catch write, no reads),
//     - a much smaller consolidator that reads top-N rollup docs per
//       current bucket and writes the existing `leaderboardCache/global_*`
//       doc the client already consumes (no client changes),
//     - a once-a-week drift correction that rebuilds rollups from the
//       source `publicCatches` data to catch any missed trigger writes
//       (Firestore triggers are at-least-once but not at-most-once, and
//       network errors during the trigger can drop writes — drift sweeps
//       reconcile those).
//
// Bucket keys are deterministic ISO strings — day_YYYY-MM-DD, week_YYYY-Www,
// month_YYYY-MM, year_YYYY. Doc IDs use composite `${bucket}_${ownerUid}` so
// writes are idempotent under at-least-once delivery: re-running the same
// trigger event lands on the same doc and `FieldValue.increment(0)` is a
// no-op for the totals (catchCount may double-count on duplicate delivery,
// but the weekly drift fix corrects it).

// `bestKg` is intentionally NOT maintained by the trigger. Doing so requires
// a read-then-write transaction per write (4× extra reads) AND a separate
// recompute on every delete to handle the case where the deleted catch was
// the biggest. We leave bestKg stale-but-bounded: the weekly drift fix
// recomputes it correctly from publicCatches. The leaderboard sorts by
// totalKg anyway — bestKg is a sort-tiebreak / display value only.

function dayBucketKey(d: Date): string {
  return `day_${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isoWeekBucketKey(d: Date): string {
  // ISO-8601 week: weeks start Monday, week 1 contains the first Thursday
  // of the year. Reused for both bucket keying and consistency with the
  // periodMinIso() above (which also treats Monday as week start).
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThu.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `week_${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthBucketKey(d: Date): string {
  return `month_${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yearBucketKey(d: Date): string {
  return `year_${d.getUTCFullYear()}`;
}

function bucketsForDate(date: Date): Array<{ period: Period; bucket: string }> {
  return [
    { period: "day", bucket: dayBucketKey(date) },
    { period: "week", bucket: isoWeekBucketKey(date) },
    { period: "month", bucket: monthBucketKey(date) },
    { period: "year", bucket: yearBucketKey(date) },
  ];
}

// TTL durations per bucket period. Day buckets become irrelevant the moment
// the day rolls over; we keep them ~5 weeks just to allow late drift fixes
// to inspect them. Week ~2mo, month ~13mo, year never (year buckets need
// to live for at least a year to be queryable as "current year").
const TTL_DAYS: Record<Period, number | null> = {
  day: 35,
  week: 60,
  month: 400,
  year: null,
};

function ttlForBucket(period: Period, date: Date): Timestamp | null {
  const days = TTL_DAYS[period];
  if (days == null) return null;
  const t = new Date(date);
  t.setUTCDate(t.getUTCDate() + days);
  return Timestamp.fromDate(t);
}

function rollupDocId(bucket: string, ownerUid: string): string {
  return `${bucket}_${ownerUid}`;
}

// onPublicCatchForRollup ------------------------------------------------------
// Fires on every create/update/delete of `publicCatches/{id}`. Computes the
// "before" and "after" bucket sets and writes the delta to each affected
// rollup doc. For an unchanged-date update, the bucket set is the same and
// we just shift totalKg by (afterKg - beforeKg). For a date change, we
// decrement old buckets and increment new ones in a single batch.
export const onPublicCatchForRollup = onDocumentWritten(
  { document: "publicCatches/{catchId}", maxInstances: 20 },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    // Snapshot helpers — coerce to safe primitives, guarding against
    // partial / malformed source docs (a Firestore write can leave fields
    // undefined; we don't want NaN propagating into rollups).
    const beforeUid = typeof before?.ownerUid === "string" ? before.ownerUid : "";
    const afterUid = typeof after?.ownerUid === "string" ? after.ownerUid : "";
    const beforeKg = typeof before?.weightKg === "number" && Number.isFinite(before.weightKg) ? (before.weightKg as number) : 0;
    const afterKg = typeof after?.weightKg === "number" && Number.isFinite(after.weightKg) ? (after.weightKg as number) : 0;
    const beforeDateStr = typeof before?.date === "string" ? before.date : "";
    const afterDateStr = typeof after?.date === "string" ? after.date : "";
    const ownerName = (typeof after?.ownerName === "string" && after.ownerName)
      || (typeof before?.ownerName === "string" && before.ownerName)
      || "Рибар";

    const beforeDate = beforeDateStr ? new Date(beforeDateStr) : null;
    const afterDate = afterDateStr ? new Date(afterDateStr) : null;
    // Reject invalid dates — a NaN-valued Date would silently produce
    // nonsense bucket keys like `day_NaN-NaN-NaN` and pollute the
    // collection. Better to log and bail.
    if (beforeDate && isNaN(beforeDate.getTime())) {
      logger.warn(`[onPublicCatchForRollup] invalid before.date: ${beforeDateStr}`);
      return;
    }
    if (afterDate && isNaN(afterDate.getTime())) {
      logger.warn(`[onPublicCatchForRollup] invalid after.date: ${afterDateStr}`);
      return;
    }

    // Compute per-rollup-doc deltas. Same uid for the same catch is the
    // only sensible interpretation — if ownerUid changed mid-edit (which
    // shouldn't happen), treat it as a delete from the old uid and a
    // create for the new uid.
    type Delta = {
      bucket: string;
      period: Period;
      ownerUid: string;
      deltaKg: number;
      deltaCount: number;
      // Carry through enough doc metadata to bootstrap a new rollup doc
      // when this is the first write to it.
      ttlAt: Timestamp | null;
    };
    const deltas: Delta[] = [];

    if (beforeDate && beforeUid) {
      for (const { period, bucket } of bucketsForDate(beforeDate)) {
        deltas.push({
          bucket, period, ownerUid: beforeUid,
          deltaKg: -beforeKg, deltaCount: -1,
          ttlAt: ttlForBucket(period, beforeDate),
        });
      }
    }
    if (afterDate && afterUid) {
      for (const { period, bucket } of bucketsForDate(afterDate)) {
        deltas.push({
          bucket, period, ownerUid: afterUid,
          deltaKg: afterKg, deltaCount: 1,
          ttlAt: ttlForBucket(period, afterDate),
        });
      }
    }

    if (deltas.length === 0) return;

    // Coalesce by doc ID — if a doc edit kept the same bucket but changed
    // weight, we get a -beforeKg and +afterKg delta for the SAME rollup
    // doc, which should net to (afterKg - beforeKg). Without coalescing
    // we'd issue two separate increments (correct, but doubles the write
    // count for what should be a single op).
    const byDoc = new Map<string, Delta>();
    for (const d of deltas) {
      const id = rollupDocId(d.bucket, d.ownerUid);
      const existing = byDoc.get(id);
      if (existing) {
        existing.deltaKg += d.deltaKg;
        existing.deltaCount += d.deltaCount;
      } else {
        byDoc.set(id, { ...d });
      }
    }

    // Idempotency via per-event dedup doc + atomic transaction. onDocumentWritten
    // has at-least-once delivery, and the function emits FieldValue.increment
    // deltas — a duplicate fire would re-issue +/-N kg and inflate (or sink)
    // the leaderboard totals. event.id is stable across retries of the same
    // logical event, so we can use it as the dedup key. weeklyLeaderboardDriftFix
    // still runs as a safety net, but with this guard in place it should rarely
    // find drift to correct.
    //
    // The claim AND the rollup writes happen inside one transaction so we
    // never end up "claimed but not written": if the writes fail, the claim
    // doesn't commit, and the retry sees no prior claim and processes cleanly.
    // 4 rollup writes max (one per period bucket) + 1 dedup doc = 5 ops, well
    // under the 500-write transaction limit.
    //
    // ttlAt on the dedup doc lets the rollupEvents collection self-clean via
    // Firestore native TTL (configure rollupEvents.ttlAt as a TTL field in the
    // GCP console). 7 days is generous — Firebase retries usually happen
    // within seconds, never days.
    const dedupRef = db.doc(`rollupEvents/${event.id}`);
    try {
      await db.runTransaction(async (tx) => {
        const dedupSnap = await tx.get(dedupRef);
        if (dedupSnap.exists) {
          // Duplicate delivery — already processed. Skip silently.
          return;
        }
        tx.set(dedupRef, {
          processedAt: FieldValue.serverTimestamp(),
          catchId: event.params.catchId,
          ttlAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        for (const [docId, d] of byDoc.entries()) {
          // Skip pure-zero deltas (can happen if beforeKg == afterKg AND the
          // same bucket appears on both sides — e.g. a non-substantive edit
          // touching neither weight nor date). A zero-delta merge would still
          // count as a billable write; skipping saves a few % of writes on
          // bulk edits.
          if (d.deltaKg === 0 && d.deltaCount === 0) continue;
          const ref = db.collection("leaderboardRollup").doc(docId);
          const payload: Record<string, unknown> = {
            bucket: d.bucket,
            period: d.period,
            ownerUid: d.ownerUid,
            ownerName,
            totalKg: FieldValue.increment(d.deltaKg),
            catchCount: FieldValue.increment(d.deltaCount),
          };
          if (d.ttlAt) payload.ttlAt = d.ttlAt;
          tx.set(ref, payload, { merge: true });
        }
      });
    } catch (e) {
      // A transaction throw means neither the dedup claim nor the rollup
      // writes landed — Firebase will retry the event automatically, and the
      // next invocation will see no prior claim and try again. Log so any
      // persistent failure surfaces; don't rethrow because that triggers
      // exponential-backoff retries on top of the at-least-once retries we
      // already handle.
      logger.warn(`[onPublicCatchForRollup] tx failed for event ${event.id}`, e);
    }
  },
);

// consolidateLeaderboards -----------------------------------------------------
// Reads top-N rollup docs for each current bucket and writes them to the
// existing `leaderboardCache/global_{period}` doc that the client already
// consumes. Cadence is every 10 min (matches the legacy aggregator) but
// the cost shape is radically different — ~200 reads × 4 periods per run.
//
// Top-200 is chosen so the client's leaderboard UI (which shows top ~50
// + the user's own rank) has comfortable headroom. If a leaderboard ever
// needs to show >200 ranks the client falls back to direct rollup queries
// or live aggregation — same as it does today when the cache doc is empty.

const LEADERBOARD_TOP_N = 200;

export const consolidateLeaderboards = onSchedule(
  { schedule: "every 10 minutes", maxInstances: 1 },
  async () => {
  const now = new Date();
  const periods: Period[] = ["day", "week", "month", "year"];

  for (const period of periods) {
    const currentBucket =
      period === "day" ? dayBucketKey(now)
        : period === "week" ? isoWeekBucketKey(now)
          : period === "month" ? monthBucketKey(now)
            : yearBucketKey(now);

    const snap = await db
      .collection("leaderboardRollup")
      .where("bucket", "==", currentBucket)
      .orderBy("totalKg", "desc")
      .limit(LEADERBOARD_TOP_N)
      .get();

    const rows: LeaderboardRow[] = snap.docs.map((d, i) => {
      const data = d.data();
      const totalKg = typeof data.totalKg === "number" && Number.isFinite(data.totalKg) ? data.totalKg : 0;
      const catchCount = typeof data.catchCount === "number" && Number.isFinite(data.catchCount) ? data.catchCount : 0;
      const bestKg = typeof data.bestKg === "number" && Number.isFinite(data.bestKg) ? data.bestKg : 0;
      return {
        rank: i + 1,
        ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : "",
        ownerName: typeof data.ownerName === "string" ? data.ownerName : "Рибар",
        totalKg,
        catchCount,
        bestKg,
      };
    }).filter((r) => r.ownerUid && r.totalKg > 0);
    // Filter zero-or-negative totals — a user who reshared then deleted
    // their catches lands at totalKg=0 from the increment math, but should
    // not appear on the board.

    await db.collection("leaderboardCache").doc(`global_${period}`).set({
      rows,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
});

// weeklyLeaderboardDriftFix ---------------------------------------------------
// Runs once a week to reconcile rollup state with the source-of-truth
// publicCatches collection. Catches three classes of drift:
//   1) Trigger writes lost to network errors or function timeouts.
//   2) `bestKg` staleness from deletes (which the trigger intentionally
//      ignores — see comment at the top of this block).
//   3) `ownerName` updates (a user renaming themselves doesn't fan out a
//      backfill — drift picks it up).
//
// Cost: one full scan of publicCatches per period per run. Same magnitude
// as a single run of the old aggregator — but only once a week instead of
// 144 times a day, so ~99.3% cheaper. At 10k DAU this is roughly $5/month.

export const weeklyLeaderboardDriftFix = onSchedule(
  { schedule: "0 3 * * 0", timeZone: "Europe/Sofia", maxInstances: 1 },
  async () => {
    const now = new Date();
    const periods: Period[] = ["day", "week", "month", "year"];

    for (const period of periods) {
      const minIso = periodMinIso(period);
      const currentBucket =
        period === "day" ? dayBucketKey(now)
          : period === "week" ? isoWeekBucketKey(now)
            : period === "month" ? monthBucketKey(now)
              : yearBucketKey(now);

      const snapshot = await db
        .collection("publicCatches")
        .where("date", ">=", minIso)
        .get();

      // Aggregate from source. Same shape as the old aggregator's inner
      // loop — minus the sort, since we write per-user rollups rather
      // than a ranked rows array.
      type Agg = { ownerName: string; totalKg: number; catchCount: number; bestKg: number };
      const map = new Map<string, Agg>();
      for (const doc of snapshot.docs) {
        const d = doc.data();
        const uid: string = d.ownerUid ?? "";
        if (!uid) continue;
        const kg: number = typeof d.weightKg === "number" && Number.isFinite(d.weightKg) ? d.weightKg : 0;
        const name: string = typeof d.ownerName === "string" ? d.ownerName : "Рибар";
        const existing = map.get(uid);
        if (existing) {
          existing.totalKg += kg;
          existing.catchCount += 1;
          if (kg > existing.bestKg) existing.bestKg = kg;
          // Keep the most recent name we saw (publicCatches docs aren't
          // guaranteed ordered, but the difference between any two recent
          // copies of a user's name is negligible).
          existing.ownerName = name || existing.ownerName;
        } else {
          map.set(uid, { ownerName: name, totalKg: kg, catchCount: 1, bestKg: kg });
        }
      }

      // Write each authoritative rollup. We use `set` (not merge) for the
      // numeric fields so any drift in the existing doc is corrected
      // outright. ttlAt is preserved if the bucket has one.
      const ttlAt = period === "year" ? null : ttlForBucket(period, now);

      // Chunk writes — Firestore batches cap at 500 ops. Most weekly fixes
      // will be well under this, but the year-bucket recompute on a large
      // user base could exceed it.
      const entries = Array.from(map.entries());
      for (let i = 0; i < entries.length; i += 400) {
        const batch = db.batch();
        for (const [uid, agg] of entries.slice(i, i + 400)) {
          const ref = db.collection("leaderboardRollup").doc(rollupDocId(currentBucket, uid));
          const payload: Record<string, unknown> = {
            bucket: currentBucket,
            period,
            ownerUid: uid,
            ownerName: agg.ownerName,
            totalKg: agg.totalKg,
            catchCount: agg.catchCount,
            bestKg: agg.bestKg,
          };
          if (ttlAt) payload.ttlAt = ttlAt;
          batch.set(ref, payload, { merge: true });
        }
        await batch.commit();
      }

      logger.info(`[weeklyLeaderboardDriftFix] period=${period} bucket=${currentBucket} users=${map.size}`);
    }
  },
);

// consolidateClassicsCache --------------------------------------------------
// Maintains `classicsCache/week` and `classicsCache/month` — pre-ranked
// top-50 photos by likeCount within each period. Replaces the previous
// client-side pattern where each HomeScreen / ClassicsScreen open ran a
// `where('date' >= periodStart) orderBy('date' desc) limit(N)` against
// publicCatches and sorted by likeCount client-side, reading 60–420 docs
// per session.
//
// Cost shape: this function reads top 100 per period × 2 periods × hourly =
// ~5k reads/day = pennies. The client reads exactly one doc per open
// (`classicsCache/{period}`).
//
// Composite index required: (date asc, likeCount desc) on publicCatches —
// added in firestore.indexes.json. Without the index the function throws
// a one-time setup error on first run that includes the create-index link.

function startOfIsoWeekUtc(now: Date): Date {
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset, 0, 0, 0, 0));
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

const CLASSICS_TOP_N = 50;
const CLASSICS_CANDIDATE_SCAN = 100;

export const consolidateClassicsCache = onSchedule(
  { schedule: "every 60 minutes", maxInstances: 1 },
  async () => {
  const now = new Date();
  const periods: Array<{ key: "week" | "month"; sinceIso: string }> = [
    { key: "week", sinceIso: startOfIsoWeekUtc(now).toISOString() },
    { key: "month", sinceIso: startOfMonthUtc(now).toISOString() },
  ];

  for (const { key, sinceIso } of periods) {
    // Pull top-CANDIDATE by likeCount within the period. We over-fetch a
    // bit because we still need to filter to docs that actually have a
    // photoUri (Firestore can't combine the date range, the likeCount
    // sort, and a "photoUri non-empty" filter into one query without
    // multiple composite indexes — easier to filter in code).
    // Single orderBy(likeCount, desc) plus the date range gives Firestore a
    // single composite index to satisfy: (date asc, likeCount desc). We
    // re-sort in code anyway, so adding orderBy(date) here would just cost
    // an extra index for no shipping behavior change.
    const snap = await db
      .collection("publicCatches")
      .where("date", ">=", sinceIso)
      .orderBy("date", "asc")
      .orderBy("likeCount", "desc")
      .limit(CLASSICS_CANDIDATE_SCAN)
      .get();

    // ClassicEntry mirrors the subset of CloudCatch fields the client needs
    // to render the leaderboard rows + podium. Using `id` (not `catchId`) so
    // the entry slots directly into a FeedItem shape on the client.
    type ClassicEntry = {
      id: string;
      ownerUid: string;
      ownerName: string;
      photoUri: string;
      photoTitle: string | null;
      likeCount: number;
      date: string;
      speciesName: string;
      weightKg: number | null;
    };
    const entries: ClassicEntry[] = [];
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const photoUri = typeof d.photoUri === "string" ? d.photoUri.trim() : "";
      if (!photoUri) continue;
      const likeCount = typeof d.likeCount === "number" && Number.isFinite(d.likeCount) ? d.likeCount : 0;
      entries.push({
        id: doc.id,
        ownerUid: typeof d.ownerUid === "string" ? d.ownerUid : "",
        ownerName: typeof d.ownerName === "string" ? d.ownerName : "Рибар",
        photoUri,
        photoTitle: typeof d.photoTitle === "string" ? d.photoTitle : null,
        likeCount,
        date: typeof d.date === "string" ? d.date : "",
        speciesName: typeof d.speciesName === "string" ? d.speciesName : "",
        weightKg: typeof d.weightKg === "number" && Number.isFinite(d.weightKg) ? d.weightKg : null,
      });
    }

    // Final ranking: by likeCount desc, tiebreak by date desc (newer wins).
    entries.sort((a, b) => {
      if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount;
      return Date.parse(b.date) - Date.parse(a.date);
    });

    const items = entries.slice(0, CLASSICS_TOP_N);

    await db.collection("classicsCache").doc(key).set({
      items,
      sinceIso,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[consolidateClassicsCache] period=${key} candidates=${snap.size} ranked=${items.length}`);
  }
});

// backfillLeaderboardRollup ---------------------------------------------------
// One-time callable used to populate the rollup collection from existing
// publicCatches data after deploying the new system. Without this, the
// rollup collection starts empty and the consolidator writes empty
// leaderboardCache docs until users start logging new catches.
//
// Safety: gated to the App's owner uid via a hardcoded admin list. Reading
// every publicCatches doc is expensive; we don't want a random client
// invoking this. After successful one-time use, this function can be
// removed in a subsequent deploy.

const BACKFILL_ADMIN_UIDS: string[] = [
  // Add your own uid(s) here before deploying.
];

export const backfillLeaderboardRollup = onCall(
  { maxInstances: 2 },
  async (request) => {
  const uid = request.auth?.uid;
  if (!uid || !BACKFILL_ADMIN_UIDS.includes(uid)) {
    throw new HttpsError("permission-denied", "Admin-only.");
  }
  // Rate limit: 2/hour. Backfill is a one-time op; the cap stops an
  // accidental rapid retry from re-scanning publicCatches multiple times
  // in succession (each run reads every public catch in the period).
  await checkAndConsumeRateBucket(uid, "backfillLeaderboardRollup", 2, 2);

  const periods: Period[] = ["day", "week", "month", "year"];
  let totalProcessed = 0;
  let totalRollupsWritten = 0;

  for (const period of periods) {
    const minIso = periodMinIso(period);
    const snap = await db
      .collection("publicCatches")
      .where("date", ">=", minIso)
      .get();

    type Agg = { ownerName: string; totalKg: number; catchCount: number; bestKg: number };
    const map = new Map<string, Agg>();
    for (const doc of snap.docs) {
      const d = doc.data();
      const cuid: string = d.ownerUid ?? "";
      if (!cuid) continue;
      const kg: number = typeof d.weightKg === "number" && Number.isFinite(d.weightKg) ? d.weightKg : 0;
      const name: string = typeof d.ownerName === "string" ? d.ownerName : "Рибар";
      const ex = map.get(cuid);
      if (ex) {
        ex.totalKg += kg;
        ex.catchCount += 1;
        if (kg > ex.bestKg) ex.bestKg = kg;
        ex.ownerName = name || ex.ownerName;
      } else {
        map.set(cuid, { ownerName: name, totalKg: kg, catchCount: 1, bestKg: kg });
      }
    }
    totalProcessed += snap.size;

    const now = new Date();
    const currentBucket =
      period === "day" ? dayBucketKey(now)
        : period === "week" ? isoWeekBucketKey(now)
          : period === "month" ? monthBucketKey(now)
            : yearBucketKey(now);
    const ttlAt = period === "year" ? null : ttlForBucket(period, now);

    const entries = Array.from(map.entries());
    for (let i = 0; i < entries.length; i += 400) {
      const batch = db.batch();
      for (const [cuid, agg] of entries.slice(i, i + 400)) {
        const ref = db.collection("leaderboardRollup").doc(rollupDocId(currentBucket, cuid));
        const payload: Record<string, unknown> = {
          bucket: currentBucket,
          period,
          ownerUid: cuid,
          ownerName: agg.ownerName,
          totalKg: agg.totalKg,
          catchCount: agg.catchCount,
          bestKg: agg.bestKg,
        };
        if (ttlAt) payload.ttlAt = ttlAt;
        batch.set(ref, payload, { merge: true });
        totalRollupsWritten++;
      }
      await batch.commit();
    }
  }

  return {
    ok: true,
    catchesProcessed: totalProcessed,
    rollupsWritten: totalRollupsWritten,
  };
});

// ---------------------------------------------------------------------------
// Ephemeral-doc TTL stamping — see Firestore native TTL block lower down.
// ---------------------------------------------------------------------------
// The previous design ran four scheduled functions (`cleanupExpiredStories`,
// `cleanupExpiredLivePins`, `cleanupExpiredWaterReports`,
// `cleanupOldNotifications`) every 30min–24h. Each invocation cost reads to
// find expired docs + writes to delete them, plus the function exec time.
// At any non-trivial scale those sweeps dominated Firestore ops cost.
//
// Replaced by Firestore-native TTL: a server-stamped `ttlAt` Timestamp on
// each ephemeral doc, and a TTL policy (set in the GCP Console) that deletes
// the doc within ~24h of `ttlAt` passing. Cost: zero reads, zero writes,
// zero function executions per cleanup. The stamping itself is one tiny
// patch write per doc, done in an `onDocumentCreated` trigger so it can't
// be tampered with from the client.
//
// Notifications are special: we only delete READ notifications older than
// 30 days. Unread notifs must persist forever. So `ttlAt` is stamped on the
// transition to read=true, not at create time — unread docs simply have no
// `ttlAt`, which means TTL ignores them.

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
  { schedule: "every day 09:00", timeZone: "Europe/Sofia", maxInstances: 1 },
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
      logger.info(`[tournamentEndingSoonReminder] no tournaments ending on ${tomorrowIso}`);
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
        logger.info(`[tournamentEndingSoonReminder] ${tournamentId} already reminded — skip`);
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
        logger.warn(`[tournamentEndingSoonReminder] ${tournamentId} hit participant cap of ${PARTICIPANT_LIMIT}`);
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
          // Quiet hours — same treatment as the per-doc fanout. The reminder
          // is scheduled daily at 09:00 Sofia, so quiet-hours conflicts are
          // unusual but cheap to check; better to be consistent than to have
          // one notification type bypass DND.
          if (isInQuietHours(prefs)) continue;
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
          logger.warn(`[tournamentEndingSoonReminder] ${tournamentId}/${uid} failed`, e);
        }
      }

      await markerRef.set({
        sentAt: FieldValue.serverTimestamp(),
        recipients: sent,
      });
      totalSent += sent;
    }

    logger.info(`[tournamentEndingSoonReminder] sent ${totalSent} pushes across ${tournamentsSnap.size} tournaments`);
  },
);

// `cleanupOldNotifications` replaced by Firestore-native TTL — see the
// `stampNotificationTtl` trigger at the bottom of this file.

// ---------------------------------------------------------------------------
// weeklyGreatFishingDayAlert — Sundays at 18:00 Europe/Sofia
// ---------------------------------------------------------------------------
// Once a week, check tomorrow's forecast at a Bulgaria-central reference point
// (Sofia). If the bite rating for tomorrow is >= 4, push every user with a
// valid Expo token: "Утре изглежда отличен за риболов". Otherwise silently
// skip. The push is generic (not per-user-personalised) because per-user
// fan-out at 10k DAU would burn through Open-Meteo's free tier of 10k
// calls/day on the first invocation.
//
// Why Sunday evening: weekend trip planning is when this matters. A
// Wednesday push about Thursday's weather rarely converts; Sunday's push
// about Monday morning has higher intent.
//
// Per-user personalisation followup: when we have favorite-water data
// densely populated (currently sparse), group user spots into ~50 km cells,
// fetch forecast per cell once, and send personalised pushes. Until then
// the global signal is the right cost/benefit.

export const weeklyGreatFishingDayAlert = onSchedule(
  { schedule: "every sunday 18:00", timeZone: "Europe/Sofia", maxInstances: 1 },
  async () => {
    // Sofia coords — Bulgaria's geographic center is close to Sofia for
    // weather-pattern purposes.
    const lat = 42.6977;
    const lng = 23.3219;
    // We need tomorrow's forecast, so request a 1-day forecast and read
    // index [0] (the soonest available day). Open-Meteo's free endpoint
    // tolerates this without auth.
    let rating = 0;
    let weatherCode = 0;
    let temp = 0;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,wind_speed_10m_max,precipitation_probability_max&timezone=Europe/Sofia&forecast_days=2`;
      const res = await fetch(url);
      const json = await res.json() as {
        daily: {
          weather_code: number[];
          temperature_2m_max: number[];
          wind_speed_10m_max: number[];
          precipitation_probability_max: number[];
        };
      };
      // Index 1 = tomorrow (0 is today).
      const idx = 1;
      weatherCode = json.daily.weather_code[idx] ?? 0;
      temp = json.daily.temperature_2m_max[idx] ?? 15;
      const wind = json.daily.wind_speed_10m_max[idx] ?? 0;
      const precip = json.daily.precipitation_probability_max[idx] ?? 0;
      // Crude rating: 5 if clear + temp 15-25 + wind 5-15 + precip < 30,
      // 4 if some-but-not-all of those hold, lower otherwise. Mirrors the
      // shape of the client-side fishing-rating heuristic without
      // re-implementing it server-side.
      let score = 3;
      if (weatherCode <= 3) score += 1;
      if (temp >= 12 && temp <= 26) score += 0.5;
      if (wind >= 4 && wind <= 18) score += 0.5;
      if (precip < 30) score += 0.5;
      if (precip > 60) score -= 1;
      if (wind > 35) score -= 1.5;
      rating = Math.max(1, Math.min(5, Math.round(score)));
    } catch (e) {
      logger.warn(`[weeklyGreatFishingDayAlert] forecast fetch failed`, e);
      return;
    }

    if (rating < 4) {
      logger.info(`[weeklyGreatFishingDayAlert] rating ${rating} below threshold, skip`);
      return;
    }

    // Idempotency marker — one per Sunday evening run so a retry doesn't
    // re-push to everyone.
    const today = new Date().toISOString().slice(0, 10);
    const markerRef = db.doc(`greatFishingAlerts/${today}`);
    const marker = await markerRef.get();
    if (marker.exists) {
      logger.info(`[weeklyGreatFishingDayAlert] already sent today, skip`);
      return;
    }

    // Fan out to every user with a valid Expo push token. We read tokens
    // via a collectionGroup query on the private subcollection. At 10k DAU
    // this is ~10k reads + 10k pushes once per week = ~40k reads/month
    // ($0.024) and 40k pushes/month (free).
    const tokenSnap = await db.collectionGroup("private").get();
    let sent = 0;
    const body = `Утре изглежда отличен ден за риболов (${temp}° максимум). Време да планираш!`;
    for (const tokDoc of tokenSnap.docs) {
      if (tokDoc.id !== 'pushToken') continue;
      const token = tokDoc.data()?.expoPushToken as string | undefined;
      if (!token || !token.startsWith("ExponentPushToken[")) continue;
      try {
        await sendExpoPush(token, "Отлична прогноза 🎣", body, {
          type: 'fishingWindow',
          weatherCode: String(weatherCode),
          temp: String(temp),
        });
        sent += 1;
      } catch (e) {
        // Individual push failures don't abort the fan-out.
        logger.warn(`[weeklyGreatFishingDayAlert] push fail`, e);
      }
    }

    await markerRef.set({
      sentAt: FieldValue.serverTimestamp(),
      rating,
      weatherCode,
      temp,
      recipients: sent,
    });
    logger.info(`[weeklyGreatFishingDayAlert] sent ${sent} pushes (rating ${rating})`);
  },
);

// ---------------------------------------------------------------------------
// dailyThrowbackNotifications — daily at 08:00 Europe/Sofia
// ---------------------------------------------------------------------------
// Finds every public catch dated "this day last year" (and "this day 2 years
// ago" if any) and sends the owner a push notification with the catch info.
// Classic engagement loop — surfaces the user's own happy memories at a time
// they're likely to plan a fishing trip.
//
// Why publicCatches only: local-only catches live in AsyncStorage on the
// user's device and aren't visible to the server. A future "background
// scan + local notification" path would handle them, but that needs an
// Expo BackgroundFetch task — deferred to v2.
//
// Idempotency: same marker-doc pattern as tournamentEndingSoonReminder.
// After sending a push for catch C on day D we write to
// `throwbackSent/{D}_{catchId}` so a second invocation that same day
// (deploy backfill, scheduler hiccup) silently skips.
//
// Privacy: the push only references the user's own catch — no other users
// involved. The Firestore rule keeps `throwbackSent` server-write-only.

export const dailyThrowbackNotifications = onSchedule(
  { schedule: "every day 08:00", timeZone: "Europe/Sofia", maxInstances: 1 },
  async () => {
    // Compute "this day last year" and "this day 2 years ago" in YYYY-MM-DD
    // form. Catches are stored with their ISO date string, so date-string
    // equality is the cheapest match. Same-month/day handling: any catch
    // on YYYY-MM-DD where YYYY differs from today's year by 1 or 2.
    const today = new Date();
    const targets: string[] = [];
    for (const yearsBack of [1, 2]) {
      const d = new Date(today);
      d.setFullYear(d.getFullYear() - yearsBack);
      targets.push(d.toISOString().slice(0, 10));
    }
    const todayKey = today.toISOString().slice(0, 10);

    let totalSent = 0;
    for (const targetDate of targets) {
      // date field on publicCatches is ISO — startsWith match on YYYY-MM-DD
      // means "any catch on that calendar day regardless of the time slot
      // saved alongside it" (some catches store full datetime, others just
      // the date). Range query [targetDate, targetDate+1) achieves this.
      const lo = targetDate;
      // Date string +1 day for the upper bound. Constructing as Date keeps
      // the leap-year and month-boundary math right.
      const upperDate = new Date(targetDate + 'T00:00:00Z');
      upperDate.setUTCDate(upperDate.getUTCDate() + 1);
      const hi = upperDate.toISOString().slice(0, 10);

      const snap = await db
        .collection("publicCatches")
        .where("date", ">=", lo)
        .where("date", "<", hi)
        .get();
      if (snap.empty) continue;

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as Record<string, unknown>;
        const ownerUid = data.ownerUid as string | undefined;
        const speciesName = data.speciesName as string | undefined;
        const weightKg = data.weightKg as number | undefined;
        const locationName = (data.location as { name?: string } | undefined)?.name;
        if (!ownerUid) continue;

        // Per-catch dedup marker so a same-day retry doesn't re-notify.
        const markerRef = db.doc(`throwbackSent/${todayKey}_${docSnap.id}`);
        const marker = await markerRef.get();
        if (marker.exists) continue;

        // Quiet hours respected; no dedicated category toggle for throwback
        // yet so the global "push disabled" check is handled by the absence
        // of a push token (next branch). If we add a "throwback enabled"
        // pref later it goes here.
        const prefs = await getNotifPrefs(ownerUid);
        if (isInQuietHours(prefs)) {
          await markerRef.set({ skipped: 'quietHours', at: FieldValue.serverTimestamp() });
          continue;
        }

        const tokenSnap = await db.doc(`users/${ownerUid}/private/pushToken`).get();
        const token = tokenSnap.data()?.expoPushToken as string | undefined;
        if (!token || !token.startsWith("ExponentPushToken[")) {
          await markerRef.set({ skipped: 'noToken', at: FieldValue.serverTimestamp() });
          continue;
        }

        const yearsAgo = (Math.round(
          (today.getTime() - new Date(targetDate).getTime()) / (365 * 24 * 60 * 60 * 1000),
        )) || 1;
        const yearsLabel = yearsAgo === 1 ? '1 година' : `${yearsAgo} години`;
        const speciesPart = speciesName ?? 'риба';
        const weightPart = typeof weightKg === 'number' ? ` ${weightKg} кг` : '';
        const locationPart = locationName ? ` при ${locationName}` : '';

        try {
          await sendExpoPush(
            token,
            `Преди ${yearsLabel} 🎣`,
            `Хвана ${speciesPart}${weightPart}${locationPart}. Време за нов улов?`,
            {
              type: 'throwback',
              catchId: docSnap.id,
            },
          );
          await markerRef.set({
            sentAt: FieldValue.serverTimestamp(),
            catchId: docSnap.id,
            ownerUid,
          });
          totalSent += 1;
        } catch (e) {
          logger.warn(`[dailyThrowbackNotifications] push failed for ${docSnap.id}`, e);
          // No marker write on push failure — next run will retry.
        }
      }
    }

    logger.info(`[dailyThrowbackNotifications] sent ${totalSent} throwback pushes`);
  },
);

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
    logger.info(`[deleteMyAccount] ${label}: deleted ${total}`);
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
      logger.warn(`[deleteMyAccount] recursiveDelete failed for ${ref.path}`, e);
    });
  }
}

// NOTE: `enforceAppCheck: true` temporarily disabled. Re-enable on every
// callable once you've (a) registered the iOS DeviceCheck + Android Play
// Integrity providers in the Firebase Console under App Check → Apps, and
// (b) generated debug tokens for dev builds. Without those, code-level
// enforcement rejects dev calls before the function runs and the client
// sees a confusing "unauthenticated" error. See memory:
// `ribolov-app-check-enforcement` for the full re-enable checklist.
export const deleteMyAccount = onCall(
  { maxInstances: 5 },
  async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  // Rate limit: 1/hour. There is exactly one legitimate delete ever per
  // account; the limit's job is to prevent a stuck retry loop from
  // re-running the recursive-delete walk (which scans many subcollections
  // and burns compute on each invocation).
  await checkAndConsumeRateBucket(uid, "deleteMyAccount", 1, 1);

  // ── Phases 1 + 2: parallelized. Both touch independent doc paths
  // (Phase 1 = the user's own owned docs; Phase 2 = backrefs in other
  // users' subcollections), and Firestore deletes are idempotent, so
  // running them concurrently is safe and roughly 3× faster than the
  // previous sequential walk. Each per-collection query still paginates
  // sequentially within itself — only the cross-collection orchestration
  // moves to Promise.all.
  //
  // One subtle overlap: a user-hosted tournament (deleted by Phase 1)
  // contains the user's own photoEntries, which Phase 2c (collectionGroup
  // photoEntries) ALSO targets. Both paths converge on the same docs —
  // Firestore treats a delete of an already-deleted doc as a no-op, so
  // the worst case is a few redundant batch operations, not corruption.

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
  // Each owned-query loop runs its own pagination — wrap it as a separate
  // async task so Promise.all schedules them concurrently.
  const ownedTasks = ownedQueries.map(async ([q, label]) => {
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
        logger.info(`[deleteMyAccount] ${label}: recursively deleted ${pageTotal}`);
      }
    } catch (e) {
      logger.warn(`[deleteMyAccount] ${label} phase failed`, e);
    }
  });

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

  // 2b/2c/2d are collectionGroup deleteByQuery calls on disjoint groups —
  // run them concurrently with Phase 1.
  const backrefTasks = [
    deleteByQuery(
      db.collectionGroup("comments").where("authorUid", "==", uid),
      "comments(authored)",
    ),
    deleteByQuery(
      db.collectionGroup("photoEntries").where("ownerUid", "==", uid),
      "tournamentEntries",
    ),
    deleteByQuery(
      db.collectionGroup("members").where("uid", "==", uid),
      "groupMemberships",
    ),
  ];

  // Await all of Phase 1 + Phase 2's first three sub-phases together.
  // 2e (follow backrefs) reads /users/{uid}/following + /followers, which
  // are deleted by Phase 3. Keep 2e sequential after this barrier so the
  // reads land before Phase 3 wipes those subcollections.
  await Promise.all([...ownedTasks, ...backrefTasks]);

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
    logger.warn(`[deleteMyAccount] follow backref cleanup failed`, e);
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
    logger.warn(`[deleteMyAccount] conversation cleanup failed`, e);
  }

  // ── Phase 3: the user's own /users/{uid} doc + all its subcollections.
  //     recursiveDelete handles every subcollection (following, followers,
  //     notifications, savedCatches, blockedUsers, settings, private, etc.)
  try {
    await db.recursiveDelete(db.doc(`users/${uid}`));
  } catch (e) {
    logger.warn(`[deleteMyAccount] users/${uid} delete failed`, e);
  }

  logger.info(`[deleteMyAccount] cascade complete for ${uid}`);
  return { ok: true };
});

// (Note: sharedRef validation moved inline into onNewMessage above. The
// previous standalone `validateSharedRefInMessage` trigger raced with
// onNewMessage's unread-counter bump — an invalid ref would soft-delete
// the message AFTER the counter was already incremented, leaving the
// recipient with a phantom unread. The inlined check makes both writes
// happen together or neither.)

// ---------------------------------------------------------------------------
// Cloudflare R2 media upload — presigned-URL + server-side delete
// ---------------------------------------------------------------------------
// We moved photo / video storage off Firebase Storage onto Cloudflare R2
// (zero egress fees). The flow is the standard S3-style presigned-URL pattern:
//   1. Client calls `getR2UploadUrl({ path, contentType })` — we verify the
//      caller's Firebase Auth identity and that the path lives in a namespace
//      they own, then mint a 10-minute presigned PUT URL.
//   2. Client PUTs the file bytes directly to R2 (no proxy hop through our
//      function — uploads go phone → R2 over Cloudflare's edge).
//   3. Client writes the resulting `https://pub-<id>.r2.dev/<path>` URL into
//      Firestore alongside the catch/post/story/etc.
// Deletes route through `deleteR2Object` so we can re-validate the path
// against the caller's uid (presigned DELETE would let any path-holder nuke
// arbitrary objects).
//
// Secrets are defined here and bound on each callable's options so they're
// available via `.value()` at runtime.

const R2_ACCOUNT_ID = defineSecret("R2_ACCOUNT_ID");
const R2_BUCKET = defineSecret("R2_BUCKET");
const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const R2_PUBLIC_BASE_URL = defineSecret("R2_PUBLIC_BASE_URL");

function makeR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID.value()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID.value(),
      secretAccessKey: R2_SECRET_ACCESS_KEY.value(),
    },
  });
}

/** Returns true iff `path` lives in a namespace the calling user owns. The
    user's uid is embedded in every allowed path, so the server can authorize
    by string-match alone — no Firestore reads on the hot path. */
function isR2PathAllowedForUser(path: string, uid: string): boolean {
  // Cheap defense against `..` traversal or anchored paths sneaking past the
  // prefix checks below. R2 treats keys as opaque strings, but Firestore
  // queries that join on storagePath would break if we let weird shapes in.
  if (!path || path.startsWith("/") || path.includes("..") || path.length > 1024) {
    return false;
  }
  // Per-user namespaces — uid must be the second path segment.
  if (path.startsWith(`profilePhotos/${uid}/`)) return true;
  if (path.startsWith(`publicCatchPhotos/${uid}/`)) return true;
  if (path.startsWith(`stories/${uid}/`)) return true;
  if (path.startsWith(`posts/${uid}/`)) return true;
  // damFeeds/<damId>/<uid>/<postId>.<ext> — uid is the third segment.
  const dam = path.match(/^damFeeds\/[^/]+\/([^/]+)\//);
  if (dam && dam[1] === uid) return true;
  // chatMedia/<convId>/<uid>_<timestamp>.<ext> — uid is the filename prefix.
  const chat = path.match(/^chatMedia\/[^/]+\/([^_/]+)_/);
  if (chat && chat[1] === uid) return true;
  return false;
}

// Only these MIME types are accepted on upload. Whitelist > blacklist — a
// caller can't smuggle an HTML payload past R2 and serve it from our public
// hostname for phishing. Sized cap is enforced by Cloudflare on the bucket
// side (max object size); we don't need to recheck here.
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

export const getR2UploadUrl = onCall(
  {
    // `enforceAppCheck` temporarily disabled — see deleteMyAccount comment.
    secrets: [R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL],
    // Cap concurrent instances — uploads can burst (multi-photo posts) but
    // 20 is well above any legit per-user-second pattern; bounds attack
    // surface if rate-limit-bypass attempts ever stack up.
    maxInstances: 20,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    // Rate limit: 60 signed-URL requests per hour per uid. Legit usage
    // (multi-photo posts, story bursts) stays well under this; prevents
    // a scripted bad actor from spamming R2 with garbage uploads.
    await checkAndConsumeRateBucket(uid, "r2UploadUrl", 60, 60);

    const path = typeof request.data?.path === "string" ? request.data.path : "";
    const contentType = typeof request.data?.contentType === "string" ? request.data.contentType : "";
    if (!path) throw new HttpsError("invalid-argument", "path required");
    if (!contentType) throw new HttpsError("invalid-argument", "contentType required");
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new HttpsError("invalid-argument", `contentType "${contentType}" not allowed`);
    }
    if (!isR2PathAllowedForUser(path, uid)) {
      throw new HttpsError("permission-denied", `path "${path}" not in user ${uid} namespace`);
    }

    const s3 = makeR2Client();
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET.value(),
      Key: path,
      ContentType: contentType,
    });
    // 10-minute window: long enough that a slow upload over cellular still
    // finishes on the original URL, short enough that a leaked URL isn't
    // reusable for long. Client retries inside this window re-use the same
    // signature — re-calling the function on every retry would be wasteful.
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 });
    const publicUrl = `${R2_PUBLIC_BASE_URL.value().replace(/\/$/, "")}/${path}`;

    return { uploadUrl, publicUrl, key: path };
  },
);

export const deleteR2Object = onCall(
  {
    // `enforceAppCheck` temporarily disabled — see deleteMyAccount comment.
    secrets: [R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY],
    maxInstances: 20,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    // Rate limit: same 60/hr as upload. Even though deletes only target the
    // caller's own namespace (so abuse can't hit anyone else), unbounded
    // delete spam burns S3 API calls + function compute.
    await checkAndConsumeRateBucket(uid, "r2DeleteObject", 60, 60);

    const path = typeof request.data?.path === "string" ? request.data.path : "";
    if (!path) throw new HttpsError("invalid-argument", "path required");
    if (!isR2PathAllowedForUser(path, uid)) {
      throw new HttpsError("permission-denied", `path "${path}" not in user ${uid} namespace`);
    }

    const s3 = makeR2Client();
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET.value(), Key: path }));
    } catch (e) {
      // R2 returns 204 for both "deleted" and "didn't exist". An actual error
      // here means a real outage / credential issue — log it but don't
      // surface to the client, since orphan files aren't user-actionable.
      logger.warn(`[deleteR2Object] failed for ${path}`, e);
    }
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// getSpeciesHeatmap — server-side aggregation for the map heatmap layer
// ---------------------------------------------------------------------------
// The client previously read up to 2,500 publicCatches docs per map open
// and aggregated cells locally. At any non-trivial DAU that's the single
// biggest read source in the app. Moved server-side here, with two wins:
//   1. Response payload shrinks from ~2,500 catch docs to ~50–200 cells.
//   2. A 10-minute Firestore-backed cache means N concurrent map opens in
//      the same window cost 1 aggregation total, not N. Each cache hit is
//      a single doc read (the cache doc itself).
//
// k-anonymity invariant is preserved on the server: cells with fewer than
// HEATMAP_MIN_DISTINCT_OWNERS distinct angler uids are dropped before the
// response leaves the function. Privacy guarantee matches the previous
// client-side implementation byte-for-byte.

const HEATMAP_CELL_DEG = 0.05;
const HEATMAP_MIN_DISTINCT_OWNERS = 3;
const HEATMAP_MAX_DOCS = 2500;
const HEATMAP_CACHE_TTL_MS = 10 * 60 * 1000;

type HeatmapCell = {
  latitude: number;
  longitude: number;
  ownerCount: number;
  catchCount: number;
};

export const getSpeciesHeatmap = onCall(
  { maxInstances: 10 },
  async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  // Rate limit: 30/hour. The function has a 10-min cache so legitimate
  // map opens almost always hit the cache; this guards against cache-miss
  // spam (a script alternating species names to force a full publicCatches
  // scan on each call).
  await checkAndConsumeRateBucket(request.auth.uid, "speciesHeatmap", 30, 30);
  const minDateIso = typeof request.data?.minDateIso === "string" ? request.data.minDateIso : "";
  const speciesNameRaw = typeof request.data?.speciesName === "string" ? request.data.speciesName : "";
  if (!minDateIso) throw new HttpsError("invalid-argument", "minDateIso required");
  // Cap the species name so a malicious caller can't blow up the cache key
  // namespace. Real Bulgarian species names are <40 chars.
  const speciesName = speciesNameRaw.slice(0, 64);

  // Cache key bucketed by (species, day) — the client already passes a
  // YYYY-MM-DD prefix on minDateIso, so collisions across users on the same
  // day are intentional and what we want.
  const cacheKey = `${speciesName || "all"}_${minDateIso.slice(0, 10)}`
    // Defensive: Firestore doc IDs can't contain '/' and shouldn't contain
    // weird whitespace. Slugify aggressively.
    .replace(/[^a-zA-Z0-9_\-:.]/g, "_");
  const cacheRef = db.doc(`heatmapCache/${cacheKey}`);

  const cacheSnap = await cacheRef.get().catch(() => null);
  if (cacheSnap && cacheSnap.exists) {
    const cached = cacheSnap.data() as { cells?: HeatmapCell[]; updatedAt?: Timestamp };
    const updatedAt = cached.updatedAt;
    if (updatedAt instanceof Timestamp &&
        Date.now() - updatedAt.toMillis() < HEATMAP_CACHE_TTL_MS) {
      return { cells: cached.cells ?? [] };
    }
  }

  // Cache miss or stale — aggregate from publicCatches.
  const snap = await db
    .collection("publicCatches")
    .where("date", ">=", minDateIso)
    .orderBy("date", "desc")
    .limit(HEATMAP_MAX_DOCS)
    .get();

  type Bucket = { lat: number; lng: number; owners: Set<string>; catches: number };
  const buckets = new Map<string, Bucket>();

  for (const d of snap.docs) {
    const c = d.data() as {
      location?: { latitude?: number; longitude?: number };
      ownerUid?: string;
      speciesName?: string;
    };
    const lat = c.location?.latitude;
    const lng = c.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number" || !c.ownerUid) continue;
    if (speciesName && c.speciesName !== speciesName) continue;

    const row = Math.floor(lat / HEATMAP_CELL_DEG);
    const col = Math.floor(lng / HEATMAP_CELL_DEG);
    const key = `${row}:${col}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        lat: (row + 0.5) * HEATMAP_CELL_DEG,
        lng: (col + 0.5) * HEATMAP_CELL_DEG,
        owners: new Set(),
        catches: 0,
      };
      buckets.set(key, b);
    }
    b.owners.add(c.ownerUid);
    b.catches += 1;
  }

  const cells: HeatmapCell[] = [];
  for (const b of buckets.values()) {
    if (b.owners.size < HEATMAP_MIN_DISTINCT_OWNERS) continue;
    cells.push({
      latitude: b.lat,
      longitude: b.lng,
      ownerCount: b.owners.size,
      catchCount: b.catches,
    });
  }

  // Best-effort cache write. A failed cache write doesn't break the response —
  // we just lose this aggregation's "memo" and the next call re-aggregates.
  cacheRef
    .set({ cells, updatedAt: FieldValue.serverTimestamp() })
    .catch((e) => logger.warn(`[getSpeciesHeatmap] cache write failed for ${cacheKey}`, e));

  return { cells };
});

// ---------------------------------------------------------------------------
// Firestore-native TTL stampers
// ---------------------------------------------------------------------------
// Each onCreate trigger below stamps a `ttlAt` Timestamp field on the new
// doc, computed server-side as `createdAt + TTL`. The matching Firestore
// TTL policy (set in the GCP Console once per collection group) deletes the
// doc within ~24h of `ttlAt` passing.
//
// This replaces the previous scheduled cleanup functions
// (`cleanupExpiredStories`, `cleanupExpiredLivePins`,
// `cleanupExpiredWaterReports`, `cleanupOldNotifications`). The advantage is
// zero reads + zero writes per cleanup — Google's TTL infrastructure handles
// the sweep at no charge. The cost is one tiny `update` write per doc at
// creation time, which is negligible (<<1% of the docs' lifetime ops).
//
// Why server-side, not client-side: the client used to compute
// `expiresAt = Date.now() + TTL_MS`, which depended on the device's
// wall-clock. A misset phone (hours / days off) would either evict its own
// stories early or keep them up past their intended window. Doing this in a
// trigger is the only way to guarantee a clean wall-clock anchor.

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const LIVE_PIN_TTL_MS = 4 * 60 * 60 * 1000;
const WATER_REPORT_TTL_MS = 24 * 60 * 60 * 1000;
const READ_NOTIF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Pulls the server-stamped `createdAt` Timestamp off the doc and returns
    a Timestamp `ttlMs` later. Returns null when createdAt is missing — the
    caller must skip the write in that case so we don't accidentally delete
    a doc that has no anchor (e.g. a malformed write by a future client). */
function ttlFromCreatedAt(data: Record<string, unknown> | undefined, ttlMs: number): Timestamp | null {
  const createdAt = data?.createdAt;
  if (!(createdAt instanceof Timestamp)) return null;
  return Timestamp.fromMillis(createdAt.toMillis() + ttlMs);
}

export const stampStoryTtl = onDocumentCreated(
  { document: "stories/{storyId}", maxInstances: 10 },
  async (event) => {
  const ttlAt = ttlFromCreatedAt(event.data?.data(), STORY_TTL_MS);
  if (!ttlAt) return;
  await event.data!.ref.update({ ttlAt });
});

export const stampLivePinTtl = onDocumentCreated(
  { document: "liveFishingPins/{pinId}", maxInstances: 10 },
  async (event) => {
  const ttlAt = ttlFromCreatedAt(event.data?.data(), LIVE_PIN_TTL_MS);
  if (!ttlAt) return;
  await event.data!.ref.update({ ttlAt });
});

export const stampWaterReportTtl = onDocumentCreated(
  { document: "waterReports/{reportId}", maxInstances: 10 },
  async (event) => {
  const ttlAt = ttlFromCreatedAt(event.data?.data(), WATER_REPORT_TTL_MS);
  if (!ttlAt) return;
  await event.data!.ref.update({ ttlAt });
});

/** Notifications are unique: we only want to TTL-delete docs that have been
    marked read. Stamping `ttlAt` at creation would delete unread notifs too.
    Instead we stamp on the read=false → read=true transition. Unread notifs
    have no `ttlAt`, so TTL passes them over indefinitely. */
export const stampNotificationTtl = onDocumentUpdated(
  { document: "users/{userId}/notifications/{notifId}", maxInstances: 50 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.read === true) return; // already read on a prior write — no-op
    if (after.read !== true) return; // still unread — wait for the transition
    if (after.ttlAt instanceof Timestamp) return; // already stamped — no-op
    const ttlAt = Timestamp.fromMillis(Date.now() + READ_NOTIF_TTL_MS);
    await event.data!.after.ref.update({ ttlAt });
  },
);

// ---------------------------------------------------------------------------
// Story cascade-delete: cleans up subcollections + R2 media when a story doc
// is deleted by any path (user action, TTL sweep, account delete).
// ---------------------------------------------------------------------------
// Firestore TTL only deletes the parent doc — `stories/{id}/reactions` and
// `stories/{id}/comments` would be orphaned without this trigger. We also
// best-effort the R2 video / photo file via the same path used by the
// client-side `deleteFromR2` (presigned-URL flow not needed here because
// we're already inside the trusted server boundary).

export const onStoryDeleted = onDocumentDeleted(
  {
    document: "stories/{storyId}",
    secrets: [R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY],
    maxInstances: 10,
  },
  async (event) => {
    const storyId = event.params.storyId;
    const data = event.data?.data() as Record<string, unknown> | undefined;

    // Cascade subcollections. recursiveDelete tolerates non-existence so
    // this is safe even for stories that never accumulated reactions.
    await Promise.all([
      db.recursiveDelete(db.collection(`stories/${storyId}/reactions`)).catch((e) => {
        logger.warn(`[onStoryDeleted] reactions cascade failed for ${storyId}`, e);
      }),
      db.recursiveDelete(db.collection(`stories/${storyId}/comments`)).catch((e) => {
        logger.warn(`[onStoryDeleted] comments cascade failed for ${storyId}`, e);
      }),
    ]);

    // R2 media cleanup — derive the key from the public URL and DELETE it.
    // Best-effort: an orphan R2 object is invisible to clients (no story doc
    // references it) but accumulates storage cost over time. The user-side
    // delete path no longer touches R2 directly — it relies on this trigger
    // to handle cleanup for any deletion path uniformly.
    const mediaUrl = typeof data?.mediaUrl === "string" ? data.mediaUrl : "";
    if (mediaUrl && /^https:\/\/[^/]+\.r2\.dev\//i.test(mediaUrl)) {
      try {
        const key = new URL(mediaUrl).pathname.replace(/^\//, "");
        if (key) {
          const s3 = makeR2Client();
          await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET.value(), Key: key }));
        }
      } catch (e) {
        logger.warn(`[onStoryDeleted] R2 cleanup failed for ${storyId}`, e);
      }
    }
  },
);

// ---------------------------------------------------------------------------
// publicCatches / posts R2 cleanup triggers
// ---------------------------------------------------------------------------
// When a catch or post doc is deleted (via account-delete cascade, the user's
// own "delete catch" action, or any future admin-side moderation tool) the
// R2 photo/video/poster files would otherwise be orphaned. The client used
// to handle this itself via `deleteFromR2` in the client-side delete flow,
// but the account-delete cascade runs server-side and skips that path
// entirely. Mirroring the onStoryDeleted pattern keeps R2 in sync regardless
// of who initiated the delete.

/** Shared key-deriver for a public R2 URL OR a raw storage key. Returns null
    for Cloudinary-prefixed paths (Cloudinary manages its own lifecycle) and
    for non-R2 URLs (e.g. external avatars). */
function deriveR2Key(value: string | undefined | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("cloudinary:")) return null;
  if (/^https?:\/\//i.test(v)) {
    if (!/^https:\/\/[^/]+\.r2\.dev\//i.test(v)) return null;
    try {
      return new URL(v).pathname.replace(/^\//, "") || null;
    } catch {
      return null;
    }
  }
  // Already a bare storage key (e.g. publicCatchPhotos/uid/id/123.jpg).
  return v;
}

async function deleteR2Keys(keys: Array<string | null | undefined>, source: string): Promise<void> {
  const real = keys.filter((k): k is string => typeof k === "string" && k.length > 0);
  if (real.length === 0) return;
  const s3 = makeR2Client();
  await Promise.all(
    real.map(async (key) => {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET.value(), Key: key }));
      } catch (e) {
        logger.warn(`[${source}] R2 delete failed for ${key}`, e);
      }
    }),
  );
}

export const onPublicCatchDeleted = onDocumentDeleted(
  {
    document: "publicCatches/{catchId}",
    secrets: [R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY],
    maxInstances: 20,
  },
  async (event) => {
    const data = event.data?.data() as Record<string, unknown> | undefined;
    if (!data) return;
    const keys: Array<string | null> = [];
    keys.push(deriveR2Key(data.photoStoragePath as string | undefined));
    keys.push(deriveR2Key(data.videoStoragePath as string | undefined));
    keys.push(deriveR2Key(data.videoThumbnailStoragePath as string | undefined));
    // Extra photos are stored as URLs (no per-extra storage path). Derive
    // each from the URL — non-R2 ones return null and are filtered out.
    const extras = Array.isArray(data.extraPhotoUris) ? (data.extraPhotoUris as unknown[]) : [];
    for (const u of extras) {
      if (typeof u === "string") keys.push(deriveR2Key(u));
    }
    await deleteR2Keys(keys, "onPublicCatchDeleted");
  },
);

export const onPostDeleted = onDocumentDeleted(
  {
    document: "posts/{postId}",
    secrets: [R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY],
    maxInstances: 20,
  },
  async (event) => {
    const data = event.data?.data() as Record<string, unknown> | undefined;
    if (!data) return;
    const keys: Array<string | null> = [];
    keys.push(deriveR2Key(data.photoStoragePath as string | undefined));
    keys.push(deriveR2Key(data.videoStoragePath as string | undefined));
    keys.push(deriveR2Key(data.videoThumbnailStoragePath as string | undefined));
    await deleteR2Keys(keys, "onPostDeleted");
  },
);
