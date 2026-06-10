import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes } from 'firebase/storage';
import { getStorageEnv } from './storage-setup';

// A buffer of n zero bytes — size is what the size-cap rules check.
const bytes = (n: number) => new Uint8Array(n);
const IMG = { contentType: 'image/jpeg' };
const VIDEO = { contentType: 'video/mp4' };
const BIN = { contentType: 'application/octet-stream' };

const TEN_MB = 10 * 1024 * 1024;

describe('storage rules', () => {
  beforeAll(async () => { await getStorageEnv(); });
  afterEach(async () => { await (await getStorageEnv()).clearStorage(); });
  afterAll(async () => { await (await getStorageEnv()).cleanup(); });

  describe('profilePhotos / publicCatchPhotos (owner-only, image, <=10MB)', () => {
    it('owner can upload an image under their own folder', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertSucceeds(uploadBytes(ref(alice, 'profilePhotos/alice/avatar.jpg'), bytes(1000), IMG));
      await assertSucceeds(uploadBytes(ref(alice, 'publicCatchPhotos/alice/catch.jpg'), bytes(1000), IMG));
    });

    it('DENIES uploading under another user’s folder', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertFails(uploadBytes(ref(alice, 'profilePhotos/bob/avatar.jpg'), bytes(1000), IMG));
    });

    it('DENIES a non-image content type', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/x.bin'), bytes(1000), BIN));
    });

    it('DENIES an image over the 10MB cap', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/big.jpg'), bytes(TEN_MB + 1), IMG));
    });

    it('DENIES an unauthenticated upload', async () => {
      const anon = (await getStorageEnv()).unauthenticatedContext().storage();
      await assertFails(uploadBytes(ref(anon, 'profilePhotos/alice/avatar.jpg'), bytes(1000), IMG));
    });
  });

  describe('damFeeds (owner-only, image, <=10MB)', () => {
    it('owner uploads to their own damFeeds path; denies another user’s', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertFails(uploadBytes(ref(alice, 'damFeeds/dam1/bob/p.jpg'), bytes(1000), IMG));
      await assertSucceeds(uploadBytes(ref(alice, 'damFeeds/dam1/alice/p.jpg'), bytes(1000), IMG));
    });
  });

  describe('stories (self, image OR video, <=100MB)', () => {
    it('owner can upload a video; denies another user’s folder', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertFails(uploadBytes(ref(alice, 'stories/bob/clip.mp4'), bytes(1000), VIDEO));
      await assertSucceeds(uploadBytes(ref(alice, 'stories/alice/clip.mp4'), bytes(1000), VIDEO));
    });
  });

  describe('chatMedia (participant-gated via convId)', () => {
    // convId is sorted(uid1, uid2).join('_'); a writer must be one of the two.
    it('a conversation participant can upload; a third party cannot', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      const carol = (await getStorageEnv()).authenticatedContext('carol').storage();
      await assertFails(uploadBytes(ref(carol, 'chatMedia/alice_bob/m.jpg'), bytes(1000), IMG));
      await assertSucceeds(uploadBytes(ref(alice, 'chatMedia/alice_bob/m.jpg'), bytes(1000), IMG));
    });

    it('DENIES a non-image in chatMedia', async () => {
      const alice = (await getStorageEnv()).authenticatedContext('alice').storage();
      await assertFails(uploadBytes(ref(alice, 'chatMedia/alice_bob/m.bin'), bytes(1000), BIN));
    });
  });
});
