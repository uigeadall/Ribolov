# Firestore Cost Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the four biggest Firestore read-cost leaks: the redundant full-scan leaderboard aggregator, the always-on 10-minute leaderboard consolidator, per-feed-card comment-count aggregation reads, and per-feed-card block-list reads / saved-state listeners.

**Architecture:** (1) Delete the legacy `aggregateLeaderboards` scheduled function — its own code comment says the trigger-based rollup pipeline replaces it, yet both run and both write `leaderboardCache/global_{period}`. (2) Add a `leaderboardMeta/state` dirty-flag doc so `consolidateLeaderboards` exits after 1 read when nothing changed (vs ~800 reads every 10 minutes). (3) Denormalize `commentCount` onto `publicCatches` docs, mirroring the pattern `posts` already uses (seeded 0 on create, best-effort `increment(±1)` on comment add/delete, rules-gated to ±1). (4) Add a TTL + inflight-dedup cache to `getBlockedUids` and convert the per-card saved-state listener to a cached one-shot fetch, mirroring the existing reaction-cache pattern in `socialReactions.ts`.

**Tech Stack:** Expo / React Native, Firebase web SDK (client), firebase-admin + firebase-functions v2 (Cloud Functions), Firestore security rules, Vitest (`test/logic` pure suites, `test/rules` emulator suites).

**Branching note:** The current checkout is on `redesign/home-dark-premium` (unmerged UI work). This plan is independent — execute it on a new branch **cut from `main`** (use superpowers:using-git-worktrees).

**Repo root:** `/Users/antonkondachiev/Desktop/ribolov-app`

---

## Verification commands (used throughout)

| Command | What it checks | Notes |
|---|---|---|
| `npx tsc --noEmit` | App TypeScript | run from repo root |
| `npm test` | Pure-logic Vitest suite (`test/logic`) | no emulator needed |
| `npm run test:rules` | Firestore rules suite (`test/rules`) | boots emulator, needs Java |
| `cd functions && npm run build` | Functions TypeScript compile | `npm run deploy` also builds |

---

### Task 1: Delete the legacy `aggregateLeaderboards` scheduled function

The function at `functions/src/index.ts:650` does a full `publicCatches` scan per period (day/week/month/year) daily. The comment block at line 712-740 ("Trigger-based leaderboard rollups (replaces the full-scan aggregator)") confirms `onPublicCatchForRollup` + `consolidateLeaderboards` supersede it. Both write the same `leaderboardCache/global_{period}` docs, so they currently fight: the legacy daily full-scan overwrites the consolidator's output with independently-computed rows.

**Files:**
- Modify: `functions/src/index.ts` (delete lines ~641–709: the comment header `// aggregateLeaderboards — runs every 10 minutes` through the closing `});` of the function, just before the `// Trigger-based leaderboard rollups` comment block)

- [ ] **Step 1: Confirm nothing else references the function**

Run: `grep -rn "aggregateLeaderboards" --include="*.ts" --include="*.tsx" /Users/antonkondachiev/Desktop/ribolov-app/src /Users/antonkondachiev/Desktop/ribolov-app/functions/src`
Expected: matches ONLY inside `functions/src/index.ts` (the definition and comments referring to it). The client reads `leaderboardCache` docs, never the function.

- [ ] **Step 2: Delete the function**

In `functions/src/index.ts`, delete the entire block starting at the comment:

```ts
// aggregateLeaderboards — runs every 10 minutes
```

(note: that header comment is stale — the schedule is actually `"every 24 hours"`) through the end of the function:

```ts
export const aggregateLeaderboards = onSchedule(
  { schedule: "every 24 hours", maxInstances: 1 },
  async () => {
  const periods: Period[] = ["day", "week", "month", "year"];
  ...
    await db.collection("leaderboardCache").doc(`global_${period}`).set({
      rows,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
});
```

Keep everything from `// ---------------------------------------------------------------------------` / `// Trigger-based leaderboard rollups (replaces the full-scan aggregator).` onward. In that retained comment block, update the sentence "The old `aggregateLeaderboards` above does a full collection scan" to past tense: "The old `aggregateLeaderboards` (deleted 2026-06-11) did a full collection scan".

- [ ] **Step 3: Verify functions still compile**

Run: `cd /Users/antonkondachiev/Desktop/ribolov-app/functions && npm run build`
Expected: exits 0, no TypeScript errors. If `periodMinIso` or other helpers become unused, TypeScript `noUnusedLocals` may flag them — check whether `weeklyLeaderboardDriftFix` still uses `periodMinIso` (it does, at its top); only remove helpers the compiler actually reports as unused.

- [ ] **Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "functions: delete legacy aggregateLeaderboards full-scan aggregator

The trigger-based rollup pipeline (onPublicCatchForRollup +
consolidateLeaderboards) replaced it, but both were still deployed and
both wrote leaderboardCache/global_{period}, overwriting each other.
Removes 4 full publicCatches scans per day."
```

---

### Task 2: `shouldConsolidate` gate helper (pure, TDD)

A pure decision function for Task 3. It must return `true` when the period buckets rolled over (so the "day" board resets at midnight even with zero activity), `true` when rollup writes are newer than the last consolidation, and `false` otherwise.

**Files:**
- Create: `functions/src/lib/consolidateGate.ts`
- Test: `test/logic/consolidateGate.test.ts`

(Pattern precedent: `test/logic/buckets.test.ts` imports directly from `functions/src/lib/buckets`.)

- [ ] **Step 1: Write the failing test**

Create `test/logic/consolidateGate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldConsolidate } from '../../functions/src/lib/consolidateGate';

const BUCKETS_A = 'day_2026-06-11|week_2026-W24|month_2026-06|year_2026';
const BUCKETS_B = 'day_2026-06-12|week_2026-W24|month_2026-06|year_2026';

describe('shouldConsolidate', () => {
  it('runs when the bucket key changed (midnight rollover resets the day board)', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: null,
      consolidatedThroughMillis: null,
      currentBucketsKey: BUCKETS_B,
      lastBucketsKey: BUCKETS_A,
    })).toBe(true);
  });

  it('runs on a fresh meta doc with no recorded bucket key', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: null,
      consolidatedThroughMillis: null,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: null,
    })).toBe(true);
  });

  it('skips when buckets match and no rollup write was ever recorded', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: null,
      consolidatedThroughMillis: 1000,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(false);
  });

  it('runs when rollup writes exist but were never consolidated', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: 1000,
      consolidatedThroughMillis: null,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(true);
  });

  it('runs when a rollup write is newer than the last consolidation', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: 2000,
      consolidatedThroughMillis: 1000,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(true);
  });

  it('skips when consolidation already covers the newest rollup write', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: 1000,
      consolidatedThroughMillis: 1000,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/antonkondachiev/Desktop/ribolov-app && npx vitest run test/logic/consolidateGate.test.ts`
Expected: FAIL — `Cannot find module '../../functions/src/lib/consolidateGate'` (or similar resolve error).

- [ ] **Step 3: Write the implementation**

Create `functions/src/lib/consolidateGate.ts`:

```ts
/**
 * Decision gate for consolidateLeaderboards: should this scheduled run do
 * the ~800-read consolidation, or exit after the 1-read meta check?
 *
 * Run when:
 *  - the period-bucket key changed since the last consolidation (midnight /
 *    week / month / year rollover — the "day" cache doc must reset to an
 *    empty board even if nobody logged a catch overnight), or
 *  - a rollup write landed after the last consolidation covered it.
 *
 * Skip when buckets are unchanged and no rollup write is newer than what
 * the last consolidation already processed. consolidatedThroughMillis is
 * set to the lastRollupWriteAt value READ AT THE START of the consolidation
 * run (not "now") so a rollup write that lands mid-run still triggers the
 * next cycle instead of being silently skipped.
 */
export function shouldConsolidate(args: {
  lastRollupWriteAtMillis: number | null;
  consolidatedThroughMillis: number | null;
  currentBucketsKey: string;
  lastBucketsKey: string | null;
}): boolean {
  if (args.currentBucketsKey !== args.lastBucketsKey) return true;
  if (args.lastRollupWriteAtMillis === null) return false;
  if (args.consolidatedThroughMillis === null) return true;
  return args.lastRollupWriteAtMillis > args.consolidatedThroughMillis;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/logic/consolidateGate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify functions compile and commit**

```bash
cd /Users/antonkondachiev/Desktop/ribolov-app/functions && npm run build && cd ..
git add functions/src/lib/consolidateGate.ts test/logic/consolidateGate.test.ts
git commit -m "functions: add shouldConsolidate gate helper for dirty-flag consolidation"
```

---

### Task 3: Wire the dirty flag into the rollup trigger, drift fix, and consolidator

`consolidateLeaderboards` currently costs ~200 reads × 4 periods × 144 runs/day ≈ 115k reads/day (~3.5M/month) even with zero app activity. After this task an idle run costs 1 read.

Meta doc shape — `leaderboardMeta/state`:
- `lastRollupWriteAt` (Timestamp) — bumped by `onPublicCatchForRollup` and `weeklyLeaderboardDriftFix`
- `consolidatedThroughAt` (Timestamp) — the `lastRollupWriteAt` value the last consolidation run observed at its start
- `consolidatedBucketsKey` (string) — `day|week|month|year` bucket keys at last consolidation

**Files:**
- Modify: `functions/src/index.ts` — three places: `onPublicCatchForRollup` (~line 757), `consolidateLeaderboards` (~line 920), `weeklyLeaderboardDriftFix` (~line 978)

- [ ] **Step 1: Bump the flag from `onPublicCatchForRollup`**

In `onPublicCatchForRollup`, find the end of the `try { await db.runTransaction(...) }` block (the transaction that writes the dedup doc + rollup increments). Immediately **after** the closing `} catch (e) { ... }` of that try/catch, add:

```ts
    // Dirty-flag for consolidateLeaderboards: record that rollup state
    // changed so the next consolidation run knows it has work. Outside the
    // transaction to keep the hot path free of contention on this shared
    // doc — if this write is lost (crash between tx commit and here), the
    // flag is healed by the next catch write, the next bucket rollover
    // (which always consolidates), or the weekly drift fix.
    await db
      .doc("leaderboardMeta/state")
      .set({ lastRollupWriteAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch((e) => logger.warn("[onPublicCatchForRollup] meta bump failed", e));
```

(`FieldValue` and `logger` are already imported at the top of the file.)

- [ ] **Step 2: Bump the flag from `weeklyLeaderboardDriftFix`**

In `weeklyLeaderboardDriftFix`, after the `for (const period of periods) { ... }` loop completes (after the last `logger.info(...)` inside the loop, just before the function's closing `}`), add:

```ts
    // Drift fixes rewrite rollup docs directly — tell the consolidator.
    await db
      .doc("leaderboardMeta/state")
      .set({ lastRollupWriteAt: FieldValue.serverTimestamp() }, { merge: true });
```

- [ ] **Step 3: Gate `consolidateLeaderboards`**

Add the import at the top of `functions/src/index.ts`, next to the existing `./lib/buckets` import:

```ts
import { shouldConsolidate } from "./lib/consolidateGate";
```

Replace the start of `consolidateLeaderboards` — currently:

```ts
export const consolidateLeaderboards = onSchedule(
  { schedule: "every 10 minutes", maxInstances: 1 },
  async () => {
  const now = new Date();
  const periods: Period[] = ["day", "week", "month", "year"];
```

with:

```ts
export const consolidateLeaderboards = onSchedule(
  { schedule: "every 10 minutes", maxInstances: 1 },
  async () => {
  const now = new Date();
  const periods: Period[] = ["day", "week", "month", "year"];

  // Dirty-flag gate: 1 meta read decides whether the ~800-read consolidation
  // below has anything to do. Idle 10-minute ticks (no new catches, no
  // bucket rollover) exit here — that was ~3.5M reads/month of pure waste.
  const metaRef = db.doc("leaderboardMeta/state");
  const currentBucketsKey = [
    dayBucketKey(now),
    isoWeekBucketKey(now),
    monthBucketKey(now),
    yearBucketKey(now),
  ].join("|");
  const metaSnap = await metaRef.get();
  const lastRollupWriteAt = metaSnap.exists
    ? (metaSnap.get("lastRollupWriteAt") as Timestamp | undefined)
    : undefined;
  const consolidatedThroughAt = metaSnap.exists
    ? (metaSnap.get("consolidatedThroughAt") as Timestamp | undefined)
    : undefined;
  const lastBucketsKey = metaSnap.exists
    ? (metaSnap.get("consolidatedBucketsKey") as string | undefined)
    : undefined;
  if (!shouldConsolidate({
    lastRollupWriteAtMillis: lastRollupWriteAt?.toMillis() ?? null,
    consolidatedThroughMillis: consolidatedThroughAt?.toMillis() ?? null,
    currentBucketsKey,
    lastBucketsKey: lastBucketsKey ?? null,
  })) {
    return;
  }
```

(`dayBucketKey`, `isoWeekBucketKey`, `monthBucketKey`, `yearBucketKey`, `Timestamp` are already imported.)

Then, at the **end** of the function — after the `for (const period of periods) { ... }` loop, just before the function's closing `});` — add:

```ts
  // Record what this run covered. consolidatedThroughAt is the rollup
  // timestamp observed at the START of this run — a write landing mid-run
  // stays newer than this and triggers the next cycle.
  await metaRef.set({
    consolidatedThroughAt: lastRollupWriteAt ?? Timestamp.now(),
    consolidatedBucketsKey: currentBucketsKey,
  }, { merge: true });
```

- [ ] **Step 4: Build, run logic tests**

Run: `cd /Users/antonkondachiev/Desktop/ribolov-app/functions && npm run build && cd .. && npm test`
Expected: build exits 0; all logic tests pass (including the 6 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "functions: dirty-flag gate for consolidateLeaderboards

Idle 10-minute runs now cost 1 read (meta doc check) instead of ~800.
Rollup trigger and weekly drift fix bump leaderboardMeta/state; the
consolidator skips unless rollup state changed or the period buckets
rolled over (rollover always runs so the day board resets at midnight)."
```

---

### Task 4: Security rules — allow ±1 `commentCount` bumps on `publicCatches` (TDD via rules suite)

Mirror the posts pattern, but as a **separate disjunct** — the posts rules fold `commentCount` into the likeCount clause, which would break reactions on legacy catches missing the field (`request.resource.data.commentCount is number` fails when the field is absent). An independent clause sidesteps that.

**Files:**
- Modify: `firestore.rules` (publicCatches `allow update`, the disjunct ending at line ~361)
- Test: `test/rules/catches-posts.test.ts`

- [ ] **Step 1: Write the failing rules tests**

In `test/rules/catches-posts.test.ts`, inside `describe('publicCatches update/delete rule', ...)`, add after the existing `it('DENIES a non-owner changing ownerUid', ...)` block:

```ts
  it('lets a commenter bump commentCount +1 alone (legacy doc without the field)', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'publicCatches', CATCH), { commentCount: 1 }),
    );
  });

  it('lets a commenter decrement commentCount -1', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'publicCatches', CATCH), {
        ownerUid: 'bob',
        speciesName: 'Костур',
        likeCount: 0,
        reactionCounts: { heart: 0 },
        commentCount: 3,
      });
    });
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(alice, 'publicCatches', CATCH), { commentCount: 2 }),
    );
  });

  it('DENIES a commentCount jump greater than 1', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(alice, 'publicCatches', CATCH), { commentCount: 5 }));
  });

  it('DENIES a commentCount bump that smuggles other fields', async () => {
    await seedCatch();
    const alice = (await getTestEnv()).authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(alice, 'publicCatches', CATCH), { commentCount: 1, speciesName: 'хакнат' }),
    );
  });
```

(`seed`, `setDoc`, `assertSucceeds`, `assertFails`, `updateDoc`, `doc` are already imported in this file.)

- [ ] **Step 2: Run rules suite to verify the new tests fail**

Run: `cd /Users/antonkondachiev/Desktop/ribolov-app && npm run test:rules`
Expected: the two `assertSucceeds` tests FAIL (permission denied — no rule allows a commentCount-only update yet); the two `assertFails` tests pass vacuously. Pre-existing tests stay green.

- [ ] **Step 3: Add the rules disjunct**

In `firestore.rules`, inside the publicCatches `allow update: if signedIn() && ( ... )` — after the reaction-bump disjunct's closing paren (the line ending `...get('wow', 0) + 1)` at ~line 361) and **before** the closing `);` — add:

```
        ||
        // Comment-count bump — any signed-in user steps commentCount by ±1,
        // paired client-side with creating/deleting a comment doc (see
        // addCatchComment / deleteCatchComment). Kept as its own disjunct
        // (unlike /posts, which folds it into the like clause) so reaction
        // writes on legacy catches missing commentCount don't start failing
        // the `is number` check. affectedKeys.hasOnly prevents smuggling
        // other fields; get('commentCount', 0) defaults legacy docs.
        (request.resource.data.commentCount is number
          && request.resource.data.commentCount >= resource.data.get('commentCount', 0) - 1
          && request.resource.data.commentCount <= resource.data.get('commentCount', 0) + 1
          && request.resource.data.ownerUid == resource.data.ownerUid
          && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['commentCount']))
```

- [ ] **Step 4: Run rules suite to verify it passes**

Run: `npm run test:rules`
Expected: PASS — all pre-existing tests plus the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules test/rules/catches-posts.test.ts
git commit -m "rules: allow ±1 commentCount bumps on publicCatches

Separate disjunct (not folded into the like clause like /posts) so
reaction writes on legacy catches missing the field keep working."
```

---

### Task 5: Client — maintain `commentCount` in `addCatchComment` / `deleteCatchComment`

Mirror `posts.ts` exactly: best-effort `updateDoc(increment(±1))` after the comment write, failures captured to observability. Best-effort (not a batch) so deleting a comment under an already-removed catch doc (catch made private — the parent doc is deleted but comment subdocs linger) still succeeds.

**Files:**
- Modify: `src/services/socialComments.ts` (`addCatchComment` ~line 163, `deleteCatchComment` ~line 215)

- [ ] **Step 1: Bump on add**

In `addCatchComment`, after the `await addDoc(...)` call and **before** the `notifyInteraction({...})` block, add:

```ts
  // Bump the denormalized commentCount on the catch doc so feed cards can
  // render "View N comments" with zero reads (mirrors posts.commentCount).
  // Best-effort: if this fails the comment is still saved; capture to
  // observability so silent count drift is visible to us.
  updateDoc(doc(fb.db, 'publicCatches', catchId), { commentCount: increment(1) })
    .catch((e) => captureException(e, { area: 'catch_comment_count_inc', catchId }));
```

(`updateDoc`, `doc`, `increment` are already imported from `firebase/firestore`; `captureException` is already imported from `./observability`.)

- [ ] **Step 2: Decrement on delete**

In `deleteCatchComment`, after the `await deleteDoc(...)` line, add:

```ts
  // Best-effort decrement — see addCatchComment. Deliberately NOT batched
  // with the delete: comments can outlive their parent doc (catch toggled
  // private deletes publicCatches/{id} but leaves the subcollection), and
  // an atomic batch would make those deletions fail entirely.
  updateDoc(doc(fb.db, 'publicCatches', catchId), { commentCount: increment(-1) })
    .catch((e) => captureException(e, { area: 'catch_comment_count_dec', catchId, commentId }));
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/services/socialComments.ts
git commit -m "feat: maintain denormalized commentCount on catch comment add/delete"
```

---

### Task 6: Client — seed `commentCount: 0`, type it, and consume it in the feed hook

**Files:**
- Modify: `src/services/catchSync.ts` (CloudCatch type ~line 33-40; publish seed ~line 243)
- Modify: `src/hooks/useFeedPostSocial.ts` (count effect ~lines 139-179; optimistic bumps in `onSendComment` / `onDeleteComment`)

- [ ] **Step 1: Add the type field**

In `src/services/catchSync.ts`, in the `CloudCatch` type, after the `reactionCounts?: ...` member, add:

```ts
  /** Denormalized comments tally maintained best-effort by addCatchComment /
      deleteCatchComment (mirrors posts.commentCount). Optional because
      legacy catches pre-date the field — useFeedPostSocial falls back to a
      fetchCatchCommentCount count() read for those. */
  commentCount?: number;
```

- [ ] **Step 2: Seed on first publish**

In the same file (~line 243), change the publish transaction's seed line from:

```ts
        : { ...payload, likeCount: 0, reactionCounts: {} };
```

to:

```ts
        : { ...payload, likeCount: 0, reactionCounts: {}, commentCount: 0 };
```

Also extend the adjacent comment ("Seed both `likeCount` and `reactionCounts`...") to mention `commentCount`.

- [ ] **Step 3: Consume the inline count in the hook**

In `src/hooks/useFeedPostSocial.ts`:

(a) Next to the existing `inlineLikeCount` / `inlineSummary` derivations (~line 139), add:

```ts
  const inlineCommentCount = typeof item.commentCount === 'number' ? item.commentCount : null;
```

(b) Rewrite the count-fetch effect (~lines 145-179). Replace:

```ts
  useEffect(() => {
    if (!socialEnabled || !catchId || !isVisible) return;
    // Inline counts are the source of truth — set immediately, no roundtrip.
    setLikeCount(inlineLikeCount);
    if (inlineSummary !== null) setReactionSummary(inlineSummary);

    let cancelled = false;
    void (async () => {
      const tasks: Promise<unknown>[] = [
        fetchCatchCommentCount(catchId).then((cc) => {
          if (!cancelled) setCommentCount(cc);
        }),
      ];
```

with:

```ts
  useEffect(() => {
    if (!socialEnabled || !catchId || !isVisible) return;
    // Inline counts are the source of truth — set immediately, no roundtrip.
    setLikeCount(inlineLikeCount);
    if (inlineSummary !== null) setReactionSummary(inlineSummary);
    if (inlineCommentCount !== null) setCommentCount(inlineCommentCount);

    let cancelled = false;
    void (async () => {
      const tasks: Promise<unknown>[] = [];
      // Only pay the per-card count() read for legacy catches that pre-date
      // the denormalized commentCount field. New catches seed it at publish
      // and addCatchComment/deleteCatchComment maintain it.
      if (inlineCommentCount === null) {
        tasks.push(
          fetchCatchCommentCount(catchId).then((cc) => {
            if (!cancelled) setCommentCount(cc);
          }),
        );
      }
```

and at the end of that effect, change the dependency array from:

```ts
  }, [socialEnabled, catchId, isVisible, inlineLikeCount, inlineSummary, item.likeCount]);
```

to:

```ts
  }, [socialEnabled, catchId, isVisible, inlineLikeCount, inlineSummary, inlineCommentCount, item.likeCount]);
```

Also add an early-out so an all-inline card runs zero network work — right before `await Promise.all(tasks);` add:

```ts
      if (tasks.length === 0) return;
```

(c) Optimistic local bumps so the label stays right between feed refreshes. In `onSendComment`, after `await addCatchComment(...)` succeeds (same `try` block, next line), add:

```ts
      setCommentCount((c) => c + 1);
```

In `onDeleteComment`, after `await deleteCatchComment(catchId, commentId);` succeeds, add:

```ts
            setCommentCount((c) => Math.max(0, c - 1));
```

- [ ] **Step 4: Typecheck + logic tests**

Run: `npx tsc --noEmit && npm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/catchSync.ts src/hooks/useFeedPostSocial.ts
git commit -m "feat: render comment counts from the denormalized field

Seeds commentCount: 0 at publish, consumes item.commentCount in
useFeedPostSocial with optimistic ±1 on send/delete. Eliminates one
count() aggregation read per feed card per mount; legacy catches
without the field keep the fetch fallback."
```

---

### Task 7: One-off backfill script for existing catches

Without backfill, every pre-existing catch keeps paying the legacy count() read per card mount forever. Mirror `functions/scripts/scrubEmailNames.js` (plain JS, Admin SDK, ADC credentials, dry-run by default).

**Files:**
- Create: `functions/scripts/backfillCommentCounts.js`

- [ ] **Step 1: Write the script**

```js
/**
 * One-off backfill: write the denormalized `commentCount` field onto
 * publicCatches docs that pre-date it.
 *
 * WHY: feed cards render "View N comments" from `commentCount` with zero
 * reads; docs missing the field fall back to a count() aggregation read per
 * card per mount. New catches seed the field at publish — this script
 * brings old docs up to par so the fallback path dies out.
 *
 * WHAT IT DOES: for each publicCatches doc missing `commentCount`, runs a
 * count() aggregation over its comments subcollection and writes the result.
 * Docs that already have the field are skipped (re-running is safe).
 *
 * RUNNING (from the functions/ directory):
 *   # Credentials: Admin SDK uses Application Default Credentials:
 *   #   gcloud auth application-default login
 *   node scripts/backfillCommentCounts.js              # DRY RUN — reports only
 *   node scripts/backfillCommentCounts.js --apply      # writes the counts
 *   node scripts/backfillCommentCounts.js --project=<id> --apply
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

// Same project resolution as scrubEmailNames.js: flag > env > .firebaserc.
function resolveProjectId() {
  const flag = process.argv.find((a) => a.startsWith('--project='));
  if (flag) return flag.slice('--project='.length);
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const rc = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.firebaserc'), 'utf8'));
    return rc.projects && rc.projects.default;
  } catch {
    return undefined;
  }
}

const projectId = resolveProjectId();
if (!projectId) {
  console.error('Could not resolve a project id. Pass --project=<id> or set GOOGLE_CLOUD_PROJECT.');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  console.log(`[backfillCommentCounts] project=${projectId} mode=${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const snap = await db.collection('publicCatches').get();
  let skipped = 0;
  let updated = 0;
  for (const docSnap of snap.docs) {
    if (typeof docSnap.get('commentCount') === 'number') {
      skipped += 1;
      continue;
    }
    const agg = await docSnap.ref.collection('comments').count().get();
    const count = agg.data().count;
    console.log(`  ${docSnap.id}: commentCount=${count}`);
    if (APPLY) {
      await docSnap.ref.set({ commentCount: count }, { merge: true });
    }
    updated += 1;
  }
  console.log(`[backfillCommentCounts] done. ${updated} ${APPLY ? 'updated' : 'would update'}, ${skipped} already had the field.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run sanity check (no writes)**

Run: `cd /Users/antonkondachiev/Desktop/ribolov-app/functions && node scripts/backfillCommentCounts.js`
Expected: prints per-doc counts and a summary; exits 0. (If ADC credentials are missing it errors with an auth message — that's an environment gap, not a script bug; the `--apply` run happens in Task 10 with the user.)

- [ ] **Step 3: Commit**

```bash
cd /Users/antonkondachiev/Desktop/ribolov-app
git add functions/scripts/backfillCommentCounts.js
git commit -m "scripts: backfill denormalized commentCount onto existing publicCatches"
```

---

### Task 8: `TtlMap` helper (TDD) + cache `getBlockedUids`

`getBlockedUids` reads the entire `blockedUsers` subcollection with no caching, and `useFeedPostSocial` calls it once **per feed card** — 20 mounted cards = 20 identical collection reads, plus more from ChatsScreen / SearchScreen / ChatDetailScreen / SharePickerModal / social.ts. Fix at the source with a module-level TTL cache + inflight-promise dedup (the dedup is what collapses the 20-cards-mount-at-once burst into 1 read).

**Files:**
- Create: `src/services/ttlCache.ts`
- Test: `test/logic/ttlCache.test.ts`
- Modify: `src/services/blockUser.ts`

- [ ] **Step 1: Write the failing test**

Create `test/logic/ttlCache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TtlMap } from '../../src/services/ttlCache';

describe('TtlMap', () => {
  it('returns a stored value before the TTL expires', () => {
    let now = 1000;
    const cache = new TtlMap<string, number>(500, () => now);
    cache.set('a', 42);
    now = 1499;
    expect(cache.get('a')).toBe(42);
  });

  it('expires a value once the TTL elapses', () => {
    let now = 1000;
    const cache = new TtlMap<string, number>(500, () => now);
    cache.set('a', 42);
    now = 1500;
    expect(cache.get('a')).toBeUndefined();
  });

  it('returns undefined for keys never set', () => {
    const cache = new TtlMap<string, number>(500);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('set refreshes the TTL window', () => {
    let now = 1000;
    const cache = new TtlMap<string, number>(500, () => now);
    cache.set('a', 1);
    now = 1400;
    cache.set('a', 2);
    now = 1899;
    expect(cache.get('a')).toBe(2);
  });

  it('delete removes an entry immediately', () => {
    const cache = new TtlMap<string, number>(500);
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('stores falsy values distinctly from missing ones', () => {
    const cache = new TtlMap<string, boolean>(500);
    cache.set('a', false);
    expect(cache.get('a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/logic/ttlCache.test.ts`
Expected: FAIL — cannot resolve `../../src/services/ttlCache`.

- [ ] **Step 3: Write the implementation**

Create `src/services/ttlCache.ts`:

```ts
/** Tiny TTL'd in-memory key→value map. Shared by the read-cost caches
    (blocked-uids, saved-state) that trade a bounded staleness window for
    not re-reading the same Firestore data on every card mount. The nowFn
    parameter exists for deterministic tests. */
export class TtlMap<K, V> {
  private readonly map = new Map<K, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly nowFn: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.nowFn() - entry.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.map.set(key, { value, at: this.nowFn() });
  }

  delete(key: K): void {
    this.map.delete(key);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/logic/ttlCache.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire into `blockUser.ts`**

Replace the body of `src/services/blockUser.ts`'s cache-relevant parts. Add imports and module state after the existing imports:

```ts
import { TtlMap } from './ttlCache';

// Block lists change rarely but are read constantly (every feed card, chat
// list, search, share sheet). 60s TTL + inflight dedup turns the
// 20-reads-per-feed-mount burst into one collection read per minute.
// block/unblock invalidate immediately so the UI never serves a stale
// "not blocked" after the user just blocked someone.
const _blockedCache = new TtlMap<string, Set<string>>(60_000);
const _inflightBlocked = new Map<string, Promise<Set<string>>>();
```

Replace `getBlockedUids` with:

```ts
export async function getBlockedUids(myUid: string): Promise<Set<string>> {
  const cached = _blockedCache.get(myUid);
  if (cached) return cached;
  const inflight = _inflightBlocked.get(myUid);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const fb = requireFirebase();
      const snap = await getDocs(collection(fb.db, 'users', myUid, 'blockedUsers'));
      const set = new Set(snap.docs.map((d) => d.id));
      _blockedCache.set(myUid, set);
      return set;
    } catch {
      // Don't cache failures — the next caller should retry.
      return new Set<string>();
    } finally {
      _inflightBlocked.delete(myUid);
    }
  })();
  _inflightBlocked.set(myUid, p);
  return p;
}
```

In `blockUser(...)`, after the `await setDoc(...)`, add:

```ts
  _blockedCache.delete(myUid);
```

In `unblockUser(...)`, after the `await deleteDoc(...)`, add:

```ts
  _blockedCache.delete(myUid);
```

Also fix the stale comment at `src/screens/SearchScreen.tsx:176` — it currently claims "`getBlockedUids` is server-cached so the cost is low", which was wrong until now. Change it to:

```ts
      // `getBlockedUids` is TTL-cached in blockUser.ts so the cost is low.
```

- [ ] **Step 6: Typecheck + tests + commit**

```bash
npx tsc --noEmit && npm test
git add src/services/ttlCache.ts test/logic/ttlCache.test.ts src/services/blockUser.ts src/screens/SearchScreen.tsx
git commit -m "perf: TTL + inflight-dedup cache for getBlockedUids

Every feed card mount (plus chats/search/share surfaces) re-read the full
blockedUsers collection. Now one read per user per minute, invalidated
immediately on block/unblock."
```

---

### Task 9: Saved-state — cached one-shot fetch instead of a listener per card

`subscribeCatchSaved` attaches one `onSnapshot` listener per mounted feed card. Convert it to a cached one-shot `getDoc`, exactly like `subscribeMyReactionOnCatch` in `socialReactions.ts` already does for reactions (same signature kept, no-op unsubscribe, write-through on toggle). Same accepted trade-off as reactions: a save made on another device won't appear until the cache expires or the feed remounts.

**Files:**
- Modify: `src/services/socialSaves.ts`

- [ ] **Step 1: Rewrite `subscribeCatchSaved`**

In `src/services/socialSaves.ts`, add to the imports: `import { TtlMap } from './ttlCache';` and add module state below the imports:

```ts
// Saved-state cache: mirrors the my-reaction cache in socialReactions.ts.
// Each feed card used to hold a live onSnapshot on its saves doc — 20+
// active listeners per feed view for a value that only changes when THIS
// user taps save. One-shot getDoc + 5min TTL + write-through on toggle.
// Trade-off (same as reactions): a save made on another device won't show
// here until the TTL lapses or the feed refetches.
const SAVED_TTL_MS = 5 * 60 * 1000;
const _savedCache = new TtlMap<string, boolean>(SAVED_TTL_MS);
const savedKey = (myUid: string, catchId: string) => `${myUid}:${catchId}`;
```

Replace:

```ts
export function subscribeCatchSaved(myUid: string, catchId: string, cb: (saved: boolean) => void): () => void {
  const fb = requireFirebase();
  return onSnapshot(doc(fb.db, 'users', myUid, 'savedCatches', catchId), (s) => cb(s.exists()));
}
```

with:

```ts
/** Subscribe-shape API kept for source compatibility, but backed by a
    one-shot fetch + memory cache (see _savedCache note above). Returns a
    no-op unsubscribe when served from cache. */
export function subscribeCatchSaved(myUid: string, catchId: string, cb: (saved: boolean) => void): () => void {
  const key = savedKey(myUid, catchId);
  const cached = _savedCache.get(key);
  if (cached !== undefined) {
    cb(cached);
    return () => {};
  }
  let cancelled = false;
  void (async () => {
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'users', myUid, 'savedCatches', catchId));
      _savedCache.set(key, snap.exists());
      if (!cancelled) cb(snap.exists());
    } catch {
      if (!cancelled) cb(false);
    }
  })();
  return () => { cancelled = true; };
}
```

- [ ] **Step 2: Write through on toggles**

In `toggleSaveCatch`, before `return false;` (the unsave branch) add:

```ts
    _savedCache.set(savedKey(myUid, catchId), false);
```

and before `return true;` (the save branch) add:

```ts
  _savedCache.set(savedKey(myUid, catchId), true);
```

In `unsaveCatchesBulk`, after each `await batch.commit();`, add:

```ts
    for (const id of catchIds.slice(i, i + CHUNK)) {
      _savedCache.set(savedKey(myUid, id), false);
    }
```

- [ ] **Step 3: Clean up imports**

`onSnapshot` is still used by `subscribeSavedCatchIdsOrdered` — keep it. `getDoc` is already imported. Verify with: `npx tsc --noEmit`
Expected: clean (TypeScript flags any unused import if the config does).

- [ ] **Step 4: Commit**

```bash
git add src/services/socialSaves.ts
git commit -m "perf: saved-state as cached one-shot fetch instead of per-card listener

Mirrors the my-reaction cache pattern in socialReactions.ts: sheds 20+
active onSnapshot listeners per feed view, write-through on toggle."
```

---

### Task 10: Full verification, deploy, backfill

- [ ] **Step 1: Run everything**

```bash
cd /Users/antonkondachiev/Desktop/ribolov-app
npx tsc --noEmit
npm test
npm run test:rules
cd functions && npm run build && cd ..
```

Expected: all clean/green. Fix anything that isn't before proceeding.

- [ ] **Step 2: CHECKPOINT — confirm deploy with the user**

Deploying touches production. Confirm before running:

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

The functions deploy will detect that `aggregateLeaderboards` no longer exists in the source and **prompt to delete it from production — answer yes** (that's the point of Task 1). Watch the deploy output for `consolidateLeaderboards`, `onPublicCatchForRollup`, and `weeklyLeaderboardDriftFix` updating successfully.

- [ ] **Step 3: Run the backfill (after rules deploy)**

```bash
cd functions
node scripts/backfillCommentCounts.js              # dry run, inspect output
node scripts/backfillCommentCounts.js --apply
```

Expected: per-doc counts printed; `--apply` writes them. Re-running is safe (docs with the field are skipped).

- [ ] **Step 4: Post-deploy smoke checks**

- Firebase Console → Functions → logs: within ~20 minutes `consolidateLeaderboards` should log invocations that return quickly (gated runs). After the next catch is logged (or the midnight rollover), one run should do real work.
- In the app (simulator is fine): open the feed — comment counts render; like a catch (rules regression check); save/unsave a catch; comment on a catch and verify the count label increments.

- [ ] **Step 5: Commit any fixups, then finish the branch**

Use superpowers:finishing-a-development-branch (merge to `main` / PR per user preference).

---

## Self-review notes

- **Spec coverage:** finding 1 (idle consolidator burn) → Tasks 2-3; finding 2 (redundant aggregator) → Task 1 (delete, since the retained comment block proves the rollup pipeline replaced it); finding 3 (per-card comment count) → Tasks 4-7; finding 4 (block-list reads + saved listeners) → Tasks 8-9. Deploy/backfill → Task 10.
- **Why no emulator tests for the functions changes:** the repo has no Cloud Functions test harness (only `test/logic` + `test/rules`); the gate decision — the only branchy logic — is extracted pure and tested (Task 2), matching the existing `buckets.ts`/`buckets.test.ts` precedent.
- **Ordering constraint:** Task 4 (rules) must land before Task 5 ships to users, or comment writes would log permission errors on the count bump (best-effort, comments still save). In production order, rules deploy precedes app release — Task 10 deploys rules; the app changes ride the next build.
- **Known accepted trade-offs:** commentCount is best-effort (drift possible if the bump write fails — captured to observability, same stance as posts); saved-state and block-list have bounded staleness windows (5min / 60s) with write-through/invalidate on local mutation.
