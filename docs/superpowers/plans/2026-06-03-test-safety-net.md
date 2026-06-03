# Test Safety Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a focused automated-test safety net: a Vitest logic suite for the deterministic core services and a `@firebase/rules-unit-testing` suite that locks in the 2026-06-02 Firestore-rules security hardening.

**Architecture:** One Vitest runner at the repo root, two suites split by directory. `test/logic/` runs in plain Node (no emulator). `test/rules/` runs against the Firestore emulator via `firebase emulators:exec`. Tests characterize existing, already-shipped code — so a correctly-written test PASSES on first run; a failure means either a real regression or a wrong expectation to investigate.

**Tech Stack:** Vitest, `@firebase/rules-unit-testing`, the Firebase JS SDK (`firebase/firestore`, already a dependency at `^12.12.1`), the Firebase CLI + Java (both already installed).

---

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` (create) | Vitest config: node env, test glob, timeouts, firebase ESM inlining |
| `package.json` (modify) | Add `test`, `test:watch`, `test:rules`, `test:all` scripts + devDeps |
| `firebase.json` (modify) | Add deterministic `emulators.firestore` port |
| `test/logic/firestoreSanitize.test.ts` (create) | `stripUndefinedForFirestore` behavior |
| `test/logic/feedRanking.test.ts` (create) | `scoreFeedItem` / `rankFeedItems` behavior |
| `test/logic/solunar.test.ts` (create) | `getSolunarDay` invariants + determinism |
| `test/logic/personalBests.test.ts` (create) | PB computation/detection |
| `test/rules/setup.ts` (create) | Shared test-environment harness (load rules, seed, clear) |
| `test/rules/conversations.test.ts` (create) | conversation update branches — the pushToken/muted fix |
| `test/rules/catches-posts.test.ts` (create) | publicCatches social-counter ±1 bounds |
| `test/rules/users-private.test.ts` (create) | user-doc + private push-token authz |
| `test/rules/notifications.test.ts` (create) | notification create/overwrite/read authz |

---

## Task 1: Scaffold the Vitest runner + a smoke test

**Files:**
- Modify: `package.json` (add devDeps + scripts)
- Create: `vitest.config.ts`
- Modify: `firebase.json` (add emulators block)
- Create: `test/logic/smoke.test.ts` (temporary, deleted in Task 6)

- [ ] **Step 1: Install dev dependencies**

Run from the repo root (`~/Desktop/ribolov-app`):
```bash
npm install -D vitest@^2 @firebase/rules-unit-testing@^4
```
Expected: both packages added to `devDependencies`, no peer-dep errors.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Firebase v12 ships ESM with conditional exports that Vite occasionally
    // fails to pre-bundle under SSR/node. Inlining sidesteps that.
    server: { deps: { inline: ['firebase', '@firebase/rules-unit-testing'] } },
  },
});
```

- [ ] **Step 3: Add scripts to `package.json`**

In the `"scripts"` block, add these four entries (keep the existing ones):
```json
"test": "vitest run test/logic",
"test:watch": "vitest test/logic",
"test:rules": "firebase emulators:exec --only firestore 'vitest run test/rules'",
"test:all": "npm test && npm run test:rules"
```

- [ ] **Step 4: Add the emulator block to `firebase.json`**

Add this top-level key alongside the existing `"firestore"`, `"functions"`, `"storage"` keys:
```json
"emulators": {
  "firestore": { "port": 8080 },
  "ui": { "enabled": false },
  "singleProjectMode": true
}
```

- [ ] **Step 5: Write a temporary smoke test**

Create `test/logic/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the logic suite to verify the runner works**

Run: `npm test`
Expected: PASS — 1 test file, 1 test passing. No emulator/Java needed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts firebase.json test/logic/smoke.test.ts
git commit -m "test: scaffold vitest runner + emulator config"
```

---

## Task 2: Logic tests — `firestoreSanitize`

**Files:**
- Test: `test/logic/firestoreSanitize.test.ts`
- Under test (do not modify): `src/services/firestoreSanitize.ts`

Behavior reference: `stripUndefinedForFirestore` recursively drops `undefined`, preserves `null`/primitives, preserves `FieldValue` (e.g. `serverTimestamp()`, `deleteField()`) and `Timestamp` instances as opaque leaves, recurses objects, and maps+filters arrays (dropping `undefined` elements).

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { serverTimestamp, deleteField, Timestamp, FieldValue } from 'firebase/firestore';
import { stripUndefinedForFirestore } from '../../src/services/firestoreSanitize';

describe('stripUndefinedForFirestore', () => {
  it('drops top-level undefined keys', () => {
    const out = stripUndefinedForFirestore({ a: 1, b: undefined, c: 'x' });
    expect(out).toEqual({ a: 1, c: 'x' });
    expect('b' in out).toBe(false);
  });

  it('preserves null, 0, empty string, and false', () => {
    const out = stripUndefinedForFirestore({ a: null, b: 0, c: '', d: false });
    expect(out).toEqual({ a: null, b: 0, c: '', d: false });
  });

  it('recurses into nested objects', () => {
    const out = stripUndefinedForFirestore({ outer: { keep: 1, drop: undefined } });
    expect(out).toEqual({ outer: { keep: 1 } });
  });

  it('maps arrays and filters undefined elements', () => {
    const out = stripUndefinedForFirestore({ list: [1, undefined, 2] });
    expect(out).toEqual({ list: [1, 2] });
  });

  it('preserves FieldValue sentinels as opaque leaves', () => {
    const out = stripUndefinedForFirestore({ ts: serverTimestamp(), del: deleteField() });
    expect(out.ts).toBeInstanceOf(FieldValue);
    expect(out.del).toBeInstanceOf(FieldValue);
  });

  it('preserves Timestamp instances as opaque leaves', () => {
    const ts = Timestamp.fromMillis(1_700_000_000_000);
    const out = stripUndefinedForFirestore({ when: ts });
    expect(out.when).toBe(ts);
    expect(out.when).toBeInstanceOf(Timestamp);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/logic/firestoreSanitize.test.ts`
Expected: PASS — 6 tests. (The code already exists; these characterize it.) If the FieldValue/Timestamp imports throw an ESM error, confirm Step 1 of Task 1's `server.deps.inline` is present in `vitest.config.ts`.

- [ ] **Step 3: Commit**

```bash
git add test/logic/firestoreSanitize.test.ts
git commit -m "test: cover stripUndefinedForFirestore"
```

---

## Task 3: Logic tests — `feedRanking`

**Files:**
- Test: `test/logic/feedRanking.test.ts`
- Under test (do not modify): `src/services/feedRanking.ts`

Behavior reference: `scoreFeedItem` returns `-Infinity` for the user's own catch (`myUid === ownerUid`), hidden authors, and not-interested catch ids. Otherwise score = recency decay (half-life 24h) × follow/spot/species boosts + engagement. `rankFeedItems` scores all items, drops non-finite scores, and returns a new array sorted by descending score.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { scoreFeedItem, rankFeedItems, type RankingSignals } from '../../src/services/feedRanking';
import type { FeedItem } from '../../src/services/catchSync';

// Minimal FeedItem factory — only the fields scoreFeedItem reads.
function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'c1',
    speciesId: 'sp1',
    speciesName: 'Костур',
    date: new Date().toISOString(),
    ownerUid: 'bob',
    ...over,
  } as FeedItem;
}

function signals(over: Partial<RankingSignals> = {}): RankingSignals {
  return {
    followedUids: new Set<string>(),
    favoriteSpotCoords: [],
    topSpeciesIds: new Set<string>(),
    myUid: 'me',
    ...over,
  };
}

describe('scoreFeedItem', () => {
  it('hides my own catches with -Infinity', () => {
    expect(scoreFeedItem(item({ ownerUid: 'me' }), signals({ myUid: 'me' }))).toBe(-Infinity);
  });

  it('drops hidden authors with -Infinity', () => {
    const s = signals({ hiddenAuthorUids: new Set(['bob']) });
    expect(scoreFeedItem(item({ ownerUid: 'bob' }), s)).toBe(-Infinity);
  });

  it('drops not-interested catch ids with -Infinity', () => {
    const s = signals({ notInterestedCatchIds: new Set(['c1']) });
    expect(scoreFeedItem(item({ id: 'c1' }), s)).toBe(-Infinity);
  });

  it('scores a followed author higher than a non-followed one (same recency)', () => {
    const date = new Date().toISOString();
    const followed = scoreFeedItem(item({ ownerUid: 'bob', date }), signals({ followedUids: new Set(['bob']) }));
    const plain = scoreFeedItem(item({ ownerUid: 'bob', date }), signals());
    expect(followed).toBeGreaterThan(plain);
  });

  it('scores a fresher catch higher than an older one (all else equal)', () => {
    const fresh = scoreFeedItem(item({ date: new Date().toISOString() }), signals());
    const old = scoreFeedItem(item({ date: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() }), signals());
    expect(fresh).toBeGreaterThan(old);
  });
});

describe('rankFeedItems', () => {
  it('returns [] for empty input', () => {
    expect(rankFeedItems([], signals())).toEqual([]);
  });

  it('excludes hidden items and sorts the rest by descending score', () => {
    const fresh = item({ id: 'fresh', ownerUid: 'bob', date: new Date().toISOString() });
    const old = item({ id: 'old', ownerUid: 'bob', date: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() });
    const hidden = item({ id: 'hidden', ownerUid: 'carol' });
    const out = rankFeedItems([old, hidden, fresh], signals({ hiddenAuthorUids: new Set(['carol']) }));
    expect(out.map((i) => i.id)).toEqual(['fresh', 'old']);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/logic/feedRanking.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
git add test/logic/feedRanking.test.ts
git commit -m "test: cover feed ranking score + rank"
```

---

## Task 4: Logic tests — `solunar`

**Files:**
- Test: `test/logic/solunar.test.ts`
- Under test (do not modify): `src/services/solunar.ts`

Behavior reference: `getSolunarDay(lat, lon, date)` returns `{ date, illumination (0..1), ageDays (0..~29.5), phaseName, phaseLabel, rating (1..5), periods }`. The moon math is private; we assert public invariants + determinism (this still catches a broken illumination formula, an out-of-range rating, or unsorted periods). We deliberately do NOT hard-code magic phase values to avoid coupling to the epoch constant.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { getSolunarDay } from '../../src/services/solunar';

const PHASES = [
  'new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous',
  'full', 'waningGibbous', 'lastQuarter', 'waningCrescent',
];

// Sofia-ish coordinates; date is fixed so the test is deterministic.
const LAT = 42.7;
const LON = 23.3;
const REF = new Date('2024-01-11T12:00:00.000Z'); // near a new moon

describe('getSolunarDay', () => {
  it('returns illumination within 0..1', () => {
    const d = getSolunarDay(LAT, LON, REF);
    expect(d.illumination).toBeGreaterThanOrEqual(0);
    expect(d.illumination).toBeLessThanOrEqual(1);
  });

  it('returns ageDays within the synodic month', () => {
    const d = getSolunarDay(LAT, LON, REF);
    expect(d.ageDays).toBeGreaterThanOrEqual(0);
    expect(d.ageDays).toBeLessThanOrEqual(29.6);
  });

  it('returns a known phase name and a 1..5 rating', () => {
    const d = getSolunarDay(LAT, LON, REF);
    expect(PHASES).toContain(d.phaseName);
    expect([1, 2, 3, 4, 5]).toContain(d.rating);
  });

  it('returns periods sorted ascending by start time', () => {
    const { periods } = getSolunarDay(LAT, LON, REF);
    const starts = periods.map((p) => p.start);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });

  it('is deterministic for the same date and coordinates', () => {
    const a = getSolunarDay(LAT, LON, REF);
    const b = getSolunarDay(LAT, LON, REF);
    expect(a).toEqual(b);
  });

  it('produces different illumination ~half a cycle apart', () => {
    const a = getSolunarDay(LAT, LON, REF);
    const b = getSolunarDay(LAT, LON, new Date('2024-01-25T12:00:00.000Z'));
    expect(Math.abs(a.illumination - b.illumination)).toBeGreaterThan(0.3);
  });
});
```

> **Note on `periods[].start`:** the test assumes `SolunarPeriod.start` is a numeric (epoch/hour) sortable value. If the implementation names the field differently (e.g. `startMs`/`startHour`) or uses a string, read `src/services/solunar.ts` (the `SolunarPeriod` type, ~line 36) and adjust the property name in the sort test only. Do not change the other tests.

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/logic/solunar.test.ts`
Expected: PASS — 6 tests. If the `periods` sort test fails on a property name, apply the note above. If the "half a cycle apart" test fails, widen the date gap or lower the `0.3` threshold to `0.2` — it only needs to prove illumination varies with date.

- [ ] **Step 3: Commit**

```bash
git add test/logic/solunar.test.ts
git commit -m "test: cover solunar day invariants"
```

---

## Task 5: Logic tests — `personalBests`

**Files:**
- Test: `test/logic/personalBests.test.ts`
- Under test (do not modify): `src/services/personalBests.ts`

Behavior reference: `computePersonalBests(catches)` returns a `Map<speciesId, PersonalBest>`; the first qualifying catch seeds the PB, a heavier catch overtakes `weightKg`+`catchId`+`weightCatchId`, a longer catch overtakes `lengthCm`+`lengthCatchId` independently. Catches with both `weightKg` and `lengthCm` zero/absent are skipped. `isPersonalBestCatch(c, bests)` is true if `c.id` holds either the weight or length record. `checkNewPersonalBest(newCatch, all)` reports `weight`/`length`/`both`/`null` vs prior catches of the same species (strictly greater).

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  computePersonalBests,
  isPersonalBestCatch,
  checkNewPersonalBest,
} from '../../src/services/personalBests';
import type { Catch } from '../../src/types/index';

function c(over: Partial<Catch> = {}): Catch {
  return {
    id: 'id',
    speciesId: 'sp1',
    speciesName: 'Шаран',
    date: '2024-05-01T00:00:00.000Z',
    ...over,
  } as Catch;
}

describe('computePersonalBests', () => {
  it('seeds the PB from the first qualifying catch', () => {
    const bests = computePersonalBests([c({ id: 'a', weightKg: 2, lengthCm: 40 })]);
    const pb = bests.get('sp1')!;
    expect(pb.weightKg).toBe(2);
    expect(pb.catchId).toBe('a');
    expect(pb.weightCatchId).toBe('a');
    expect(pb.lengthCatchId).toBe('a');
  });

  it('lets a heavier catch overtake the weight record', () => {
    const bests = computePersonalBests([
      c({ id: 'a', weightKg: 2, lengthCm: 40 }),
      c({ id: 'b', weightKg: 5, lengthCm: 30 }),
    ]);
    const pb = bests.get('sp1')!;
    expect(pb.weightKg).toBe(5);
    expect(pb.weightCatchId).toBe('b');
    expect(pb.catchId).toBe('b');
  });

  it('tracks weight and length records on different catches independently', () => {
    const bests = computePersonalBests([
      c({ id: 'heavy', weightKg: 9, lengthCm: 20 }),
      c({ id: 'long', weightKg: 1, lengthCm: 80 }),
    ]);
    const pb = bests.get('sp1')!;
    expect(pb.weightCatchId).toBe('heavy');
    expect(pb.lengthCatchId).toBe('long');
  });

  it('skips catches with no weight and no length', () => {
    const bests = computePersonalBests([c({ id: 'empty' })]);
    expect(bests.has('sp1')).toBe(false);
  });
});

describe('isPersonalBestCatch', () => {
  it('is true for a catch holding either dimension record', () => {
    const catches = [
      c({ id: 'heavy', weightKg: 9, lengthCm: 20 }),
      c({ id: 'long', weightKg: 1, lengthCm: 80 }),
    ];
    const bests = computePersonalBests(catches);
    expect(isPersonalBestCatch(catches[0], bests)).toBe(true); // weight holder
    expect(isPersonalBestCatch(catches[1], bests)).toBe(true); // length holder
  });

  it('is false for a non-record catch', () => {
    const catches = [
      c({ id: 'best', weightKg: 9, lengthCm: 80 }),
      c({ id: 'mid', weightKg: 3, lengthCm: 30 }),
    ];
    const bests = computePersonalBests(catches);
    expect(isPersonalBestCatch(catches[1], bests)).toBe(false);
  });
});

describe('checkNewPersonalBest', () => {
  const prior = [c({ id: 'p', weightKg: 4, lengthCm: 50 })];

  it('reports "both" when the new catch beats weight and length', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 5, lengthCm: 60 }), prior))
      .toEqual({ isNew: true, field: 'both' });
  });

  it('reports "weight" when only weight is beaten', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 5, lengthCm: 10 }), prior))
      .toEqual({ isNew: true, field: 'weight' });
  });

  it('reports "length" when only length is beaten', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 1, lengthCm: 60 }), prior))
      .toEqual({ isNew: true, field: 'length' });
  });

  it('reports not-new when neither dimension is beaten', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 4, lengthCm: 50 }), prior))
      .toEqual({ isNew: false, field: null });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/logic/personalBests.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 3: Commit**

```bash
git add test/logic/personalBests.test.ts
git commit -m "test: cover personal-best computation + detection"
```

---

## Task 6: Rules harness — `test/rules/setup.ts` + remove smoke test

**Files:**
- Create: `test/rules/setup.ts`
- Delete: `test/logic/smoke.test.ts`

- [ ] **Step 1: Write the harness**

```ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const __dirname = dirname(fileURLToPath(import.meta.url));

let env: RulesTestEnvironment | null = null;

/** Lazily build the shared test environment from the real firestore.rules.
    Host/port come from FIRESTORE_EMULATOR_HOST (set by `emulators:exec`),
    falling back to the firebase.json default. */
export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (env) return env;
  const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-ribolov-rules',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host,
      port: Number(portStr),
    },
  });
  return env;
}

/** Seed documents bypassing security rules (for arranging test state). */
export async function seed(
  fn: (db: import('firebase/firestore').Firestore) => Promise<void>,
): Promise<void> {
  const e = await getTestEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as import('firebase/firestore').Firestore);
  });
}
```

- [ ] **Step 2: Delete the temporary smoke test**

```bash
git rm test/logic/smoke.test.ts
```

- [ ] **Step 3: Verify the logic suite still passes without the smoke test**

Run: `npm test`
Expected: PASS — 4 logic files (firestoreSanitize, feedRanking, solunar, personalBests), no smoke file.

- [ ] **Step 4: Commit**

```bash
git add test/rules/setup.ts
git commit -m "test: add rules-unit-testing harness; drop smoke test"
```

---

## Task 7: Rules tests — conversations (the pushToken/muted fix)

**Files:**
- Test: `test/rules/conversations.test.ts`
- Exercises (do not modify): `firestore.rules` conversation `update` rule

Rule reference: `allow update` requires `request.auth.uid in resource.data.participantIds` and one of: (1) `participantNames`-only diff; (2) `lastMessage/lastMessageAt/lastSenderUid/unreadCounts`-only diff AND `peerHasNotBlockedMeInConv`; (3) `participantData`-only diff where the caller writes ONLY their own uid key and ONLY its `muted` sub-field. `delete` is denied. Conv id format is `sorted(uidA,uidB).join('_')`.

- [ ] **Step 1: Write the tests**

```ts
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
```

- [ ] **Step 2: Run the rules suite**

Run: `npm run test:rules`
Expected: the emulator starts, this file's 7 tests PASS, the emulator shuts down. (Other rules files added in later tasks will also run once present.)

- [ ] **Step 3: Mutation check — prove the security test actually guards the fix**

Temporarily weaken `firestore.rules`: in conversation branch (3), delete the two `.keys().hasOnly(['muted'])` / `.diff(...).affectedKeys().hasOnly(['muted'])` constraints (reverting to the pre-fix "own-key only" form).
Run: `npm run test:rules`
Expected: the test **"DENIES injecting a pushToken into the caller own entry"** now FAILS (the write is wrongly allowed).
Then `git checkout firestore.rules` to restore the fix and re-run:
Run: `npm run test:rules`
Expected: all green again.

- [ ] **Step 4: Commit**

```bash
git add test/rules/conversations.test.ts
git commit -m "test: lock in conversation participantData/pushToken authz"
```

---

## Task 8: Rules tests — publicCatches social counters

**Files:**
- Test: `test/rules/catches-posts.test.ts`
- Exercises (do not modify): `firestore.rules` publicCatches `update`/`delete`

Rule reference (non-owner social-counter branch): a non-owner update is allowed only when `likeCount` is within ±1 of prior, `ownerUid` is unchanged, the diff `affectedKeys().hasOnly(['likeCount','reactionCounts'])`, and each of `heart/fire/trophy/fish/wow` in `reactionCounts` is within ±1. `delete` is allowed only for the owner.

- [ ] **Step 1: Write the tests**

```ts
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
```

- [ ] **Step 2: Run the rules suite**

Run: `npm run test:rules`
Expected: PASS — including this file's 5 tests.

- [ ] **Step 3: Commit**

```bash
git add test/rules/catches-posts.test.ts
git commit -m "test: lock in publicCatches social-counter bounds"
```

---

## Task 9: Rules tests — user doc + private push token

**Files:**
- Test: `test/rules/users-private.test.ts`
- Exercises (do not modify): `firestore.rules` `users/{userId}` + `users/{userId}/private/{document}`

Rule reference: `users/{userId}` read requires `signedIn()`; `create/update` requires `isSelf(userId)` AND `request.resource.data.uid == userId`. `users/{userId}/private/{document}` read+write requires `isSelf(userId)` (owner-only — protects the push token).

- [ ] **Step 1: Write the tests**

```ts
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
```

- [ ] **Step 2: Run the rules suite**

Run: `npm run test:rules`
Expected: PASS — including this file's 4 tests.

- [ ] **Step 3: Commit**

```bash
git add test/rules/users-private.test.ts
git commit -m "test: lock in user-doc + private push-token authz"
```

---

## Task 10: Rules tests — notifications

**Files:**
- Test: `test/rules/notifications.test.ts`
- Exercises (do not modify): `firestore.rules` `users/{userId}/notifications/{nid}`

Rule reference: `read,delete` require `isSelf(userId)` (the recipient). `create` requires `signedIn()`, `auth.uid != userId`, `actorUid == auth.uid`, `actorName` string ≤120, `type` in the allowed set, `preview` string ≤200, `read == false`, and type-specific shape (for `follow`: no/empty `catchId` and empty `preview`). `update` additionally requires `actorUid == resource.data.actorUid` (an actor can't overwrite another actor's slot).

- [ ] **Step 1: Write the tests**

```ts
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
```

- [ ] **Step 2: Run the full rules suite**

Run: `npm run test:rules`
Expected: PASS — all four rules files (conversations, catches-posts, users-private, notifications).

- [ ] **Step 3: Commit**

```bash
git add test/rules/notifications.test.ts
git commit -m "test: lock in notification create/overwrite/read authz"
```

---

## Task 11: Wire it together + document

**Files:**
- Modify: `CLAUDE.md` (replace the "no test scripts" line; note the stale `users/{uid}` aggregate)

- [ ] **Step 1: Run the complete suite end to end**

Run: `npm run test:all`
Expected: logic suite passes (4 files), then the emulator boots, the rules suite passes (4 files), and the emulator shuts down. Exit code 0.

- [ ] **Step 2: Update `CLAUDE.md`**

Find this line under `## Commands`:
```
No lint or test scripts are configured. TypeScript checking: `npx tsc --noEmit`.
```
Replace it with:
```
TypeScript checking: `npx tsc --noEmit`. No lint script is configured.

Tests (Vitest):
- `npm test` — logic suite (pure services; no emulator needed)
- `npm run test:rules` — Firestore security-rules suite (boots the Firestore emulator via `firebase emulators:exec`; needs Java)
- `npm run test:all` — both
```
Also, in the `### Firestore collections` table, change the `users/{uid}` row description from `Profile + `unreadMessageCount` aggregate` to `Profile (the `unreadMessageCount` aggregate was removed 2026-06-02)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document test commands; drop stale unreadMessageCount note"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Vitest runner + scripts + `firebase.json` emulator block → Task 1 ✓
- Logic: firestoreSanitize → T2; feedRanking → T3; solunar (covers moon math) → T4; personalBests → T5 ✓ (moon.ts/stats.ts correctly dropped — empty stubs, per the corrected spec)
- Rules harness → T6; conversations (the shipped fix, incl. mutation check) → T7; publicCatches bounds → T8; users + private push token → T9; notifications → T10 ✓
- Local-only scripts (no CI) → honored ✓
- Non-goals (RN components, CF quiet-hours, achievements) → not included ✓
- Success criterion "reintroducing the participantData hole fails a test" → T7 Step 3 mutation check ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step contains complete code. The two adaptive notes (solunar `periods` property name; "half cycle" threshold) give exact fallback values, not vague instructions. ✓

**3. Type consistency:** `getTestEnv`/`seed` defined in T6 are used verbatim in T7–T10. `RankingSignals`/`FeedItem`/`Catch`/`PersonalBest` match the real exports read from source. Conv id `alice_bob`, fields (`participantIds`, `participantData`, `unreadCounts`), and reaction keys (`heart/fire/trophy/fish/wow`) match `firestore.rules`. ✓
