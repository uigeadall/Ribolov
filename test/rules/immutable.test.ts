import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seed } from './setup';

// Collections that use `allow update: if false`. The shared property under
// test: owner-only create with field validation, NO updates ever (not even by
// the owner), owner-only delete.
describe('immutable collections', () => {
  beforeAll(async () => { await getTestEnv(); });
  afterEach(async () => { await (await getTestEnv()).clearFirestore(); });
  afterAll(async () => { await (await getTestEnv()).cleanup(); });

  describe('liveFishingPins', () => {
    const validPin = (owner: string) => ({
      ownerUid: owner,
      ownerName: 'Alice',
      latitude: 42.5,
      longitude: 27.4,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1h ahead (rule: future, <=5h)
    });

    it('SUCCEEDS owner create; DENIES spoofed ownerUid', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'liveFishingPins', 'p_spoof'), validPin('bob')));
      await assertSucceeds(setDoc(doc(alice, 'liveFishingPins', 'p_ok'), validPin('alice')));
    });

    it('DENIES create with expiresAt in the past', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'liveFishingPins', 'p_old'), { ...validPin('alice'), expiresAt: Date.now() - 1000 }),
      );
    });

    it('DENIES update even by the owner (immutable); owner-only delete', async () => {
      await seed(async (db) => { await setDoc(doc(db, 'liveFishingPins', 'p1'), validPin('alice')); });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      await assertFails(updateDoc(doc(alice, 'liveFishingPins', 'p1'), { note: 'edited' }));
      await assertFails(deleteDoc(doc(bob, 'liveFishingPins', 'p1')));
      await assertSucceeds(deleteDoc(doc(alice, 'liveFishingPins', 'p1')));
    });
  });

  describe('damFeeds/feedPosts', () => {
    const DAM = 'dam_studen_kladenets';
    const validPost = (owner: string) => ({
      ownerUid: owner,
      damId: DAM,
      photoUrl: 'https://cdn.example.com/x.jpg',
      storagePath: `damFeeds/${DAM}/${owner}/x.jpg`,
    });

    it('SUCCEEDS owner create; DENIES a damId that mismatches the path', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(
        setDoc(doc(alice, 'damFeeds', DAM, 'feedPosts', 'x1'), { ...validPost('alice'), damId: 'other_dam' }),
      );
      await assertSucceeds(
        setDoc(doc(alice, 'damFeeds', DAM, 'feedPosts', 'x2'), validPost('alice')),
      );
    });

    it('DENIES update (immutable); owner-only delete', async () => {
      const DAM2 = DAM;
      await seed(async (db) => {
        await setDoc(doc(db, 'damFeeds', DAM2, 'feedPosts', 'd1'), validPost('alice'));
      });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      await assertFails(updateDoc(doc(alice, 'damFeeds', DAM2, 'feedPosts', 'd1'), { photoUrl: 'https://cdn.example.com/y.jpg' }));
      await assertFails(deleteDoc(doc(bob, 'damFeeds', DAM2, 'feedPosts', 'd1')));
      await assertSucceeds(deleteDoc(doc(alice, 'damFeeds', DAM2, 'feedPosts', 'd1')));
    });
  });

  describe('stories', () => {
    const validStory = (uid: string) => ({
      uid,
      mediaType: 'photo',
      mediaUrl: 'https://cdn.example.com/s.jpg',
      text: 'на язовира',
    });

    it('SUCCEEDS owner create; DENIES spoofed uid and bad mediaType', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'stories', 's_spoof'), validStory('bob')));
      await assertFails(setDoc(doc(alice, 'stories', 's_bad'), { ...validStory('alice'), mediaType: 'gif' }));
      await assertSucceeds(setDoc(doc(alice, 'stories', 's_ok'), validStory('alice')));
    });

    it('DENIES update (immutable); owner-only delete', async () => {
      await seed(async (db) => { await setDoc(doc(db, 'stories', 's1'), validStory('alice')); });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      await assertFails(updateDoc(doc(alice, 'stories', 's1'), { text: 'edited' }));
      await assertFails(deleteDoc(doc(bob, 'stories', 's1')));
      await assertSucceeds(deleteDoc(doc(alice, 'stories', 's1')));
    });
  });

  describe('waterReports', () => {
    const validReport = (reporter: string) => ({
      reporterUid: reporter,
      fishingActivity: 4,
      waterCondition: 'clear',
      note: 'кълве на воблер',
    });

    it('SUCCEEDS owner create; DENIES out-of-range activity and bad condition', async () => {
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(alice, 'waterReports', 'w_a'), { ...validReport('alice'), fishingActivity: 9 }));
      await assertFails(setDoc(doc(alice, 'waterReports', 'w_b'), { ...validReport('alice'), waterCondition: 'frozen' }));
      await assertSucceeds(setDoc(doc(alice, 'waterReports', 'w_ok'), validReport('alice')));
    });

    it('DENIES update (immutable); reporter-only delete', async () => {
      await seed(async (db) => { await setDoc(doc(db, 'waterReports', 'w1'), validReport('alice')); });
      const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
      const bob = (await getTestEnv()).authenticatedContext('bob').firestore();
      await assertFails(updateDoc(doc(alice, 'waterReports', 'w1'), { note: 'edited' }));
      await assertFails(deleteDoc(doc(bob, 'waterReports', 'w1')));
      await assertSucceeds(deleteDoc(doc(alice, 'waterReports', 'w1')));
    });
  });
});
