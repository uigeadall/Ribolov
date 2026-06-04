# Home Screen Redesign — Design

**Date:** 2026-06-04
**Status:** Approved (user approved the 3-phase design; starting with Phase 1)
**Screen:** `src/screens/HomeScreen.tsx` (currently 1,376 lines, a single `ScrollView` rendering ~13 stacked sections)

## Goal

Address 8 UI/UX/frontend improvements to the app's most-trafficked screen, delivered in **3 verifiable phases**, each shippable on its own. The screen currently renders all sections eagerly in one `ScrollView` and the file is unwieldy.

## Constraints / reality

- **No UI/component test framework exists** (the repo has only the logic + Firestore-rules suites added 2026-06-03). A visual redesign cannot be auto-verified. Verification per phase = `npx tsc --noEmit` green + manual device check via `npm run reinstall:ios`. The one piece with real branching logic (Today-block card selection) WILL get a pure-function unit test in the existing Vitest logic suite.
- The screen is the highest-traffic surface, so changes ship phase-by-phase behind device verification, not in one sweep.
- Reuse existing primitives — `Card`, `GlassCard`, `SectionHeader`, `EmptyState`, `Skeleton`/`ListSkeleton`, `SolunarCard` already exist. No new design-system primitives.
- No new data fetches. The adaptive Today block uses only signals already loaded on Home (`weather`/`fishingLabel`, the solunar service, `followingCatches`, `nearestWaters`). There is no trip data on Home, so no "unlogged trip" branch.

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Sequencing | 3 phases, ship each |
| Today block | Smart / adaptive |
| Rails | Only "This day in history" — and it is ALREADY a horizontal rail, so no rail work is needed; Following/Recent/Nearest stay as-is |
| Hero meta row | Demote to a tappable/expandable strip (Phase 3) |
| Verification | tsc + manual device check each phase; unit-test the Today-block selector |

---

## Phase 1 — Structure & perf foundation  (addresses #7 FlashList + the 1,376-line file)

**Extract the sections** out of `HomeScreen.tsx` into focused components under `src/screens/home/sections/`:
`HeroHeader`, `MonthlyBestPill`, `AddCatchCta`, `ShortcutRow`, `WeatherForecastCard`, `SolunarSection`, `TournamentsSection`, `ThisDayRail`, `FollowingSection`, `NearestWaterSection`, `RecentCatchesSection`, `ClassicsHighlight`.
- Each component receives its data + callbacks via props. `HomeScreen` remains the data-loading container (keeps all `useState`/`load*`/`useEffect`).
- Styles for each section move with the component (the relevant slice of the current `S` StyleSheet).

**Replace the `ScrollView`** (in the `Screen` wrapper usage) with `@shopify/flash-list`:
- Build a typed `HomeSection[]` descriptor array in `HomeScreen`; render via `FlashList` with `getItemType` per section so heterogeneous sections recycle correctly.
- The hero renders as the list header (or the first item).
- Pull-to-refresh (`FishingRefreshControl`) wired to FlashList's `refreshControl`.

**Invariant: zero visual or behavioral change.** Phase 1 is a pure structural move. Same sections, same order, same look. Success = the screen looks/behaves identically and scrolls more smoothly (below-fold image sections no longer mount until approached).

**Verification:** `npx tsc --noEmit` green; manual device parity check (`npm run reinstall:ios`) — screen identical, scroll smooth, pull-to-refresh works, navigation from each section works.

---

## Phase 2 — Content / information architecture  (addresses #1 Today block, #2 reorder; #6 rails = no-op)

**New `TodayBlock` component** at the top of the content area. The card-selection logic is a **pure function** `selectTodayCard(signals): TodayCard` extracted to `src/screens/home/selectTodayCard.ts` so it is unit-testable. Priority (using only loaded signals):
1. **Fresh following activity today** (any `followingCatches` dated today) → social card: "<name> и още N споделиха нови улови" → CTA "Към лентата".
2. **else good conditions** (`weather.fishingRating >= GOOD_THRESHOLD`) → conditions card: nearest spot + solunar window + rating → CTA "Запиши улов".
3. **else baseline conditions card** (always renders something with whatever weather is available; if weather missing, a neutral "Запиши улов" prompt).

**Reorder sections by intent:** Hero → **TodayBlock** → Add-CTA → Following → Forecast → Solunar → Tournaments → This-day → Nearest water → Recent → Classics. Onboarding checklist + monthly-best pill stay pinned near the top for new users.

**Rails:** none to build — "This day" is already a horizontal rail; Following/Recent/Nearest remain unchanged per the user's choice.

**Verification:** unit tests for `selectTodayCard` (all 3 priority branches + missing-weather fallback) in the Vitest logic suite; `tsc`; device check.

---

## Phase 3 — Polish  (addresses #3 empty states, #4 hero, #5 card tokens, #8 skeletons)

- **Empty states:** replace "hide the section" with aspirational `EmptyState` placeholders — Following: "Последвай рибари, за да виждаш техните улови"; Recent: "Запиши първия си улов". (Other sections keep hiding when empty if a placeholder would be noise.)
- **Hero meta row:** wind/precip/moon becomes a **tappable strip**, collapsed by default, expanding on tap so the hero is less of a dashboard.
- **Card consistency:** route each section's container through the existing `Card`/`GlassCard` components for uniform radius/shadow/padding. (Theme exposes color tokens — `card`, `cardEdge` — but no radius/shadow tokens, so consistency comes from the shared components, not new tokens.)
- **Skeletons:** during the 3 mount loads (`loadStats`, `loadWeather`, `loadTodayHub`), show per-section `Skeleton`/`ListSkeleton` placeholders instead of the single spinner — instant layout, no shift.

**Verification:** `tsc`; device check (empty states for a fresh account, hero expand/collapse, skeleton-on-cold-load).

---

## File structure (Phase 1 target)

```
src/screens/
  HomeScreen.tsx                  # data-loading container; builds HomeSection[]; renders FlashList
  home/
    sections/
      HeroHeader.tsx
      MonthlyBestPill.tsx
      AddCatchCta.tsx
      ShortcutRow.tsx
      WeatherForecastCard.tsx
      SolunarSection.tsx
      TournamentsSection.tsx
      ThisDayRail.tsx
      FollowingSection.tsx
      NearestWaterSection.tsx
      RecentCatchesSection.tsx
      ClassicsHighlight.tsx
    types.ts                      # HomeSection descriptor union + shared section prop types
    # Phase 2 adds: TodayBlock.tsx, selectTodayCard.ts
```

## Non-Goals

- No new data sources or Firestore reads (no trip data, no new aggregates).
- No new design-system tokens/components beyond the existing primitives.
- No converting Following/Recent/Nearest to rails (explicit user choice).
- No UI test framework adoption (out of scope; only the pure `selectTodayCard` gets a unit test).
- Phases 2 and 3 get their own implementation plans after Phase 1 ships.

## Success criteria

- **Phase 1:** screen renders identically, scrolls more smoothly, file decomposed into focused section components, `tsc` clean, device parity confirmed.
- **Phase 2:** adaptive Today block live with the documented priority; sections reordered; `selectTodayCard` unit-tested green.
- **Phase 3:** aspirational empty states, collapsible hero meta, consistent card styling, per-section skeletons.
