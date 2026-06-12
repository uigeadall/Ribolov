# FishAngler-deep screen redesign — design

## What & why

The palette (FishAngler teal/navy/white) and feed-first structure are done, but
screen CONTENT still uses the old app's layouts. User decision (2026-06-12):
clone FishAngler's proven screen patterns nearly 1:1 with Ribolov's data.
Colors and navigation do NOT change. Purely presentational, component-level.

## Process rule (learned the hard way)

No mockups. One screen at a time: implement → user reviews LIVE in the
simulator → adjust until approved → commit → next screen. Mockup-approval
failed twice; live-approval is the only validation that counts.

## Screen order

1. **Feed post card** (`src/components/FeedPost.tsx`) — FishAngler card
   anatomy: header row (avatar; bold "Име при Водоем" inline; date · region
   muted below; ⋯ menu), edge-to-edge photo, species pill UNDER the photo
   (navy pill, fish icon, "Шаран · 4.2 кг"), caption, muted counts line
   ("34 харесвания · 7 коментара"), hairline divider, flat icon action row,
   comments preview.
2. **Logbook list rows** (`src/screens/LogbookScreen.tsx`) — clean list-row
   language: thumbnail left, title + meta stacked, weight chip right.
3. **Species detail** (`src/screens/SpeciesDetailScreen.tsx`) — tabbed layout:
   name + star rating + catch-count header; tabs (Детайли / Стръв / Улови /
   Води); pill sub-filters; rated list rows.
4. **Stats → Intel** (`src/screens/StatsScreen.tsx`) — "Catches by Species":
   stacked monthly bars colored by species, Total/Species toggle, species
   rows with thumbnail + count.
5. **Profile** (`src/screens/ProfileScreen.tsx`) — lightest touch: apply the
   same list/card language to hero + tabs.

Reference screenshots: FishAngler App Store shots saved at /tmp/fa_1..5.png
(re-downloadable from their App Store listing).

## Constraints

- Data/services/hooks untouched — restyle render only.
- Keep FlashList perf patterns (recycle resets, stable closures) intact.
- Tokens only (no new hex); Chip/NavBand primitives where they fit.
- tsc + vitest green after every screen; one commit per screen.
