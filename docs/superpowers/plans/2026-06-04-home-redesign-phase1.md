# Home Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Recommended here: inline execution** — this is a tightly-coupled single-file refactor (`HomeScreen.tsx`); parallel subagents would conflict and each would pay a cold read of a 1,376-line file.

**Goal:** Decompose `HomeScreen.tsx` (1,376 lines, one `ScrollView`) into focused section components, then swap the `ScrollView` for a virtualized `FlashList` — with **zero visual/behavioral change**.

**Architecture:** `HomeScreen` stays the data-loading container (all `useState`/`load*`/`useEffect`/`useMemo` unchanged). Each visual section becomes a component under `src/screens/home/sections/`. Components pull theme via a shared `useHomeTheme()` hook and navigation via `useAppNavigation()` themselves, so they take only **data + a few stateful callbacks** as props (no theme prop-drilling). Repeated UI (section header ×8, empty-hint ×3, catch-tile styles ×3) is shared. Final task swaps the container to `FlashList`.

**Tech Stack:** React Native, Expo, `@shopify/flash-list` (already a dependency), `useTheme`, `useAppNavigation`.

**Verification reality:** No UI/component tests exist and the app can't be run in this environment. Per-task verification = `npx tsc --noEmit` clean (catches type/prop breaks). **True visual parity is verified by the user on device via `npm run reinstall:ios`** after the extraction tasks and again after the FlashList swap. The FlashList swap (Task 14) is the only step that changes scroll/layout fundamentals — it is last and explicitly device-gated.

---

## File Structure (Phase 1 target)

```
src/screens/
  HomeScreen.tsx                       # container: state, loaders, builds section list, renders FlashList
  home/
    useHomeTheme.ts                    # derived theme vars (cardBg, cardBorder, waveColor, heroGrad, ...)
    sections/
      sectionStyles.ts                 # shared StyleSheet: sectionRow/Left/Accent/Label/Link, emptyHint*, catchCard/catchEmpty
      HomeSectionHeader.tsx            # accent bar + label + optional right link (replaces the 8× inline header)
      EmptyHint.tsx                    # icon + text + chevron pressable (replaces the 3× inline empty hint)
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
```

Extraction rule for every section task: **move the existing JSX block verbatim** from `HomeScreen.tsx` (identified by its `{/* ── … ── */}` comment marker) into the new component, replacing closed-over locals with: `useHomeTheme()` values, `useAppNavigation()`, props (data), and the shared `HomeSectionHeader`/`EmptyHint`/`sectionStyles`. Section-specific style keys move into a local `StyleSheet.create` in the component; the shared keys live in `sectionStyles.ts`. No visual change.

---

## Task 1: Shared scaffolding (theme hook + shared styles + shared header/empty-hint)

**Files:**
- Create: `src/screens/home/useHomeTheme.ts`
- Create: `src/screens/home/sections/sectionStyles.ts`
- Create: `src/screens/home/sections/HomeSectionHeader.tsx`
- Create: `src/screens/home/sections/EmptyHint.tsx`

- [ ] **Step 1: `useHomeTheme.ts`** — encapsulate the theme-derived locals currently computed in `HomeScreen` (lines ~663–673) so every section derives them identically:

```ts
import { useTheme } from '../../services/themeContext';

export function useHomeTheme() {
  const { colors, mode } = useTheme();
  const heroGrad: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#4EAEE0', '#1E7CC4', '#0D559A'];
  return {
    colors, mode,
    heroGrad,
    waveColor:  mode === 'dark' ? '#080E1A' : '#F2F8FF',
    cardBg:     mode === 'dark' ? '#0E1E35' : '#FFFFFF',
    cardBorder: mode === 'dark' ? 'rgba(74,168,232,0.15)' : 'rgba(21,112,184,0.10)',
    textColor:  colors.text,
    mutedColor: colors.textMuted,
    primary:    colors.primary,
    accent:     colors.accent,
  };
}
```

- [ ] **Step 2: `sectionStyles.ts`** — move the shared `S` keys used by 2+ sections (`sectionRow`, `sectionLeft`, `sectionAccent`, `sectionLabel`, `sectionLink`, `emptyHint`, `emptyHintIcon`, `emptyHintText`, `catchCard`, `catchEmpty`) out of `HomeScreen`'s `S` into a `StyleSheet.create` exported as `sectionStyles`. Copy the exact style declarations from `HomeScreen.tsx`'s current `S` definitions (do not re-derive values).

- [ ] **Step 3: `HomeSectionHeader.tsx`** — the header that currently repeats 8× (`<View style={S.sectionRow}><View style={S.sectionLeft}><View accent/><Text label/></View>{link}</View>`):

```tsx
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { sectionStyles as s } from './sectionStyles';
import { useHomeTheme } from '../useHomeTheme';

type Props = {
  label: string;
  accentColor?: string;            // defaults to primary
  link?: { text: string; onPress: () => void };
};

export function HomeSectionHeader({ label, accentColor, link }: Props) {
  const { primary, mutedColor } = useHomeTheme();
  return (
    <View style={s.sectionRow}>
      <View style={s.sectionLeft}>
        <View style={[s.sectionAccent, { backgroundColor: accentColor ?? primary }]} />
        <Text style={[s.sectionLabel, { color: mutedColor }]}>{label}</Text>
      </View>
      {link ? (
        <Pressable onPress={link.onPress} hitSlop={8}>
          <Text style={[s.sectionLink, { color: primary }]}>{link.text}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: `EmptyHint.tsx`** — the empty-state pressable that repeats 3× (Following/Nearest/Recent):

```tsx
import React from 'react';
import { Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sectionStyles as s } from './sectionStyles';
import { useHomeTheme } from '../useHomeTheme';
import { View } from 'react-native';

type Props = { icon: keyof typeof Ionicons.glyphMap; text: string; onPress: () => void };

export function EmptyHint({ icon, text, onPress }: Props) {
  const { cardBg, cardBorder, primary, mutedColor } = useHomeTheme();
  return (
    <Pressable onPress={onPress} style={[s.emptyHint, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={[s.emptyHintIcon, { backgroundColor: primary + '18' }]}>
        <Ionicons name={icon} size={20} color={primary} />
      </View>
      <Text style={[s.emptyHintText, { color: mutedColor }]}>{text}</Text>
      <Ionicons name="chevron-forward" size={16} color={mutedColor} />
    </Pressable>
  );
}
```

- [ ] **Step 5:** `npx tsc --noEmit` → clean (new files compile; nothing wired yet).
- [ ] **Step 6: Commit** — `git add src/screens/home && git commit -m "home: shared scaffolding (useHomeTheme, sectionStyles, HomeSectionHeader, EmptyHint)"`

---

## Tasks 2–13: Extract one section per task

For **each** task below: create the component file, move its JSX block verbatim (per the extraction rule), replace its inline header with `<HomeSectionHeader …>` and inline empty-hint with `<EmptyHint …>` where applicable, wire it into `HomeScreen` in place of the moved block (import + render with the listed props), delete the now-dead `S` keys + locals it used, then `npx tsc --noEmit` and commit. Keep behavior identical.

### Task 2: `HeroHeader.tsx`  (source: HERO block, lines ~699–810)
**Props:** `{ weather: WeatherSnapshot | null; weatherStatus: 'idle'|'loading'|'error'; firstName: string; dateStr: string; locLabel: string; unreadMsgs: number; unreadNotifs: number; onRetryWeather: () => void }`. Pulls `useHomeTheme()` (heroGrad/mode) + `useAppNavigation()`. Keep the module-local `greeting()`, `fishingLabel()`, `moonPhaseEmoji()` helpers it needs — move the ones used only by the hero with it; leave `fishingLabel` shared (also used by WeatherForecastCard) in a small `home/sections/forecastHelpers.ts` if both need it. `fLabel` is derived inside from `weather`.
- [ ] tsc clean → commit `"home: extract HeroHeader"`

### Task 3: `MonthlyBestPill.tsx`  (source: lines ~826–844)
**Props:** `{ best: Catch | null }` (renders null when `best` is null). Uses `useHomeTheme()` + `useAppNavigation()`. Local styles: `pbPill`, `pbPillIcon`, `pbPillLabel`, `pbPillTitle`.
- [ ] tsc clean → commit `"home: extract MonthlyBestPill"`

### Task 4: `AddCatchCta.tsx`  (source: lines ~846–866)
**Props:** none (self-contained; uses `useAppNavigation()` + Haptics). Local style: `ctaCard`, `ctaCardText`, `ctaCardSub`.
- [ ] tsc clean → commit `"home: extract AddCatchCta"`

### Task 5: `ShortcutRow.tsx`  (source: lines ~868–889)
**Props:** none (uses `useAppNavigation()` + `useHomeTheme()`). Local styles: `pillRow`, `pillBtn`, `pillBtnText`.
- [ ] tsc clean → commit `"home: extract ShortcutRow"`

### Task 6: `WeatherForecastCard.tsx`  (source: Прогноза block, lines ~891–991)
**Props:** `{ weather: WeatherSnapshot | null; weatherStatus: 'idle'|'loading'|'error'; forecast: ForecastDay[] }`. Uses `useHomeTheme()` + `useAppNavigation()` + `HomeSectionHeader` (label "Прогноза", link "Виж на картата →" → MapTab). Keeps `BiteForecast`, `getSeasonSuggestions`, the species-suggestion chip, and the 7-day strip (incl. its `Skeleton` loading state). Local styles: `forecastScroll`, `fcCard`, `fcDay`, `fcDate`, `fcTemp`.
- [ ] tsc clean → commit `"home: extract WeatherForecastCard"`

### Task 7: `SolunarSection.tsx`  (source: lines ~993–1007)
**Props:** `{ coord: { latitude: number; longitude: number } | null }` (null → renders null). Uses `HomeSectionHeader` (label "Лунен прогноз", accent `#7B5BBE`) + existing `SolunarCard`.
- [ ] tsc clean → commit `"home: extract SolunarSection"`

### Task 8: `TournamentsSection.tsx`  (source: lines ~1009–1073)
**Props:** `{ tournaments: Tournament[] }` (empty → null). Uses `useHomeTheme()` + `useAppNavigation()` + `HomeSectionHeader` (label "Твои турнири", accent `#E8902E`, link "Виж всички →" when >1). Keeps the days-left computation + inline row styling.
- [ ] tsc clean → commit `"home: extract TournamentsSection"`

### Task 9: `ThisDayRail.tsx`  (source: В този ден block, lines ~1075–1131)
**Props:** `{ catches: Catch[] }` (empty → null). Uses `useHomeTheme()` + `useAppNavigation()` + `HomeSectionHeader` (label "В този ден", accent `#E8902E`). Keeps the horizontal `ScrollView` rail + age-badge logic. Uses shared `catchCard`/`catchEmpty` from `sectionStyles`.
- [ ] tsc clean → commit `"home: extract ThisDayRail"`

### Task 10: `FollowingSection.tsx`  (source: lines ~1133–1199)
**Props:** `{ catches: CloudCatch[] }`. Uses `useHomeTheme()` + `useAppNavigation()` + `HomeSectionHeader` (label "От твоите приятели", link "Към лентата →" → FeedTab when non-empty) + `EmptyHint` (icon "people-outline", text "Намери приятели, за да виждаш техните улови" → ProfileTab/Friends) for the empty branch. Shared `catchCard`/`catchEmpty`.
- [ ] tsc clean → commit `"home: extract FollowingSection"`

### Task 11: `NearestWaterSection.tsx`  (source: lines ~1201–1267)
**Props:** `{ waters: Array<{ kind: 'dam'|'river'; id: string; name: string; region: string; km: number }>; onRequestLocation: () => void }`. The empty branch's permission flow (which resets `lastFetchRef` + calls `loadWeather`) stays in `HomeScreen` and is passed as `onRequestLocation`. Uses `HomeSectionHeader` (label "Най-близки водоеми", link "Виж карта →" → MapTab) + `EmptyHint` (icon "location-outline", text "Разреши локация…" → `onRequestLocation`). Local styles: `nearbyList`, `nearbyRow`, `nearbyIconWrap`, `nearbyName`, `nearbyMeta`, `nearbyDistance`.
- [ ] tsc clean → commit `"home: extract NearestWaterSection"`

### Task 12: `RecentCatchesSection.tsx`  (source: lines ~1269–1326)
**Props:** `{ catches: Catch[] }`. Uses `HomeSectionHeader` (label "Недавни улови", link "Виж всички →" → LogbookList) + `EmptyHint` (icon "add-circle-outline", text "Запиши първия си улов — ще го виждаш тук" → AddCatch). Shared `catchCard`/`catchEmpty`.
- [ ] tsc clean → commit `"home: extract RecentCatchesSection"`

### Task 13: `ClassicsHighlight.tsx`  (source: lines ~1331–1365)
**Props:** `{ classic: RankedClassicPhoto | null }` (null/no photo → null). Uses `useHomeTheme()` + `useAppNavigation()` + `HomeSectionHeader` (label "Снимка на седмицата", accent `#FFD700`, link "Класики →"). Local styles: `classicsCard`, `classicsOverlay`, `classicsOwner`, `classicsTitle`, `classicsActions`, `classicsLike`, `classicsVote`, `classicsBadge`.
- [ ] tsc clean → commit `"home: extract ClassicsHighlight"`

**After Task 13:** `HomeScreen`'s `return` is now hero + wave wrapper containing `<OnboardingChecklist/>`, `<MonthlyBestPill/>`, `<AddCatchCta/>`, `<ShortcutRow/>`, `<WeatherForecastCard/>`, `<SolunarSection/>`, `<TournamentsSection/>`, `<ThisDayRail/>`, `<FollowingSection/>`, `<NearestWaterSection/>`, `<RecentCatchesSection/>`, `<FeaturedAnglerCard/>`, `<ClassicsHighlight/>`. `S` should retain only `hero*` + `wave` + `map` keys. **Checkpoint: `npx tsc --noEmit` clean, then USER device check (`npm run reinstall:ios`) confirms the screen is visually identical and all navigation works before Task 14.**

---

## Task 14: Swap `ScrollView` → `FlashList`  (device-gated — the only fundamental change)

**Files:** Modify `src/screens/HomeScreen.tsx`.

- [ ] **Step 1:** Build a typed section list. Add `src/screens/home/types.ts`:

```ts
export type HomeSection = { key: string; render: () => React.ReactElement | null };
```

- [ ] **Step 2:** In `HomeScreen`, replace the `<Screen scroll>` + `<View style={S.wave}>` stack with a `FlashList`:
  - `ListHeaderComponent` = `<HeroHeader … />`.
  - `data` = a `HomeSection[]` built from the section components in the **current order** (Onboarding, MonthlyBestPill, AddCatchCta, ShortcutRow, WeatherForecastCard, SolunarSection, TournamentsSection, ThisDayRail, FollowingSection, NearestWaterSection, RecentCatchesSection, FeaturedAnglerCard, ClassicsHighlight, trailing spacer).
  - `renderItem={({ item }) => item.render()}`, `keyExtractor={(it) => it.key}`, `getItemType={(it) => it.key}`.
  - Apply the wave background (`waveColor`) as the list's `contentContainerStyle`/`style` background so the "rises over hero" effect is preserved.
  - Wire `refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}` onto the FlashList.
  - Keep `<ComposeFab />` outside, as today.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4: Device verification (USER):** `npm run reinstall:ios` — confirm: hero + wave look identical; all sections render in the same order; pull-to-refresh works; scroll is smooth; every section's tap-through navigates correctly; cold-load skeletons (forecast) still show. Only commit once confirmed.
- [ ] **Step 5: Commit** — `git commit -m "home: virtualize with FlashList (no visual change)"`

---

## Self-Review (plan author)

**1. Spec coverage (Phase 1 only):** #7 FlashList → Task 14 ✓. "1,376-line file" decomposition → Tasks 1–13 ✓. "Zero visual change" invariant → verbatim-move rule + device checkpoints ✓. Phases 2–3 explicitly deferred (separate plans) ✓.

**2. Placeholder scan:** No TBD/“handle later”. Scaffolding code (Task 1) is complete and concrete. Extraction tasks specify exact source markers, exact prop interfaces, exact shared helpers, and per-task tsc+commit — the body is a precise verbatim move, not a vague instruction.

**3. Type consistency:** `useHomeTheme()` keys (`cardBg`/`cardBorder`/`primary`/`mutedColor`/`textColor`/`accent`/`mode`/`colors`/`heroGrad`/`waveColor`) are used consistently in HomeSectionHeader/EmptyHint and named identically to the locals they replace. Prop types reuse existing exported types (`WeatherSnapshot`, `ForecastDay`, `Catch`, `CloudCatch`, `Tournament`, `RankedClassicPhoto`). `HomeSection` defined in Task 14 and used only there.

**4. Risk note:** Tasks 2–13 are mechanically safe (tsc-guarded verbatim moves). Task 14 changes scroll/layout fundamentals and is the one step that can regress invisibly to tsc — hence it is last, isolated, and device-gated before commit.
