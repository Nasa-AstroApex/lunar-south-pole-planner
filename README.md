# AstroApex — Lunar South Pole Mission Planner

**NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator**

A C11 mission-planning engine that turns real JPL ephemerides and LOLA terrain
horizons into fast, decision-ready site/date trade studies for the lunar south pole.

> **30-second trade studies.** Pick a landing site and date, and immediately see the
> Sun and Earth positions against the local horizon, the power and direct-to-Earth
> (DTE) communication windows, and how a schedule slip changes everything.

---

## What it does

- **Real ephemerides** — Sun and Earth positions from NAIF CSPICE (`de440s.bsp`,
  `pck00010.tpc`, `naif0012.tls`) in the `IAU_MOON` frame with light-time + stellar
  aberration (`LT+S`).
- **Terrain-aware horizons** — 360° horizon masks from real LOLA 80 m skyline
  profiles for Shackleton Rim, Connecting Ridge, and Malapert Massif (Barker et al.
  2023, NASA GSFC PGDA 90); synthetic analytic terrain elsewhere, always labeled.
- **Sun/Earth visibility & windows** — hourly illumination fraction, DTE windows,
  longest dark period, and the next sunset/sunrise and earthset/earthrise events.
- **Five-site comparison** — Shackleton Rim, Connecting Ridge, Malapert Massif,
  Nobile Rim 1, and Haworth, each with backend score and GO/CAUTION/NO-GO verdict.
- **3B scene** — an `IAU_MOON` kinematic visualization of the spacecraft, descent
  trajectory, and landing sites, clearly labeled as not physics-validated.
- **Provenance everywhere** — every output marks its source: `CSPICE_DE440S_IAU_MOON`,
  `LOLA_80M_SKYLINE`, `SYNTHETIC_ANALYTIC`, heuristic thermal/battery, and kinematic 3B.

## Architecture

```
[NASA kernels: .tls, .bsp, .tpc]        [LOLA / analytic terrain]
              \                            /
               v                          v
        [ C11 physics core: src/cspice_math.c ]
               |             \
               |              +--> [ Lua scoring: lua/main.lua ]
               |                    -> data/output.json (2D mission plan)
               v
        [ 3B scene: src/3b_moon.c ]
               -> data/3b_scene.json / .js (3B scene)

        [ HTTP / CLI: src/main.c ]
               |
        GET /  (2D JSON)      GET /3b (3B JSON)      GET /compare (5-site JSON)
```

Two independent data models are produced and must never be mixed:

1. **2D mission plan** → `data/output.json` (schema: `src/cspice_math.h`; UI contract: `docs/UI_CONTRACT.md`)
2. **3B scene** → `data/3b_scene.json` / `data/3b_scene.js` (schema: `src/3b_moon.h`)

## Build & run

```bash
make clean && make          # build/build/lunar_sim (+ MissionPlanner symlink)
make test                   # smoke test (--once)
make validate               # 2D + 3B + ranking JSON consistency checks
make snapshots              # regenerate the static demo snapshot catalog + offline sample
```

### CLI

```bash
./build/lunar_sim --once \
  "Shackleton Rim" -89.7668 -171.87 2026-10-18T00:00:00 14
```

### HTTP server

```bash
./build/lunar_sim --serve 8080
```

```bash
# 2D mission plan
curl 'http://127.0.0.1:8080/?site=Shackleton%20Rim&lat=-89.7668&lon=-171.87&utc=2026-10-18T00:00:00&days=14'

# 3B landing scene
curl 'http://127.0.0.1:8080/3b?mode=0&t_sec=0&site=Connecting%20Ridge&lat=-89.4632&lon=-137.49'

# Five-site comparison (race-free, in-memory)
curl 'http://127.0.0.1:8080/compare?utc=2026-10-18T00:00:00&days=14'
```

The HTTP layer renders each response in memory (no shared-file writes), so parallel
requests for site comparisons are safe.

### CSPICE setup

`cspice/` is not committed. Download the NAIF CSPICE C toolkit from
<https://naif.jpl.nasa.gov/naif/toolkit_C.html>, extract it as `cspice/` at the repo
root (`cspice/include/SpiceUsr.h`, `cspice/lib/cspice.a`), then `make clean && make`.
Kernels are loaded from `data/kernels/`. If CSPICE is absent or the kernel set is
incomplete, the engine fails closed rather than silently using a fallback ephemeris.

## Web demo (no compiler required)

`ui-starter/` is a self-contained, English "Universe Sandbox" mission control:

- **`index.html`** — full-screen canvas shell + HUD layout (top HUD, mission panel, attitude sphere, debug console).
- **`style.css`** — Mission Control theme with a compact `< 860px` responsive layout.
- **`app.js`** — the 13-body SPICE scene: Kepler orbit rings + trails, 1:1 camera focus modes, a unified time warp, right-click custom landing target, a continuous descent simulation, and a 3D spacecraft attitude sphere.
- **`debug.js`** — a built-in live Debug & Telemetry console (`D` key or the "Debug Logs" button; `[BOOT]`/`[API]`/`[SIM]`/`[RUNTIME]` records, `.log` download, copy-to-clipboard).
- **`data/3b_scene.js`** — default scene (`window.SCENE_3B_DATA`).
- **`data/demo_snapshots.json`** — the static scenario catalog (8 scenarios, exact-request match).
- **`data/sample_output.json`** — offline 2D sample.

### Features

- 13 SPICE bodies (Sun, Earth, Moon, Venus, Mars + 8 asteroids) with Kepler orbit rings and trails.
- 1:1 real-km camera focus modes — `Moon 1:1`, `Earth–Moon 1:1`, `Sun & Asteroids 1:1` — plus a unified time warp (`0x`–`86400x`).
- Right-click the Moon to pick a custom landing point, plus 6 preset south-pole sites.
- Continuous-time descent (`Start Descent Maneuver`, `Loop`, `Return to Orbit`) with an honestly labeled `KINEMATIC VISUALIZATION — NO MASS MODEL` Touchdown Report.
- 3D spacecraft attitude sphere with `Target/Qibla`, `Prograde`, `Nadir`, `Solar`, `Earth DTE` presets and `Vx/Vy/Vz` + `Az/El` controls.

### Run it

Static preview (offline, no compiler):

```bash
cd ui-starter && python3 -m http.server 8000
```

Live C11 engine sync (serves the real backend and streams `/3b` into the viewer when the page is on `localhost`):

```bash
./build/lunar_sim --serve 8080
```

The viewer auto-connects to the live backend **only** when the page host is
`localhost`/`127.0.0.1` (or when `?live=1` is passed explicitly). On any other host it
stays on the static snapshot catalog and never issues a localhost HTTP probe — no
Mixed Content / Connection Refused noise on GitHub Pages.

Refresh the static catalog and offline sample:

```bash
make snapshots && make validate
```

### Public demo

Deploy `ui-starter/` to any static host (GitHub Pages, Vercel, Netlify). The live demo
is published at:

> **https://nasa-astroapex.github.io/lunar-south-pole-planner/**

See `.github/workflows/pages.yml` for the GitHub Pages build.

## Data provenance & honesty

| Topic | Source | JSON marker |
|---|---|---|
| Sun/Earth position (CSPICE) | NAIF CSPICE DE440s, `IAU_MOON`, `LT+S` | `meta.ephemeris_source = "CSPICE_DE440S_IAU_MOON"` |
| Sun/Earth position (fallback) | Meeus analytic series | `meta.ephemeris_source = "ANALYTIC_MEEUS_FALLBACK"` |
| Horizon: 3 known sites | Real LOLA 80 m skyline (Barker et al. 2023) | `meta.dem_info.horizon_source = "LOLA_80M_SKYLINE"` |
| Horizon: everywhere else | Synthetic analytic terrain | `meta.dem_info.horizon_source = "SYNTHETIC_ANALYTIC"` |
| Slope, rover route, ice target | Synthetic terrain | `meta.dem_info.terrain_is_synthetic = true` |
| Temperature, ice probability, battery | Heuristic formulas | labeled "Heuristic" |
| 3B trajectory/touchdown | Kinematic visualization, no mass/fuel model | `physics_valid = false` |
| 3B frame | Sun/Earth/site/spacecraft/trajectory in `IAU_MOON` | `frame = "IAU_MOON"` |
| 3B descent phase | Post-burn descent, distinct from instantaneous orbit | `trajectory_phase = "POST_BURN_DESCENT"` |

The `ui-starter/` 13-body engine is a **kinematic visualization**, not a physics model:
its Kepler orbit rings and RK4 descent are interactive renderings that carry the
`KINEMATIC VISUALIZATION — NO MASS MODEL` label and are never used to derive mission
decisions. The C11 backend remains the source of truth for ephemerides, horizon masks,
illumination, visibility windows, temperatures, scores, and GO/NO-GO verdicts; the
frontend copies those values verbatim and must never override backend constants.

## NASA data & resources

- NAIF CSPICE + SPICE kernels — <https://naif.jpl.nasa.gov/>
- JPL Horizons — <https://ssd.jpl.nasa.gov/horizons/>
- LOLA south-pole DEMs — NASA GSFC PGDA 90, Barker et al. 2023,
  <https://pgda.gsfc.nasa.gov/products/90>, DOI 10.60903/gsfcpgda-lola-spole
- Quickmap — <https://quickmap.lroc.asu.edu/>
- Moon Trek — <https://trek.nasa.gov/moon/>
- Site coordinates — NASA Lunar Surface Data Book, Table A2-2 (NTRS 20230007818)

## Notes

- `make test` is a smoke test; `make validate` verifies internal consistency of the
  2D + 3B + ranking JSON.
- `data/output.json`, `data/3b_scene.json`, `data/3b_scene.js` are generated outputs;
  do not edit them by hand.
- The HTTP server reads only GET query parameters; POST bodies are not parsed.

See `AGENTS.md`, `docs/FRONTEND_GUIDE.md`, `docs/ARCHITECTURE.md`, and
`submission/` for details.
