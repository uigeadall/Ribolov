import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

const GROUP = 'club1';

// Group created by bob; alice is a member, carol is NOT. memberCount seeded
// high so a "jump to 0" troll write is distinguishable from a +1 join.
async function seedGroup(creator = 'bob') {
  await seed(async (db) => {
    await setDoc(doc(db, 'groups', GROUP), {
      createdBy: creator, name: 'Бургаски кефалджии', memberCount: 10, postCount: 0,
    });
    await setDoc(doc(db, 'groups', GROUP, 'members', 'alice'), { uid: 'alice' });
  });
}

describe('groups rules', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  describe('group document', () => {
    it('SUCCEEDS create by the creator', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertSucceeds(
        setDoc(doc(alice, 'groups', 'g_new'), { createdBy: 'alice', name: 'Нов клуб' }),
      );
    });

    it('DENIES create with spoofed createdBy', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'groups', 'g_spoof'), { createdBy: 'bob', name: 'Нов клуб' }),
      );
    });

    it('DENIES create with a name over 60 chars', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'groups', 'g_long'), { createdBy: 'alice', name: 'x'.repeat(61) }),
      );
    });

    it('lets a non-creator bump memberCount +1 (join)', async () => {
      await seedGroup('bob');
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertSucceeds(updateDoc(doc(carol, 'groups', GROUP), { memberCount: 11 }));
    });

    it('DENIES a non-creator zeroing memberCount (troll)', async () => {
      await seedGroup('bob');
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(updateDoc(doc(carol, 'groups', GROUP), { memberCount: 0 }));
    });

    it('DENIES a non-creator editing the group name', async () => {
      await seedGroup('bob');
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(updateDoc(doc(carol, 'groups', GROUP), { name: 'hijacked' }));
    });

    it('lets the creator delete; denies a non-creator', async () => {
      await seedGroup('bob');
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(deleteDoc(doc(carol, 'groups', GROUP)));
      await assertSucceeds(deleteDoc(doc(bob, 'groups', GROUP)));
    });
  });

  describe('members subcollection', () => {
    it('lets a user add their own membership; denies adding someone else', async () => {
      await seedGroup('bob');
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(setDoc(doc(carol, 'groups', GROUP, 'members', 'dave'), { uid: 'dave' }));
      await assertSucceeds(setDoc(doc(carol, 'groups', GROUP, 'members', 'carol'), { uid: 'carol' }));
    });

    it('lets the group admin kick a member; denies a random user', async () => {
      await seedGroup('bob');
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      await assertFails(deleteDoc(doc(carol, 'groups', GROUP, 'members', 'alice')));
      await assertSucceeds(deleteDoc(doc(bob, 'groups', GROUP, 'members', 'alice')));
    });
  });

  describe('group posts — membership gated', () => {
    it('lets a MEMBER post; DENIES a NON-MEMBER', async () => {
      await seedGroup('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore(); // member
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore(); // not a member
      await assertFails(
        setDoc(doc(carol, 'groups', GROUP, 'posts', 'gp1'), { ownerUid: 'carol', text: 'hi' }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'groups', GROUP, 'posts', 'gp2'), { ownerUid: 'alice', text: 'hi' }),
      );
    });

    it('DENIES updating a group post (immutable)', async () => {
      await seedGroup('bob');
      await seed(async (db) => {
        await setDoc(doc(db, 'groups', GROUP, 'posts', 'gp3'), { ownerUid: 'alice', text: 'orig' });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(alice, 'groups', GROUP, 'posts', 'gp3'), { text: 'edited' }));
    });
  });

  describe('group events & polls — membership gated', () => {
    it('lets a member create an event; denies a non-member', async () => {
      await seedGroup('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      const carol = (await getTestEnv()).authenticatedContext('carol').firestore();
      const ev = { createdBy: '', title: 'Среща', dateIso: '2026-07-01' };
      await assertFails(
        setDoc(doc(carol, 'groups', GROUP, 'events', 'e1'), { ...ev, createdBy: 'carol' }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'groups', GROUP, 'events', 'e2'), { ...ev, createdBy: 'alice' }),
      );
    });

    it('lets a member create a valid poll; denies one with <2 options', async () => {
      await seedGroup('bob');
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'groups', GROUP, 'polls', 'p_bad'), {
          createdBy: 'alice', question: 'Кога?', options: ['само едно'],
        }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'groups', GROUP, 'polls', 'p_ok'), {
          createdBy: 'alice', question: 'Кога?', options: ['Събота', 'Неделя'],
        }),
      );
    });

    it('poll votes: self with valid optionIndex; denies out-of-range', async () => {
      await seedGroup('bob');
      await seed(async (db) => {
        await setDoc(doc(db, 'groups', GROUP, 'polls', 'p1'), {
          createdBy: 'alice', question: 'Кога?', options: ['Събота', 'Неделя'],
        });
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'groups', GROUP, 'polls', 'p1', 'votes', 'alice'), { optionIndex: 9 }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'groups', GROUP, 'polls', 'p1', 'votes', 'alice'), { optionIndex: 1 }),
      );
    });
  });
});
