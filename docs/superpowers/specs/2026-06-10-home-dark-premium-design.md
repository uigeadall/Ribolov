# Home Screen Redesign — Dark-Premium Grouped Cards

**Date:** 2026-06-10 · **Status:** Approved (plan-mode approval, same date)

## Goal

Replace the Home screen's "blue gradient hero + wave cap + glassmorphism" look with a
**dark-premium, data-forward design language built on Apple-style grouped cards**.
Direction chosen by the user from visual mockups: blend of *dark premium*
(Fishbrain-Pro/Strava: big numerals, cold accent) and *iOS native grouped cards*
(flat cards, list rows, hairline dividers).

## Locked decisions

1. **Theme-aware** — the language works in light AND dark mode (dark is the showcase).
   ThemeContext (mode + 5 accent presets) is unchanged.
2. **Trim + restructure** — 15 stacked sections become ~9 focused ones; weak entry
   points move behind «Виж още» link rows.
3. **Teal accent** replaces orange `#F5890A` as the «океан» default:
   dark `#2DD4BF`, light `#0F766E` (AA on white — raw `#2DD4BF` is 1.9:1 there).
   Other accent presets untouched.

## Design language rules

- Flat `colors.card` surfaces, 1px hairline borders.
- **No shadows** except photo tiles. **No gradients** except photo overlays.
- Uppercase `typography.overline` micro-labels.
- Big numerals (Nunito ExtraBold, 32–48pt, tight letterSpacing).
- Single accent color; per-section accent colors (orange/purple/gold) are removed.

## Target structure (header + 9 sections)

**ListHeaderComponent** (replaces HeroHeader + wave cap): flat app bar (brand mark,
chats/notifications BadgeIcons) + greeting block (big `greeting(), {firstName}`,
muted `date · location` micro-line). Weather moves out of the header entirely.

| # | Key | Content |
|---|-----|---------|
| 1 | `onboarding` | OnboardingChecklist (conditional) — flat restyle |
| 2 | `conditions` | NEW **ConditionsCard**: selectTodayCard smart strip · big temp numeral + WeatherIcon + fishing-rating chip · hairline meta grid (wind/precip/pressure/moon) · BiteForecast · species tip caption · 7-day strip · compact solunar row. Link «Виж на картата →» |
| 3 | `following` | FollowingSection — restyle |
| 4 | `stats` | NEW **StatTileRow**: «Улови» count (→ Logbook) · «Рекорд за месеца» (→ CatchDetail) · teal «+ Улов» tile (→ AddCatch) |
| 5 | `tournaments` | TournamentsSection (self-hiding) — restyle |
| 6 | `thisDay` | ThisDayRail (self-hiding) — restyle |
| 7 | `recent` | RecentCatchesSection — restyle |
| 8 | `nearest` | NearestWaterSection — one grouped card, hairline rows |
| 9 | `community` | NEW **CommunitySection**: classics photo-of-week + featured-angler row; halves self-hide |
| 10 | `more` | NEW **MoreLinksSection**: settings-style rows — Турнири, План за риболов, Класики, Карта |
| 11 | `tail` | spacer |

**Deleted:** HeroHeader, TodayBlock, WeatherForecastCard, SolunarSection,
MonthlyBestPill, AddCatchCta, ShortcutRow, ClassicsHighlight. FeaturedAnglerCard
leaves Home (component file stays; its self-fetch moves into CommunitySection).
GlassCard becomes unused by Home (dead-code cleanup later, not in this redesign).

## Token strategy

- Only global palette change: ocean preset + top-level `lightColors`/`darkColors`
  accent → teal as above.
- `useHomeTheme.ts` is the home token hook: drop `heroGrad`/`waveColor`; add `bg`,
  `surface`, `hairline`, `accentSoft` (accent+`1A`), `onAccent` (dark `#04201C` ink /
  light `#FFFFFF`). `cardBg`/`cardBorder` stay as migration aliases until Phase 3.
- Hard-coded color removals: AddCatchCta orange gradient (deleted with component),
  ComposeFab `#F5A020` → `colors.accent` (re-skins FAB on Feed/Logbook too —
  intentional), `fishingLabel` moderate `#F5890A` → `#F0A830`.
- `Screen` wrapper unchanged; Home passes `gradient={[bg,bg,bg]}`.
- SolunarCard / BiteForecast are shared with WaterDetailScreen — reuse, never fork.

## Out of scope

Data loaders, `selectTodayCard.ts` (its 7 tests must keep passing), Screen API,
navigation beyond «Виж още» rows to existing screens, other accent presets,
palette surface tokens.

## Phasing & verification

Three phases (tokens+chrome → structural merges → restyles+polish), each gated on
`npx tsc --noEmit` + `npm test`, with iOS **simulator** screenshot review
(device installs blocked on signing). Final sweep: light/dark × 5 accent presets,
empty cold start, pull-to-refresh, FAB, all link navigations.
Implementation detail lives in the approved plan
(`~/.claude/plans/declarative-spinning-quokka.md`).
