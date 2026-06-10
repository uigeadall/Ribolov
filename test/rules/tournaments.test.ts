import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

const T = 'tour1';

// Tournament hosted by bob.
async function seedTournament(host = 'bob') {
  await seed(async (db) => {
    await setDoc(doc(db, 'tournaments', T), { hostUid: host, name: 'Пролетен турнир' });
  });
}

describe('tournaments rules', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  describe('tournament document', () => {
    it('SUCCEEDS create by the host; DENIES a spoofed hostUid', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'tournaments', 't_spoof'), { hostUid: 'bob' }));
      await assertSucceeds(setDoc(doc(alice, 'tournaments', 't_ok'), { hostUid: 'alice' }));
    });

    it('lets only the host update and delete', async () => {
      await seedTournament('bob');
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(alice, 'tournaments', T), { name: 'hijacked' }));
      await assertSucceeds(updateDoc(doc(bob, 'tournaments', T), { name: 'renamed' }));
      await assertFails(deleteDoc(doc(alice, 'tournaments', T)));
      await assertSucceeds(deleteDoc(doc(bob, 'tournaments', T)));
    });
  });

  describe('participants', () => {
    it('lets a user join as themselves; denies joining as someone else', async () => {
      await seedTournament('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'tournaments', T, 'participants', 'carol'), { uid: 'carol' }));
      await assertSucceeds(setDoc(doc(alice, 'tournaments', T, 'participants', 'alice'), { uid: 'alice' }));
    });

    it('lets the host remove a participant; denies a random user', async () => {
      await seedTournament('bob');
      await seed(async (db) => {
        await setDoc(doc(db, 'tournaments', T, 'participants', 'alice'), { uid: 'alice' });
      });
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(deleteDoc(doc(carol, 'tournaments', T, 'participants', 'alice')));
      await assertSucceeds(deleteDoc(doc(bob, 'tournaments', T, 'participants', 'alice')));
    });
  });

  describe('entries', () => {
    it('lets a user create their own entry; denies a spoofed ownerUid', async () => {
      await seedTournament('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'tournaments', T, 'entries', 'c1'), { ownerUid: 'bob' }));
      await assertSucceeds(setDoc(doc(alice, 'tournaments', T, 'entries', 'c2'), { ownerUid: 'alice' }));
    });
  });

  describe('photoEntries', () => {
    it('lets the owner create their own entry; denies writing under another uid', async () => {
      await seedTournament('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'tournaments', T, 'photoEntries', 'bob'), { ownerUid: 'bob' }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'tournaments', T, 'photoEntries', 'alice'), { ownerUid: 'alice', likeCount: 0 }),
      );
    });

    it('DENIES a photoEntry with a non-https photoUri', async () => {
      await seedTournament('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'tournaments', T, 'photoEntries', 'alice'), {
          ownerUid: 'alice', photoUri: 'http://insecure/p.jpg',
        }),
      );
    });

    it('lets a non-owner bump likeCount +1 but not jump it', async () => {
      await seedTournament('bob');
      await seed(async (db) => {
        await setDoc(doc(db, 'tournaments', T, 'photoEntries', 'bob'), { ownerUid: 'bob', likeCount: 0 });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(alice, 'tournaments', T, 'photoEntries', 'bob'), { likeCount: 5 }));
      await assertSucceeds(updateDoc(doc(alice, 'tournaments', T, 'photoEntries', 'bob'), { likeCount: 1 }));
    });

    it('entry likes: self write; denies under another uid', async () => {
      await seedTournament('bob');
      await seed(async (db) => {
        await setDoc(doc(db, 'tournaments', T, 'photoEntries', 'bob'), { ownerUid: 'bob', likeCount: 0 });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'tournaments', T, 'photoEntries', 'bob', 'likes', 'carol'), { v: 1 }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'tournaments', T, 'photoEntries', 'bob', 'likes', 'alice'), { v: 1 }),
      );
    });
  });
});
