import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { catchesStore, spotsStore, gearStore, tripsStore } from '../storage/storage';
import { addBreadcrumb, captureException } from './observability';

/**
 * GDPR data export. Collects everything the service has stored about the
 * caller — local logbook data plus cloud-side profile / public posts /
 * social graph / saved items — into a single JSON file and surfaces the
 * system share sheet so the user can save it to Files, AirDrop it to a
 * laptop, email it to themselves, etc.
 *
 * Promised by docs/privacy.html ("Right to data portability"). Until this
 * function exists, that promise is a lie. Now it ships.
 *
 * Scope choice: include everything the SERVICE knows about the user.
 * That excludes:
 *   - Other users' content (their catches, posts, messages they sent to me)
 *     — those belong to the other user, not me
 *   - Aggregate metrics (leaderboard rankings, classics) — derived from
 *     my data, not separately stored about me
 *   - Server logs (Firestore reads/writes audit) — not stored long-term
 *
 * Cost: 1 user-doc read + N collection reads where N scales with how much
 * the user has done. For an active user this could be ~50 Firestore reads.
 * Acceptable — the user explicitly chose to export, this isn't a hot path.
 */
export type GdprExportBundle = {
  exportedAt: string;
  userId: string;
  schema: number;
  profile: Record<string, unknown> | null;
  localLogbook: {
    catches: unknown[];
    spots: unknown[];
    gear: unknown[];
    trips: unknown[];
  };
  cloudFootprint: {
    publicCatches: unknown[];
    posts: unknown[];
    stories: unknown[];
    savedCatches: unknown[];
    following: string[];
    followers: string[];
    followedHashtags: string[];
    blockedUsers: string[];
    notificationsRecent: unknown[];
  };
};

const SCHEMA_VERSION = 1;

async function readUserDoc(uid: string): Promise<Record<string, unknown> | null> {
  try {
    const fb = requireFirebase();
    const snap = await getDoc(doc(fb.db, 'users', uid));
    if (!snap.exists()) return null;
    return snap.data() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readOwnedCollection(uid: string, path: string, ownerField: string, max = 500): Promise<unknown[]> {
  try {
    const fb = requireFirebase();
    const snap = await getDocs(
      query(collection(fb.db, path), where(ownerField, '==', uid), limit(max)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

async function readSubcollection(uid: string, sub: string, max = 1000): Promise<unknown[]> {
  try {
    const fb = requireFirebase();
    const snap = await getDocs(
      query(collection(fb.db, 'users', uid, sub), limit(max)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

async function readSubcollectionIds(uid: string, sub: string, max = 5000): Promise<string[]> {
  try {
    const fb = requireFirebase();
    const snap = await getDocs(
      query(collection(fb.db, 'users', uid, sub), limit(max)),
    );
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

async function readNotificationsRecent(uid: string, max = 200): Promise<unknown[]> {
  try {
    const fb = requireFirebase();
    const snap = await getDocs(
      query(
        collection(fb.db, 'users', uid, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(max),
      ),
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/**
 * Assemble the export bundle. Runs all reads in parallel so a user with
 * thousands of catches doesn't sit waiting through serial round-trips —
 * the slowest single read dominates the total wait, not the sum.
 */
export async function buildGdprExport(uid: string): Promise<GdprExportBundle> {
  addBreadcrumb('gdpr', 'export_start', { uid });

  const [
    profile,
    localCatches,
    localSpots,
    localGear,
    localTrips,
    publicCatches,
    posts,
    stories,
    savedCatches,
    following,
    followers,
    followedHashtags,
    blockedUsers,
    notificationsRecent,
  ] = await Promise.all([
    readUserDoc(uid),
    catchesStore.list().catch(() => []),
    spotsStore.list().catch(() => []),
    gearStore.list().catch(() => []),
    tripsStore.list().catch(() => []),
    readOwnedCollection(uid, 'publicCatches', 'ownerUid'),
    readOwnedCollection(uid, 'posts', 'ownerUid'),
    readOwnedCollection(uid, 'stories', 'uid'),
    readSubcollection(uid, 'savedCatches'),
    readSubcollectionIds(uid, 'following'),
    readSubcollectionIds(uid, 'followers'),
    readSubcollectionIds(uid, 'followedHashtags'),
    readSubcollectionIds(uid, 'blockedUsers'),
    readNotificationsRecent(uid),
  ]);

  addBreadcrumb('gdpr', 'export_assembled', {
    uid,
    catches: String(localCatches.length),
    spots: String(localSpots.length),
    publicCatches: String(publicCatches.length),
    posts: String(posts.length),
  });

  return {
    exportedAt: new Date().toISOString(),
    userId: uid,
    schema: SCHEMA_VERSION,
    profile,
    localLogbook: {
      catches: localCatches,
      spots: localSpots,
      gear: localGear,
      trips: localTrips,
    },
    cloudFootprint: {
      publicCatches,
      posts,
      stories,
      savedCatches,
      following,
      followers,
      followedHashtags,
      blockedUsers,
      notificationsRecent,
    },
  };
}

/**
 * High-level entry point: build the bundle, write it to a temp file with
 * a date-stamped filename, and surface the system share sheet so the user
 * can route the file wherever they like.
 *
 * Returns the path written so callers can show a success message; throws
 * on hard failures (file write, no sharing support, etc.) so the UI can
 * surface a sensible error toast.
 */
export async function exportMyDataAndShare(uid: string): Promise<string> {
  if (!uid) throw new Error('Не сте влезли в акаунт.');
  const bundle = await buildGdprExport(uid);

  // Date-stamp the filename so a user exporting multiple times gets clearly
  // distinguishable files in their share-target app (Files, Mail, etc.).
  const yyyyMmDd = new Date().toISOString().slice(0, 10);
  const fileName = `ribolov-export-${yyyyMmDd}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  const json = JSON.stringify(bundle, null, 2);
  try {
    await FileSystem.writeAsStringAsync(fileUri, json);
  } catch (e) {
    captureException(e, { area: 'gdpr_write_file', uid });
    throw new Error('Файлът не можа да бъде записан.');
  }

  if (!(await Sharing.isAvailableAsync())) {
    // Without the share sheet we can't deliver the file — surface the path
    // in the error so a developer can pull it manually if needed.
    throw new Error(`Споделянето не е налично. Файлът е записан на: ${fileUri}`);
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'Изтегли моите данни',
    UTI: 'public.json',
  });

  addBreadcrumb('gdpr', 'export_shared', { uid, bytes: String(json.length) });
  return fileUri;
}
