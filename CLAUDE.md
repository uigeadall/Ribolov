# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start Metro bundler (Expo Go — limited, native modules may not work)
npm run start

# Start Metro without Expo Go (recommended for development)
npm run start:metro

# Build and run on device/simulator (required for native modules)
npx expo run:ios
npx expo run:android

# EAS cloud build for TestFlight
npm run build:testflight

# Submit to App Store
npm run submit:ios
```

TypeScript checking: `npx tsc --noEmit`. No lint script is configured.

Tests (Vitest):
- `npm test` — logic suite (pure services; no emulator needed)
- `npm run test:rules` — Firestore security-rules suite (boots the Firestore emulator via `firebase emulators:exec`; needs Java)
- `npm run test:all` — both

## Architecture

### Navigation

Five-level hierarchy: `RootStack → Tabs → [LogbookStack | FeedStack | ProfileStack | SpeciesStack] → Screen`.

All type definitions are in `src/navigation/types.ts`. Every navigator uses `headerShown: false`.

**Cross-stack navigation rule**: You cannot call `navigation.navigate('AddCatch')` from the Feed or Profile stacks — those screens don't exist there. Always go through the tab entry point:
```ts
(navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} });
(navigation as any).navigate('ProfileTab', { screen: 'Chats' });
```

`UserPublicProfile` and `Search` live in the root stack (above tabs) and are navigable from anywhere via `(navigation as any).navigate('UserPublicProfile', { uid })`.

### State and data layers

**Local storage** (`src/storage/storage.ts`): `catchesStore`, `spotsStore`, `gearStore`, `tripsStore` — all backed by `AsyncStorage` with JSON serialisation. `catchesStore` has an in-memory cache with a promise mutex to prevent concurrent write races.

**Firebase** (`src/services/firebase.ts`): lazily initialised singleton (`ensureFirebase` / `requireFirebase`). Uses `memoryLocalCache` (no offline persistence). The web SDK (`firebase` npm package) is used for Firestore/Storage/Auth; `@react-native-firebase` is used only for App Check.

**Sync queue pattern** (`src/services/catchSyncQueue.ts`, `src/services/messageSyncQueue.ts`, `src/services/syncQueue.ts`): writes are queued to AsyncStorage and flushed with exponential backoff. `cloudSync.ts` is a barrel re-exporting `catchSync`, `userProfile`, `messaging`, `social`, `tournaments`.

**Social feed** (`src/services/socialFeed.ts`): public catches written to `publicCatches` Firestore collection. Feed is paginated with cursor-based `startAfter`. Following feed passes `ownerUids` array for server-side filtering.

### Hooks

- `useAsync(fn, deps)` — runs an async function, tracks `{ data, loading, refreshing, error }`, exposes `reload(silent?)`. Use for one-shot fetches.
- `useFirestoreSubscription(subscribe, deps)` — wraps `onSnapshot` lifecycle, returns `{ data, loading, setData }`. `setData` allows optimistic updates before the next snapshot.
- `useAppNavigation` (`src/navigation/useAppNavigation.ts`) — typed navigation hook used across all 25+ screens.

### Theming

`ThemeContext` (`src/services/themeContext.tsx`) provides `{ colors, mode, accent }`. Always use `const { colors, mode } = useTheme()` — never hardcode colours. Light/dark + accent palette is in `src/theme/palette.ts`.

### Map

`src/config/mapEngine.ts` exports `USE_REACT_NATIVE_MAPS`. Set to `false` to switch from `react-native-maps` (Google/Apple native) to the Leaflet WebView fallback (`src/components/LeafletMap.tsx`). Dam and river data is static in `src/data/dams.ts` and `src/data/rivers.ts`.

### Leaderboards

`fetchAndAggregateLeaderboard` in `src/services/leaderboards.ts` uses an inflight-dedup Map to prevent concurrent duplicate Firestore scans. For `scope.type === 'all'` it first tries a precomputed `leaderboardCache/{global_period}` Firestore doc before falling back to client aggregation.

### Firestore collections

| Collection | Purpose |
|---|---|
| `publicCatches` | Public feed items |
| `users/{uid}/following`, `users/{uid}/followers` | Follow graph |
| `users/{uid}` | Profile (the `unreadMessageCount` aggregate was removed 2026-06-02) |
| `conversations/{convId}/messages` | Direct messages |
| `leaderboardCache` | Precomputed global leaderboard rows |

### Key patterns

- `pointerEvents="box-none"` must be a **View prop**, not inside the `style` object.
- For absolute-positioned headers over `FlatList`, use `contentContainerStyle={{ paddingTop: headerHeight }}` (scrolls with content). Container-level `paddingTop` leaves a blank gap when the header slides away.
- `stripUndefinedForFirestore` (`src/services/firestoreSanitize.ts`) must wrap every object written to Firestore to avoid "undefined is not supported" errors.
- `Animated.diffClamp(scrollY, 0, maxHeight)` + `Animated.multiply(..., -1)` for scroll-direction-aware collapsing headers.
