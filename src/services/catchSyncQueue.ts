import AsyncStorage from '@react-native-async-storage/async-storage';
import { catchesStore } from '../storage/storage';
import { ensureCatchPhotoUploadedForCloud, pushCatch } from './cloudSync';
import { addBreadcrumb, captureException } from './observability';

const QUEUE_KEY = 'ribolov:catch-sync-queue';

type Entry = {
  catchId: string;
  sharePublic: boolean;
  attempts: number;
  /** unix ms — не опитвай преди това време */
  nextAttemptAfter?: number;
};

const MAX_ATTEMPTS = 14;
const BASE_DELAY_MS = 5000;

function backoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.min(attempts, 10), 3_600_000);
}

function normalizeEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return [];
  const out: Entry[] = [];
  const seen = new Map<string, Entry>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const catchId = typeof o.catchId === 'string' ? o.catchId : '';
    if (!catchId) continue;
    const sharePublic = !!o.sharePublic;
    const attempts = typeof o.attempts === 'number' && o.attempts >= 0 ? Math.floor(o.attempts) : 0;
    const nextAttemptAfter =
      typeof o.nextAttemptAfter === 'number' && o.nextAttemptAfter > 0 ? o.nextAttemptAfter : undefined;
    seen.set(catchId, { catchId, sharePublic, attempts, nextAttemptAfter });
  }
  for (const v of seen.values()) out.push(v);
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

async function writeQ(entries: Entry[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

export async function enqueueCatchSync(catchId: string, sharePublic: boolean): Promise<void> {
  const q = await readQ();
  const rest = q.filter((e) => e.catchId !== catchId);
  rest.push({ catchId, sharePublic, attempts: 0 });
  await writeQ(rest);
  addBreadcrumb('sync', 'catch_enqueue', { catchId, sharePublic: String(sharePublic) });
}

export async function clearCatchSyncQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/** Изпраща чакащите улови към Firebase с експоненциален backoff. */
export async function flushPendingCatchSync(ctx: {
  user: { uid: string; displayName: string | null; email: string | null };
}): Promise<void> {
  const entries = await readQ();
  if (entries.length === 0) return;

  const now = Date.now();
  const remaining: Entry[] = [];
  const ownerName = ctx.user.displayName ?? ctx.user.email ?? 'Рибар';

  for (const entry of entries) {
    if (entry.nextAttemptAfter != null && now < entry.nextAttemptAfter) {
      remaining.push(entry);
      continue;
    }

    const list = await catchesStore.list();
    const c = list.find((x) => x.id === entry.catchId);
    if (!c) {
      addBreadcrumb('sync', 'catch_missing_skip', { catchId: entry.catchId });
      continue;
    }

    try {
      let toSync = c;
      const uri = toSync.photoUri?.trim();
      if (uri && !/^https?:\/\//i.test(uri)) {
        toSync = await ensureCatchPhotoUploadedForCloud(c, ctx.user.uid);
      }
      await pushCatch(toSync, ctx.user.uid, ownerName, entry.sharePublic);
      await catchesStore.save({ ...toSync, syncedToCloud: true });
      addBreadcrumb('sync', 'catch_push_ok', { catchId: entry.catchId });
    } catch (e) {
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        captureException(e, {
          area: 'catch_sync_abandoned',
          catchId: entry.catchId,
          attempts: String(attempts),
        });
        continue;
      }
      remaining.push({
        catchId: entry.catchId,
        sharePublic: entry.sharePublic,
        attempts,
        nextAttemptAfter: Date.now() + backoffMs(attempts),
      });
      captureException(e, {
        area: 'catch_sync_retry',
        catchId: entry.catchId,
        attempt: String(attempts),
      });
    }
  }

  await writeQ(remaining);
}
