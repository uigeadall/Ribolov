import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

const POST = 'post1';

// A post owned by bob with zeroed counters, so non-owner ±1 bumps are testable.
async function seedPost(ownerUid = 'bob') {
  await seed(async (db) => {
    await setDoc(doc(db, 'posts', POST), {
      ownerUid,
      ownerName: 'Bob',
      text: 'Hello lake',
      likeCount: 0,
      commentCount: 0,
      reactionCounts: { heart: 0 },
    });
  });
}

describe('posts rules', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  describe('create', () => {
    it('SUCCEEDS for the owner with valid minimal data', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(
        setDoc(doc(alice, 'posts', 'p_new'), { ownerUid: 'alice', ownerName: 'Alice', text: 'hi' }),
      );
    });

    it('DENIES create that spoofs ownerUid', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'posts', 'p_spoof'), { ownerUid: 'bob', ownerName: 'Alice', text: 'hi' }),
      );
    });

    it('DENIES create with text over 2000 chars', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'posts', 'p_long'), {
          ownerUid: 'alice', ownerName: 'Alice', text: 'x'.repeat(2001),
        }),
      );
    });

    it('DENIES create with a non-https photoUri', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'posts', 'p_uri'), {
          ownerUid: 'alice', ownerName: 'Alice', text: 'hi', photoUri: 'http://insecure/x.jpg',
        }),
      );
    });
  });

  describe('update', () => {
    it('lets the OWNER edit text freely', async () => {
      await seedPost('bob');
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      await assertSucceeds(updateDoc(doc(bob, 'posts', POST), { text: 'edited' }));
    });

    it('lets a NON-OWNER bump likeCount +1', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(updateDoc(doc(alice, 'posts', POST), { likeCount: 1 }));
    });

    it('DENIES a non-owner likeCount jump greater than 1', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(alice, 'posts', POST), { likeCount: 5 }));
    });

    it('DENIES a non-owner editing the text', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(alice, 'posts', POST), { text: 'hijacked' }));
    });
  });

  describe('delete', () => {
    it('lets the owner delete; denies a non-owner', async () => {
      await seedPost('bob');
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(deleteDoc(doc(alice, 'posts', POST)));
      await assertSucceeds(deleteDoc(doc(bob, 'posts', POST)));
    });
  });

  describe('likes subcollection', () => {
    it('lets a user like with a valid reaction under their own uid', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(
        setDoc(doc(alice, 'posts', POST, 'likes', 'alice'), { reaction: 'fire' }),
      );
    });

    it('DENIES a like with an out-of-enum reaction', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'posts', POST, 'likes', 'alice'), { reaction: 'rocket' }),
      );
    });

    it('DENIES liking under another user’s uid', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'posts', POST, 'likes', 'bob'), { reaction: 'heart' }),
      );
    });
  });

  describe('comments subcollection', () => {
    it('SUCCEEDS creating a comment as the author', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(
        setDoc(doc(alice, 'posts', POST, 'comments', 'c1'), {
          authorUid: 'alice', authorName: 'Alice', text: 'nice catch', createdAt: serverTimestamp(),
        }),
      );
    });

    it('DENIES a comment with a spoofed authorUid', async () => {
      await seedPost('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'posts', POST, 'comments', 'c2'), {
          authorUid: 'bob', authorName: 'Alice', text: 'nice catch', createdAt: serverTimestamp(),
        }),
      );
    });

    it('lets the POST OWNER delete someone else’s comment (moderation)', async () => {
      await seedPost('bob');
      await seed(async (db) => {
        await setDoc(doc(db, 'posts', POST, 'comments', 'c3'), {
          authorUid: 'alice', authorName: 'Alice', text: 'spam',
        });
      });
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(deleteDoc(doc(carol, 'posts', POST, 'comments', 'c3')));
      await assertSucceeds(deleteDoc(doc(bob, 'posts', POST, 'comments', 'c3')));
    });
  });
});
