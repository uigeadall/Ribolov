# Home Redesign — Phase 3 (Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended — edits the shared `HomeScreen.tsx` + a few section files) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Polish the home screen — fix the cold-load empty-state flash with per-section skeletons, and make the hero's weather meta row collapsible — while honestly scoping the two polish items that Phase 1 already satisfied or that aren't worth the risk.

**Architecture:** Add two initial-load flags (`statsLoaded`, `hubLoaded`) in `HomeScreen` so the catch rails can show skeleton tiles during the first load instead of their empty CTA. Add a collapse toggle to `HeroHeader`'s meta row. No new data, no new deps.

**Tech Stack:** React Native, Expo, the existing `Skeleton` component, `useHomeTheme`.

**Verification:** `npx tsc --noEmit` + the logic suite (`npm test`, must stay 36/36) after each task; visuals confirmed on device (`npm run reinstall:ios`).

---

## Honest scope (read first)

The spec's Phase 3 lists four items. Two need real work; two are already done or deliberately deferred — doing them anyway would be busywork or risk:

| Item | Status | Action |
|---|---|---|
| #8 Skeletons | **Real bug.** On cold load `recentCatches`/`followingCatches` are `[]`, so the rails flash their empty CTA ("Запиши първия си улов" / "Намери приятели") for ~1s before data arrives. | **Task 1** — fix it. |
| #4 Collapsible hero meta | Not done. | **Task 2** — implement. |
| #3 Aspirational empty states | **Already satisfied.** Following/Recent already render compact aspirational `EmptyHint`s (preserved in Phase 1); the sections that hide (ThisDay/Solunar/Tournaments/Classics) *should* hide — a placeholder there is noise (spec agrees). The richer `EmptyState` component is a full-screen animated treatment that would look heavy stacked in the feed. | **Task 3** — light copy polish only; document as satisfied. |
| #5 Card consistency | **Deferred.** Sections already read cohesively; routing every one-off card through `GlassCard` risks shadow/radius/border regressions that can't be caught without UI tests. Low value, real risk. | **Task 3** — document the deferral; user can override. |

---

## File Structure (Phase 3)

```
src/screens/HomeScreen.tsx                         # MODIFIED — statsLoaded/hubLoaded flags; pass `loading` to rails
src/screens/home/sections/RecentCatchesSection.tsx # MODIFIED — loading prop → skeleton rail
src/screens/home/sections/FollowingSection.tsx     # MODIFIED — loading prop → skeleton rail
src/screens/home/sections/CatchRailSkeleton.tsx    # NEW — shared horizontal skeleton-tile rail
src/screens/home/sections/HeroHeader.tsx           # MODIFIED — collapsible meta row
docs/superpowers/specs/2026-06-04-home-redesign-design.md  # MODIFIED — mark Phase 3 done
```

---

## Task 1: Cold-load skeletons for the catch rails

**Files:**
- Create: `src/screens/home/sections/CatchRailSkeleton.tsx`
- Modify: `src/screens/home/sections/RecentCatchesSection.tsx`
- Modify: `src/screens/home/sections/FollowingSection.tsx`
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Create the shared skeleton rail**

`src/screens/home/sections/CatchRailSkeleton.tsx`:
```tsx
import React from 'react';
import { ScrollView } from 'react-native';
import { Skeleton } from '../../../components/Skeleton';
import { spacing } from '../../../theme/typography';

/** Placeholder tiles matching the 120×160 catchCard, shown while a catch rail
    loads so we don't flash the empty-state CTA at users who actually have
    catches. */
export function CatchRailSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} width={120} height={160} borderRadius={18} />
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Add a `loading` prop to `RecentCatchesSection`**

In `src/screens/home/sections/RecentCatchesSection.tsx`, change the props type and the empty branch. Replace:
```tsx
type Props = { catches: Catch[] };
```
with:
```tsx
type Props = { catches: Catch[]; loading?: boolean };
```
Update the signature to `export function RecentCatchesSection({ catches, loading }: Props) {`. Add the `CatchRailSkeleton` import:
```tsx
import { CatchRailSkeleton } from './CatchRailSkeleton';
```
Then change the body's conditional so a loading+empty state shows skeletons instead of the empty hint. Replace the `{catches.length > 0 ? ( … ) : ( <EmptyHint … /> )}` with:
```tsx
      {catches.length > 0 ? (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl }}
        >
          {catches.map((c) => (
            /* ...existing tile markup unchanged... */
          ))}
        </ScrollView>
      ) : loading ? (
        <CatchRailSkeleton />
      ) : (
        <EmptyHint
          icon="add-circle-outline"
          text="Запиши първия си улов — ще го виждаш тук"
          onPress={() => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} })}
        />
      )}
```
(Only the conditional wrapper changes — keep the existing tile `.map(...)` body verbatim. Also gate the header link the same as today: it already shows only when `catches.length > 0`, which is correct — no link during loading.)

- [ ] **Step 3: Add a `loading` prop to `FollowingSection`** (same pattern)

In `src/screens/home/sections/FollowingSection.tsx`: change `type Props = { catches: CloudCatch[] };` to `type Props = { catches: CloudCatch[]; loading?: boolean };`, update the signature to `({ catches, loading }: Props)`, add `import { CatchRailSkeleton } from './CatchRailSkeleton';`, and change the empty branch from a direct `EmptyHint` to:
```tsx
      ) : loading ? (
        <CatchRailSkeleton />
      ) : (
        <EmptyHint
          icon="people-outline"
          text="Намери приятели, за да виждаш техните улови"
          onPress={() => (navigation as any).navigate('ProfileTab', { screen: 'Friends' })}
        />
      )}
```
(i.e. the existing `<ScrollView>…</ScrollView> : <EmptyHint/>` becomes `<ScrollView>…</ScrollView> : loading ? <CatchRailSkeleton/> : <EmptyHint/>`.)

- [ ] **Step 4: Add load flags in `HomeScreen` and pass `loading`**

In `src/screens/HomeScreen.tsx`:
1. Add state near the other `useState`s:
```ts
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [hubLoaded, setHubLoaded] = useState(false);
```
2. At the **end** of `loadStats` (after the `if (user && configured) { … } else { … }` block, still inside the callback), set the flag:
```ts
    if (!isCancelled()) setStatsLoaded(true);
```
3. At the **end** of `loadTodayHub` (after the tournaments try/catch), set:
```ts
    if (!isCancelled()) setHubLoaded(true);
```
4. In the user-change reset `useEffect`, add (so a new account shows skeletons again, not the previous account's empty CTA):
```ts
    setStatsLoaded(false);
    setHubLoaded(false);
```
5. In the `sections` array, pass the flag to each rail:
```tsx
    { key: 'following', render: () => <FollowingSection catches={followingCatches} loading={!hubLoaded} /> },
```
```tsx
    { key: 'recent', render: () => <RecentCatchesSection catches={recentCatches} loading={!statsLoaded} /> },
```
6. Add `statsLoaded, hubLoaded` to the `sections` `useMemo` dependency array.

Note: because the flags flip to `true` after the first load and stay true for the session, pull-to-refresh re-uses the `FishingRefreshControl` spinner (no skeleton re-flash) — which is the desired behavior.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit` → clean.
Run: `npm test` → 5 files / 36 tests pass (unchanged — this is UI-only).

- [ ] **Step 6: Commit**

```bash
git add src/screens/home/sections/CatchRailSkeleton.tsx src/screens/home/sections/RecentCatchesSection.tsx src/screens/home/sections/FollowingSection.tsx src/screens/HomeScreen.tsx
git commit -m "home: skeleton catch rails on cold load (no empty-state flash)"
```

---

## Task 2: Collapsible hero meta row

**Files:**
- Modify: `src/screens/home/sections/HeroHeader.tsx`

Make the wind/precip/moon glass bar collapsed by default with a slim "details" toggle, expanding on tap — so the hero reads as a welcome, not a dashboard.

- [ ] **Step 1: Add collapse state**

At the top of the `HeroHeader` component body, add:
```tsx
  const [metaExpanded, setMetaExpanded] = React.useState(false);
```
(`React` is already imported in this file.)

- [ ] **Step 2: Replace the meta-row block**

Replace the existing meta block (the `{weather && ( <View style={S.heroMetaRow}> … </View> )}` and the loading `{weatherStatus === 'loading' && !weather && ( … )}` that follows it) with a collapsed-by-default toggle:
```tsx
        {/* Meta row: wind / humidity / moon — collapsed by default so the hero
            breathes; tap to expand the full glass bar. */}
        {weather && (
          metaExpanded ? (
            <Pressable onPress={() => setMetaExpanded(false)} style={S.heroMetaRow}>
              <View style={S.heroMetaItem}>
                <Ionicons name="flag-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={S.heroMetaText}>{weather.windKmh} км/ч</Text>
              </View>
              <View style={S.heroMetaDivider} />
              <View style={S.heroMetaItem}>
                <Ionicons name="rainy-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={S.heroMetaText}>{weather.precipitationProbability}%</Text>
              </View>
              <View style={S.heroMetaDivider} />
              <View style={S.heroMetaItem}>
                <Text style={S.heroMetaText}>{moonPhaseEmoji(weather.moonPhaseName)}</Text>
                <Text style={S.heroMetaText}>{weather.moonPhaseName}</Text>
              </View>
              <Ionicons name="chevron-up" size={14} color="rgba(255,255,255,0.6)" style={{ marginLeft: 6 }} />
            </Pressable>
          ) : (
            <Pressable onPress={() => setMetaExpanded(true)} style={S.heroMetaCollapsed}>
              <Text style={S.heroMetaText}>Детайли за времето</Text>
              <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.7)" />
            </Pressable>
          )
        )}
        {weatherStatus === 'loading' && !weather && (
          <View style={[S.heroMetaRow, { justifyContent: 'center' }]}>
            <ActivityIndicator color="rgba(255,255,255,0.5)" size="small" />
          </View>
        )}
```

- [ ] **Step 3: Add the collapsed-bar style**

In the `StyleSheet.create` at the bottom of `HeroHeader.tsx`, add a `heroMetaCollapsed` key next to `heroMetaRow`:
```ts
  heroMetaCollapsed: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8,
    marginTop: spacing.sm, alignSelf: 'center',
  },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/screens/home/sections/HeroHeader.tsx
git commit -m "home: collapsible hero weather-meta row"
```

---

## Task 3: Empty-state copy polish + document #3/#5 decisions

**Files:**
- Modify: `src/screens/home/sections/FollowingSection.tsx` (copy only)
- Modify: `docs/superpowers/specs/2026-06-04-home-redesign-design.md`

- [ ] **Step 1: Sharpen the Following empty copy** (more aspirational, same compact `EmptyHint`)

In `FollowingSection.tsx`, change the empty-branch `EmptyHint` text from
`"Намери приятели, за да виждаш техните улови"` to
`"Последвай рибари — улови­те им ще се появят тук"`.
(Recent's copy "Запиши първия си улов — ще го виждаш тук" is already good; leave it.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Mark Phase 3 done in the spec**

In `docs/superpowers/specs/2026-06-04-home-redesign-design.md`, update the status line to note Phase 3 complete, recording the honest scope: #8 skeletons + #4 collapsible meta implemented; #3 satisfied via the existing compact `EmptyHint`s (the rich `EmptyState` is a full-screen treatment, too heavy stacked); #5 card consistency deferred (low value / regression risk without UI tests).

- [ ] **Step 4: Commit**

```bash
git add src/screens/home/sections/FollowingSection.tsx docs/superpowers/specs/2026-06-04-home-redesign-design.md
git commit -m "home: aspirational empty copy; document Phase 3 scope (#3 done, #5 deferred)"
```

---

## Task 4: Device verification (USER)

- [ ] **Step 1:** `npm run reinstall:ios`. Confirm:
  - **Cold load:** the Following + Recent rails show shimmering skeleton tiles (not the "log first catch" / "find friends" CTA) until data lands; a genuinely-empty account still gets the CTA after load.
  - **Hero meta:** the weather bar is collapsed ("Детайли за времето ⌄") by default; tapping expands wind/precip/moon and collapses again.
  - Phases 1–2 still intact (FlashList scroll, Today block, order).
  - Decision check: do you want #5 (card consistency) after all, or is the current cohesion fine?

---

## Self-Review (plan author)

**1. Spec coverage (Phase 3):** #8 → Task 1. #4 → Task 2. #3 → Task 3 (documented as satisfied + copy polish). #5 → Task 3 (documented deferral with rationale; flagged for user override in Task 4). All four spec items addressed, two with explicit honest-scope decisions rather than busywork.

**2. Placeholder scan:** No TBD/"handle later". Task 1–3 code steps give exact prop changes, exact conditional shapes, exact new component, exact style key. The one "keep existing markup verbatim" instruction (Task 1 Step 2 tile `.map`) is a preserve-don't-retype directive, not a placeholder.

**3. Type consistency:** `loading?: boolean` added identically to both rail Props; `CatchRailSkeleton({ count })` matches its single call site (default 4). `statsLoaded`/`hubLoaded` defined once, set in the matching loaders, reset on user change, added to the `sections` `useMemo` deps. `metaExpanded` local to HeroHeader; `heroMetaCollapsed` style referenced only after it's added. `moonPhaseEmoji`/`Ionicons`/`ActivityIndicator`/`Pressable` already imported in HeroHeader (verified — the meta block already used them).

**4. Risk note:** Task 2 (hide weather details by default) is the one subjective change — faithful to the approved spec but reversible; explicitly surfaced in the Task 4 device check so the user can veto. Task 1 is the high-value fix and is low-risk (additive `loading` branch). #5 deferral is a deliberate engineering call, documented and overridable.
