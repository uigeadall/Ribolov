# Migration plan — `firebase/firestore` → `@react-native-firebase/firestore`

## Why

The web SDK (`firebase` npm package) currently used for Firestore has **no working offline persistence on React Native**. We rely on `memoryLocalCache` only (see `src/services/firebase.ts`). Symptoms:

- Cold-start screens show spinners for 3–30 s while App Check tokens + initial queries resolve over the network.
- Lost connectivity = empty Home, Logbook, Feed — no fallback to last-known data.
- Tried `persistentLocalCache` from `firebase/firestore` on 2026-05-20: it's a no-op on RN (web SDK requires IndexedDB; logs `code=unimplemented` at every cold start).

`@react-native-firebase/firestore` (the native bridge) uses the iOS/Android Firestore SDKs, which **do have persistent disk caching**. After migration, cold starts read cached data instantly; offline writes queue locally and sync when online.

## Surface area

| Metric | Count |
|---|---|
| Files importing `firebase/firestore` | **31** |
| Files using `onSnapshot` (live subscriptions) | 13 |
| Highest Firestore-call-density files (services) | `messaging.ts` (35), `catchSync.ts` (25), `userProfile.ts` (24), `tournaments.ts` (22), `posts.ts` (22), `groups.ts` (21), `stories.ts` (19) |

The data layer is concentrated in `src/services/` (~25 files) with thin call sites in screens. Migration is "rewrite the services; touch screens only where they import Firestore directly."

## API differences (concrete examples)

The web SDK uses a **modular / tree-shakeable** API. RNFirebase uses a **namespaced** API. Every read/write touches.

| Operation | Current (web SDK) | After (RNFirebase) |
|---|---|---|
| Read doc | `getDoc(doc(db, 'users', uid))` | `firestore().collection('users').doc(uid).get()` |
| Query | `getDocs(query(collection(db, 'publicCatches'), where('date','>=',iso), orderBy('date','desc'), limit(50)))` | `firestore().collection('publicCatches').where('date','>=',iso).orderBy('date','desc').limit(50).get()` |
| Subscribe | `onSnapshot(query(...), cb)` | `firestore().collection(...).where(...).onSnapshot(cb)` |
| Write | `setDoc(doc(db, ...), data, { merge: true })` | `firestore().doc(...).set(data, { merge: true })` |
| Batch | `writeBatch(db).update(ref, data).commit()` | `firestore().batch().update(ref, data).commit()` |
| Server timestamp | `serverTimestamp()` | `firestore.FieldValue.serverTimestamp()` |
| Increment | `increment(1)` | `firestore.FieldValue.increment(1)` |
| Field path / docId | `documentId()` | `firestore.FieldPath.documentId()` |
| Doc reference type | `DocumentReference` (from firebase/firestore) | `FirebaseFirestoreTypes.DocumentReference` |
| Snapshot shape | `snap.docs[i].data()` (same) | same — minor type-only diffs |

Idiom shifts that need attention:

1. **Snapshot listeners** return an `unsubscribe` function — same in both, but error callback signature differs (RNFirebase passes `Error` not the union).
2. **`onSnapshot` with `includeMetadataChanges: true`** behaves slightly differently for `hasPendingWrites` — relevant for our optimistic chat send.
3. **Server timestamps in optimistic UI** — RNFirebase exposes a `serverTimestampBehavior: 'estimate'` snapshot option that helps. Current code uses `{ toMillis: () => Date.now() }` shims (see `ChatDetailScreen` optimistic send).
4. **`FieldValue.delete()`** — for removing a field, the namespace is different.
5. **Transactions** — `runTransaction(db, async tx => ...)` becomes `firestore().runTransaction(async tx => ...)`.
6. **`Timestamp`** — type comes from `firestore.Timestamp` instead of `firebase/firestore`. Most of our code uses ISO strings on the wire, so this is rarely hit.

## What can stay

- `firebase/app`, `firebase/auth`, `firebase/storage` — keep these for now. RNFirebase auth/storage are a separate (larger) migration. Firestore migration alone gives the offline win.
- `firestore.rules`, `firestore.indexes.json` — unchanged. Rules and indexes are server-side.
- `functions/` — unchanged. Functions already use `firebase-admin`.
- App Check setup — RNFirebase requires its own App Check integration; needs verification that current `@react-native-firebase/app-check` (already used) keeps working with the new firestore module.

## Phased rollout (recommended)

A 31-file big-bang migration is risky. Do it in slices, each shippable independently. Each slice converts a small group of services + their screen callers; the rest keep using the web SDK. **Both SDKs can coexist in the app**, pointing at the same Firestore backend.

### Phase 0 — Setup (½ day)
- Add `@react-native-firebase/firestore` to package.json.
- Run `npx expo prebuild`, rebuild iOS/Android.
- Verify cold-start path: web SDK auth still works, RNFirebase Firestore client initializes against the same project.
- Add a `src/services/rnfirestore.ts` thin wrapper that returns `firestore()` lazily — mirror the `requireFirebase()` pattern.

### Phase 1 — One read-only screen wedge (½ day)
- Migrate **one** non-write surface, e.g., `src/services/leaderboards.ts` (read-only, well-isolated, has clear measurable benefit — leaderboard cache reads).
- Compare cold-start time before/after.
- Confirm offline behavior: airplane-mode the device, verify cached rows render.

### Phase 2 — Catches (1–2 days)
- `src/services/catchSync.ts` (25 Firestore calls) — the biggest user-facing win. Once migrated, Home/Logbook/Feed have cached public catches on cold start.
- Update `socialFeed.ts`, `personalBests.ts`, `stats.ts` to consume the migrated API.

### Phase 3 — Social graph (1 day)
- `src/services/social.ts`, `userProfile.ts`, `posts.ts`, `socialReactions.ts`, `socialComments.ts`, `socialSaves.ts`, `socialNotifications.ts`, `hashtags.ts`.
- These all snapshot user-scoped state; persistence helps a lot.

### Phase 4 — Messaging (1 day)
- `src/services/messaging.ts` (35 Firestore calls, the heaviest file). `onSnapshot` heavy — verify the optimistic-send code still works after migration (currently uses a `{ toMillis: () => Date.now() }` shim that may conflict with RNFirebase's snapshot timestamp behavior).
- `messageSyncQueue.ts` should keep working — it doesn't talk to Firestore directly, only through the queue.

### Phase 5 — Tournaments + Groups + Stories (1 day)
- `tournaments.ts`, `groups.ts`, `groupEvents.ts`, `groupPolls.ts`, `stories.ts`.

### Phase 6 — Long tail (½ day)
- Everything left: `liveFishingPins.ts`, `fishingReports.ts`, `damFeed.ts`, `contentReports.ts`, `blockUser.ts`, `achievements.ts`, `firestoreSanitize.ts` (utility — likely just imports), `pushNotifications.ts`.
- Plus the 5 screens that import `firebase/firestore` directly: `CatchDetailScreen.tsx`, `FeedScreen.tsx`, `TournamentDetailScreen.tsx`, `SearchScreen.tsx`, `AddCatchScreen.tsx`, `NotificationPreferencesScreen.tsx`.

### Phase 7 — Cleanup (½ day)
- Remove `firebase/firestore` import from `firebase.ts` and `package.json`.
- Remove the `memoryLocalCache` setup.
- Update `CLAUDE.md` to reflect the new architecture.

**Total estimate: 5–7 working days** for a focused engineer who knows the codebase. Include 1 day of buffer for App Check / Sentry / device-rebuild surprises.

## Risks

1. **App Check token resolution.** RNFirebase has its own App Check integration. We already use `@react-native-firebase/app-check` for the bridge — needs verification that the new Firestore client picks up tokens correctly.
2. **`onSnapshot` semantics drift.** A handful of subscribers depend on `hasPendingWrites` (optimistic chat, optimistic likes). Test each one explicitly after migration.
3. **Type churn.** All the `DocumentReference`, `Timestamp`, `QueryDocumentSnapshot` type imports change shape. TypeScript will catch most of it; a few `any`-typed paths may slip through.
4. **Bundle size.** Adds ~2 MB to the iOS bundle. Acceptable.
5. **Expo Go incompatible.** RNFirebase requires a development build (`npx expo run:ios`). Expo Go users would lose Firestore. We already document this in `CLAUDE.md` ("Expo Go — limited, native modules may not work").

## Don't do (anti-pattern)

- ❌ Re-attempt `persistentLocalCache` from `firebase/firestore`. It's silently ignored on RN — proven on 2026-05-20.
- ❌ Migrate `firebase/auth` in the same change. Auth migration is its own multi-day project; mixing them multiplies risk.
- ❌ Migrate everything in one PR. Phased rollout is what makes this safe — each slice is bisectable.

## Open questions

- Do we keep both SDKs forever, or fully retire the web SDK after Phase 7?
- Does the user want this in the same release as a `@react-native-firebase/auth` migration, or strictly Firestore-only?
- Acceptable bundle-size impact on Android (RNFirebase is heavier than the web SDK's tree-shaken bundle)?

---

*This plan was written from a code-only audit (no profiler data). Confirm the cold-start latency claim with a one-day measurement before committing to the multi-day investment.*
