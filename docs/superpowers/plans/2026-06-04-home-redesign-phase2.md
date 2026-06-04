# Home Redesign — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended here — Tasks 3–4 edit the single shared `HomeScreen.tsx`) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an adaptive "Today" priority block to the top of the home content and reorder the sections by user intent.

**Architecture:** The "which card to show" decision is a **pure function** `selectTodayCard(signals)` (unit-tested in the Vitest logic suite). A `TodayBlock` component calls it and renders one of three cards (social / good-conditions / baseline). `HomeScreen` passes the already-loaded signals and slots `TodayBlock` into the `HomeSection[]` in the new intent-ordered position. Builds on Phase 1's section architecture.

**Tech Stack:** React Native, Expo, the existing `GlassCard`/`useHomeTheme`/`useAppNavigation`, Vitest (logic suite from 2026-06-03).

**Verification:** `selectTodayCard` gets real unit tests (`npm test`). `npx tsc --noEmit` after each task. Visual confirmation of `TodayBlock` + the reorder is on device (`npm run reinstall:ios`) — there is no UI test framework.

---

## File Structure (Phase 2)

```
src/screens/home/
  selectTodayCard.ts              # NEW — pure decision function + TodayCard/TodaySignals types
  sections/
    TodayBlock.tsx                # NEW — calls selectTodayCard, renders the chosen card
  # HomeScreen.tsx                # MODIFIED — pass signals to TodayBlock, reorder HomeSection[]
test/logic/
  selectTodayCard.test.ts         # NEW — unit tests for the 3 branches + edges
```

---

## Task 1: `selectTodayCard` pure function + unit tests (TDD)

**Files:**
- Create: `src/screens/home/selectTodayCard.ts`
- Create: `test/logic/selectTodayCard.test.ts`

The decision logic, isolated from React so it's unit-testable. Priority: (1) any following-catch dated *today* → social; (2) else `fishingRating >= GOOD_FISHING_THRESHOLD` → good conditions; (3) else baseline. `now` is injectable for deterministic tests.

- [ ] **Step 1: Write the implementation**

`src/screens/home/selectTodayCard.ts`:
```ts
/** The card the Today block should show, chosen by selectTodayCard. */
export type TodayCard =
  | { kind: 'social'; actorName: string; othersCount: number }
  | { kind: 'conditions'; rating: number; spotName: string | null }
  | { kind: 'baseline'; rating: number | null; spotName: string | null };

export type TodaySignals = {
  /** Public catches from followed anglers (most-recent first is fine). */
  followingCatches: { ownerUid: string; ownerName?: string; date: string }[];
  /** weather?.fishingRating ?? null (1..5). */
  fishingRating: number | null;
  /** nearestWaters[0]?.name ?? null. */
  nearestSpotName: string | null;
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
};

/** A 4+ rating is "drop everything and go" — matches the forecast strip's
    `best` highlight threshold (day.fishingRating >= 4). */
export const GOOD_FISHING_THRESHOLD = 4;

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Decide which Today card to show. Pure — no React, no I/O. */
export function selectTodayCard(s: TodaySignals): TodayCard {
  const now = s.now ?? new Date();

  // (1) Fresh following activity today wins — it's the most re-engaging signal.
  const todays = s.followingCatches.filter((c) => {
    const t = Date.parse(c.date);
    return !Number.isNaN(t) && isSameLocalDay(new Date(t), now);
  });
  if (todays.length > 0) {
    const owners: { uid: string; name?: string }[] = [];
    for (const c of todays) {
      if (!owners.some((o) => o.uid === c.ownerUid)) {
        owners.push({ uid: c.ownerUid, name: c.ownerName });
      }
    }
    return {
      kind: 'social',
      actorName: owners[0].name?.trim() || 'Рибар',
      othersCount: owners.length - 1,
    };
  }

  // (2) Good conditions → nudge to log a catch.
  if (s.fishingRating != null && s.fishingRating >= GOOD_FISHING_THRESHOLD) {
    return { kind: 'conditions', rating: s.fishingRating, spotName: s.nearestSpotName };
  }

  // (3) Baseline — always renders something useful.
  return { kind: 'baseline', rating: s.fishingRating, spotName: s.nearestSpotName };
}
```

- [ ] **Step 2: Write the failing tests**

`test/logic/selectTodayCard.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { selectTodayCard, GOOD_FISHING_THRESHOLD, type TodaySignals } from '../../src/screens/home/selectTodayCard';

const NOW = new Date('2026-06-04T12:00:00.000Z');
const todayIso = '2026-06-04T08:00:00.000Z';
const oldIso = '2026-05-01T08:00:00.000Z';

function signals(over: Partial<TodaySignals> = {}): TodaySignals {
  return { followingCatches: [], fishingRating: null, nearestSpotName: null, now: NOW, ...over };
}

describe('selectTodayCard', () => {
  it('prefers social when a followed angler posted today', () => {
    const card = selectTodayCard(signals({
      followingCatches: [{ ownerUid: 'u1', ownerName: 'Иван', date: todayIso }],
      fishingRating: 5, // even with great weather, social wins
    }));
    expect(card).toEqual({ kind: 'social', actorName: 'Иван', othersCount: 0 });
  });

  it('counts distinct other owners for the social card', () => {
    const card = selectTodayCard(signals({
      followingCatches: [
        { ownerUid: 'u1', ownerName: 'Иван', date: todayIso },
        { ownerUid: 'u1', ownerName: 'Иван', date: todayIso }, // same owner, not counted twice
        { ownerUid: 'u2', ownerName: 'Петър', date: todayIso },
      ],
    }));
    expect(card).toEqual({ kind: 'social', actorName: 'Иван', othersCount: 1 });
  });

  it('falls back to Рибар when the first today-owner has no name', () => {
    const card = selectTodayCard(signals({
      followingCatches: [{ ownerUid: 'u1', date: todayIso }],
    }));
    expect(card).toEqual({ kind: 'social', actorName: 'Рибар', othersCount: 0 });
  });

  it('ignores following catches from other days', () => {
    const card = selectTodayCard(signals({
      followingCatches: [{ ownerUid: 'u1', ownerName: 'Иван', date: oldIso }],
      fishingRating: 2,
    }));
    expect(card.kind).toBe('baseline');
  });

  it('shows good conditions when rating >= threshold and no social', () => {
    const card = selectTodayCard(signals({ fishingRating: GOOD_FISHING_THRESHOLD, nearestSpotName: 'Язовир Искър' }));
    expect(card).toEqual({ kind: 'conditions', rating: GOOD_FISHING_THRESHOLD, spotName: 'Язовир Искър' });
  });

  it('shows baseline when rating is below threshold', () => {
    const card = selectTodayCard(signals({ fishingRating: 3, nearestSpotName: 'Язовир Искър' }));
    expect(card).toEqual({ kind: 'baseline', rating: 3, spotName: 'Язовир Искър' });
  });

  it('shows baseline when there is no weather rating at all', () => {
    const card = selectTodayCard(signals({ fishingRating: null }));
    expect(card).toEqual({ kind: 'baseline', rating: null, spotName: null });
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run test/logic/selectTodayCard.test.ts`
Expected: PASS — 7 tests. (Code + tests are written together; this characterizes the intended behavior.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/home/selectTodayCard.ts test/logic/selectTodayCard.test.ts
git commit -m "home: selectTodayCard pure decision fn + unit tests"
```

---

## Task 2: `TodayBlock` component

**Files:**
- Create: `src/screens/home/sections/TodayBlock.tsx`

Renders the card chosen by `selectTodayCard`. Reuses `GlassCard` for the surface, `useHomeTheme` for colors, `useAppNavigation` for the CTAs. Social → "Към лентата" (FeedTab). Conditions/baseline → "Запиши улов" (AddCatch). Renders `null` only in the impossible empty case (kept defensive).

- [ ] **Step 1: Write the component**

`src/screens/home/sections/TodayBlock.tsx`:
```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { useAppNavigation } from '../../../navigation/useAppNavigation';
import { spacing } from '../../../theme/typography';
import type { WeatherSnapshot } from '../../../services/weather';
import { useHomeTheme } from '../useHomeTheme';
import { fishingLabel } from '../homeHelpers';
import { selectTodayCard } from '../selectTodayCard';

type Props = {
  followingCatches: { ownerUid: string; ownerName?: string; date: string }[];
  weather: WeatherSnapshot | null;
  nearestSpotName: string | null;
};

export function TodayBlock({ followingCatches, weather, nearestSpotName }: Props) {
  const navigation = useAppNavigation();
  const { textColor, mutedColor, primary, accent } = useHomeTheme();

  const card = selectTodayCard({
    followingCatches,
    fishingRating: weather?.fishingRating ?? null,
    nearestSpotName,
  });

  // Headline + sub + CTA per card kind.
  let emoji: string;
  let title: string;
  let sub: string;
  let ctaLabel: string;
  let onPress: () => void;

  if (card.kind === 'social') {
    emoji = '🎣';
    title = card.othersCount > 0
      ? `${card.actorName} и още ${card.othersCount} споделиха`
      : `${card.actorName} сподели нов улов`;
    sub = 'Виж какво кълве при приятелите ти';
    ctaLabel = 'Към лентата';
    onPress = () => (navigation as any).navigate('FeedTab');
  } else if (card.kind === 'conditions') {
    const fl = fishingLabel(card.rating);
    emoji = '🔥';
    title = 'Чудесни условия за риболов';
    sub = card.spotName ? `${fl.text} · ${card.spotName}` : fl.text;
    ctaLabel = 'Запиши улов';
    onPress = () => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  } else {
    emoji = '🐟';
    title = 'Готов ли си за риболов?';
    sub = card.spotName ? `Запиши улова си от ${card.spotName}` : 'Запиши улова си в дневника';
    ctaLabel = 'Запиши улов';
    onPress = () => navigation.navigate('LogbookTab', { screen: 'AddCatch', params: {} });
  }

  // Rating stars for the conditions/baseline cards (when a rating exists).
  const rating = card.kind === 'social' ? null : card.rating;

  return (
    <GlassCard style={S.card} onPress={onPress}>
      <View style={S.row}>
        <Text style={S.emoji}>{emoji}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[S.title, { color: textColor }]} numberOfLines={1}>{title}</Text>
          <Text style={[S.sub, { color: mutedColor }]} numberOfLines={1}>{sub}</Text>
          {rating != null && (
            <View style={S.stars}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Ionicons key={i} name={i <= rating ? 'star' : 'star-outline'} size={12} color={accent} />
              ))}
            </View>
          )}
        </View>
      </View>
      <View style={[S.cta, { backgroundColor: primary }]}>
        <Text style={S.ctaText}>{ctaLabel}</Text>
        <Ionicons name="chevron-forward" size={15} color="#fff" />
      </View>
    </GlassCard>
  );
}

const S = StyleSheet.create({
  card: { marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emoji: { fontSize: 30 },
  title: { fontSize: 16, fontFamily: 'Nunito_800ExtraBold', letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: 'Nunito_600SemiBold', marginTop: 2 },
  stars: { flexDirection: 'row', gap: 2, marginTop: 6 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: 14, paddingVertical: 10,
  },
  ctaText: { color: '#fff', fontSize: 14, fontFamily: 'Nunito_800ExtraBold' },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (If `GlassCard` doesn't accept `onPress`, confirm against `src/components/GlassCard.tsx` — its props are `ViewProps & { onPress?: () => void }`, so it does.)

- [ ] **Step 3: Commit**

```bash
git add src/screens/home/sections/TodayBlock.tsx
git commit -m "home: TodayBlock adaptive card component"
```

---

## Task 3: Wire `TodayBlock` into `HomeScreen` + reorder sections

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Import TodayBlock** — add with the other section imports:

```ts
import { TodayBlock } from './home/sections/TodayBlock';
```

- [ ] **Step 2: Replace the `sections` array** with the intent-ordered version including `today`. Replace the existing `const sections = useMemo<HomeSection[]>(() => [ ... ]` array body with:

```ts
  const sections = useMemo<HomeSection[]>(() => [
    { key: 'onboarding', render: () => (user && configured
      ? <OnboardingChecklist hasProfilePhoto={!!user.photoURL} catchCount={catchCount} followingCount={followingCount} />
      : null) },
    { key: 'today', render: () => <TodayBlock followingCatches={followingCatches} weather={weather} nearestSpotName={nearestWaters[0]?.name ?? null} /> },
    { key: 'monthlyBest', render: () => <MonthlyBestPill best={bestThisMonth} /> },
    { key: 'addCatch', render: () => <AddCatchCta /> },
    { key: 'following', render: () => <FollowingSection catches={followingCatches} /> },
    { key: 'forecast', render: () => <WeatherForecastCard weather={weather} weatherStatus={weatherStatus} forecast={forecast} /> },
    { key: 'solunar', render: () => <SolunarSection coord={userCoord} /> },
    { key: 'tournaments', render: () => <TournamentsSection tournaments={activeTournaments} /> },
    { key: 'thisDay', render: () => <ThisDayRail catches={thisDayCatches} /> },
    { key: 'nearest', render: () => <NearestWaterSection waters={nearestWaters} onRequestLocation={requestLocation} /> },
    { key: 'recent', render: () => <RecentCatchesSection catches={recentCatches} /> },
    { key: 'featured', render: () => <FeaturedAnglerCard /> },
    { key: 'classics', render: () => <ClassicsHighlight classic={topClassic} /> },
    { key: 'tail', render: () => <View style={{ height: spacing.xxl }} /> },
  ], [
    user, configured, catchCount, followingCount, bestThisMonth, weather, weatherStatus,
    forecast, userCoord, activeTournaments, thisDayCatches, followingCatches, nearestWaters,
    requestLocation, recentCatches, topClassic,
  ]);
```

Notes: `shortcuts` (ShortcutRow) is intentionally **dropped from the lineup** — the design's reorder list does not include it (the three shortcuts duplicate Profile-tab destinations now reachable via the Today CTA + tabs). Its component file stays for potential reuse. The `useMemo` dependency array is unchanged (TodayBlock reads only already-listed deps: `followingCatches`, `weather`, `nearestWaters`).

- [ ] **Step 3: Remove the now-unused ShortcutRow import** from `HomeScreen.tsx` (the line `import { ShortcutRow } from './home/sections/ShortcutRow';`). `noUnusedLocals` is off so leaving it wouldn't error, but remove it to keep the file honest.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run the logic suite** (confirms selectTodayCard still green alongside the rest)

Run: `npm test`
Expected: PASS — 5 logic files now (firestoreSanitize, feedRanking, solunar, personalBests, selectTodayCard), 36 tests total (29 + 7).

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "home: slot TodayBlock + reorder sections by intent"
```

---

## Task 4: Device verification (USER) + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-home-redesign-design.md` (mark Phase 2 done)

- [ ] **Step 1: Device check (USER)** — `npm run reinstall:ios`. Confirm: the Today block appears directly under the hero; it shows the social card when a followed angler posted today, otherwise the conditions/baseline card; its CTA navigates (FeedTab vs AddCatch); the new section order reads Hero → Today → (monthly best) → Add → Following → Forecast → Solunar → Tournaments → This-day → Nearest → Recent → Featured → Classics; the ShortcutRow is gone; scroll/refresh still fine.
- [ ] **Step 2:** In the design spec, change the Phase 2 status note to "Phase 2 — DONE 2026-06-04". Commit:

```bash
git add docs/superpowers/specs/2026-06-04-home-redesign-design.md
git commit -m "docs: mark home redesign Phase 2 complete"
```

---

## Self-Review (plan author)

**1. Spec coverage (Phase 2):** Adaptive Today block → Task 2 (component) + Task 1 (the documented 3-branch priority: social > good-conditions > baseline). `selectTodayCard` as a unit-tested pure function → Task 1. Intent reorder → Task 3. "#6 rails = no-op" → honored (not touched). "No new data fetches" → honored (TodayBlock consumes existing `followingCatches`/`weather`/`nearestWaters`). Onboarding + monthly-best pinned near top → Task 3 order. ✓

**2. Placeholder scan:** No TBD/"handle later". Every code step is complete (full `selectTodayCard`, full test file, full `TodayBlock`, full sections array). Device step is an explicit user action, not a vague instruction.

**3. Type consistency:** `TodayCard`/`TodaySignals`/`GOOD_FISHING_THRESHOLD`/`selectTodayCard` defined in Task 1 and used identically in Task 2's `TodayBlock` and the tests. `TodayBlock` props (`followingCatches`/`weather`/`nearestSpotName`) match the call site in Task 3. `followingCatches` element shape (`{ ownerUid; ownerName?; date }`) is a structural subset of `CloudCatch`, so passing `CloudCatch[]` satisfies it. `nearestWaters[0]?.name` is `string | undefined` → coerced to `null` via `?? null` to match `nearestSpotName: string | null`. `fishingLabel` reused from `homeHelpers` (Phase 1). ✓

**4. Decision note:** Dropping `ShortcutRow` from the lineup is a real behavior change (not pure reorder). It follows the approved spec's reorder list, which omits it. Flagged here and surfaced in the Task 4 device check so the user can veto if they disagree.
