# Test Safety Net — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Scope:** Focused safety net — security-critical Firestore rules + deterministic core services. No RN component tests.

## Goal

The app is ~60k lines across 50 screens with **zero automated tests**. This is
the highest structural risk, especially for the Firestore security rules, which
were changed twice in the week of 2026-06-02 (the `participantData`/pushToken
hardening, reaction-count bounds, block-check fixes). Today those rule changes
are verified by hand via the emulator on each edit.

This work establishes a focused, sustainable test safety net that:
1. Locks in the security guarantees of the Firestore rules so a future edit that
   reopens a hole fails a test instead of shipping.
2. Pins the behavior of the deterministic core services so refactors are safe.

It is deliberately **not** a full testing foundation — RN component/hook/screen
tests are out of scope (see Non-Goals).

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Ambition | Focused safety net (rules + deterministic logic) |
| Runner | Vitest |
| CI | Local scripts only (CI deferred) |
| Logic-test location | Centralized in `test/logic/` (option A) |

## Architecture

Two test suites sharing one runner (Vitest at repo root), split by directory
because they have different runtime needs:

- **Logic suite** (`test/logic/`) — pure Node, no external services, runs in
  milliseconds.
- **Rules suite** (`test/rules/`) — uses `@firebase/rules-unit-testing` against
  the Firestore emulator, wrapped in `firebase emulators:exec` so the emulator
  lifecycle is automatic.

### Why this split

The logic targets were verified to be import-isolated: `moon`, `solunar`,
`stats` have zero imports; `feedRanking` and `personalBests` import only types
(erased at compile time); `firestoreSanitize` imports two classes from
`firebase/firestore` that load in Node without app initialization. So the logic
suite needs **no** React-Native/Expo mocking and **no** `jest-expo` preset.

The rules suite is inherently integration-style (it exercises the deployed
`firestore.rules` against a real Firestore emulator), so it is isolated from the
logic suite and gated behind the emulator.

### Directory layout

```
/vitest.config.ts
/test/
  logic/
    firestoreSanitize.test.ts
    feedRanking.test.ts
    moon.test.ts
    solunar.test.ts
    stats.test.ts
    personalBests.test.ts
  rules/
    setup.ts                 # initializeTestEnvironment, load firestore.rules
    conversations.test.ts
    catches-posts.test.ts
    users-private.test.ts
    notifications.test.ts
```

### package.json scripts

```
test         → vitest run test/logic
test:watch   → vitest test/logic
test:rules   → firebase emulators:exec --only firestore 'vitest run test/rules'
test:all     → npm test && npm run test:rules
```

### firebase.json

Add a deterministic emulator port so `emulators:exec` is reproducible:

```json
"emulators": { "firestore": { "port": 8080 }, "ui": { "enabled": false } }
```

## Logic suite — coverage

Each file targets one service; tests assert documented behavior, not
implementation details.

- **`firestoreSanitize.test.ts`** — `stripUndefinedForFirestore`:
  - strips top-level `undefined` keys
  - preserves `null`, `0`, `''`, `false`
  - preserves `FieldValue` and `Timestamp` instances (not treated as plain objects)
  - recurses into nested objects
  - leaves arrays intact
- **`feedRanking.test.ts`** — `scoreFeedItem` (signal weighting monotonicity),
  `rankFeedItems` (correct ordering, stable for equal scores, empty input).
- **`moon.test.ts`** — moon phase for known reference dates (a documented
  new/full moon date maps to the expected phase bucket).
- **`solunar.test.ts`** — major/minor window computation against a known
  reference; windows fall in valid ranges; cross-day handling.
- **`stats.test.ts`** — aggregation correctness (totals, averages, bests) over a
  fixed catch list, including empty list.
- **`personalBests.test.ts`** — PB detection: first catch of a species is a PB,
  a heavier catch is a PB, an equal/lighter one is not, unit consistency.

## Rules suite — coverage (security regression net)

Uses `@firebase/rules-unit-testing`. `setup.ts` builds the test environment from
the real `firestore.rules`, exposes authed/unauthed contexts, and clears
Firestore between tests. Each test asserts both **allow** and **deny** paths.

- **`conversations.test.ts`** (the fix shipped 2026-06-02 + the branch logic):
  - participant may write **only** their own `participantData[uid].muted`
  - participant **cannot** write the peer's `participantData` entry → denied
  - participant **cannot** inject `pushToken` or extra fields into own entry → denied
  - `participantNames`-only merge allowed for a participant
  - `lastMessage`/`unreadCounts` update allowed only when not blocked by peer
  - non-participant write → denied; `delete` → denied
- **`catches-posts.test.ts`**:
  - non-owner may bump `likeCount` by ±1 and `reactionCounts` per-type by ±1
  - a >1 jump in either is denied
  - changing `ownerUid` or any other field by a non-owner is denied
  - owner may delete own doc; non-owner delete denied
- **`users-private.test.ts`**:
  - `users/{uid}` read requires auth; unauthed read denied
  - write requires `isSelf` and `uid == userId`; cross-user write denied
  - `users/{uid}/private/pushToken` readable/writable only by the owner;
    another signed-in user is denied (protects the push-token from the redirect
    vector closed this week)
- **`notifications.test.ts`**:
  - actor can create a notification with valid `type`/size constraints
  - actor B cannot overwrite actor A's existing notification slot
  - recipient can read and delete their notifications; a third party cannot

## Non-Goals

- React-Native component, screen, or hook tests (the declined "broader
  foundation"). No `jest-expo`, no `@testing-library/react-native`.
- Cloud Function logic tests, including the cross-midnight quiet-hours math in
  `functions/src/index.ts`. That lives in the `functions/` package with its own
  toolchain and is the obvious **next follow-up**, tracked separately.
- Firebase-coupled services (`achievements.ts`, sync queues, etc.) that require
  live Firestore/AsyncStorage — not pure, out of this net.
- CI / GitHub Actions wiring (deferred; ~10 min to add later).

## Dependencies added

- Root devDependencies: `vitest`, `@firebase/rules-unit-testing`.
- Requires Java (already present) and the Firebase CLI (already present) for the
  rules suite.

## Success criteria

- `npm test` runs the logic suite green with no emulator/Java needed.
- `npm run test:rules` spins up the emulator, runs the rules suite green, and
  shuts the emulator down.
- Each shipped rule branch from the 2026-06-02 hardening has at least one
  passing allow-case and one passing deny-case.
- Re-introducing the original `participantData` hole (unconstrained own-entry
  write) makes a rules test fail.
