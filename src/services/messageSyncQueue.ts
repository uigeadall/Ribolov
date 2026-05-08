import AsyncStorage from '@react-native-async-storage/async-storage';
import { addBreadcrumb, captureException } from './observability';
import { sendConversationMessage } from './cloudSync';

const QUEUE_KEY = 'ribolov:message-sync-queue';

type Entry = {
  convId: string;
  senderUid: string;
  text: string;
  recipientUid: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  attempts: number;
  nextAttemptAfter?: number;
};

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 3_000;

function backoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.min(attempts, 8), 1_800_000);
}

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
      text: typeof o.text === 'string' ? o.text : '',
      recipientUid: typeof o.recipientUid === 'string' ? o.recipientUid : '',
      mediaUrl: typeof o.mediaUrl === 'string' ? o.mediaUrl : undefined,
      mediaType: o.mediaType === 'photo' || o.mediaType === 'video' ? o.mediaType : undefined,
      attempts: typeof o.attempts === 'number' && o.attempts >= 0 ? Math.floor(o.attempts) : 0,
      nextAttemptAfter:
        typeof o.nextAttemptAfter === 'number' && o.nextAttemptAfter > 0
          ? o.nextAttemptAfter
          : undefined,
    });
  }
  return out;
}

async function readQ(): Promise<Entry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return normalizeEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeQ(entries: Entry[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

export async function enqueueMessage(
  convId: string,
  senderUid: string,
  text: string,
  recipientUid: string,
  mediaUrl?: string,
  mediaType?: 'photo' | 'video',
): Promise<void> {
  const q = await readQ();
  q.push({ convId, senderUid, text, recipientUid, mediaUrl, mediaType, attempts: 0 });
  await writeQ(q);
  addBreadcrumb('sync', 'message_enqueue', { convId, senderUid });
}

export async function getPendingMessageCount(): Promise<number> {
  const q = await readQ();
  return q.length;
}

export async function flushPendingMessages(): Promise<void> {
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
        entry.mediaUrl,
        entry.mediaType,
      );
      addBreadcrumb('sync', 'message_flush_ok', { convId: entry.convId });
    } catch (e) {
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        captureException(e, {
          area: 'message_sync_abandoned',
          convId: entry.convId,
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
        attempt: String(attempts),
      });
    }
  }

  await writeQ(remaining);
}
