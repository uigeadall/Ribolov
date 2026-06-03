import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

const CATCH = 'catch1';

async function seedCatch() {
  await seed(async (db) => {
    await setDoc(doc(db, 'publicCatches', CATCH), {
      ownerUid: 'bob',
      speciesName: 'Костур',
      likeCount: 0,
      reactionCounts: { heart: 0 },
    });
  });
}

describe('publicCatches update/delete rule', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  it('lets a non-owner bump likeCount +1 and a reaction +1', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'publicCatches', CATCH), { likeCount: 1, reactionCounts: { heart: 1 } }),
    );
  });

  it('DENIES a likeCount jump greater than 1', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(alice, 'publicCatches', CATCH), { likeCount: 5 }));
  });

  it('DENIES a reaction tally jump greater than 1', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(alice, 'publicCatches', CATCH), { likeCount: 1, reactionCounts: { heart: 3 } }),
    );
  });

  it('DENIES a non-owner changing ownerUid', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(alice, 'publicCatches', CATCH), { likeCount: 1, ownerUid: 'alice' }),
    );
  });

  it('lets the owner delete; denies a non-owner delete', async () => {
    await seedCatch();
    const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(deleteDoc(doc(alice, 'publicCatches', CATCH)));
    await assertSucceeds(deleteDoc(doc(bob, 'publicCatches', CATCH)));
  });
});
