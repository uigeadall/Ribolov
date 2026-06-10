import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

// One lifecycle per file: the shared RulesTestEnvironment singleton is
// torn down once in afterAll. Nested describes are for grouping only and
// must NOT register their own cleanup() (it would destroy the shared env
// for the groups that follow).
describe('server-only + contentReports rules', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  // These collections are written exclusively by Cloud Functions via the admin
  // SDK (which bypasses rules). A client must never be able to forge or reset
  // them — forging leaderboard rows would let anyone top the standings, and
  // writing rateLimits would let a caller reset their own bucket and bypass the
  // server-side limiter entirely.
  describe('server-only collections — client writes denied', () => {
    it('leaderboardCache: signed-in can READ but cannot WRITE', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'leaderboardCache', 'global_week'), { rows: [] });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(getDoc(doc(alice, 'leaderboardCache', 'global_week')));
      await assertFails(
        setDoc(doc(alice, 'leaderboardCache', 'global_week'), { rows: [{ uid: 'alice', total: 999 }] }),
      );
    });

    it('leaderboardCache: unauthenticated cannot read', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'leaderboardCache', 'global_week'), { rows: [] });
      });
      const anon = (await getTestEnv()).unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(anon, 'leaderboardCache', 'global_week')));
    });

    it('leaderboardRollup: signed-in can READ but cannot WRITE', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'leaderboardRollup', 'week_2026W24_alice'), { total: 5 });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(getDoc(doc(alice, 'leaderboardRollup', 'week_2026W24_alice')));
      await assertFails(
        updateDoc(doc(alice, 'leaderboardRollup', 'week_2026W24_alice'), { total: 99999 }),
      );
    });

    it('classicsCache: signed-in can READ but cannot WRITE', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'classicsCache', 'week'), { photos: [] });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(getDoc(doc(alice, 'classicsCache', 'week')));
      await assertFails(setDoc(doc(alice, 'classicsCache', 'week'), { photos: ['forged'] }));
    });

    it('rateLimits: signed-in can NEITHER read nor write (no self-reset)', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'rateLimits', 'alice_deleteMyAccount'), { count: 1 });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(getDoc(doc(alice, 'rateLimits', 'alice_deleteMyAccount')));
      await assertFails(setDoc(doc(alice, 'rateLimits', 'alice_deleteMyAccount'), { count: 0 }));
    });
  });

  // contentReports is a one-way moderation inbox: anyone signed-in can FILE a
  // report about themselves as reporter, but nobody can read, edit, or delete
  // reports (that happens server-side / in the console).
  describe('contentReports — create-only moderation inbox', () => {
    const validReport = (reporter: string) => ({
      reporterUid: reporter,
      targetType: 'catch',
      catchId: 'catch123',
      reason: 'spam content here',
    });

    it('create SUCCEEDS with a valid report by the reporter', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(setDoc(doc(alice, 'contentReports', 'r1'), validReport('alice')));
    });

    it('DENIES create that spoofs reporterUid as someone else', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'contentReports', 'r2'), validReport('bob')));
    });

    it('DENIES create with an out-of-enum targetType', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'contentReports', 'r3'), { ...validReport('alice'), targetType: 'user' }),
      );
    });

    it('DENIES create with a too-short reason', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'contentReports', 'r4'), { ...validReport('alice'), reason: 'x' }),
      );
    });

    it('DENIES reading a report (read:false, even your own)', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'contentReports', 'r5'), validReport('alice'));
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(getDoc(doc(alice, 'contentReports', 'r5')));
    });

    it('DENIES update and delete of a report', async () => {
      await seed(async (db) => {
        await setDoc(doc(db, 'contentReports', 'r6'), validReport('alice'));
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(alice, 'contentReports', 'r6'), { reason: 'edited reason text' }));
      await assertFails(deleteDoc(doc(alice, 'contentReports', 'r6')));
    });
  });
});
