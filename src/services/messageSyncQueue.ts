import { addBreadcrumb, captureException } from './observability';
import { sendConversationMessage, makeMessageClientId } from './messaging';
import type { MessageReplyRef, SharedRef } from '../types';
import { calcBackoffMs, readSyncQueue, writeSyncQueue } from './syncQueue';
import { makePromiseChain } from '../utils/promiseChain';

const QUEUE_KEY = 'ribolov:message-sync-queue';

type Entry = {
  convId: string;
  senderUid: string;
  senderName?: string;
  text: string;
  recipientUid: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  replyTo?: MessageReplyRef;
  sharedRef?: SharedRef;
  /** Stable id so a retry after a partial success doesn't create a duplicate Firestore doc. */
  clientId: string;
  attempts: number;
  nextAttemptAfter?: number;
};

function normalizeReplyTo(raw: unknown): MessageReplyRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.messageId !== 'string' || typeof o.senderUid !== 'string' || typeof o.preview !== 'string') return undefined;
  return { messageId: o.messageId, senderUid: o.senderUid, preview: o.preview };
}

function normalizeSharedRef(raw: unknown): SharedRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== 'catch' && kind !== 'post' && kind !== 'spot') return undefined;
  if (typeof o.id !== 'string' || o.id.length === 0) return undefined;
  return {
    kind,
    id: o.id,
    ownerUid: typeof o.ownerUid === 'string' ? o.ownerUid : undefined,
    title: typeof o.title === 'string' ? o.title : undefined,
    subtitle: typeof o.subtitle === 'string' ? o.subtitle : undefined,
    photoUrl: typeof o.photoUrl === 'string' ? o.photoUrl : undefined,
  };
}

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 3_000;
const MAX_BACKOFF_ATTEMPTS = 8;
const MAX_DELAY_MS = 1_800_000;

/** Firestore error codes that won't fix themselves on retry — drop these immediately.
    NOTE: 'failed-precondition' is intentionally NOT here. App Check token expiry
    surfaces as failed-precondition during a brief refresh window, and so do
    transient rules races during account provisioning. Treating it as terminal
    silently dropped legitimate offline messages. Real rule violations will be
    retried up to MAX_ATTEMPTS and then abandoned via the normal path. */
const TERMINAL_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'not-found',
  'out-of-range',
]);

function errorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    return String((e as { code: unknown }).code);
  }
  return '';
}

const backoffMs = (attempts: number) =>
  calcBackoffMs(attempts, BASE_DELAY_MS, MAX_BACKOFF_ATTEMPTS, MAX_DELAY_MS);

function normalizeEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  const out: Entry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    if (typeof o.convId !== 'string' || typeof o.senderUid !== 'string') continue;
    out.push({
      convId: o.convId,
      senderUid: o.senderUid,
      senderName: typeof o.senderName === 'string' ? o.senderName : undefined,
      text: typeof o.text === 'string' ? o.text : '',
      recipientUid: typeof o.recipientUid === 'string' ? o.recipientUid : '',
      mediaUrl: typeof o.mediaUrl === 'string' ? o.mediaUrl : undefined,
      mediaType: o.mediaType === 'photo' || o.mediaType === 'video' ? o.mediaType : undefined,
      replyTo: normalizeReplyTo(o.replyTo),
      sharedRef: normalizeSharedRef(o.sharedRef),
      // Backfill a clientId for entries written by older app versions so legacy queued
      // sends still benefit from idempotency on the next flush.
      clientId: typeof o.clientId === 'string' && o.clientId.length > 0 ? o.clientId : makeMessageClientId(),
      attempts: typeof o.attempts === 'number' && o.attempts >= 0 ? Math.floor(o.attempts) : 0,
      nextAttemptAfter:
        typeof o.nextAttemptAfter === 'number' && o.nextAttemptAfter > 0
          ? o.nextAttemptAfter
          : undefined,
    });
  }
  return out;
}

const readQ = () => readSyncQueue(QUEUE_KEY, normalizeEntries);
const writeQ = (entries: Entry[]) => writeSyncQueue(QUEUE_KEY, entries);

// Single mutex serialises every read-modify-write of the queue — both
// enqueue and flush. Without this, an enqueue (user taps "send") firing
// while a flush is mid-loop would read the same queue snapshot the flush
// read, and write a disjoint result back, clobbering the flush's pending
// list. Worse case: a perpetually-failing message would be re-added to
// the queue every time a new one enqueues during its flush, causing
// duplicate Firestore writes (clientId dedupes those, but only after the
// rule check + transaction round trip).
const withQueueMutex = makePromiseChain();

export async function enqueueMessage(
  convId: string,
  senderUid: string,
  text: string,
  recipientUid: string,
  senderName?: string,
  mediaUrl?: string,
  mediaType?: 'photo' | 'video',
  clientId?: string,
  replyTo?: MessageReplyRef,
  sharedRef?: SharedRef,
): Promise<void> {
  await withQueueMutex(async () => {
    const q = await readQ();
    const id = clientId ?? makeMessageClientId();
    // Defensive: if this exact clientId is already queued, don't duplicate it.
    if (q.some((e) => e.clientId === id)) return;
    q.push({
      convId,
      senderUid,
      senderName,
      text,
      recipientUid,
      mediaUrl,
      mediaType,
      replyTo,
      sharedRef,
      clientId: id,
      attempts: 0,
    });
    await writeQ(q);
    addBreadcrumb('sync', 'message_enqueue', { convId, senderUid, clientId: id });
  });
}

export async function getPendingMessageCount(): Promise<number> {
  const q = await readQ();
  return q.length;
}

export async function flushPendingMessages(): Promise<void> {
  return withQueueMutex(runFlush);
}

async function runFlush(): Promise<void> {
  const entries = await readQ();
  if (entries.length === 0) return;

  const now = Date.now();
  const remaining: Entry[] = [];

  for (const entry of entries) {
    if (entry.nextAttemptAfter != null && now < entry.nextAttemptAfter) {
      remaining.push(entry);
      continue;
    }

    try {
      await sendConversationMessage(
        entry.convId,
        entry.senderUid,
        entry.text,
        entry.recipientUid,
        entry.senderName,
        entry.mediaUrl,
        entry.mediaType,
        entry.clientId,
        entry.replyTo,
        entry.sharedRef,
      );
      addBreadcrumb('sync', 'message_flush_ok', { convId: entry.convId });
    } catch (e) {
      const code = errorCode(e);
      const isTerminal = TERMINAL_CODES.has(code);
      const attempts = entry.attempts + 1;
      if (isTerminal || attempts >= MAX_ATTEMPTS) {
        captureException(e, {
          area: isTerminal ? 'message_sync_terminal' : 'message_sync_abandoned',
          convId: entry.convId,
          code,
          attempts: String(attempts),
        });
        continue;
      }
      remaining.push({
        ...entry,
        attempts,
        nextAttemptAfter: Date.now() + backoffMs(attempts),
      });
      captureException(e, {
        area: 'message_sync_retry',
        convId: entry.convId,
        code,
        attempt: String(attempts),
      });
    }
  }

  await writeQ(remaining);
}
