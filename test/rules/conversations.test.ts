import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

const CONV = 'alice_bob';

async function seedConv(participantData?: Record<string, unknown>) {
  await seed(async (db) => {
    await setDoc(doc(db, 'conversations', CONV), {
      participantIds: ['alice', 'bob'],
      participantNames: { alice: 'Alice', bob: 'Bob' },
      lastMessage: 'hi',
      unreadCounts: { alice: 0, bob: 0 },
      ...(participantData ? { participantData } : {}),
    });
  });
}

describe('conversations update rule', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  it('lets a participant mute their own entry (no prior participantData)', async () => {
    await seedConv();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'conversations', CONV), { participantData: { alice: { muted: true } } }),
    );
  });

  it('lets a participant flip muted on an existing own entry', async () => {
    await seedConv({ alice: { muted: false } });
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'conversations', CONV), { 'participantData.alice.muted': true }),
    );
  });

  it('DENIES injecting a pushToken into the caller own entry (the 2026-06-02 fix)', async () => {
    await seedConv();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(alice, 'conversations', CONV), {
        participantData: { alice: { muted: true, pushToken: 'ExponentPushToken[evil]' } },
      }),
    );
  });

  it('DENIES writing the PEER participantData entry', async () => {
    await seedConv();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(alice, 'conversations', CONV), { participantData: { bob: { muted: true } } }),
    );
  });

  it('lets a participant update lastMessage/unreadCounts when not blocked', async () => {
    await seedConv();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'conversations', CONV), {
        lastMessage: 'yo', lastMessageAt: 1, lastSenderUid: 'alice', unreadCounts: { alice: 0, bob: 1 },
      }),
    );
  });

  it('DENIES update from a non-participant', async () => {
    await seedConv();
    const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
    await assertFails(
      updateDoc(doc(carol, 'conversations', CONV), { lastMessage: 'intrusion' }),
    );
  });

  it('DENIES delete by a participant', async () => {
    await seedConv();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(deleteDoc(doc(alice, 'conversations', CONV)));
  });
});
