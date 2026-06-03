import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

// A valid "follow" notification under bob's collection, authored by alice.
const followNotif = {
  actorUid: 'alice',
  actorName: 'Alice',
  type: 'follow',
  preview: '',
  read: false,
};

describe('notifications rules', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  it('lets an actor create a valid follow notification on the recipient', async () => {
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(alice, 'users', 'bob', 'notifications', 'follow_alice'), followNotif),
    );
  });

  it('DENIES an actor spoofing a different actorUid', async () => {
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(alice, 'users', 'bob', 'notifications', 'follow_x'), { ...followNotif, actorUid: 'carol' }),
    );
  });

  it("DENIES actor B overwriting actor A's existing slot", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', 'bob', 'notifications', 'follow_slot'), followNotif);
    });
    const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
    await assertFails(
      setDoc(doc(carol, 'users', 'bob', 'notifications', 'follow_slot'), { ...followNotif, actorUid: 'carol' }),
    );
  });

  it('lets the recipient read and delete; denies a third party read', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', 'bob', 'notifications', 'follow_slot'), followNotif);
    });
    const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
    const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
    await assertFails(getDoc(doc(carol, 'users', 'bob', 'notifications', 'follow_slot')));
    await assertSucceeds(getDoc(doc(bob, 'users', 'bob', 'notifications', 'follow_slot')));
    await assertSucceeds(deleteDoc(doc(bob, 'users', 'bob', 'notifications', 'follow_slot')));
  });
});
