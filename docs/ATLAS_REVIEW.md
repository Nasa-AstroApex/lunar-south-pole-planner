# Review: Ferman's single-file 3D lunar atlas

Source reviewed: `~/Downloads/astroapex_ay_atlas_g_rev_planlay_c (1).html` (116 KB,
single-file WebGL/Canvas app, Turkish UI).

## What is strong

- High-FPS WebGL moon with a layered HUD canvas.
- 360° ray-marched horizon mask, timeline, site markers, JSON export.
- Works offline (no build step), so it can be hosted as a static page.

## Critical finding — the terrain is procedural, not LOLA

The app's `DEM` is generated in JavaScript, not read from a LOLA product:

- `generatePlanetaryTextureData()` synthesizes a 2048×1024 texture and a 1024×512
  elevation grid (`demElevationKm`) using `hash3()`, `noise3D()`, `fbm3D()` and a
  hand-written crater list (`craterSpecs`).
- There is no embedded LOLA raster, no external LOLA fetch, and no GDAL/PDS ingest.
- The UI labels it `LRO WAC + LOLA DEM 2048×1024 · CSPICE`, and the horizon function is
  called "360° LOLA DEM RAY-MARCHING". Those labels are not supported by the code.

The Sun model is also simplified: a fixed `sunLat = 1.54°` and a scalar
`state.sunAngleDeg`, not a CSPICE ephemeris. The "live backend" bridge calls
`http://localhost:8080/api/simulate`, which the C11 server does not expose (it serves
`/`, `/compare`, `/3b`).

## Risk

Publishing this as "real LOLA + CSPICE" would be a false scientific claim. NASA Space
Apps judges score **Validity** and **Relevance**; an unlabeled procedural DEM presented
as LOLA data is a credibility risk. It would also contradict this repo's own provenance
rules (`AGENTS.md`, `docs/FRONTEND_GUIDE.md`).

## Recommendation

1. Do **not** make the procedural atlas the primary demo.
2. Keep the C11 engine as the source of truth for Sun/Earth, horizons, windows, and
   decisions. Real LOLA 80 m skyline profiles are used for Shackleton Rim, Connecting
   Ridge, and Malapert Massif; everything else is labeled `SYNTHETIC_ANALYTIC`.
3. If the atlas is integrated later, it must be relabeled:
   - "Procedural lunar atlas — visual only, not LOLA data."
   - Replace `demElevationKm` with a real LOLA heightfield for the supported sites.
   - Replace the JS Sun model with backend `/3b` vectors.
   - Translate the UI to English.
4. Until then, the login-free public demo is `ui-starter/` (English, an interactive
   13-body kinematic viewer backed by the real C11 engine or static snapshots).

This preserves the visual strength without overclaiming the data.
