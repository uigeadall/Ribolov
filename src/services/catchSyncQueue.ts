import AsyncStorage from '../storage/kv';
import { catchesStore } from '../storage/storage';
import { ensureCatchPhotoUploadedForCloud, pushCatch } from './cloudSync';
import { addBreadcrumb, captureException } from './observability';
import { calcBackoffMs, readSyncQueue, writeSyncQueue } from './syncQueue';

const QUEUE_KEY = 'ribolov:catch-sync-queue';

type Entry = {
  catchId: string;
  sharePublic: boolean;
  attempts: number;
  /** unix ms — не опитвай преди това време */
  nextAttemptAfter?: number;
};

const MAX_ATTEMPTS = 14;
const BASE_DELAY_MS = 5_000;
const MAX_BACKOFF_ATTEMPTS = 10;
const MAX_DELAY_MS = 3_600_000;

const backoffMs = (attempts: number) =>
  calcBackoffMs(attempts, BASE_DELAY_MS, MAX_BACKOFF_ATTEMPTS, MAX_DELAY_MS);

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

const readQ = () => readSyncQueue(QUEUE_KEY, normalizeEntries);
const writeQ = (entries: Entry[]) => writeSyncQueue(QUEUE_KEY, entries);

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

/** Manual retry path for a specific catch. Used when the user taps the
    cloud-upload indicator on a Logbook card after an upload has been
    abandoned (MAX_ATTEMPTS exhausted) or while it's still waiting on
    backoff. Re-enqueues with attempts=0 and immediately triggers a flush
    so the user sees movement rather than waiting for the next ambient
    flush window. */
export async function forceRetryCatchSync(
  catchId: string,
  sharePublic: boolean,
  ctx: { user: { uid: string; displayName: string | null; email: string | null } },
): Promise<void> {
  const q = await readQ();
  const rest = q.filter((e) => e.catchId !== catchId);
  rest.push({ catchId, sharePublic, attempts: 0 });
  await writeQ(rest);
  addBreadcrumb('sync', 'catch_force_retry', { catchId });
  await flushPendingCatchSync(ctx);
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

  // Read the full catch list once — not once per queue entry
  const catchList = await catchesStore.list();
  const catchById = new Map(catchList.map((c) => [c.id, c]));

  for (const entry of entries) {
    if (entry.nextAttemptAfter != null && now < entry.nextAttemptAfter) {
      remaining.push(entry);
      continue;
    }

    const c = catchById.get(entry.catchId);
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
      const synced = { ...toSync, syncedToCloud: true };
      await catchesStore.save(synced);
      catchById.set(entry.catchId, synced);
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
