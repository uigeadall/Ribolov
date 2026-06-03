import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

async function seedUser() {
  await seed(async (db) => {
    await setDoc(doc(db, 'users', 'bob'), { uid: 'bob', displayName: 'Bob' });
    await setDoc(doc(db, 'users', 'bob', 'private', 'pushToken'), { expoPushToken: 'ExponentPushToken[bob]' });
  });
}

describe('users + private rules', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  it('lets any signed-in user read a user doc; denies unauthenticated read', async () => {
    await seedUser();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    const anon = (await getTestEnv()).unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(alice, 'users', 'bob')));
    await assertFails(getDoc(doc(anon, 'users', 'bob')));
  });

  it('lets a user write their own doc with matching uid; denies mismatched uid', async () => {
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(alice, 'users', 'alice'), { uid: 'alice', displayName: 'Alice' }));
    await assertFails(setDoc(doc(alice, 'users', 'alice'), { uid: 'bob', displayName: 'Spoof' }));
  });

  it('DENIES a user writing another user doc', async () => {
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(alice, 'users', 'bob'), { uid: 'bob', displayName: 'Hijack' }));
  });

  it('keeps the private push token owner-only', async () => {
    await seedUser();
    const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(bob, 'users', 'bob', 'private', 'pushToken')));
    await assertFails(getDoc(doc(alice, 'users', 'bob', 'private', 'pushToken')));
    await assertFails(setDoc(doc(alice, 'users', 'bob', 'private', 'pushToken'), { expoPushToken: 'ExponentPushToken[evil]' }));
  });
});
