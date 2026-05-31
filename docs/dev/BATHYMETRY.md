# Bathymetry layer — scoping doc

**Goal:** Show depth contours for major Bulgarian reservoirs on the map.
Pro anglers fish specific depths (drop-offs, channels, weed lines) and
choose spots based on bathymetric features. This is the single biggest
"why we use Ribolov vs FishBrain" feature for serious users.

**Status:** Not started. Foundation for a future implementation session.

## Why this is hard

1. **Data sourcing.** Bulgarian reservoir bathymetry isn't published in
   one neat dataset. Sources to check:
   - ИАРА (Изпълнителна агенция по рибарство и аквакултури)
   - МОСВ (Министерство на околната среда и водите) open data portal
   - НАПС (Напоителни системи) — they manage most large reservoirs
   - Kapka.bg (community angling site) — may have crowd-sourced depths
   - Academic datasets from BAS / SU (Sofia University) — limnology grants
   - Reservoir operators' annual reports (sediment studies often include
     depth surveys)
   - Satellite-derived bathymetry for clear shallow water (Sentinel-2)
   - Sonar logs from active anglers (could solicit via in-app upload)

2. **Format conversion.** Likely sources are PDFs, scanned maps, or
   shapefiles. Need a pipeline:
   - Source → raw depth points
   - Interpolate to a grid (kriging or IDW)
   - Generate contour lines at e.g. 2 m intervals
   - Export as MBTiles / PMTiles vector tiles
   - Host on R2 (zero egress) or similar

3. **Map integration.** MapLibre can render vector tiles natively
   (already wired). Adding a bathymetry source is straightforward once
   tiles exist — ~30 min of code. Hard part is the tile generation
   pipeline, not the client.

4. **Rendering quality.** Contour labels at high zoom (depth values),
   color ramp by depth range, opacity blending with the satellite
   layer, snapping to dam boundaries. ~1-2 days of polish once basic
   contours render.

## Suggested phased plan

### Phase 1 — Pilot with 3 reservoirs (~3-5 days)
- Pick 3 popular reservoirs (Iskar, Kardzhali, Studen Kladenec)
- Source depth data manually (PDF maps, satellite, sonar)
- Hand-build contours in QGIS
- Export as GeoJSON → MapLibre source
- Ship as a hidden "Развойна функция" toggle in Settings

### Phase 2 — Production rollout (~2 weeks)
- Build the tile-generation pipeline (Python + GDAL + Tippecanoe)
- Process every Bulgarian reservoir with available data
- Host tiles on R2
- Cache headers for client-side caching
- Bathymetry toggle in Map screen layer chooser
- Promotion: "Now showing depth contours for 47 reservoirs"

### Phase 3 — Crowd-sourced expansion (~ongoing)
- "Submit your sonar log" upload flow
- Server-side accepts .gpx / .sl3 / .csv files
- Validates and queues for monthly tile rebuild
- Contributor leaderboard ("депосити дълбочинни данни")

## Files / modules that will need work

- New service: `src/services/bathymetry.ts` — tile URL resolver, opt-in flag
- `src/components/MapLibreMap.tsx` — add the raster/vector source + layer
- Settings screen: layer toggle
- New Cloud Function: `processSonarUpload` (Phase 3)
- New R2 bucket: `bathymetry-tiles`

## Cost estimate

- One-time data engineering: 1-3 weeks depending on data quality
- Ongoing tile hosting: <$5/month on R2 (vector tiles are small)
- Crowd-sourced processing function: ~$0 on free-tier Cloud Functions

## Why we're not doing this in the current session

Multi-day data engineering project that needs research time. The code
side is small once data exists. Open as a tracked epic to revisit when
the user has bandwidth to source the data.
